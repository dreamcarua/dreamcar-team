-- 026_emergency_etl_throttle.sql — 26.08.2026, АВАРІЙНЕ ЗНИЖЕННЯ
--
-- Причина: GitHub прислав алерт «90% Actions minutes» — 2723 із 3000, reset аж 01.09.
-- Замір за 24 год: 416 хв/добу сумарно по всіх приватних репо. При залишку 277 хв
-- квоти вистачало приблизно на 16 годин. Без бюджету у Billing це означає повну
-- зупинку Actions до 1 вересня — тобто мертві ETL, компресія і автопост.
--
-- Що ріжемо і чому це безпечно ЗАРАЗ:
--   • jobid 76 (etl-fb-ads) — реклама вимкнена з 18.08 (spend = 0), ETL возить нулі.
--   • jobid 75 (etl-mysql)  — оплат теж нема з 20.08 (deals 0 / webhooks 0 / ads 0).
-- Обидва GH-воркфлоу вже disabled, це другий канал тригерів (див. міграцію 025).
--
-- 🔴 ПІСЛЯ СТАРТУ НОВОГО ПРОМО ПОВЕРНУТИ:
--   select cron.alter_job(75, schedule := '15,45 * * * *');
--   select cron.alter_job(76, schedule := '45 * * * *');
--   gh workflow enable "ETL MySQL → Supabase"      -R dreamcarua/dreamcar-dashboard
--   gh workflow enable "ETL Facebook Ads → Supabase" -R dreamcarua/dreamcar-dashboard
--   gh workflow enable "SMM Content Watchdog (IG stories/posts)" -R dreamcarua/dreamcar-dashboard

-- ETL MySQL: 48/добу → 4/добу (кожні 6 год). Оплати за паузи однаково не йдуть,
-- а якщо раптом підуть — максимальна затримка 6 год, і є workflow_dispatch.
select cron.alter_job(75, schedule := '20 2,8,14,20 * * *');

-- ETL FB Ads: 24/добу → 2/добу. Повернути одразу як увімкнемо рекламу.
select cron.alter_job(76, schedule := '50 6,18 * * *');

select jobid, schedule, active,
       substring(command from 'workflow'',''([a-z-]+)') as workflow
  from cron.job where jobid in (75,76) order by jobid;
