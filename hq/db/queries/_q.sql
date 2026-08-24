select json_build_object(
  'tg_post_analytics', (select json_build_object(
      'rows_30d',count(*),'last_sync',max(last_synced_at),
      'with_views',count(*) filter (where views>0),
      'with_clicks',count(*) filter (where clicks_total>0))
     from tg_post_analytics where first_published_at >= now() - interval '30 days'),
  'ig_media', (select json_build_object('rows_30d',count(*),'last_sync',max(synced_at))
     from dashboard_ig_media where synced_at >= now() - interval '30 days'),
  'active_meta_campaigns', (select count(*) from dashboard_ads_data
     where date_start >= current_date - 3 and coalesce(spend,0) > 0)
) as r;
