select json_build_object(
  'secret_tables', (select json_agg(table_name) from information_schema.tables
      where table_schema='public' and (table_name ilike '%secret%' or table_name ilike '%config%')),
  'app_secrets_keys', (select json_agg(key) from app_secrets),
  'settings_fb', (select json_agg(json_build_object('k',key,'len',length(value::text),'at',updated_at))
      from dashboard_settings where key ilike '%token%' or key ilike '%fb%' or key ilike '%meta%' or key ilike '%smm%')
) as r;
