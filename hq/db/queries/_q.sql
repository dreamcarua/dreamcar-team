with x as (
  select p.id, p.code, p.name, p.date_start, p.date_end, unnest(p.deal_project_values) as val
  from dashboard_projects p
)
select json_build_object(
  'overlaps', (select json_agg(o) from (
      select val, count(*) c, json_agg(json_build_object('code',code,'name',name,'start',date_start) order by date_start) projects
      from x group by val having count(*)>1 order by c desc) o),
  'cols_projects', (select json_agg(column_name order by ordinal_position)
      from information_schema.columns where table_name='dashboard_projects'),
  'all_projects', (select json_agg(json_build_object('code',code,'vals',deal_project_values,'s',date_start,'e',date_end) order by date_start desc)
      from dashboard_projects)
) as r;
