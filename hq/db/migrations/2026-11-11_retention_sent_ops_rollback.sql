-- Відкат 2026-11-11_retention_sent_ops.sql. М'який варіант: лише вимкнути кнопки —
--   UPDATE public.app_secrets SET value = '0' WHERE key = 'retention_sent_ops_enabled';
SELECT cron.unschedule('retention-sent-ops-resume') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention-sent-ops-resume');
DROP FUNCTION IF EXISTS public.retention_sent_ops_resume();
DROP FUNCTION IF EXISTS public.retention_sent_op_lease(bigint);
DROP FUNCTION IF EXISTS public.retention_sent_op_cancel(bigint);
DROP FUNCTION IF EXISTS public.retention_sent_op_request(uuid, text);
DROP FUNCTION IF EXISTS public.retention_sent_info(uuid);
DROP FUNCTION IF EXISTS public._retention_kick_op(bigint);
DROP FUNCTION IF EXISTS public._retention_can_manage(uuid);
DROP TABLE IF EXISTS public.retention_sent_ops;
ALTER TABLE public.retention_messages DROP COLUMN IF EXISTS sent_media;
DELETE FROM public.app_secrets WHERE key = 'retention_sent_ops_enabled';
