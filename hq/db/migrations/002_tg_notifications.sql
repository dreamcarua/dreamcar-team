-- =====================================================================
-- Migration 002 — TG notifications support
-- =====================================================================
-- Виконати в Supabase SQL Editor після schema.sql + rls.sql + triggers.sql.
-- =====================================================================

-- 1. Колонки для TG-прив'язки користувача
alter table public.users
  add column if not exists tg_chat_id   bigint,
  add column if not exists tg_username  text;

create index if not exists users_tg_chat_id_idx on public.users (tg_chat_id) where tg_chat_id is not null;

-- 2. RLS — користувач може оновити свої tg_chat_id / tg_username
drop policy if exists "users_update_own_tg" on public.users;
create policy "users_update_own_tg" on public.users
  for update
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- 3. Database Webhooks налаштовуються через UI:
--    Supabase Dashboard → Database → Webhooks → Create
--
--    Створи 2 вебхуки:
--    --------------------------------------------------------------
--    Webhook #1: publication-status-changed
--      Table:    publications
--      Events:   ✓ INSERT  ✓ UPDATE
--      Type:     Supabase Edge Functions
--      Function: notify-tg
--      Method:   POST
--      Headers:  x-hq-secret: <значення з HQ_WEBHOOK_SECRET secret>
--    --------------------------------------------------------------
--    Webhook #2: comment-added
--      Table:    comments
--      Events:   ✓ INSERT
--      Type:     Supabase Edge Functions
--      Function: notify-tg
--      Method:   POST
--      Headers:  x-hq-secret: <те ж значення>
--    --------------------------------------------------------------
--
-- 4. Secrets для Edge Function (Settings → Edge Functions → Manage secrets):
--    TG_BOT_TOKEN       = <токен бота @YourBot>
--    TG_GROUP_CHAT_ID   = -1001234567890   (chat_id команди, числовий)
--    HQ_WEBHOOK_SECRET  = <випадковий рядок 32+ символів>
--    SUPABASE_URL              — встановлюється Supabase автоматично
--    SUPABASE_SERVICE_ROLE_KEY — встановлюється Supabase автоматично
--
-- 5. Деплой функції з локального репо:
--    supabase functions deploy notify-tg --no-verify-jwt
--    (--no-verify-jwt бо вебхук БД не передає Supabase JWT, замість нього
--     ми використовуємо власний x-hq-secret)
--
-- Готово. Перевірка:
--   1. Зміни статус публікації на 'review' → у TG-групі має з'явитися повідомлення.
--   2. Додай коментар → group chat отримує silent повідомлення.
