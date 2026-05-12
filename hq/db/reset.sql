-- =====================================================================
-- DreamCar HQ — Стіл SMM
-- Reset — повне видалення public schema і створення наново
--
-- Використовуй ПЕРЕД повторним прогоном schema.sql якщо попередній
-- прогін падав на півдорозі (як, наприклад, помилка з tsvector).
--
-- ВАЖЛИВО: видаляє ВСЕ з public schema. auth.users (Supabase internal)
-- лишається.
-- =====================================================================

drop schema if exists public cascade;
create schema public;

grant all on schema public to postgres;
grant all on schema public to public;
grant usage on schema public to anon, authenticated, service_role;

-- Готово. Тепер можна виконувати schema.sql → rls.sql → seed.sql
