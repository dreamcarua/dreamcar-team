-- 04.11.2026: задачі колег (mode=team) видаються лише воркеру з обмеженою сесією (версія >= 2026-11-04.2).
-- Захист на час, поки Mac Studio не підтягнув новий воркер: стара версія виконала б запит колеги з повними правами.
-- Вже накочено через Supabase MCP. Rollback: попередня версія функції у 2026-11-04_owner_dm_jobs.sql.
CREATE OR REPLACE FUNCTION public.owner_dm_claim(p_worker text)
RETURNS SETOF public.owner_dm_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_id bigint; v_ver text; v_team_ok boolean;
BEGIN
  UPDATE owner_dm_jobs SET status = 'queued', updated_at = now()
   WHERE status = 'working' AND claimed_at < now() - interval '70 minutes' AND attempts < 2;
  UPDATE owner_dm_jobs SET status = 'failed', error = 'воркер не завершив задачу двічі', finished_at = now(), updated_at = now()
   WHERE status = 'working' AND claimed_at < now() - interval '70 minutes' AND attempts >= 2;

  SELECT version INTO v_ver FROM owner_dm_worker WHERE worker = p_worker;
  v_team_ok := coalesce(v_ver, '') >= '2026-11-04.2';

  SELECT id INTO v_id FROM owner_dm_jobs
   WHERE status = 'queued' AND NOT cancel_requested AND (mode = 'owner' OR v_team_ok)
   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE owner_dm_jobs SET status = 'working', worker = p_worker, claimed_at = now(),
         attempts = attempts + 1, updated_at = now()
   WHERE id = v_id RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_dm_claim(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_dm_claim(text) TO service_role;
