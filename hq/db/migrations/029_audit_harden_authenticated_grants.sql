-- 029_audit_harden_authenticated_grants.sql
-- Аудит екосистеми 25.09.2026 (V02 + V04-matview). Застосовано на проді через Supabase MCP apply_migration
-- 25.09.2026 та звірено (0/13 функцій лишилось для authenticated, усі 13 зберегли service_role;
-- обидва revenue-matview закрито, mv_dashboard_filter_options лишився доступним).
--
-- Причина: у Supabase Auth увімкнена самореєстрація (disable_signup=false) → будь-хто = authenticated.
-- Ці функції/matview були викличні/читні роллю authenticated без перевірки особи.
-- Zero-regression: service_role (cron/edge/воркери) зберігає явний грант; фронт їх не кличе (.rpc grep = 0);
-- жодна public-функція/тригер не викликає їх у тілі.
-- Відкат: замінити REVOKE EXECUTE→GRANT EXECUTE / FROM authenticated→TO authenticated;
--          REVOKE SELECT→GRANT SELECT / FROM authenticated→TO authenticated.

REVOKE EXECUTE ON FUNCTION public.enqueue_tg_notify(p_chat_id text, p_text text, p_source text, p_emergency boolean, p_parse_mode text, p_reply_markup jsonb, p_disable_preview boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.health_rotate_ingest_token() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.kasa_kick() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.kasa_kick_one(fn text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_autopost_jobs(worker_name text, max_jobs integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_autopost_job(job_id uuid, pub_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_autopost_job(job_id uuid, pub_id uuid, chat_id text, msg_id bigint) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_autopost_job(job_id uuid, pub_id uuid, err_msg text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_compress_jobs(worker_name text, max_jobs integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_compress_job(cre_id uuid, out_url text, out_size_bytes bigint) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_pending_autoposts() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.process_autopost_queue() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_team_task_notifications(p_limit integer) FROM authenticated;

REVOKE SELECT ON public.mv_upsell_daily FROM authenticated;
REVOKE SELECT ON public.mv_dashboard_cohort_retention FROM authenticated;

-- ПРИМІТКА: autovacuum-тюнінг net._http_response (V17) НЕ входить сюди —
-- ALTER TABLE net._http_response вимагає власника таблиці (pg_net/supabase_admin),
-- недоступного через Management API. Винести у тікет Supabase support.
