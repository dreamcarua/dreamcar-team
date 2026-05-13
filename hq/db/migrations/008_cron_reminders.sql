-- =====================================================================
-- Migration 008 — pg_cron для cron-reminders (G2/G3/G4/G5b)
-- =====================================================================
-- Виконати в Supabase SQL Editor.
--
-- ОБОВ'ЯЗКОВО: спочатку задеплой Edge Function cron-reminders:
--   supabase functions deploy cron-reminders --no-verify-jwt
-- =====================================================================

-- Прибираємо стару задачу (ідемпотентно)
select cron.unschedule('hq-cron-reminders') where exists (
  select 1 from cron.job where jobname = 'hq-cron-reminders'
);

-- Створюємо — щогодини
select cron.schedule(
  'hq-cron-reminders',
  '0 * * * *',  -- кожна година о :00
  $$
  select net.http_post(
    url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/cron-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hq-cron-secret', '<ВСТАВ_ТУТ_HQ_CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- ⚠️ ОБОВ'ЯЗКОВО: заміни <ВСТАВ_ТУТ_HQ_CRON_SECRET> на справжній HQ_CRON_SECRET
--    (той же, що у міграціях 004, 007).
-- ---------------------------------------------------------------------

-- ПЕРЕВІРКА
-- select jobname, schedule, active from cron.job where jobname like 'hq-%' order by jobname;
-- select status_code, content from net._http_response order by id desc limit 5;
