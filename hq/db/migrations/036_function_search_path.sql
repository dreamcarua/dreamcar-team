-- 036_function_search_path.sql — hardening: закріпити search_path у 40 функцій
-- (advisor function_search_path_mutable). Пінимо на ПОТОЧНИЙ ефективний набір
-- (public, extensions, pg_temp) — поведінка не змінюється, лише стає фіксованою
-- (захист від search_path-ін'єкції у SECDEF). Ідемпотентно: чіпаємо лише ті,
-- де search_path ще НЕ заданий. Відкат: ALTER FUNCTION ... RESET search_path.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        '_dash_viewer_ctx','_htrend','backfill_ads_utm_from_deals','canon_code','current_offset',
        'hq_note_voter_roles','is_paid_placement','is_quiet_hours_kyiv','kasa_account_cashflow',
        'kasa_account_ops','kasa_cashflow','kasa_dividends','kasa_internal_flow','kasa_is_allowed',
        'kasa_kick','kasa_kick_one','kasa_mark_internal','kasa_monthly_cashflow','kasa_search',
        'kasa_touch_updated_at','kasa_try_reanchor','last_sample_at','local_date','local_ts',
        'next_send_time_kyiv','pick_bank_replies','publications_notify_with_dedup','reconcile_pay_provider',
        'reset_approvals_on_rework','resolve_ads_project','rpc_cache_cleanup','sanitize_html',
        'tg_ads_stamp_project','tg_dashboard_deals_normalize_project','tg_sanitize_insight','today_local',
        'touch_updated_at','trg_creatives_force_pending_video','utm_eq'
      ])
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO ''public'', ''extensions'', ''pg_temp''', r.sig);
    RAISE NOTICE 'search_path pinned: %', r.sig;
  END LOOP;
END $$;
