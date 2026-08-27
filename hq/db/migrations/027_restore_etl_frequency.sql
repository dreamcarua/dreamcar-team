-- 027_restore_etl_frequency.sql — 27.08.2026, ВІДКАТ аварійного зниження
--
-- Контекст: 24.08 репо перевели у private, і Actions почали їсти квоту. 27.08 квота
-- вигоріла (3000/3000), бо реальне споживання виявилось у ~20 разів більшим за мою
-- оцінку. Репо повернуто у public → Actions знову безкоштовні (для public-репо на
-- standard runners вони безлімітні), тож економити хвилини більше не треба.
--
-- Повертаємо робочу частоту: ризик «забули ввімкнути перед стартом промо» коштує
-- дорожче за хвилини, яких тепер і так не рахують.
--
-- 🔴 Урок, який лишається в силі: pg_cron — ОСНОВНИЙ канал тригерів ETL
-- (див. міграцію 025 і feedback_etl_two_trigger_channels).

select cron.alter_job(75, schedule := '15,45 * * * *');  -- etl-mysql:  назад 2/год
select cron.alter_job(76, schedule := '45 * * * *');      -- etl-fb-ads: назад 1/год

select jobid, schedule, active,
       substring(command from 'workflow'',''([a-z-]+)') as workflow
  from cron.job where jobid in (75,76) order by jobid;
