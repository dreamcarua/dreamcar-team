with agg as (
  select project, (paid_at at time zone 'Europe/Kyiv')::date d, count(*) c, sum(amount) s
  from dashboard_deals
  where status='pay' and project in ('IPHONE 17 PRO MAX','3 IPHONE')
  group by 1,2
)
select json_agg(json_build_object('p',project,'d',d,'c',c,'s',s) order by project, d) as r from agg;
