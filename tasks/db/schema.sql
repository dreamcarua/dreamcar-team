-- =====================================================================
-- DreamCar Team Hub — Tasks schema (v2 — fixed enum + auth_id mapping)
-- =====================================================================
-- Запустити через Supabase SQL Editor (dreamcar-hq проєкт):
-- https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/sql
--
-- Виправлено vs v1:
--   1. user_role enum НЕ має 'admin' і 'marketing_lead' — використовуємо
--      реальні значення з HQ schema: 'ceo','coo','lead','member','designer'
--   2. auth.uid() ↔ public.users.id ≠ збіг. Зв'язок через колонку auth_id.
--      → policies використовують public.current_user_id() (вже існує у HQ).
--   3. created_by / assignee_id типу public.users(id) — порівнюємо з
--      current_user_id(), а не з auth.uid().
-- =====================================================================

-- ENUM: статус задачі
do $$ begin
  create type task_status as enum ('inbox', 'doing', 'review', 'done');
exception when duplicate_object then null; end $$;

-- ENUM: пріоритет
do $$ begin
  create type task_priority as enum ('p1', 'p2', 'p3', 'p4');
exception when duplicate_object then null; end $$;

-- ============== ТАБЛИЦЯ ==============
create table if not exists public.team_tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  status          task_status not null default 'inbox',
  priority        task_priority not null default 'p3',
  assignee_id     uuid references public.users(id) on delete set null,
  created_by      uuid references public.users(id) on delete set null,
  due_date        date,
  tags            text[] default '{}',
  -- метадані
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  -- зворотні зв'язки
  publication_id  uuid references public.publications(id) on delete set null,
  parent_task_id  uuid references public.team_tasks(id) on delete cascade
);

comment on table public.team_tasks is 'Tasks для команди — Kanban + assignee + дедлайни';

-- ============== ІНДЕКСИ ==============
create index if not exists team_tasks_status_idx     on public.team_tasks (status);
create index if not exists team_tasks_assignee_idx   on public.team_tasks (assignee_id);
create index if not exists team_tasks_created_by_idx on public.team_tasks (created_by);
create index if not exists team_tasks_due_date_idx   on public.team_tasks (due_date);
create index if not exists team_tasks_updated_at_idx on public.team_tasks (updated_at desc);
create index if not exists team_tasks_tags_gin_idx   on public.team_tasks using gin (tags);

-- ============== TRIGGER: updated_at + completed_at ==============
create or replace function public.set_team_tasks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if new.status = 'done' and (old.status is null or old.status <> 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_team_tasks_updated_at on public.team_tasks;
create trigger trg_team_tasks_updated_at
  before update on public.team_tasks
  for each row execute function public.set_team_tasks_updated_at();

-- ============== RLS ==============
alter table public.team_tasks enable row level security;

-- Helper-функція public.current_user_id() уже визначена у hq/db/schema.sql
-- (повертає public.users.id для auth.uid()). Якщо її чомусь немає — ось fallback:
do $$ begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_user_id'
  ) then
    execute $f$
      create or replace function public.current_user_id() returns uuid
        language sql security definer stable as
      'select id from public.users where auth_id = auth.uid() limit 1';
    $f$;
  end if;
end $$;

-- SELECT: будь-який автентифікований член команди бачить усі задачі
drop policy if exists "team_tasks_select_authed" on public.team_tasks;
create policy "team_tasks_select_authed"
  on public.team_tasks for select
  using (
    exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_active = true)
  );

-- INSERT: будь-який автентифікований член — і created_by має бути його ID
drop policy if exists "team_tasks_insert_member" on public.team_tasks;
create policy "team_tasks_insert_member"
  on public.team_tasks for insert
  with check (
    exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_active = true)
    and created_by = public.current_user_id()
  );

-- UPDATE: будь-який автентифікований член (плоска модель)
drop policy if exists "team_tasks_update_member" on public.team_tasks;
create policy "team_tasks_update_member"
  on public.team_tasks for update
  using (
    exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_active = true)
  );

-- DELETE: автор задачі АБО CEO/COO/Lead
drop policy if exists "team_tasks_delete_owner_or_lead" on public.team_tasks;
create policy "team_tasks_delete_owner_or_lead"
  on public.team_tasks for delete
  using (
    created_by = public.current_user_id()
    or exists (
      select 1 from public.users u
      where u.auth_id = auth.uid()
        and u.is_active = true
        and u.role in ('ceo'::user_role, 'coo'::user_role, 'lead'::user_role)
    )
  );

-- ============== REALTIME ==============
-- Підписка на зміни (potential duplicate — заглушимо помилку)
do $$ begin
  alter publication supabase_realtime add table public.team_tasks;
exception when duplicate_object then null; end $$;

-- ============== ПЕРЕВІРКА ==============
-- select count(*) from public.team_tasks;
-- select status, count(*) from public.team_tasks group by status;

-- ============== SEED (опційно — розкоментуй) ==============
-- insert into public.team_tasks (title, description, status, priority, tags, created_by)
-- select
--   'Перевірити автопостинг BMW X5 у DCSMM',
--   'Прогнати E2E flow: upload → compress → autopost → перевірка inline preview',
--   'doing'::task_status,
--   'p1'::task_priority,
--   array['hq','x5','autopost'],
--   id
-- from public.users where role = 'ceo'::user_role limit 1;
--
-- insert into public.team_tasks (title, description, status, priority, tags, created_by, due_date)
-- select
--   'Оновити onboarding для нових SMM-щиків',
--   'Синхронізувати з брендбуком v3.9.1 (17 авто, 2016, 500K+)',
--   'inbox'::task_status,
--   'p2'::task_priority,
--   array['team','onboarding','brand'],
--   id,
--   current_date + 7
-- from public.users where role = 'ceo'::user_role limit 1;
