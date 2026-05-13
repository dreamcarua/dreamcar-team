-- =====================================================================
-- Migration 007 — pg_cron schedule для daily-personal-digest
-- =====================================================================
-- Виконати в Supabase SQL Editor.
--
-- Що робить: щодня о 06:00 UTC (~09:00 Kyiv) викликає
-- Edge Function daily-personal-digest, яка надсилає кожному користувачу
-- (у кого є tg_chat_id) персональний ранковий дайджест у DM.
--
-- ВАЖЛИВО: спочатку задеплой Edge Function daily-personal-digest:
--   supabase functions deploy daily-personal-digest --no-verify-jwt
-- =====================================================================

-- Прибираємо стару задачу (ідемпотентно)
select cron.unschedule('hq-daily-personal-digest') where exists (
  select 1 from cron.job where jobname = 'hq-daily-personal-digest'
);

-- Створюємо нову — о 06:00 UTC щодня (≈ 09:00 Kyiv)
-- Запускається на 1 годину раніше за груповий digest (07:00 UTC),
-- щоб люди отримали персональне першим у себе в DM,
-- а потім — загальне у спільну групу.
select cron.schedule(
  'hq-daily-personal-digest',
  '0 6 * * *',  -- 06:00 UTC щодня
  $$
  select net.http_post(
    url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-personal-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hq-cron-secret', '<ВСТАВ_ТУТ_HQ_CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- ⚠️ ОБОВ'ЯЗКОВО: заміни <ВСТАВ_ТУТ_HQ_CRON_SECRET> на реальне значення
--    того ж самого HQ_CRON_SECRET, що в Edge Functions secrets.
--    Це той самий секрет, що використовується в migration 004.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ПЕРЕВІРКА
-- ---------------------------------------------------------------------
-- select jobname, schedule, active from cron.job
--  where jobname like 'hq-%' order by jobname;
--
-- select * from cron.job_run_details
--  where jobid = (select jobid from cron.job where jobname = 'hq-daily-personal-digest')
--  order by start_time desc limit 5;
--
-- Ручний запуск без cron (для тесту):
-- select net.http_post(
--   url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-personal-digest',
--   headers := jsonb_build_object('x-hq-cron-secret', '<секрет>'),
--   body := '{}'::jsonb
-- );
