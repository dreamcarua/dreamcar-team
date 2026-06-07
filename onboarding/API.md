# DreamCar — Edge Functions API

Документація 28 Edge Functions. Base URL: `https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/`.

Headers convention:
- `Authorization: Bearer <anon_key>` — для функцій з `verify_jwt = true`
- `Authorization: Bearer <service_role_key>` — для bypass RLS (cron/internal)
- `x-hq-secret: <HQ_SECRET>` — для критичних internal endpoints
- `Content-Type: application/json`

---

## 1. Notifications & Messaging

### 1.1 `notify-tg` — Universal TG notifier

Universal endpoint що шле DM/group повідомлення про events у publications / retention / tasks.

**Auth:** `verify_jwt = true` (anon або authenticated).

**Input:**
```json
{
  "entity": "publication" | "retention" | "task",
  "id": "<uuid>",
  "event": "review_requested" | "approved" | "rejected" | "verified" | "assigned" | "due_soon" | "comment_added",
  "status": "approved",
  "old_status": "pending_review",
  "actor_id": "<uuid optional>",
  "extra": { "comment": "..." }
}
```

**Output:**
```json
{ "ok": true, "delivered": 3, "skipped": 0 }
```

**Invoked by:** DB triggers (publications/team_tasks/retention_messages on UPDATE), frontend after manual actions.

---

### 1.2 `tg-webhook` — TG Bot main handler

Точка входу для всіх взаємодій з `@dreamcar_team_bot`. Реєструється у Telegram через `setWebhook`.

**Auth:** `verify_jwt = false` (TG не передає JWT). Захист через `secret_token` header.

**Input:** Telegram Update object.

**Output:** `200 OK` (TG ігнорує body).

**Callbacks (callback_data prefixes):**
| Prefix | Призначення |
|---|---|
| `appr:<pub_id>` | Approve publication |
| `rmappr:<pub_id>` | Remove approval |
| `vrfy:<pub_id>` | Verify published |
| `task:<task_id>:<action>` | Tasks inline actions (done, snooze) |
| `taskprop:<scan_id>:<idx>` | Accept proposed task from daily scan |
| `qappr:<id>` | Quick approve retention |
| `attach:<id>` | Attachment preview |

**Commands:**
- `/start` — welcome + bind hint
- `/me` — мій профіль і статус привʼязки
- `/tasks` — мої Inbox/Doing
- `/listen_here` — whitelist цього чату (CEO/COO)
- `/help` — список команд

**Special handling:**
- Inline emoji `📌` у кінці повідомлення → trigger `tg-task-extract`
- @mention → resolve через `users.telegram_username`
- Voice → forward до `whisper-transcribe`

---

### 1.3 `cron-reminders` — T-10 / T+10 nags

Cron-job: щохвилини. Шле reminder approverам перед publish_at та якщо публікація прострочена.

**Auth:** internal (service_role from cron).

**Input:** Empty (cron-triggered).

**Output:**
```json
{ "checked": 24, "t_minus_10_sent": 2, "t_plus_10_sent": 1 }
```

---

## 2. Publications / SMM

### 2.1 `verify-publication` — IG → TG mirror via Make.com

Current verifier. Слухає webhook від Make.com який мірорить IG публікацію у TG channel, фіксує `verified_at`.

**Auth:** `x-hq-secret`.

**Input:**
```json
{ "publication_id": "<uuid>", "ig_post_id": "...", "tg_message_id": 123 }
```

---

### 2.2 `verify-publication-ig` — DEPRECATED

Стара версія через IG Graph API. Залишена для reference. Не використовується (IG API rate limits + breaking changes).

---

### 2.3 `publication-scheduler` — auto-status

Cron: щохвилини. Транзишн `approved + publish_at <= NOW()` → `scheduled` → `published`.

**Auth:** internal.

**Output:** `{ "transitioned": N }`

---

## 3. Retention

### 3.1 `retention-scheduler` — main sender

Cron: `*/5 * * * *`. Знаходить approved messages з `scheduled_at <= NOW()`, шле через відповідний канал.

**Auth:** internal.

**Input:** Empty.

**Output:**
```json
{ "found": 3, "sent": 2, "failed": 1, "skipped_email": 1 }
```

**Channel routing:**
| Channel | Handler |
|---|---|
| `tg` | `retention-broadcast-tg` |
| `push` | Web Push subscription send |
| `email` | SKIP — manual SendPulse Dashboard |
| `sms`, `viber`, `other` | NOOP (TODO) |

---

### 3.2 `retention-broadcast-tg` — TG channel send

**Auth:** internal.

**Input:**
```json
{
  "message_id": "<uuid>",
  "channel_id": "-1002496656144",
  "text": "...",
  "parse_mode": "HTML",
  "attachments": [...]
}
```

---

## 4. Tasks / AI

### 4.1 `tg-task-extract` — Claude Haiku task extraction

Triggered коли повідомлення у TG чаті закінчується на `📌`. Claude Haiku парсить контекст → пропонує задачу → DM-confirm assignee.

**Auth:** internal (called from `tg-webhook`).

**Input:**
```json
{
  "message": { "chat_id": -100..., "text": "...", "from": {...} },
  "context_messages": [...]
}
```

**Output:**
```json
{
  "is_task": true,
  "title": "...",
  "assignee_username": "@vadym",
  "due_at": "2026-06-08T18:00+02:00",
  "priority": "high"
}
```

Silent reaction `👀` коли Claude вирішив "не задача".

---

### 4.2 `tg-daily-task-scan` — Batch scan + proposal

Cron: `0 7 * * *` UTC (= 09:00 KY). Бере всі повідомлення з buffer за минулу добу, group by chat, batch LLM call (5 per batch). Шле proposals у reply у груповий чат — CEO/COO acceptує через inline buttons.

**Auth:** internal.

**Input:** Empty.

**Output:** `{ "scanned_messages": 124, "proposals_sent": 7 }`

---

### 4.3 `task-notification-enqueue` — DB trigger callback

Викликається DB-тригером після INSERT у `team_task_notifications`. Резолвить assignee/watchers → виклик `notify-tg`.

**Auth:** internal.

---

## 5. Tracker / Analytics

### 5.1 `track-checkout` — Anon upsell tracker

Anon endpoint для landing pages (iphone.dreamcar.ua). Збирає events для upsell A/B/C funnel.

**Auth:** `verify_jwt = false` (anon, public).

**Input:**
```json
{
  "session_id": "...",
  "variant": "A" | "B" | "C",
  "step": "view" | "click" | "start" | "success",
  "amount_uah": 4999,
  "utm": { "source": "...", "campaign": "..." }
}
```

**Output:** `{ "ok": true, "event_id": "<uuid>" }`

**Frontend helpers (tracker v2.2):**
- `dcSetVariant("A")` — встановити варіант ззовні
- `dcSetSessionId(id)` — merge з utm-tracker
- `dcSetUser(email_hash)` — звязати з identifier

---

### 5.2 `refresh-mv-upsell` — MV refresher

Cron: `*/10 * * * *`. `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_upsell_funnel`.

**Auth:** internal.

---

### 5.3 `dashboard-roi-recalc` — ROI per project agg

Hourly. Перерахунок ROI per project з `dashboard_deals` JOIN `dashboard_ads_data`.

**Auth:** internal.

---

## 6. Auth / SSO

### 6.1 `sso-bridge` — cross-app token relay

Передає `access_token` між HQ → Tasks → Dashboard. Cookie-based на `.dreamcar.ua` + URL fragment fallback.

**Auth:** `verify_jwt = true`.

**Input:** `{ "target": "tasks" | "dashboard" }`

**Output:**
```json
{ "redirect_url": "https://team.dreamcar.ua/tasks/#access_token=..." }
```

---

### 6.2 `tg-oauth-callback` — Telegram Login Widget

**Auth:** anon, hash перевіряється.

**Input:** Telegram OAuth params (auth_date, hash, id, first_name, photo_url).

**Output:** redirect на `/hq/` з access_token.

---

## 7. Integrations

### 7.1 `sendpulse-readonly-proxy` — SendPulse read-only

🔴 HARD RULE: НІЯКИХ POST/PUT/PATCH/DELETE. Тільки GET (address_books, contacts, campaigns stats).

**Auth:** `verify_jwt = true` (CEO/COO only via RLS check).

**Input:** `{ "endpoint": "/address_books", "params": {...} }`

**Output:** SendPulse response (passthrough).

---

### 7.2 `meta-ads-pull` — Manual FB Ads pull

Cron у `dreamcarua/dreamcar-dashboard` GH Action, але fn доступна для manual trigger.

**Auth:** `x-hq-secret`.

**Input:** `{ "ad_account_id": "act_...", "date_range": [...] }`

**Output:** insights array.

---

### 7.3 `whisper-transcribe` — Voice → text

**Auth:** internal (called from `tg-webhook` для voice notes).

**Input:** `{ "file_url": "https://api.telegram.org/file/..." }`

**Output:** `{ "text": "...", "duration_sec": 12 }`

---

## 8. Admin / Ops

### 8.1 `cleanup-soft-deleted` — Hard-delete after 30d

Cron: `0 3 * * *` (3 AM daily). Видаляє записи з `deleted_at < NOW() - INTERVAL '30 days'` у `publications`, `retention_messages`, `team_tasks`.

**Output:** `{ "publications": 5, "tasks": 12, "retention": 0 }`

---

### 8.2 `audit-log-append` — Audit log writer

Централізований endpoint для запису у `audit_log`.

**Auth:** `verify_jwt = true`.

**Input:**
```json
{
  "action": "publication.approve",
  "entity_type": "publication",
  "entity_id": "<uuid>",
  "metadata": {...}
}
```

---

### 8.3 `dispatch-workflow` — GH Actions trigger

Тригерить GH Actions workflows для довгих/heavy tasks (compress video, batch FB Ads pull).

**Auth:** internal.

**Input:**
```json
{ "repo": "dreamcarua/dreamcar-team", "workflow": "compress.yml", "inputs": {...} }
```

---

## 9. Internal utilities

### 9.1 `health` — Health check
GET → `{ "ok": true, "ts": "..." }`. Для uptime monitoring.

### 9.2 `me` / `whoami` — Current user
**Auth:** `verify_jwt = true`. Output: повний `users` row + role.

### 9.3 `user-search` — Autocomplete
Input: `{ "q": "вад" }`. Output: array of matching users (для @mention / assignee dropdown).

### 9.4 `bind-tg` / `unbind-tg` — Telegram linking
Bind: Input `{ "tg_id": 123, "verification_code": "..." }`.
Unbind: clear `telegram_id`/`telegram_username`.

### 9.5 `attach-upload` — File upload to R2
**Auth:** `verify_jwt = true`. Multipart form. Output: `{ "url": "https://r2.dreamcar.ua/..." }`.

---

## Invoking sources matrix

| Function | Cron | DB trigger | Frontend | TG webhook | GH Action |
|---|:---:|:---:|:---:|:---:|:---:|
| `notify-tg` | | ✅ | ✅ | | |
| `tg-webhook` | | | | ✅ | |
| `cron-reminders` | ✅ | | | | |
| `verify-publication` | | | | | ✅ (Make.com) |
| `publication-scheduler` | ✅ | | | | |
| `retention-scheduler` | ✅ | | | | |
| `tg-task-extract` | | | | ✅ | |
| `tg-daily-task-scan` | ✅ | | | | |
| `track-checkout` | | | ✅ (anon) | | |
| `refresh-mv-upsell` | ✅ | | | | |
| `dashboard-roi-recalc` | ✅ | | | | |
| `sso-bridge` | | | ✅ | | |
| `cleanup-soft-deleted` | ✅ | | | | |

---

## Deploy

```bash
cd dreamcarua/dreamcar-supabase
# edit functions/<name>/index.ts
git add functions/<name>
git commit -m "..."
git push origin main
# GH Action deploy-edge-fns.yml runs automatically
```

Або manual:
```bash
supabase functions deploy <fn-name> --project-ref wotghlaehnvxyeacznvv
```

Перевірка після deploy:
```bash
curl -X POST https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/health
# → {"ok":true,"ts":"2026-06-07T..."}
```

---

## Adding new edge function

1. `mkdir functions/<name> && touch functions/<name>/index.ts`
2. Boilerplate з `_shared/serve.ts` (CORS, auth, error handling)
3. Декларувати у `supabase/config.toml`: `[functions.<name>] verify_jwt = true/false`
4. Додати рядок у цей файл (API.md)
5. Якщо є cron — додати у [CRON_JOBS.md](CRON_JOBS.md)
6. Push → GH Action deploys
7. Smoke test → `curl` + check logs
