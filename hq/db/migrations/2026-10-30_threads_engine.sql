-- Threads engine (applied 30.10.2026 via Supabase MCP): tables threads_queue, threads_targets,
-- threads_config, threads_account_daily (RLS on, anon/authenticated revoked) and pg_cron jobs
-- threads-plan, threads-publish, threads-engage, threads-trends, threads-trend-post-1/2,
-- threads-metrics, threads-report, threads-token-refresh, threads-purge-30d.
-- Purge promised by team.dreamcar.ua/legal/threads.html: third-party public posts kept <= 30 days.
select cron.schedule('threads-purge-30d','11 2 * * *', $c$delete from public.threads_targets where found_at < now() - interval '30 days'; update public.threads_queue set source = source - 'their_text' - 'permalink' where kind in ('reply_external','reply_own','reply_mention') and created_at < now() - interval '30 days' and source ? 'their_text';$c$);
