-- 04.11.2026 (Вадим, запит із чату SMM): знімки статистики публікації на 6 і 24 години + розклад воркера звітів.
-- Лише дані зі статистики Instagram/Telegram; на саму картку не впливає.
-- Rollback: hq/db/migrations/2026-11-04_publication_metric_snapshots_rollback.sql
CREATE TABLE IF NOT EXISTS public.publication_metric_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id    uuid NOT NULL REFERENCES public.publications(id) ON DELETE CASCADE,
  stage             text NOT NULL CHECK (stage IN ('6h', '24h')),
  platform          text NOT NULL CHECK (platform IN ('ig', 'tg')),
  status            text NOT NULL CHECK (status IN ('ok', 'no_match', 'duplicate', 'failed')),
  format            text,                 -- reels | post | stories | carousel | longread
  external_id       text,                 -- id медіа в IG або номер повідомлення в TG
  permalink         text,
  match_method      text,                 -- saved_id | link | tg_message_id | evidence | time
  posted_at         timestamptz,
  captured_at       timestamptz NOT NULL DEFAULT now(),
  reach             integer,
  views             integer,
  likes             integer,
  comments          integer,
  saves             integer,
  shares            integer,
  total_interactions integer,
  avg_watch_sec     numeric,
  total_watch_sec   numeric,
  skip_rate         numeric,
  profile_visits    integer,
  follows           integer,
  replies           integer,
  exits             integer,
  taps_forward      integer,
  taps_back         integer,
  swipes_forward    integer,
  clicks            integer,
  unavailable       text[] NOT NULL DEFAULT '{}',
  audience          jsonb,                -- демографія акаунта на момент знімка
  raw               jsonb,
  report_text       text,
  report_claimed_at timestamptz,          -- короткий lease: звіт шле лише один запуск
  report_sent_at    timestamptz,
  report_attempts   integer NOT NULL DEFAULT 0,
  report_error      text,
  UNIQUE (publication_id, stage, platform)
);

CREATE INDEX IF NOT EXISTS publication_metric_snapshots_baseline_idx
  ON public.publication_metric_snapshots (platform, format, stage, captured_at DESC) WHERE status = 'ok';
-- Один пост платформи має лише одну картку на етап.
CREATE UNIQUE INDEX IF NOT EXISTS publication_metric_snapshots_claimed_idx
  ON public.publication_metric_snapshots (platform, stage, external_id) WHERE status = 'ok';
CREATE INDEX IF NOT EXISTS publication_metric_snapshots_unsent_idx
  ON public.publication_metric_snapshots (captured_at) WHERE report_sent_at IS NULL;

-- Читає і пише лише service role (Edge-функція); клієнтам сайту доступу немає.
ALTER TABLE public.publication_metric_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.publication_metric_snapshots FROM anon, authenticated;

SELECT cron.schedule(
  'publication-report-10min',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/publication-report',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'x-hq-cron-secret', (select value from app_secrets where key = 'hq_cron_secret')),
       body := '{}'::jsonb,
       timeout_milliseconds := 145000) $$
);
