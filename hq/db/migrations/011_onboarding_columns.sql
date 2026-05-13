-- =====================================================================
-- Migration 011 — Onboarding + Push columns у users
-- =====================================================================

alter table public.users
  add column if not exists onboarding_steps        jsonb default '{}'::jsonb,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists push_subscription       jsonb;

-- Індекс для пошуку незавершених onboarding-ів
create index if not exists idx_users_onboarding_incomplete
  on public.users(onboarding_completed_at)
  where onboarding_completed_at is null;

-- RLS: юзер може оновити власні поля
drop policy if exists "users_update_own_onboarding" on public.users;
create policy "users_update_own_onboarding" on public.users
  for update to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- Перевірка:
-- select id, name, onboarding_steps, onboarding_completed_at from public.users;
