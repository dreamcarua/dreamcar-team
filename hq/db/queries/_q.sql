do $$
declare rid bigint;
begin
  select net.http_get(
    url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/smm-content-watchdog?dry=1',
    headers := jsonb_build_object('x-hq-cron-secret', (select value from app_secrets where key='hq_cron_secret')),
    timeout_milliseconds := 25000) into rid;
  perform pg_sleep(12);
  create temp table _res as select status_code, content from net._http_response where id = rid;
end $$;
select json_build_object('status',status_code,'body',left(content,600)) as r from _res;
