select json_build_object(
  'job75_last_runs', (select json_agg(json_build_object('start',start_time,'status',status) order by start_time desc)
     from (select start_time,status from cron.job_run_details where jobid=75 order by start_time desc limit 5) t),
  'deals_freshness', (select json_build_object(
      'last_created', max(created_at), 'last_updated', max(updated_at),
      'rows_24h', count(*) filter (where created_at >= now() - interval '24 hours'))
     from dashboard_deals),
  'etl_meta', (select json_agg(json_build_object('k',key,'v',value,'at',updated_at))
     from dashboard_settings where key like 'etl_%')
) as r;
