select json_build_object(
  'watchdog_test', (select json_build_object('status',status_code,'body',left(content,400))
     from net._http_response order by id desc limit 1),
  'pg_net_last_hour', (select count(*) from net._http_response where created > now() - interval '1 hour'),
  'cron_jobs_active', (select count(*) from cron.job where active),
  'cron_http_per_day', (select sum(case
       when schedule ~ '^\*/([0-9]+)' then 1440 / nullif((regexp_match(schedule,'^\*/([0-9]+)'))[1]::int,0)
       when schedule ~ '^[0-9,]+ \*' then array_length(string_to_array(split_part(schedule,' ',1),','),1) * 24
       else 1 end)
     from cron.job where active and command ilike '%http_post%')
) as r;
