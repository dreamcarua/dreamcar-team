-- =====================================================================
-- DreamCar Team Hub — Tasks schema
-- =====================================================================
-- Запустити через Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/sql
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
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  status        task_status not null default 'inbox',
  priority      task_priority not null default 'p3',
  assignee_id   uuid references public.users(id) on delete set null,
  created_by    uuid references public.users(id) on delete set null,
  due_date      date,
  tags          text[] default '{}',
  -- метадані
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  -- зворотні зв'язки
  publication_id uuid references public.publications(id) on delete set null,
  parent_task_id uuid references public.team_tasks(id) on delete cascade
);

comment on table public.team_tasks is 'Tasks для команди — Kanban + assignee + дедлайни';

-- ============== ІНДЕКСИ ==============
create index if not exists team_tasks_status_idx       on public.team_tasks (status);
create index if not exists team_tasks_assignee_idx     on public.team_tasks (assignee_id);
create index if not exists team_tasks_created_by_idx   on public.team_tasks (created_by);
create index if not exists team_tasks_due_date_idx     on public.team_tasks (due_date);
create index if not exists team_tasks_updated_at_idx   on public.team_tasks (updated_at desc);
create index if not exists team_tasks_tags_gin_idx     on public.team_tasks using gin (tags);

-- ============== TRIGGER: updated_at ==============
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

-- SELECT: будь-який автентифікований користувач у public.users бачить усі задачі
drop policy if exists "team_tasks_select_authed" on public.team_tasks;
create policy "team_tasks_select_authed"
  on public.team_tasks for select
  using (
    auth.uid() in (select id from public.users)
  );

-- INSERT: створювати може будь-який member команди
drop policy if exists "team_tasks_insert_member" on public.team_tasks;
create policy "team_tasks_insert_member"
  on public.team_tasks for insert
  with check (
    auth.uid() in (select id from public.users)
    and created_by = auth.uid()
  );

-- UPDATE: будь-який member команди може редагувати (плоска модель — без власників)
drop policy if exists "team_tasks_update_member" on public.team_tasks;
create policy "team_tasks_update_member"
  on public.team_tasks for update
  using (
    auth.uid() in (select id from public.users)
  );

-- DELETE: тільки той, хто створив, або admin/ceo роль
drop policy if exists "team_tasks_delete_owner_or_admin" on public.team_tasks;
create policy "team_tasks_delete_owner_or_admin"
  on public.team_tasks for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('ceo','admin','marketing_lead')
    )
  );

-- ============== REALTIME ==============
-- ВКЛЮЧИТИ через Supabase Dashboard:
--   Database → Replication → public.team_tasks → toggle "Enable"
-- АБО SQL:
alter publication supabase_realtime add table public.team_tasks;

-- ============== SEED (тестові задачі) ==============
-- Розкоментуй для додавання прикладів:
--
-- insert into public.team_tasks (title, description, status, priority, tags, created_by)
-- select
--   'Перевірити автопостинг BMW X5 у DCSMM',
--   'Прогнати E2E flow: upload → compress → autopost → перевірка inline preview',
--   'doing'::task_status,
--   'p1'::task_priority,
--   array['hq','x5','autopost'],
--   id
-- from public.users where role = 'ceo' limit 1;
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
-- from public.users where role = 'ceo' limit 1;

-- ============== ПЕРЕВІРКА ==============
-- select count(*) from public.team_tasks;
-- select status, count(*) from public.team_tasks group by status;
