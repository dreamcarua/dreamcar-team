select json_build_object(
  'ipm_by_day', (select json_agg(x order by (x->>'d')) from (
      select json_build_object('d', (paid_at at time zone 'Europe/Kyiv')::date, 'c', count(*), 's', sum(amount)) x
      from dashboard_deals
      where project = 'IPHONE 17 PRO MAX' and status='pay'
      group by 1) t),
  'three_by_day', (select json_agg(x order by (x->>'d')) from (
      select json_build_object('d', (paid_at at time zone 'Europe/Kyiv')::date, 'c', count(*), 's', sum(amount)) x
      from dashboard_deals
      where project = '3 IPHONE' and status='pay'
      group by 1) t2)
) as r;
