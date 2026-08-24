with d as (
  select date_start, sum(spend) s, count(*) c
  from dashboard_ads_data
  where date_start >= current_date - 21 and coalesce(platform,'meta')<>'google'
  group by 1)
select json_build_object(
  'meta_by_day', (select json_agg(json_build_object('d',date_start,'spend',round(s),'rows',c) order by date_start desc) from d),
  'cols_tg_post_analytics', (select json_agg(column_name order by ordinal_position)
     from information_schema.columns where table_name='tg_post_analytics'),
  'cols_ig_media', (select json_agg(column_name order by ordinal_position)
     from information_schema.columns where table_name='dashboard_ig_media')
) as r;
