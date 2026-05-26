-- =====================================================================
-- DreamCar Team Hub — Tasks schema v2: notifications + best practices
-- =====================================================================
-- Запустити ПІСЛЯ schema.sql (v2.1). Безпечно: всі додавання idempotent.
--
-- Що додається:
--   1. team_tasks: subtasks jsonb (чек-листи), recurrence (cron-pattern),
--      depends_on uuid[], last_reminder_sent_at, last_overdue_sent_at,
--      estimated_hours, watchers uuid[].
--   2. team_task_comments — коментарі з @mentions, audit-log дій.
--   3. team_task_notifications — черга TG/Email повідомлень.
--   4. Тригери на INSERT/UPDATE team_tasks → enqueue notifications.
-- =====================================================================

-- ============== A. Розширюємо team_tasks ==============
alter table public.team_tasks
  add column if not exists subtasks       jsonb        default '[]'::jsonb,  -- [{text,done,id}]
  add column if not exists recurrence     text,                              -- 'daily'|'weekly'|'monthly'|'custom:0 9 * * 1'
  add column if not exists depends_on     uuid[]       default '{}',         -- task_ids що блокують цю
  add column if not exists watchers       uuid[]       default '{}',         -- user_ids що отримують усі notify
  add column if not exists estimated_h    numeric(5,1),                      -- оцінка в годинах
  add column if not exists actual_h       numeric(5,1),                      -- факт
  add column if not exists last_reminder_sent_at  timestamptz,
  add column if not exists last_overdue_sent_at   timestamptz,
  add column if not exists last_digest_sent_on    date;                      -- щоб не дублювати daily digest

create index if not exists team_tasks_depends_on_idx on public.team_tasks using gin (depends_on);
create index if not exists team_tasks_watchers_idx   on public.team_tasks using gin (watchers);

-- ============== B. КОМЕНТАРІ ==============
create table if not exists public.team_task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.team_tasks(id) on delete cascade,
  author_id   uuid not null references public.users(id) on delete set null,
  body        text not null,
  mentions    uuid[] not null default '{}',                                  -- user_ids тегнутих через @
  -- system actions (created/moved/assigned) теж пишемо сюди для timeline
  kind        text not null default 'comment',                               -- 'comment' | 'system'
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);

create index if not exists team_task_comments_task_idx     on public.team_task_comments (task_id, created_at desc);
create index if not exists team_task_comments_author_idx   on public.team_task_comments (author_id);
create index if not exists team_task_comments_mentions_idx on public.team_task_comments using gin (mentions);

alter table public.team_task_comments enable row level security;

drop policy if exists "ttc_select" on public.team_task_comments;
create policy "ttc_select" on public.team_task_comments for select
  using (exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_active = true));

drop policy if exists "ttc_insert" on public.team_task_comments;
create policy "ttc_insert" on public.team_task_comments for insert
  with check (
    exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_active = true)
    and author_id = public.current_user_id()
  );

drop policy if exists "ttc_update_own" on public.team_task_comments;
create policy "ttc_update_own" on public.team_task_comments for update
  using (author_id = public.current_user_id());

drop policy if exists "ttc_delete_own_or_lead" on public.team_task_comments;
create policy "ttc_delete_own_or_lead" on public.team_task_comments for delete
  using (
    author_id = public.current_user_id()
    or exists (select 1 from public.users u where u.auth_id = auth.uid()
               and u.role in ('ceo'::user_role,'coo'::user_role,'lead'::user_role))
  );

do $$ begin
  alter publication supabase_realtime add table public.team_task_comments;
exception when duplicate_object then null; end $$;

-- ============== C. ЧЕРГА НОТИФІКАЦІЙ ==============
do $$ begin
  create type team_task_notify_kind as enum (
    'assigned',          -- тобі призначили завдання
    'unassigned',        -- з тебе зняли
    'status_changed',    -- статус змінив автор (для assignee)
    'mention',           -- тебе тегнули у коментарі
    'comment',           -- новий коментар у твоєму завданні
    'reminder_24h',      -- завтра дедлайн
    'reminder_1h',       -- через годину (для completed_at >0)
    'overdue',           -- дедлайн прострочено
    'daily_digest',      -- 09:00 щодня
    'recurring_created', -- автоматично створено по recurrence
    'dependency_done'    -- завдання-блокер закрите → розблокування
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type team_task_notify_channel as enum ('tg', 'email', 'inapp');
exception when duplicate_object then null; end $$;

create table if not exists public.team_task_notifications (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references public.users(id) on delete cascade,
  task_id         uuid references public.team_tasks(id) on delete cascade,
  comment_id      uuid references public.team_task_comments(id) on delete set null,
  kind            team_task_notify_kind not null,
  payload         jsonb not null default '{}',                               -- title, snippet, due_date, status тощо
  -- статус доставки
  channels        team_task_notify_channel[] not null default '{tg}',
  sent_tg         boolean not null default false,
  sent_tg_at      timestamptz,
  sent_email      boolean not null default false,
  sent_email_at   timestamptz,
  read_at         timestamptz,
  -- не спамити: pending → processing → done|error
  state           text not null default 'pending',                           -- pending|processing|done|error|skipped
  error_msg       text,
  attempts        int not null default 0,
  next_attempt_at timestamptz,
  created_at      timestamptz not null default now(),
  -- захист від дублів (наприклад, два UPDATE з тим самим status_changed підряд)
  dedupe_key      text
);

create index if not exists ttn_recipient_unread_idx on public.team_task_notifications (recipient_id, read_at);
create index if not exists ttn_pending_idx          on public.team_task_notifications (state, created_at) where state = 'pending';
create index if not exists ttn_task_idx             on public.team_task_notifications (task_id);
create unique index if not exists ttn_dedupe_uniq   on public.team_task_notifications (dedupe_key) where dedupe_key is not null;

alter table public.team_task_notifications enable row level security;

drop policy if exists "ttn_select_own" on public.team_task_notifications;
create policy "ttn_select_own" on public.team_task_notifications for select
  using (recipient_id = public.current_user_id());

drop policy if exists "ttn_update_own_read" on public.team_task_notifications;
create policy "ttn_update_own_read" on public.team_task_notifications for update
  using (recipient_id = public.current_user_id());

do $$ begin
  alter publication supabase_realtime add table public.team_task_notifications;
exception when duplicate_object then null; end $$;

-- ============== D. ENQUEUE FUNCTIONS ==============
-- універсальний helper: створити нотифікацію якщо ще немає dedupe-ключа
create or replace function public.enqueue_team_task_notification(
  p_recipient   uuid,
  p_task        uuid,
  p_kind        team_task_notify_kind,
  p_payload     jsonb default '{}',
  p_comment     uuid default null,
  p_dedupe      text default null,
  p_channels    team_task_notify_channel[] default '{tg,inapp}'
) returns uuid
language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_recipient is null then return null; end if;
  -- не нотифікуємо самого себе про власні дії
  if p_recipient = public.current_user_id() and p_kind in ('comment','status_changed','assigned','mention') then
    return null;
  end if;
  insert into public.team_task_notifications(
    recipient_id, task_id, comment_id, kind, payload, channels, dedupe_key
  ) values (
    p_recipient, p_task, p_comment, p_kind, p_payload, p_channels, p_dedupe
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ============== E. ТРИГЕРИ НА team_tasks ==============
create or replace function public.team_tasks_notify_trigger()
returns trigger language plpgsql as $$
declare
  v_payload jsonb;
  v_watcher uuid;
begin
  v_payload := jsonb_build_object(
    'title',    new.title,
    'status',   new.status,
    'priority', new.priority,
    'due_date', new.due_date,
    'tags',     new.tags
  );

  if (tg_op = 'INSERT') then
    -- assignee при створенні
    if new.assignee_id is not null then
      perform public.enqueue_team_task_notification(
        new.assignee_id, new.id, 'assigned', v_payload,
        null, 'assigned:'||new.id::text||':'||new.assignee_id::text
      );
    end if;
  elsif (tg_op = 'UPDATE') then
    -- зміна виконавця
    if new.assignee_id is distinct from old.assignee_id then
      if new.assignee_id is not null then
        perform public.enqueue_team_task_notification(
          new.assignee_id, new.id, 'assigned', v_payload,
          null, 'assigned:'||new.id::text||':'||new.assignee_id::text||':'||extract(epoch from now())::bigint::text
        );
      end if;
      if old.assignee_id is not null then
        perform public.enqueue_team_task_notification(
          old.assignee_id, new.id, 'unassigned', v_payload,
          null, 'unassigned:'||new.id::text||':'||old.assignee_id::text||':'||extract(epoch from now())::bigint::text
        );
      end if;
    end if;
    -- зміна статусу — повідомляємо assignee + watchers, якщо не сам автор зміни
    if new.status is distinct from old.status then
      v_payload := v_payload || jsonb_build_object('old_status', old.status);
      if new.assignee_id is not null then
        perform public.enqueue_team_task_notification(
          new.assignee_id, new.id, 'status_changed', v_payload,
          null, 'status:'||new.id::text||':'||new.status::text||':'||extract(epoch from now())::bigint::text
        );
      end if;
      foreach v_watcher in array coalesce(new.watchers, '{}') loop
        perform public.enqueue_team_task_notification(
          v_watcher, new.id, 'status_changed', v_payload,
          null, 'status_w:'||new.id::text||':'||v_watcher::text||':'||extract(epoch from now())::bigint::text
        );
      end loop;
    end if;
    -- разблокування залежних: коли цей таск стає done
    if new.status = 'done' and (old.status is null or old.status <> 'done') then
      perform public.enqueue_team_task_notification(
        t.assignee_id, t.id, 'dependency_done',
        jsonb_build_object('blocker_title', new.title, 'blocker_id', new.id),
        null,
        'depdone:'||t.id::text||':'||new.id::text
      )
      from public.team_tasks t
      where new.id = any(t.depends_on) and t.status <> 'done' and t.assignee_id is not null;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_team_tasks_notify on public.team_tasks;
create trigger trg_team_tasks_notify
  after insert or update on public.team_tasks
  for each row execute function public.team_tasks_notify_trigger();

-- ============== F. ТРИГЕР НА КОМЕНТАРІ ==============
create or replace function public.team_task_comments_notify_trigger()
returns trigger language plpgsql as $$
declare
  v_task  public.team_tasks%rowtype;
  v_payload jsonb;
  v_mention uuid;
  v_watcher uuid;
  v_seen uuid[] := '{}';
begin
  -- ігноруємо системні
  if new.kind = 'system' then return new; end if;

  select * into v_task from public.team_tasks where id = new.task_id;
  if v_task.id is null then return new; end if;

  v_payload := jsonb_build_object(
    'task_title', v_task.title,
    'task_id',    v_task.id,
    'snippet',    left(new.body, 240),
    'author_id',  new.author_id
  );

  -- 1. mentions — пріоритет
  foreach v_mention in array coalesce(new.mentions, '{}') loop
    if v_mention <> new.author_id and v_mention <> all(v_seen) then
      perform public.enqueue_team_task_notification(
        v_mention, new.task_id, 'mention', v_payload, new.id,
        'mention:'||new.id::text||':'||v_mention::text
      );
      v_seen := v_seen || v_mention;
    end if;
  end loop;

  -- 2. assignee — окремий event
  if v_task.assignee_id is not null and v_task.assignee_id <> new.author_id
     and v_task.assignee_id <> all(v_seen) then
    perform public.enqueue_team_task_notification(
      v_task.assignee_id, new.task_id, 'comment', v_payload, new.id,
      'comment:'||new.id::text||':'||v_task.assignee_id::text
    );
    v_seen := v_seen || v_task.assignee_id;
  end if;

  -- 3. watchers
  foreach v_watcher in array coalesce(v_task.watchers, '{}') loop
    if v_watcher <> new.author_id and v_watcher <> all(v_seen) then
      perform public.enqueue_team_task_notification(
        v_watcher, new.task_id, 'comment', v_payload, new.id,
        'comment_w:'||new.id::text||':'||v_watcher::text
      );
      v_seen := v_seen || v_watcher;
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists trg_team_task_comments_notify on public.team_task_comments;
create trigger trg_team_task_comments_notify
  after insert on public.team_task_comments
  for each row execute function public.team_task_comments_notify_trigger();

-- ============== G. HELPER: список pending для воркера ==============
create or replace function public.claim_team_task_notifications(p_limit int default 25)
returns setof public.team_task_notifications
language sql security definer as $$
  with picked as (
    select id from public.team_task_notifications
    where state = 'pending'
      and (next_attempt_at is null or next_attempt_at <= now())
    order by created_at
    limit p_limit
    for update skip locked
  )
  update public.team_task_notifications n
  set state = 'processing', attempts = attempts + 1
  from picked
  where n.id = picked.id
  returning n.*;
$$;

create or replace function public.mark_team_task_notification_done(
  p_id        uuid,
  p_channel   team_task_notify_channel,
  p_ok        boolean,
  p_error     text default null
) returns void language plpgsql security definer as $$
begin
  if p_channel = 'tg' then
    update public.team_task_notifications
    set sent_tg = case when p_ok then true else sent_tg end,
        sent_tg_at = case when p_ok then now() else sent_tg_at end,
        state = case when p_ok then 'done' else 'error' end,
        error_msg = case when p_ok then null else p_error end,
        next_attempt_at = case when p_ok then null else now() + interval '5 minutes' * attempts end
    where id = p_id;
  elsif p_channel = 'email' then
    update public.team_task_notifications
    set sent_email = case when p_ok then true else sent_email end,
        sent_email_at = case when p_ok then now() else sent_email_at end
    where id = p_id;
  end if;
end $$;

-- ============== H. ЛИЧНІ НАЛАШТУВАННЯ КОРИСТУВАЧА ==============
create table if not exists public.team_task_user_prefs (
  user_id         uuid primary key references public.users(id) on delete cascade,
  tg_enabled      boolean not null default true,
  email_enabled   boolean not null default false,
  digest_enabled  boolean not null default true,
  digest_hour     int not null default 9,            -- 9 CET
  quiet_from      int not null default 22,           -- не нотифікувати з 22 до 8
  quiet_to        int not null default 8,
  updated_at      timestamptz not null default now()
);

alter table public.team_task_user_prefs enable row level security;
drop policy if exists "tup_own" on public.team_task_user_prefs;
create policy "tup_own" on public.team_task_user_prefs for all
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- ============== І. ПЕРЕВІРКА ==============
-- select kind, count(*), count(*) filter (where state='pending') as pending
--   from public.team_task_notifications group by kind;
-- select * from public.claim_team_task_notifications(5);
