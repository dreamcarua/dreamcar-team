-- =====================================================================
-- Migration 003 — Storage policies + per-platform schedule
-- =====================================================================
-- Виконати в Supabase SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. STORAGE RLS POLICIES для bucket «creatives»
-- ---------------------------------------------------------------------
-- Без цих policies upload падає з «new row violates RLS».
-- Bucket має бути PUBLIC (галка при створенні), а ці policies контролюють,
-- хто може писати/читати окремі обʼєкти.

-- Дозволити authenticated INSERT (тобто upload) у bucket «creatives»
drop policy if exists "creatives_authenticated_insert" on storage.objects;
create policy "creatives_authenticated_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'creatives');

-- Дозволити authenticated SELECT (read) — навіть якщо bucket public,
-- listObjects через API потребує цієї policy.
drop policy if exists "creatives_authenticated_select" on storage.objects;
create policy "creatives_authenticated_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'creatives');

-- Публічний read для всіх (anon) — щоб <img src> у браузері працював
-- без авторизації. Якщо bucket уже Public — це не критично, але дублюємо.
drop policy if exists "creatives_public_select" on storage.objects;
create policy "creatives_public_select" on storage.objects
  for select to anon
  using (bucket_id = 'creatives');

-- Дозволити authenticated UPDATE свого файлу (за owner)
drop policy if exists "creatives_authenticated_update_own" on storage.objects;
create policy "creatives_authenticated_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'creatives' and auth.uid() = owner)
  with check (bucket_id = 'creatives');

-- Дозволити authenticated DELETE свого файлу
drop policy if exists "creatives_authenticated_delete_own" on storage.objects;
create policy "creatives_authenticated_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'creatives' and auth.uid() = owner);


-- ---------------------------------------------------------------------
-- 2. Per-platform schedule (для #3 з правок)
-- ---------------------------------------------------------------------
-- Замість того щоб міняти модель таблиці publication_platforms (FK складно),
-- зберігаємо overrides у JSONB колонці на publications.
-- Формат: {"ig": "2026-05-15T18:00:00Z", "tg": "2026-05-15T20:00:00Z"}
-- Базовий час публікації залишається у publish_at.
-- Якщо override відсутній — використовується publish_at.

alter table public.publications
  add column if not exists platform_schedule jsonb;

comment on column public.publications.platform_schedule is
  'Optional per-platform publish_at override. Example: {"ig":"...", "tg":"..."}';

-- ---------------------------------------------------------------------
-- 3. Soft delete (для #7 — undo delete)
-- ---------------------------------------------------------------------
-- Поле deleted_at вже може існувати з schema.sql. Перевіряємо ідемпотентно.

alter table public.publications
  add column if not exists deleted_at timestamptz;

-- Індекс щоб запити «active publications» працювали швидко
create index if not exists publications_deleted_at_idx
  on public.publications (deleted_at) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 4. Перевірка
-- ---------------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'publications'
--    and column_name in ('platform_schedule', 'deleted_at');
--
-- select policyname from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and policyname like 'creatives_%';
