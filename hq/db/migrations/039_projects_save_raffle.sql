-- 039_projects_save_raffle.sql — «шайтан-машина»: один збереження в /projects заводить
-- розіграш в обидва реєстри (launches + dashboard_projects) з точним часом старту/STOP/ефіру.
-- Застосовано 08.10.2026 через Supabase MCP (039 + 039b). Актуальні тіла — у БД (pg_get_functiondef).

create or replace function public.projects_save_raffle(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_kind text := coalesce(nullif(p->>'kind',''), 'raffle');
  v_code text := nullif(trim(p->>'code'),'');
  v_name text := nullif(trim(p->>'name'),'');
  v_start timestamptz := public.general_from_kyiv(p->>'starts_local');
  v_stop  timestamptz := public.general_from_kyiv(p->>'stop_local');
  v_live  timestamptz := public.general_from_kyiv(p->>'live_local');
  v_son date; v_eon date; v_excl boolean := coalesce((p->>'excl_from_finance')::boolean, false);
  v_status project_status := coalesce(nullif(p->>'status',''), 'active')::project_status;
  v_aliases text[]; v_dash uuid; v_dash_action text := 'skip'; v_warn text[] := '{}';
  v_dstatus text;
begin
  if not public.current_user_has_role(array['ceo','coo','lead']::user_role[]) then
    raise exception 'Створювати і редагувати проєкти можуть CEO, COO і лід' using errcode = '42501';
  end if;
  if v_name is null then raise exception 'Введи назву'; end if;
  if v_kind not in ('raffle','content','other') then raise exception 'Невідомий тип проєкту'; end if;
  if v_start is not null and v_stop is not null and v_stop <= v_start then raise exception 'STOP має бути пізніше старту'; end if;
  if v_live is not null and v_stop is not null and v_live < v_stop then raise exception 'Ефір має бути після STOP'; end if;
  v_son := coalesce((v_start at time zone 'Europe/Kyiv')::date, nullif(p->>'starts_on','')::date);
  v_eon := coalesce((v_stop  at time zone 'Europe/Kyiv')::date, nullif(p->>'ends_on','')::date);
  select array_agg(distinct upper(trim(x))) filter (where trim(x) <> '') into v_aliases
    from unnest(string_to_array(coalesce(p->>'deal_values',''), ',')) x;

  if v_id is null then
    insert into public.launches(desk_id, is_active, name, code, status, description, color, notes, budget_plan,
      excl_from_finance, kind, cycle_no, starts_at, stop_at, live_at, starts_on, ends_on, live_url)
    values ('11111111-1111-1111-1111-111111111111', true, v_name, v_code, v_status, nullif(p->>'description',''),
      coalesce(nullif(p->>'color',''),'#E30613'), nullif(p->>'notes',''), nullif(p->>'budget_plan','')::numeric,
      v_excl, v_kind, nullif(p->>'cycle_no','')::smallint, v_start, v_stop, v_live, v_son, v_eon, nullif(p->>'live_url',''))
    returning id into v_id;
  else
    update public.launches set name = v_name, code = v_code, status = v_status,
      description = nullif(p->>'description',''), color = coalesce(nullif(p->>'color',''), color),
      notes = nullif(p->>'notes',''), budget_plan = nullif(p->>'budget_plan','')::numeric,
      excl_from_finance = v_excl, kind = v_kind, cycle_no = nullif(p->>'cycle_no','')::smallint,
      starts_at = v_start, stop_at = v_stop, live_at = v_live, starts_on = v_son, ends_on = v_eon,
      live_url = case when p ? 'live_url' then nullif(p->>'live_url','') else live_url end,
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'Проєкт не знайдено'; end if;
  end if;

  -- Розіграш → другий реєстр (фінанси/дашборд), інакше дашборд покаже 0 оплат
  if v_kind = 'raffle' and not v_excl and v_status not in ('idea') then
    if v_code is null then v_warn := v_warn || 'Без коду проєкт не потрапить у дашборд — задай код (slug).';
    elsif v_son is null or v_eon is null then v_warn := v_warn || 'Без дат старту і STOP проєкт не потрапить у дашборд.';
    else
      v_dstatus := case v_status when 'completed' then 'completed' when 'archived' then 'archived' when 'measure' then 'measure' else 'active' end;
      select id into v_dash from public.dashboard_projects
       where lower(coalesce(launch_code,'')) = lower(v_code) or code = lower(v_code) limit 1;
      if v_dash is null then
        insert into public.dashboard_projects(code, launch_code, name, car_model, date_start, date_end, status, color, deal_project_values)
        values (lower(v_code), v_code, v_name, v_name, v_son, v_eon, v_dstatus, coalesce(nullif(p->>'color',''),'#E30613'),
                coalesce(v_aliases, array[upper(v_name)]))
        returning id into v_dash;
        v_dash_action := 'created';
        if v_aliases is null then v_warn := v_warn || ('Назва в CRM узята з назви проєкту: «' || upper(v_name) || '». Перевір, що в угодах SendPulse проєкт пишеться саме так.'); end if;
      else
        update public.dashboard_projects set date_start = v_son, date_end = v_eon, status = v_dstatus, launch_code = v_code,
          deal_project_values = case when v_aliases is not null then v_aliases else deal_project_values end
        where id = v_dash;
        v_dash_action := 'updated';
      end if;
    end if;
  end if;

  -- ефір у плані проєкту
  if v_kind = 'raffle' and v_live is not null then
    update public.ad_events set starts_at = v_live, ends_at = v_live + interval '1 hour', cycle = nullif(p->>'cycle_no',''), status = 'planned'
     where launch_id = v_id and source = 'general:live';
    if not found then
      insert into public.ad_events(project, cycle, launch_id, kind, title, starts_at, ends_at, audience, status, source, created_by)
      values ('dreamcar', nullif(p->>'cycle_no',''), v_id, 'live', 'Прямий ефір: розіграш ' || v_name, v_live, v_live + interval '1 hour', 'all', 'planned', 'general:live', 'projects');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'dashboard', v_dash_action, 'warnings', to_jsonb(v_warn));
exception
  when unique_violation then raise exception '%', sqlerrm;
end $$;
revoke all on function public.projects_save_raffle(jsonb) from public, anon;
grant execute on function public.projects_save_raffle(jsonb) to authenticated;

create or replace function public.general_registry_gaps() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.general_can_edit() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('launch_id', l.id, 'name', l.name, 'code', l.code, 'problem',
      case when l.code is null then 'немає коду' else 'немає в дашборді' end))
    from public.launches l
    where l.kind = 'raffle' and not l.excl_from_finance and l.status in ('planning','active','measure')
      and (l.code is null or not exists (select 1 from public.dashboard_projects d
            where lower(coalesce(d.launch_code,'')) = lower(l.code) or d.code = lower(l.code)))), '[]'::jsonb);
end $$;
revoke all on function public.general_registry_gaps() from public, anon;
grant execute on function public.general_registry_gaps() to authenticated;

-- 039b: в'юха projects віддає excl_from_finance (раніше не віддавала → галочка скидалась при редагуванні) і нові поля
create or replace view public.projects with (security_invoker = true) as
 select id, desk_id, name, code, status, description, starts_on, ends_on, color, is_active, team_lead_id,
    budget_plan, budget_actual, kpi_targets, kpi_actuals, notes, created_at, updated_at,
    (select count(*) from publications p where p.launch_id = launches.id) as publications_count,
    excl_from_finance, kind, cycle_no, starts_at, stop_at, live_at, live_url
   from launches;

create or replace function public.general_sync_live_cancel() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.live_at is not null and new.live_at is null then
    update public.ad_events set status = 'cancelled' where launch_id = new.id and source = 'general:live' and status <> 'cancelled';
  end if;
  return null;
end $$;
create or replace trigger launches_live_cancel after update of live_at on public.launches
  for each row execute function public.general_sync_live_cancel();
revoke all on function public.general_sync_live_cancel() from public, anon, authenticated;
