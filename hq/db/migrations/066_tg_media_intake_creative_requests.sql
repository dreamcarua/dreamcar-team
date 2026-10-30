-- 066 (30.10.2026): @dreamcar_team_bot у чаті DreamCar Media
-- 1) tg_media_intake  — журнал файлів із чату, що лягли в медіатеку (creatives)
-- 2) creative_requests — черга «віддаленого відділу креативів» (обробка на Mac Studio)
-- Доступ лише service role (RLS on, без політик).

create table if not exists public.tg_media_intake (
  id              bigserial primary key,
  chat_id         bigint      not null,
  message_id      bigint      not null,
  media_group_id  text,
  file_unique_id  text        not null,
  file_id         text,
  kind            text        not null check (kind in ('photo','video','doc')),
  mime            text,
  file_name       text,
  size_bytes      bigint,
  from_tg_id      bigint,
  from_name       text,
  caption         text,
  launch_id       uuid,
  creative_id     uuid references public.creatives(id) on delete set null,
  status          text        not null default 'saved'
                  check (status in ('saved','duplicate','too_big','error','cancelled')),
  error           text,
  ack_msg_id      bigint,
  acked_at        timestamptz,
  created_at      timestamptz not null default now(),
  unique (chat_id, message_id, file_unique_id)
);
create unique index if not exists tg_media_intake_saved_uq on public.tg_media_intake (file_unique_id) where status = 'saved';
create index if not exists tg_media_intake_unacked on public.tg_media_intake (created_at) where acked_at is null;
create index if not exists tg_media_intake_group on public.tg_media_intake (chat_id, media_group_id);
create index if not exists tg_media_intake_ack on public.tg_media_intake (chat_id, ack_msg_id);

create table if not exists public.creative_requests (
  id                  bigserial primary key,
  chat_id             bigint      not null,
  message_id          bigint      not null,
  reply_to_message_id bigint,
  media_group_id      text,
  from_tg_id          bigint,
  from_name           text,
  user_id             uuid,
  request_text        text        not null,
  launch_id           uuid,
  status              text        not null default 'queued'
                      check (status in ('queued','working','need_info','done','failed','cancelled')),
  question            text,
  question_msg_id     bigint,
  answers             jsonb       not null default '[]'::jsonb,
  result_creative_ids uuid[]      not null default '{}',
  result_note         text,
  error               text,
  attempts            int         not null default 0,
  claimed_by          text,
  claimed_at          timestamptz,
  finished_at         timestamptz,
  ack_msg_id          bigint,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (chat_id, message_id)
);
create index if not exists creative_requests_queue on public.creative_requests (created_at) where status = 'queued';
create index if not exists creative_requests_qmsg on public.creative_requests (chat_id, question_msg_id);

alter table public.tg_media_intake   enable row level security;
alter table public.creative_requests enable row level security;
revoke all on public.tg_media_intake   from anon, authenticated;
revoke all on public.creative_requests from anon, authenticated;
revoke all on sequence public.tg_media_intake_id_seq   from anon, authenticated;
revoke all on sequence public.creative_requests_id_seq from anon, authenticated;

-- Атомарно взяти наступну задачу (одна за раз; «зависла» working >3 год повертається в чергу).
create or replace function public.creative_request_claim(p_worker text)
returns public.creative_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.creative_requests;
begin
  update public.creative_requests
     set status = 'queued', claimed_by = null, claimed_at = null, updated_at = now()
   where status = 'working' and claimed_at < now() - interval '3 hours';

  if exists (select 1 from public.creative_requests where status = 'working') then
    return null;  -- черга по одній
  end if;

  select * into r from public.creative_requests
   where status = 'queued' order by created_at limit 1 for update skip locked;
  if not found then return null; end if;

  update public.creative_requests
     set status = 'working', claimed_by = p_worker, claimed_at = now(),
         attempts = attempts + 1, updated_at = now()
   where id = r.id returning * into r;
  return r;
end $$;
revoke all on function public.creative_request_claim(text) from public, anon, authenticated;

-- 067 (30.10.2026): claim бере задачу лише через 40 с після запиту (альбом встигає зберегтися)
create or replace function public.creative_request_claim(p_worker text)
returns public.creative_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.creative_requests;
begin
  update public.creative_requests
     set status = 'queued', claimed_by = null, claimed_at = null, updated_at = now()
   where status = 'working' and claimed_at < now() - interval '3 hours';
  if exists (select 1 from public.creative_requests where status = 'working') then
    return null;
  end if;
  select * into r from public.creative_requests
   where status = 'queued' and created_at < now() - interval '40 seconds'
   order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update public.creative_requests
     set status = 'working', claimed_by = p_worker, claimed_at = now(),
         attempts = attempts + 1, updated_at = now()
   where id = r.id returning * into r;
  return r;
end $$;
revoke all on function public.creative_request_claim(text) from public, anon, authenticated;
