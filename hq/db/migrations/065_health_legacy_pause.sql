-- 065: застосовано в прод 10.10.2026 через Supabase MCP (запис для історії).
-- Рішення Вадима 10.10.2026: усе health, що побудовано не на додатку (DayWeft), вимкнути й поставити на паузу.
-- Дані в схемі health не видаляються.
create table if not exists public.ops_paused_jobs (
  jobid bigint primary key, jobname text, paused_at timestamptz default now(), reason text);
alter table public.ops_paused_jobs enable row level security;
revoke all on public.ops_paused_jobs from public, anon, authenticated;

insert into public.ops_paused_jobs(jobid, jobname, reason)
select jobid, jobname, 'health-legacy-pause-2026-10-10' from cron.job
 where active and jobname like 'health-%' and jobname <> 'health-retire-old-ingest-token'
on conflict (jobid) do nothing;   -- 24 jobs

select cron.alter_job(jobid, active := false) from public.ops_paused_jobs where reason='health-legacy-pause-2026-10-10';
select cron.alter_job((select jobid from cron.job where jobname='health-retire-old-ingest-token'), active := false);

update health.ingest_tokens set active = false where active;   -- 9d8f, 4fb1 (dashboard-view), 855d, 48ea
update public.app_secrets set value = 'paused-2026-10-10' where key = 'health_bot_ing_token';

-- Поза SQL: Telegram deleteWebhook для health-бота (раніше url = /functions/v1/health-tg-webhook,
-- allowed_updates [message, callback_query], без secret_token).

-- Відновлення (лише за рішенням Вадима):
--   select cron.alter_job(jobid, active := true) from public.ops_paused_jobs where reason='health-legacy-pause-2026-10-10';
--   новий токен у health.ingest_tokens + app_secrets.health_bot_ing_token; setWebhook бота назад.
