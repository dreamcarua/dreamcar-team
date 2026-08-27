-- викликаємо нову Edge-функцію з БД (там же лежить hq_cron_secret) і повертаємо відповідь
select net.http_get(
  url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/smm-content-watchdog?dry=1',
  headers := jsonb_build_object('x-hq-cron-secret', (select value from app_secrets where key='hq_cron_secret')),
  timeout_milliseconds := 30000
) as request_id;
