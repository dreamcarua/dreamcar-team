-- 024_project_alias_collision_guard.sql — 17.08.2026
--
-- ПРОБЛЕМА (знайдено 17.08 на проєкті «Три iPhone 17»)
-- У dashboard_projects.deal_project_values проєкту `3iphone` було значення
-- 'IPHONE 17 PRO MAX' — але воно вже належало ЧЕРВНЕВОМУ промо `iphone_17_jun2026`.
-- MV mv_dashboard_projects_stats джойнить угоди ТІЛЬКИ по `d.project = ANY(vals)`,
-- без жодного фільтра по датах. Наслідок:
--   • «Три iPhone 17» показував 6747 оплат / 1 410 905 ₴
--     замість реальних 2874 / 685 589 ₴ (рівно вдвічі більше);
--   • ті самі 3873 оплати (725 316 ₴) рахувались ОДНОЧАСНО у двох проєктах,
--     тобто «Виручка lifetime» у KPI теж була завищена на цю суму;
--   • ROI/CAC/AOV проєкту брехали слідом.
--
-- Значення вписуються руками у формі проєкту (textarea «deal.project values»),
-- і назва «IPHONE 17 PRO MAX» природно проситься для промо, де один із призів —
-- саме iPhone 17 Pro Max. Тобто це не одноразова описка, а граблі, на які наступлять
-- знову. Тому окрім фіксу даних ставимо тригер-запобіжник.

-- ── 1. Фікс даних ────────────────────────────────────────────────────────────
-- Перевірено: угоди з project='IPHONE 17 PRO MAX' існують лише 05-07.06 і 02-05.07.
-- Жодної у серпні — тож для `3iphone` це значення чуже на 100%.
update dashboard_projects
   set deal_project_values = array_remove(deal_project_values, 'IPHONE 17 PRO MAX'),
       updated_at = now()
 where code = '3iphone'
   and 'IPHONE 17 PRO MAX' = any(deal_project_values);

-- ── 2. Запобіжник: одне значення = один проєкт ───────────────────────────────
-- Унікальний індекс по unnest() Postgres не дозволяє, тому тригер.
create or replace function public.check_project_alias_collision()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  conflict_code text;
  conflict_val  text;
begin
  select p.code, v.val into conflict_code, conflict_val
    from dashboard_projects p
    cross join lateral unnest(p.deal_project_values) as v(val)
   where p.id <> new.id
     and v.val = any(new.deal_project_values)
   limit 1;

  if conflict_code is not null then
    raise exception
      'Значення "%" вже належить проєкту "%". Один deal.project може вести лише до одного проєкту — інакше його оплати порахуються двічі й у обох проєктах будуть завищені цифри.',
      conflict_val, conflict_code
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_alias_collision on public.dashboard_projects;
create trigger trg_project_alias_collision
  before insert or update of deal_project_values on public.dashboard_projects
  for each row execute function public.check_project_alias_collision();

comment on function public.check_project_alias_collision() is
  '17.08.2026: не дає одному deal.project-значенню належати двом проєктам. MV не фільтрує угоди по датах, тому перетин aliasʼів = подвійний рахунок виручки.';

-- ── 3. Перерахунок ──────────────────────────────────────────────────────────
-- MV легка (64 kB), крон і так рефрешить її двічі на годину (jobid 55).
refresh materialized view concurrently public.mv_dashboard_projects_stats;
