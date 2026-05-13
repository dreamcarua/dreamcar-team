-- =====================================================================
-- DreamCar HQ — Стіл SMM
-- Reset — повне видалення public schema і створення наново
--
-- Використовуй ПЕРЕД повторним прогоном schema.sql якщо попередній
-- прогін падав на півдорозі або щоб отримати чистий старт.
--
-- ВАЖЛИВО: видаляє ВСЕ з public schema. auth.users (Supabase internal)
-- лишається.
--
-- Після цього:
--   1. schema.sql
--   2. rls.sql
--   3. seed.sql
-- =====================================================================

drop schema if exists public cascade;
create schema public;

-- Власник schema
grant all on schema public to postgres;
grant all on schema public to public;
grant usage on schema public to anon, authenticated, service_role;

-- ВАЖЛИВО: default privileges на майбутні таблиці й функції.
-- Інакше anon/authenticated отримують "permission denied" при кожному
-- запиті, навіть якщо RLS-policy дозволяла б доступ.
-- Це повторює стандартну поведінку Supabase для свіжого проєкту.

alter default privileges in schema public
    grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
    grant select on tables to anon;
alter default privileges in schema public
    grant usage, select on sequences to authenticated;
alter default privileges in schema public
    grant usage, select on sequences to anon;
alter default privileges in schema public
    grant execute on functions to authenticated, anon;

-- Готово. Тепер можна виконувати schema.sql → rls.sql → seed.sql
