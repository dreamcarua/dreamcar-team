do $$
declare ok boolean := false;
begin
  begin
    update dashboard_projects
       set deal_project_values = deal_project_values || array['MOTORCYCLE']
     where code = '3iphone';
  exception when unique_violation then ok := true;
  end;
  if not ok then raise exception 'GUARD НЕ СПРАЦЮВАВ — перетин aliasів пройшов!'; end if;
end $$;

select json_build_object(
  'iphone_rows', (select json_agg(json_build_object('name',name,'paid',paid,'revenue',revenue,'aov',avg_check,'conv',conv_rate,'buyers',buyers))
      from mv_dashboard_projects_stats where name ilike '%iphone%'),
  'vals_3iphone', (select deal_project_values from dashboard_projects where code='3iphone'),
  'lifetime_revenue', (select sum(revenue) from mv_dashboard_projects_stats),
  'guard_installed', (select count(*) from pg_trigger where tgname='trg_project_alias_collision')
) as r;
