# Cron Jobs Registry — DreamCar Production

> Останнє оновлення: 07.06.2026 (audit iter 2 — schedule offsets applied)

## Active cron jobs (Supabase `cron.job`)

### Daily maintenance
| Time (UTC) | Time (Kyiv) | Job | Purpose |
|---|---|---|---|
| 03:00 | 06:00 | `hq-cleanup-trashed-publications` | Hard-delete soft-deleted pubs older than 30 days |
| 03:00 | 06:00 | `webhooks_auto_cleanup_cron` | Delete dashboard_webhooks older than 14 days |
| 03:00 | 06:00 | `tg-processed-updates-cleanup` | Cleanup tg_processed_updates idempotency table (>24h) |
| 04:00 | 07:00 | `mv-cohort-retention-refresh` | Daily refresh cohort retention MV |
| 04:30 | 07:30 | `team-tasks-trash-purge` | Hard-delete soft-deleted tasks >30 days |
| 04:35 | 07:35 | `publications-trash-purge` | Hard-delete soft-deleted pubs >30 days (duplicate of above) |
| 04:45 | 07:45 | `tg-chat-buffer-cleanup-daily` | Delete tg_chat_buffer entries >7 days |
| 05:00 | 08:00 | `daily-health-audit` | Daily edge fn health check |
| 06:00 | 09:00 | `hq-daily-personal-digest` | Morning DM digest to each team member |
| 06:00 | 09:00 | `tg-personal-digest` | Telegram personal digest |
| 06:00 | 09:00 | `tg-daily-task-scan-0900kyiv` | Scan tg_chat_buffer with Claude → propose tasks |
| 07:00 | 10:00 | `hq-daily-digest` | Daily team-wide digest |
| 09:00 | 12:00 | `detect-stuck-tasks` | Mark stuck tasks (no activity >X days) |

### High frequency (real-time)
| Schedule | Job | Purpose |
|---|---|---|
| `*/15 * * * *` | `hq-cron-reminders` | T-10, T+10 reminders (review nag, missed pub) |
| `*/30 * * * *` | `team-tasks-cron-30min` | Team tasks reminders (deadlines, overdue) |
| `*/10 * * * *` | `team-tasks-notify-worker-10min` | Process pending team_task_notifications queue |
| `7 * * * *` | `webhook-health-alert` | Alert if SendPulse webhook hasn't received in 30+ min |
| `15 * * * *` | `tg-proposed-tasks-expire-hourly` | Auto-dismiss old TG-proposed tasks |
| `12 * * * *` | `mv-globals-hourly` | Refresh mv_dashboard_globals (CONCURRENTLY) |

### High frequency (5-min cycle, OFFSET to avoid collisions — audit iter 2)
| Minute | Job | Purpose |
|---|---|---|
| `1-56/5` | `autopost-tg-enqueue-cron` | Process publication autopost queue → TG |
| `2-57/5` | `retention-scheduler-5min` | Check approved/scheduled retention messages |
| `*/5` | `compress-safety-net-5min` | GH Actions dispatch для compress pending creatives |
| `*/5` | `mv-upsell-funnel-refresh` | Refresh upsell funnel MVs |

### 15-min cycle (OFFSET)
| Minute | Job | Purpose |
|---|---|---|
| `2,17,32,47` | `mv-utm-agg-refresh-15min` | Refresh mv_dashboard_utm_agg |
| `5,20,35,50` | `mv-paid-signatures-refresh-15min` | Refresh mv_paid_signatures (CONCURRENTLY) |
| `8,23,38,53` | `mv-projects-stats-refresh-15min` | Refresh mv_dashboard_projects_stats (CONCURRENTLY) |

### Event-driven one-shot
| Pattern | Job | Purpose |
|---|---|---|
| `MI HH DD MM *` | `verify_pub_<uuid>` | Per-publication T+3min verify (auto-cleanup після виконання) |

## Cron job naming conventions

- **`hq-*`** — legacy HQ-system jobs
- **`team-tasks-*`** — Tasks subsystem
- **`mv-*`** — Materialized view refreshes
- **`tg-*`** — Telegram bot jobs
- **`retention-*`** — Retention subsystem
- **`*-cleanup-*`** — Hard-delete old data
- **`*-refresh-*`** — MV refresh
- **`verify_pub_<uuid>`** — One-shot publication verification

## Common operations

### List active jobs
```sql
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
```

### Check failures over last 7 days
```sql
SELECT j.jobname, d.status, COUNT(*) 
FROM cron.job_run_details d JOIN cron.job j USING (jobid)
WHERE d.status != 'succeeded' AND d.start_time > NOW() - INTERVAL '7 days'
GROUP BY j.jobname, d.status ORDER BY COUNT(*) DESC;
```

### Pause job temporarily
```sql
UPDATE cron.job SET active = false WHERE jobname = '<JOBNAME>';
```

### Unschedule completely
```sql
SELECT cron.unschedule('<JOBNAME>');
```

## Monitoring

- **net._http_response** — для HTTP-based cron jobs (статуси, latency)
- **cron.job_run_details** — для всіх cron jobs (status, time, output)
- **Supabase Dashboard → Database → Logs → pg_cron** — додатково

## Anti-patterns to avoid

- ❌ **Cron щохвилини** для polling даних — використати event-driven (тригер створює one-shot job)
- ❌ **Кілька cron jobs на одну хвилину** — створює DB load spike (зараз offset застосовано)
- ❌ **Cron без timeout** — застрягає на TG/external API
- ❌ **Hardcoded secrets у `cron.job.command`** — використовуй `current_setting('app.settings.*')` (TODO migrate)

## See also

- `SECRETS.md` — токени які використовуються у cron jobs
- `TROUBLESHOOTING.md` — як debug провалів (TODO)
