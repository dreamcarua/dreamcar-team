-- 040_projects_merge_general.sql — GENERAL злитий у розділ ПРОЄКТИ (08.10.2026).
-- Застосовано через Supabase MCP. Сторінка проєкту тепер показує будь-який проєкт (не лише розіграш):
-- general_list_launches — усі активні проєкти з полем kind; general_get_plan — без фільтра kind='raffle',
-- дні плану будуються для розіграшів і для коротких (≤ 62 дні) інших проєктів (CONTENT до 2050 — без днів).

create or replace function public.general_list_launches() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Europe/Kyiv')::date; v_default uuid;
begin
  if not public.general_can_read() then raise exception 'Немає доступу' using errcode = '42501'; end if;
  select id into v_default from public.launches
   where kind='raffle' and status not in ('idea','archived','completed') and starts_on is not null
   order by (v_today between starts_on and coalesce(ends_on, starts_on)) desc, (starts_on >= v_today) desc, abs(starts_on - v_today)
   limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'code', l.code, 'cycle_no', l.cycle_no, 'status', l.status, 'kind', l.kind,
      'starts_on', l.starts_on, 'ends_on', l.ends_on,
      'archived', l.status in ('completed','archived'), 'is_default', l.id = v_default)
      order by (l.kind = 'raffle') desc, l.starts_on desc nulls last, l.name)
    from public.launches l where l.is_active), '[]'::jsonb);
end $$;

do $$ declare d text; begin
  d := pg_get_functiondef('public.general_get_plan(uuid)'::regprocedure);
  d := replace(d, 'select * into v_l from public.launches where id = p_launch and kind=''raffle'';', 'select * into v_l from public.launches where id = p_launch;');
  if d not like '%''kind'', v_l.kind%' then
    d := replace(d, '''id'', v_l.id, ''name'', v_l.name, ''code'', v_l.code,', '''id'', v_l.id, ''name'', v_l.name, ''code'', v_l.code, ''kind'', v_l.kind, ''description'', v_l.description, ''notes'', v_l.notes,');
  end if;
  if d not like '%<= 62%' then
    d := replace(d, 'from generate_series(v_l.starts_on, coalesce(v_l.ends_on, v_l.starts_on), interval ''1 day'') d), ''[]''::jsonb),',
                    'from generate_series(v_l.starts_on, coalesce(v_l.ends_on, v_l.starts_on), interval ''1 day'') d
                      where v_l.starts_on is not null and (v_l.kind = ''raffle'' or coalesce(v_l.ends_on, v_l.starts_on) - v_l.starts_on <= 62)), ''[]''::jsonb),');
  end if;
  execute d;
end $$;
