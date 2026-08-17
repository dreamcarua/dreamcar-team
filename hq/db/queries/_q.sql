select json_build_object(
  'refresh_jobs', (select json_agg(json_build_object('jobid',jobid,'sched',schedule,'cmd',left(command,200)))
      from cron.job where command ilike '%mv_dashboard_projects_stats%' or command ilike '%refresh%projects%'),
  'rpc_src', (select left(pg_get_functiondef(p.oid), 700) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname='dashboard_projects_with_stats' and n.nspname='public' limit 1),
  'mv_size', (select pg_size_pretty(pg_total_relation_size('mv_dashboard_projects_stats'))),
  'deals_rows', (select count(*) from dashboard_deals),
  'refreshed_at', (select max(refreshed_at) from mv_dashboard_projects_stats)
) as r;
