-- ============================================================
-- Migration #015 — TG Autopost Queue (#143)
-- ============================================================
-- Додає підтримку автоматичної публікації approved-постів у TG-канал.
-- Worker = GitHub Action runner з ffmpeg, що щоп 5 хв забирає роботи.

-- 1. Додаткові поля у publications
alter table public.publications
  add column if not exists tg_message_id jsonb default null,
  add column if not exists autopost_status text default null,
  add column if not exists autopost_error text default null,
  add column if not exists autopost_attempts int not null default 0;

comment on column public.publications.tg_message_id is 'JSON {chat_id, message_id} для editing/deletion опубл. поста';
comment on column public.publications.autopost_status is 'pending | processing | done | failed | skipped';

create index if not exists idx_pubs_autopost_status
  on public.publications(autopost_status)
  where autopost_status is not null;

-- 2. Таблиця tg_autopost_queue (атомарна черга з claim-логікою)
create table if not exists public.tg_autopost_queue (
    id            uuid primary key default uuid_generate_v4(),
    publication_id uuid not null references public.publications(id) on delete cascade,
    status        text not null default 'pending',  -- pending|processing|done|failed
    attempts      int not null default 0,
    last_error    text,
    target_chat_id text not null,
    enqueued_at   timestamptz not null default now(),
    claimed_at    timestamptz,
    completed_at  timestamptz,
    worker_id     text
);

create index if not exists idx_autopost_queue_pending
  on public.tg_autopost_queue(status, enqueued_at)
  where status in ('pending', 'processing');

create unique index if not exists uniq_autopost_active_per_pub
  on public.tg_autopost_queue(publication_id)
  where status in ('pending', 'processing');

comment on table public.tg_autopost_queue is 'Черга автопостингу — worker (GH Action) забирає pending → processing → done/failed';

-- 3. RPC claim_autopost_jobs — атомарно резервує до N pending robôт.
-- Worker викликає це raз на cron-tick, отримує список з лімітом, обробляє.
create or replace function public.claim_autopost_jobs(worker_name text, max_jobs int default 5)
returns setof public.tg_autopost_queue
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    with claimed as (
        update public.tg_autopost_queue q
        set
            status = 'processing',
            claimed_at = now(),
            worker_id = worker_name,
            attempts = attempts + 1
        where q.id in (
            select id from public.tg_autopost_queue
            where status = 'pending'
              and attempts < 3
            order by enqueued_at asc
            limit max_jobs
            for update skip locked
        )
        returning q.*
    )
    select * from claimed;
end;
$$;

grant execute on function public.claim_autopost_jobs(text, int) to service_role;

-- 4. RPC complete_autopost_job — позначає роботу як done і оновлює pub
create or replace function public.complete_autopost_job(
    job_id uuid,
    pub_id uuid,
    chat_id text,
    msg_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.tg_autopost_queue
    set status = 'done', completed_at = now(), last_error = null
    where id = job_id;

    update public.publications
    set
        status = 'published'::publication_status,
        published_at = now(),
        tg_message_id = jsonb_build_object('chat_id', chat_id, 'message_id', msg_id),
        autopost_status = 'done',
        autopost_error = null,
        last_action_via = 'autopost-tg'
    where id = pub_id;
end;
$$;

grant execute on function public.complete_autopost_job(uuid, uuid, text, bigint) to service_role;

-- 5. RPC fail_autopost_job — фіксує помилку, ставить статус failed якщо attempts=3
create or replace function public.fail_autopost_job(job_id uuid, pub_id uuid, err_msg text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    cur_attempts int;
begin
    select attempts into cur_attempts from public.tg_autopost_queue where id = job_id;
    if cur_attempts >= 3 then
        update public.tg_autopost_queue
        set status = 'failed', last_error = err_msg, completed_at = now()
        where id = job_id;
        update public.publications
        set autopost_status = 'failed', autopost_error = err_msg
        where id = pub_id;
    else
        -- Скидаємо назад у pending для retry на наступному cron
        update public.tg_autopost_queue
        set status = 'pending', last_error = err_msg, claimed_at = null, worker_id = null
        where id = job_id;
        update public.publications
        set autopost_status = 'pending', autopost_error = err_msg
        where id = pub_id;
    end if;
end;
$$;

grant execute on function public.fail_autopost_job(uuid, uuid, text) to service_role;
