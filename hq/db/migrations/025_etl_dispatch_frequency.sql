-- 025_etl_dispatch_frequency.sql — 24.08.2026
--
-- ЗНАХІДКА. ETL-воркфлоу тригеряться з ДВОХ джерел одночасно:
--   1) власний `schedule:` у .github/workflows/*.yml
--   2) pg_cron → Edge `etl-trigger` → GitHub repository_dispatch (jobid 75 і 76)
-- Другий канал додали, бо GH cron ненадійний (реально ходить у 2-4 рази рідше
-- за розклад). Але через це зміна `cron:` у воркфлоу майже нічого не дає —
-- половина ранів приходить повз нього.
--
-- Вадим попросив, щоб ETL Facebook Ads ходив удвічі рідше. У воркфлоу вже
-- зроблено 43 → 22 слоти/добу; тут приводимо до тієї ж частоти другий канал,
-- інакше економія була б лише на папері.
--
-- jobid 76 (etl-fb-ads): 15,45 * * * *  (48/добу) → 45 * * * *  (24/добу)
-- jobid 75 (etl-mysql):  НЕ чіпаємо — це оплати, свіжість критична.

select cron.alter_job(76, schedule := '45 * * * *');

-- Верифікація
select jobid, schedule, active,
       substring(command from 'workflow'',''([a-z-]+)') as workflow
  from cron.job
 where jobid in (75, 76)
 order by jobid;
