-- 034_kpi_viewer_scope.sql  (SEC-DB-03 / V04) — застосування підготовленого 031 (аудит 26.09)
-- Рішення власника: компанійські KPI бачать лише ceo/coo/lead (+ service/cron).
-- buyer/member/designer/anon -> порожньо (RETURN, не RAISE, щоб фронт не падав).
-- Відкат: CREATE OR REPLACE цих 3 функцій без блоку guard.

BEGIN;

CREATE OR REPLACE FUNCTION public.dashboard_kpi_summary_cached(
  p_from timestamptz, p_to timestamptz, p_project_values text[] DEFAULT NULL,
  p_customer_type text DEFAULT NULL, p_tariff text DEFAULT NULL,
  p_pay_provider text DEFAULT NULL, p_traffic_type text DEFAULT NULL)
RETURNS TABLE(total bigint, paid bigint, fail bigint, pending bigint, new_deals bigint,
  revenue numeric, unique_buyers bigint, paid_rate numeric,
  cached_at timestamptz, age_seconds numeric, source text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_key text; v_cd jsonb; v_cat timestamptz; v_start timestamptz; v_data jsonb; v_row jsonb;
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public._dash_viewer_ctx();
  IF NOT (v_ctx.jwt_role IS NULL OR v_ctx.jwt_role = 'service_role'
          OR v_ctx.u_role IN ('ceo','coo','lead')) THEN
    RETURN;
  END IF;

  v_key := md5('kpi_summary|' || p_from::text || '|' || p_to::text || '|' ||
    COALESCE(array_to_string(p_project_values, ','), '') || '|' ||
    COALESCE(p_customer_type, '') || '|' || COALESCE(p_tariff, '') || '|' ||
    COALESCE(p_pay_provider, '') || '|' || COALESCE(p_traffic_type, ''));
  SELECT c.result, c.refreshed_at INTO v_cd, v_cat
  FROM dashboard_rpc_cache c WHERE c.cache_key = v_key AND c.refreshed_at > now() - interval '15 minutes';
  IF v_cd IS NOT NULL THEN
    v_row := v_cd->0;
    total := (v_row->>'total')::bigint; paid := (v_row->>'paid')::bigint;
    fail := (v_row->>'fail')::bigint; pending := (v_row->>'pending')::bigint;
    new_deals := (v_row->>'new_deals')::bigint; revenue := (v_row->>'revenue')::numeric;
    unique_buyers := (v_row->>'unique_buyers')::bigint; paid_rate := (v_row->>'paid_rate')::numeric;
    cached_at := v_cat; age_seconds := EXTRACT(EPOCH FROM (now() - v_cat))::numeric;
    source := 'cache'; RETURN NEXT; RETURN;
  END IF;
  v_start := clock_timestamp();
  SELECT jsonb_agg(to_jsonb(t.*)) INTO v_data
  FROM dashboard_kpi_summary(p_from, p_to, p_project_values, p_customer_type, p_tariff, p_pay_provider, p_traffic_type) t;
  INSERT INTO dashboard_rpc_cache(cache_key, rpc_name, params_hash, result, refreshed_at, duration_ms)
  VALUES (v_key, 'dashboard_kpi_summary', v_key, v_data, now(), EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, refreshed_at = EXCLUDED.refreshed_at, duration_ms = EXCLUDED.duration_ms;
  v_row := v_data->0;
  total := (v_row->>'total')::bigint; paid := (v_row->>'paid')::bigint;
  fail := (v_row->>'fail')::bigint; pending := (v_row->>'pending')::bigint;
  new_deals := (v_row->>'new_deals')::bigint; revenue := (v_row->>'revenue')::numeric;
  unique_buyers := (v_row->>'unique_buyers')::bigint; paid_rate := (v_row->>'paid_rate')::numeric;
  cached_at := now(); age_seconds := 0; source := 'live'; RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_extended_kpi_cached(
  p_from timestamptz, p_to timestamptz, p_project_values text[] DEFAULT NULL,
  p_customer_type text DEFAULT NULL, p_tariff text DEFAULT NULL,
  p_pay_provider text DEFAULT NULL, p_traffic_type text DEFAULT NULL)
RETURNS TABLE(cached_data jsonb, cached_at timestamptz, age_seconds numeric, source text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_key text; v_cd jsonb; v_cat timestamptz; v_start timestamptz; v_data jsonb; v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public._dash_viewer_ctx();
  IF NOT (v_ctx.jwt_role IS NULL OR v_ctx.jwt_role = 'service_role'
          OR v_ctx.u_role IN ('ceo','coo','lead')) THEN
    RETURN;
  END IF;

  v_key := md5('extended_kpi|' || p_from::text || '|' || p_to::text || '|' ||
    COALESCE(array_to_string(p_project_values, ','), '') || '|' ||
    COALESCE(p_customer_type, '') || '|' || COALESCE(p_tariff, '') || '|' ||
    COALESCE(p_pay_provider, '') || '|' || COALESCE(p_traffic_type, ''));
  SELECT c.result, c.refreshed_at INTO v_cd, v_cat
  FROM dashboard_rpc_cache c WHERE c.cache_key = v_key AND c.refreshed_at > now() - interval '30 minutes';
  IF v_cd IS NOT NULL THEN
    cached_data := v_cd; cached_at := v_cat;
    age_seconds := EXTRACT(EPOCH FROM (now() - v_cat))::numeric; source := 'cache'; RETURN NEXT; RETURN;
  END IF;
  v_start := clock_timestamp();
  SELECT jsonb_agg(to_jsonb(t.*)) INTO v_data
  FROM dashboard_extended_kpi(p_from, p_to, p_project_values, p_customer_type, p_tariff, p_pay_provider, p_traffic_type) t;
  INSERT INTO dashboard_rpc_cache(cache_key, rpc_name, params_hash, result, refreshed_at, duration_ms)
  VALUES (v_key, 'dashboard_extended_kpi', v_key, v_data, now(), EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, refreshed_at = EXCLUDED.refreshed_at, duration_ms = EXCLUDED.duration_ms;
  cached_data := v_data; cached_at := now(); age_seconds := 0; source := 'live'; RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_kpi_with_delta_cached(
  p_from timestamptz, p_to timestamptz, p_project_values text[] DEFAULT NULL,
  p_customer_type text DEFAULT NULL, p_tariff text DEFAULT NULL,
  p_pay_provider text DEFAULT NULL, p_traffic_type text DEFAULT NULL)
RETURNS TABLE(cached_data jsonb, cached_at timestamptz, age_seconds numeric, source text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_key text; v_cd jsonb; v_cat timestamptz; v_start timestamptz; v_data jsonb; v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public._dash_viewer_ctx();
  IF NOT (v_ctx.jwt_role IS NULL OR v_ctx.jwt_role = 'service_role'
          OR v_ctx.u_role IN ('ceo','coo','lead')) THEN
    RETURN;
  END IF;

  v_key := md5('kpi_with_delta|' || p_from::text || '|' || p_to::text || '|' ||
    COALESCE(array_to_string(p_project_values, ','), '') || '|' ||
    COALESCE(p_customer_type, '') || '|' || COALESCE(p_tariff, '') || '|' ||
    COALESCE(p_pay_provider, '') || '|' || COALESCE(p_traffic_type, ''));
  SELECT c.result, c.refreshed_at INTO v_cd, v_cat
  FROM dashboard_rpc_cache c WHERE c.cache_key = v_key AND c.refreshed_at > now() - interval '30 minutes';
  IF v_cd IS NOT NULL THEN
    cached_data := v_cd; cached_at := v_cat;
    age_seconds := EXTRACT(EPOCH FROM (now() - v_cat))::numeric; source := 'cache'; RETURN NEXT; RETURN;
  END IF;
  v_start := clock_timestamp();
  SELECT jsonb_agg(to_jsonb(t.*)) INTO v_data
  FROM dashboard_kpi_with_delta(p_from, p_to, p_project_values, p_customer_type, p_tariff, p_pay_provider, p_traffic_type) t;
  INSERT INTO dashboard_rpc_cache(cache_key, rpc_name, params_hash, result, refreshed_at, duration_ms)
  VALUES (v_key, 'dashboard_kpi_with_delta', v_key, v_data, now(), EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, refreshed_at = EXCLUDED.refreshed_at, duration_ms = EXCLUDED.duration_ms;
  cached_data := v_data; cached_at := now(); age_seconds := 0; source := 'live'; RETURN NEXT;
END $function$;

COMMIT;
