with p as (
  select id, code, name, date_start, date_end, deal_project_values
  from dashboard_projects where name ilike '%iPhone%'
), d as (
  select dd.* from dashboard_deals dd, p where dd.project = any(p.deal_project_values)
)
select json_build_object(
  'proj', (select json_agg(json_build_object('code',code,'name',name,'vals',deal_project_values,'s',date_start,'e',date_end)) from p),
  'pay_cnt', (select count(*) from d where status='pay'),
  'pay_sum', (select sum(amount) from d where status='pay'),
  'by_value', (select json_agg(x) from (select project, status, count(*) c, sum(amount) s from d group by 1,2 order by 4 desc) x),
  'dup_wc', (select json_build_object('groups',count(*),'extra_rows',sum(c-1),'extra_sum',sum(sx))
       from (select wc_order_id, count(*) c, sum(amount)-min(amount) sx from d where status='pay' and wc_order_id is not null group by 1 having count(*)>1) z),
  'dup_sp', (select json_build_object('groups',count(*),'extra_rows',sum(c-1),'extra_sum',sum(sx))
       from (select sendpulse_deal_id, count(*) c, sum(amount)-min(amount) sx from d where status='pay' and sendpulse_deal_id is not null group by 1 having count(*)>1) z2),
  'null_keys', (select json_build_object('wc_null',count(*) filter (where wc_order_id is null),'sp_null',count(*) filter (where sendpulse_deal_id is null)) from d where status='pay'),
  'amounts', (select json_agg(h) from (select amount, count(*) c from d where status='pay' group by 1 order by c desc limit 10) h),
  'dates', (select json_build_object('min',min(paid_at),'max',max(paid_at)) from d where status='pay'),
  'outside_window', (select count(*) from d, p where d.status='pay' and (d.paid_at::date < p.date_start or d.paid_at::date > p.date_end))
) as r;
