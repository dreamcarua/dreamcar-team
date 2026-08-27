-- 028 — 27.08.2026. Перенос SMM watchdog на Edge + зниження ETL MySQL.
--
-- КОНТЕКСТ ПО ЛІМІТАХ (перевірено перед змінами, щоб не зробити гірше):
--   Supabase Edge Functions: CPU time **2 s на запит** (async I/O не рахується),
--   wall clock 400 s (Pro), memory 256 MB, ~2M invocations/міс включено.
--   Поточне навантаження: 136 активних pg_cron-джобів, ~3265 HTTP/добу (~98k/міс) —
--   це 5% від ліміту invocations, місця вистачає.
--
-- 🔴 ВИСНОВОК: важкі ETL (FB Ads, MySQL) на Edge переносити НЕ МОЖНА — вони парсять
--    тисячі рядків, а це CPU-час, і 2 s вони переберуть. Лишаються в Actions.
--    На Edge переносимо лише легке: watchdog — це 2 HTTP-запити й трохи арифметики.
--
-- 1) SMM watchdog → Edge, раз на годину у робоче вікно (4-19 UTC = 07:00-22:00 Kyiv).
--    GH-воркфлоу поки НЕ вимикаємо — попрацюють паралельно добу, звіримо, потім вимкнемо.
--    Дублю алертів не буде: обидві версії читають один стан smm_watchdog_state
--    і поважають REMIND_HOURS=1, тож другий у ту саму годину промовчить.
select cron.schedule(
  'smm-content-watchdog-edge',
  '25 4-19 * * *',
  $$select net.http_get(
      url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/smm-content-watchdog',
      headers := jsonb_build_object('x-hq-cron-secret', (select value from app_secrets where key='hq_cron_secret')),
      timeout_milliseconds := 25000)$$
);

-- 2) ETL MySQL: 48 → 24 рани на добу. За звітом GitHub це найдорожчий DreamCar-воркфлоу
--    (24 хв/добу). Затримка оплат зростає максимум до 60 хв; під час промо повернемо
--    '15,45 * * * *' або запустимо вручну через workflow_dispatch.
select cron.alter_job(75, schedule := '30 * * * *');

select jobid, jobname, schedule, active from cron.job
 where jobid = 75 or jobname = 'smm-content-watchdog-edge' order by jobid;
