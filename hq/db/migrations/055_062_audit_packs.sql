-- Аудит 10.10.2026, пакети 1 і 2 (погоджено Вадимом). Застосовано в прод через Supabase MCP 10.10.2026.
-- Повні тексти патчів функцій генерувались через pg_get_functiondef + replace; тут суть і канонічні частини.

-- 055 money_rpc_guards: 23 фінансові RPC отримали першим рядком `perform public.dc_assert_money();`
--     (ролі ceo/coo/cfo/lead; service_role і pg_cron проходять), 3 касові (kasa_bank_page, kasa_stale_accounts,
--     dashboard_kasa_fop_limit) — `perform public.dc_assert_kasa();` (kasa_is_allowed). Ядра agg_*_core — лише через
--     SECDEF-обгортки (revoke execute from authenticated). Перевірено ролями: ceo/cfo/lead ok, member/buyer/media deny.
create or replace function public.dc_assert_money(p_roles user_role[] default array['ceo','coo','cfo','lead']::user_role[])
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.dashboard_money_visible(p_roles) then
    raise exception 'Недостатньо прав для фінансових даних' using errcode = '42501';
  end if;
end $$;
create or replace function public.dc_assert_kasa()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if v_role in ('', 'service_role') then return; end if;
  if v_role = 'anon' or not public.kasa_is_allowed() then
    raise exception 'Недостатньо прав для Каси' using errcode = '42501';
  end if;
end $$;

-- 056/056b default privileges: нова функція не отримує EXECUTE для PUBLIC/anon/authenticated.
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
alter default privileges for role postgres revoke execute on functions from public;

-- 057 users_guard_insert: тригер users_guard_privileged_ins (BEFORE INSERT) — створювати користувачів лише CEO/COO;
--     зміна вже заданого auth_id теж лише CEO/COO.

-- 058 dispatch_trigger_cron_secret: див. 058_dispatch_trigger_cron_secret.sql.

-- 059 secrets_out_of_function_bodies: літерали секретів у 7 функціях БД → (select value from public.app_secrets where key=...)
--     ключі hq_webhook_secret, hq_cron_secret; 22 health-cron → app_secrets.health_cron_secret.

-- 060 ops_freshness_check: cron 'ops-freshness-check' (:20 щогодини) → DreamCar TECH, якщо витрати Meta не оновлювались 100 хв
--     або IG-інсайти 27 год (08:00–23:59 Київ, повтор раз на 6 год, повідомлення про відновлення).

-- 061 ops_registry_check: cron 'ops-registry-check' (06:10 UTC) → DreamCar TECH: розіграш без dashboard_projects,
--     порожні launches.deal_aliases, різні дати, 0 оплат за добу при живих продажах.

-- 062 fop_limit_year_aware: dashboard_kasa_fop_limit за замовчуванням поточний рік (Київ), поле limit_known.

-- Крім того (не міграції): cron 2750 health-dash-cache '*/10' → '55 * * * *' (найважчий запит БД; збігся з аварійним
-- рестартом 09.10 16:02 UTC разом із REFRESH mv_dashboard_utm_agg); cron 3643 trip-tick вимкнено.
