-- =====================================================================
-- Migration 004 — pg_cron schedule для daily-digest
-- =====================================================================
-- Виконати в Supabase SQL Editor.
-- =====================================================================

-- Розширення pg_cron уже доступне в Supabase (Database → Extensions → pg_cron → Enable)
-- Якщо ще не увімкнено: Dashboard → Database → Extensions → знайди "pg_cron" → Enable.

-- ---------------------------------------------------------------------
-- Розклад: щодня о 09:00 Kyiv (= 06:00 UTC у зимовий час, 07:00 UTC влітку)
-- Беремо 07:00 UTC як компроміс (трохи раніше взимку, точно влітку).
-- Якщо хочеш строго 09:00 Kyiv цілий рік — додай два рядки з різними cron-string
-- і вмикай/вимикай за потреби.
-- ---------------------------------------------------------------------

-- Спершу прибираємо стару задачу (якщо вже є)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'hq-daily-digest') then
    perform cron.unschedule('hq-daily-digest');
  end if;
end $$;

-- Створюємо
select cron.schedule(
  'hq-daily-digest',
  '0 7 * * *',  -- 07:00 UTC щодня
  $$
  select net.http_post(
    url := current_setting('app.daily_digest_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hq-cron-secret', current_setting('app.hq_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- НАЛАШТУВАННЯ
-- ---------------------------------------------------------------------
-- Підстав власні значення (один раз, після створення функції):
--
-- alter database postgres set app.daily_digest_url =
--   'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-digest';
--
-- alter database postgres set app.hq_cron_secret =
--   '<значення HQ_CRON_SECRET — те саме що в Edge Functions secrets>';
--
-- після ALTER DATABASE — перезапуск з'єднання робить новий setting видимим
-- для майбутніх викликів cron.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ПЕРЕВІРКА
-- ---------------------------------------------------------------------
-- select * from cron.job;
-- select * from cron.job_run_details order by start_time desc limit 5;
--
-- Ручний запуск без cron (для тесту):
-- select net.http_post(
--   url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-digest',
--   headers := jsonb_build_object('x-hq-cron-secret', '<секрет>'),
--   body := '{}'::jsonb
-- );
