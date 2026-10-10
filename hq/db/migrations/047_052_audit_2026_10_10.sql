-- Аудит 10.10.2026 (погоджено Вадимом). Усі застосовані в прод через Supabase MCP 10.10.2026.
-- 047 users_privileged_columns_guard: authenticated міг змінити собі role/utm_terms/is_active/aliases/email
--     (політика "update by CEO/COO or self" без WITH CHECK). Перевірено тестом з відкатом: member→ceo проходило.
create or replace function public.users_guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.current_user_has_role(array['ceo','coo']::user_role[]) then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.utm_terms is distinct from old.utm_terms
     or new.is_active is distinct from old.is_active
     or new.auth_id_aliases is distinct from old.auth_id_aliases
     or new.email is distinct from old.email then
    raise exception 'Змінювати роль, доступи, email або статус може лише CEO/COO' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.users_guard_privileged_columns() from public, anon, authenticated;
create or replace trigger users_guard_privileged before update on public.users
  for each row execute function public.users_guard_privileged_columns();

-- 048 health_functions_revoke_client: 119 функцій health_*/hi_* виконувались будь-яким authenticated.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'health\_%' or p.proname like 'hi\_%') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
revoke execute on function public.library_guess_launch(timestamptz) from anon;
revoke execute on function public.library_guess_event(uuid, timestamptz) from anon;

-- 049 health_view_token_scope: ingest-токен (9d8f…) лежав у публічному health/vadym/index.html з 06.07.
--     Читання дашборда (health_dashboard_cached/_json, health_ask_ctx) тепер лише токеном scope='view'.
alter table health.ingest_tokens add column if not exists scope text not null default 'ingest';
-- (функції пропатчено replace: "where token=p_token and active)" → "... and active and scope='view')")
-- insert health.ingest_tokens(label='dashboard-view', scope='view') — значення токена не в репо.

-- 050 projects_save_raffle_sync_deal_aliases: P&L #22 = 0, бо CRM-назви писались лише в
--     dashboard_projects.deal_project_values, а dashboard_project_pnl бере launches.deal_aliases.
--     Функцію пропатчено: після синку dashboard_projects копіює deal_project_values у launches.deal_aliases.
update public.launches l set deal_aliases = dp.deal_project_values
  from public.dashboard_projects dp
 where dp.code = 'bmw330' and l.name = 'BMW G20 330' and l.deal_aliases is null;

-- 051 webhook_health_alert_v2: cron 30 слав старий секрет у notify-tg (401) → алерт ніколи не доходив.
--     Тепер public.webhook_health_check() кожні 10 хв, 08:00–00:59 Київ, поріг 30 хв, повтор раз на 2 год,
--     повідомлення «відновились»; через tg_notify_queue у DreamCar TECH. Стан: public.ops_alert_state.
--     select cron.alter_job(30, schedule := '*/10 * * * *', command := 'select public.webhook_health_check()');

-- 052 verify_pub_cron_cleanup: 34 разові verify_pub_* лишались активними (спрацювали б у 2027).
--     safe_unschedule тепер SECURITY DEFINER, лише для verify_pub_*, виконує тільки service_role.
