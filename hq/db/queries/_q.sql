select json_build_object(
  'google_ads', (select json_build_object('rows',count(*),'spend',round(coalesce(sum(spend),0)),'last',max(date_start))
     from dashboard_ads_data where platform='google' and date_start >= current_date - 30),
  'meta_ads_7d', (select json_build_object('rows',count(*),'spend',round(coalesce(sum(spend),0)),'last',max(date_start))
     from dashboard_ads_data where coalesce(platform,'meta')<>'google' and date_start >= current_date - 7),
  'tables_like', (select json_agg(table_name) from information_schema.tables
     where table_schema='public' and (table_name ilike '%tg_post%' or table_name ilike '%ig_insight%' or table_name ilike '%ig_media%'))
) as r;
