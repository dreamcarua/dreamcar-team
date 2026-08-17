with p as (
  select id, code, name, date_start, date_end, deal_project_values
  from dashboard_projects where name ilike '%iPhone%'
), d as (
  select dd.* from dashboard_deals dd, p where dd.project = any(p.deal_project_values)
)
select json_build_object(
  'project', (select json_agg(row_to_json(p)) from p),
  'deals_total', (select count(*) from d),
  'pay_cnt', (select count(*) from d where status='pay'),
  'pay_sum', (select sum(amount) from d where status='pay'),
  'by_project_value', (select json_agg(x) from (
      select project, status, count(*) c, sum(amount) s from d group by 1,2 order by 1,2) x),
  'dup_by_order_ref', (select json_agg(y) from (
      select order_reference, count(*) c, sum(amount) s
      from d where status='pay' and order_reference is not null
      group by 1 having count(*)>1 order by c desc limit 10) y),
  'dup_ref_totals', (select json_build_object('groups',count(*),'extra_rows',sum(c-1),'extra_sum',sum(s_extra))
      from (select order_reference, count(*) c, sum(amount)-min(amount) s_extra
            from d where status='pay' and order_reference is not null
            group by 1 having count(*)>1) z),
  'amount_hist', (select json_agg(h) from (
      select amount, count(*) c from d where status='pay' group by 1 order by c desc limit 12) h),
  'date_range', (select json_build_object('min',min(created_at),'max',max(created_at)) from d where status='pay')
) as r;
