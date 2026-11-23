-- Копія dreamcar-dashboard/etl/migrations/20261123a_project_costs_whole_project.sql для apply-migration.yml (накочено 23.11.2026, ✅ Вадим «накочуй»)
begin;
-- 23.11.2026 · P&L: витрата «на весь проєкт» з поділом порівну на дні проєкту.
-- Запит Давида в техбот (#20261123-1603-e3fc), план погодив Вадим 23.11.2026.
-- Один рядок project_costs з whole_project=true; денний P&L бачить amount_uah / днів проєкту
-- (launches.starts_on .. ends_on, без ends_on до сьогодні), залишок копійок в останній день.
-- Дати проєкту змінились = поділ перераховується сам (view, не збережені рядки по днях).
-- Загальний P&L проєкту (dashboard_project_pnl) від дат не залежить і не змінюється.
-- Відкат: 20261123a_project_costs_whole_project_rollback.sql

alter table public.project_costs add column if not exists whole_project boolean not null default false;
comment on column public.project_costs.whole_project is
  'true = витрата на весь проєкт: у денному P&L ділиться порівну на дні launches.starts_on..ends_on (залишок в останній день); spent_at = старт проєкту';

create or replace view public.project_costs_daily as
with pc as (
  select c.id, c.launch_id, c.category_id, c.amount_uah, c.spent_at, c.whole_project,
         l.starts_on, coalesce(l.ends_on, current_date) as end_eff
  from public.project_costs c
  left join public.launches l on l.id = c.launch_id
), spread as (
  select pc.id, pc.launch_id, pc.category_id, pc.amount_uah, pc.starts_on,
         (pc.end_eff - pc.starts_on + 1) as dur,
         round(pc.amount_uah / (pc.end_eff - pc.starts_on + 1), 2) as share
  from pc
  where pc.whole_project and pc.starts_on is not null and pc.end_eff >= pc.starts_on
)
select s.id as cost_id, s.launch_id, s.category_id, g.d::date as d,
       case when g.d::date = s.starts_on + (s.dur - 1)
            then s.amount_uah - s.share * (s.dur - 1)
            else s.share end as amount_uah
from spread s
cross join lateral generate_series(s.starts_on::timestamp, (s.starts_on + (s.dur - 1))::timestamp, interval '1 day') as g(d)
union all
select pc.id, pc.launch_id, pc.category_id, pc.spent_at, pc.amount_uah
from pc
where not (pc.whole_project and pc.starts_on is not null and pc.end_eff >= pc.starts_on);

comment on view public.project_costs_daily is 'project_costs по днях: звичайна витрата = її spent_at, whole_project = поділ на дні проєкту. Лише для P&L-розрахунків (service_role).';
revoke all on public.project_costs_daily from public, anon, authenticated;
grant select on public.project_costs_daily to service_role;

-- mv_finance_daily_pnl: pc_d з project_costs_daily (решта визначення без змін)
do $$
declare v text; n text;
begin
  v := pg_get_viewdef('public.mv_finance_daily_pnl'::regclass);
  if position('project_costs_daily' in v) > 0 then raise notice 'mv already patched'; return; end if;
  n := replace(v, 'SELECT pc_1.spent_at AS d,', 'SELECT pc_1.d,');
  n := replace(n, 'FROM project_costs pc_1', 'FROM project_costs_daily pc_1');
  n := replace(n, 'GROUP BY pc_1.spent_at', 'GROUP BY pc_1.d');
  if n = v or position('spent_at' in n) > 0 or position('project_costs_daily pc_1' in n) = 0 then
    raise exception 'mv_finance_daily_pnl: unexpected definition, patch not applied';
  end if;
  execute 'drop materialized view public.mv_finance_daily_pnl';
  execute 'create materialized view public.mv_finance_daily_pnl as ' || n;
  execute 'create unique index mv_finance_daily_pnl_day_pk on public.mv_finance_daily_pnl using btree (day)';
  execute 'create index mv_finance_daily_pnl_day_brin on public.mv_finance_daily_pnl using brin (day)';
  execute 'revoke all on public.mv_finance_daily_pnl from public, anon, authenticated';
  execute 'grant all on public.mv_finance_daily_pnl to service_role';
end $$;

-- dashboard_period_pnl: variable/percent costs по днях із project_costs_daily
do $$
declare v text; n text;
begin
  v := pg_get_functiondef('public.dashboard_period_pnl(date,date,text,uuid[])'::regprocedure);
  if position('project_costs_daily' in v) > 0 then raise notice 'period fn already patched'; return; end if;
  n := regexp_replace(v, 'LEFT JOIN project_costs pc\s+ON pc\.spent_at BETWEEN', 'LEFT JOIN project_costs_daily pc ON pc.d BETWEEN');
  if n = v or position('spent_at' in n) > 0 then
    raise exception 'dashboard_period_pnl: unexpected definition, patch not applied';
  end if;
  execute n;
end $$;
commit;
