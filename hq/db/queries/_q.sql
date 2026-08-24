with d as (
  select date_start, sum(spend) s, count(*) c
  from dashboard_ads_data
  where date_start >= current_date - 30 and coalesce(platform,'meta')<>'google'
  group by 1)
select json_build_object(
  'meta_by_day', (select json_agg(json_build_object('d',date_start,'spend',round(s),'rows',c) order by date_start desc) from d),
  'tg_post_analytics', (select json_build_object('rows_30d',count(*),'last',max(fetched_at))
     from tg_post_analytics where fetched_at >= now() - interval '30 days'),
  'ig_media', (select json_build_object('rows_30d',count(*),'last',max(created_at))
     from dashboard_ig_media where created_at >= now() - interval '30 days')
) as r;
