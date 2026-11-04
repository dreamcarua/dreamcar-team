-- 04.11.2026 (Вадим): особисті повідомлення власника боту → Claude Code (Opus) на Mac Studio.
-- tg-webhook → edge owner-dm → черга owner_dm_jobs → воркер на Mac Studio (memory-kit/mac/owner-dm).
-- Власник визначається app_secrets.owner_dm_tg_ids (через кому). ID в коді немає: репо публічне.
-- Rollback: DROP FUNCTION public.owner_dm_claim(text); DROP TABLE public.owner_dm_worker; DROP TABLE public.owner_dm_jobs;

CREATE TABLE IF NOT EXISTS public.owner_dm_jobs (
  id               bigserial PRIMARY KEY,
  chat_id          bigint      NOT NULL,
  message_id       integer     NOT NULL,
  text             text,
  reply_to_msg_id  integer,
  reply_context    text,                       -- текст повідомлення, на яке відповів власник
  files            jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{file_id, kind, name, mime, size}]
  parent_job_id    bigint      REFERENCES public.owner_dm_jobs(id),
  session_id       text,                       -- id сесії Claude Code (пише воркер)
  status           text        NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','working','need_ok','done','failed','cancelled')),
  ack_msg_id       integer,
  bot_msg_ids      integer[]   NOT NULL DEFAULT '{}',
  confirm_text     text,
  confirm_msg_id   integer,
  approval         text,                       -- 'approved' після ✅
  approved_at      timestamptz,
  cancel_requested boolean     NOT NULL DEFAULT false,
  worker           text,
  attempts         integer     NOT NULL DEFAULT 0,
  result           text,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  claimed_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS owner_dm_jobs_status_idx ON public.owner_dm_jobs (status, id);
CREATE INDEX IF NOT EXISTS owner_dm_jobs_botmsg_idx ON public.owner_dm_jobs USING gin (bot_msg_ids);
ALTER TABLE public.owner_dm_jobs ENABLE ROW LEVEL SECURITY;   -- без політик: лише service_role

CREATE TABLE IF NOT EXISTS public.owner_dm_worker (
  worker   text PRIMARY KEY,
  seen_at  timestamptz NOT NULL DEFAULT now(),
  version  text
);
ALTER TABLE public.owner_dm_worker ENABLE ROW LEVEL SECURITY;

-- Видати воркеру одну задачу (queued), атомарно.
CREATE OR REPLACE FUNCTION public.owner_dm_claim(p_worker text)
RETURNS SETOF public.owner_dm_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_id bigint;
BEGIN
  -- воркер, що завис у working довше 70 хв, повертаємо в чергу (максимум 2 спроби)
  UPDATE owner_dm_jobs SET status = 'queued', updated_at = now()
   WHERE status = 'working' AND claimed_at < now() - interval '70 minutes' AND attempts < 2;
  UPDATE owner_dm_jobs SET status = 'failed', error = 'воркер не завершив задачу двічі', finished_at = now(), updated_at = now()
   WHERE status = 'working' AND claimed_at < now() - interval '70 minutes' AND attempts >= 2;

  SELECT id INTO v_id FROM owner_dm_jobs
   WHERE status = 'queued' AND NOT cancel_requested
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
