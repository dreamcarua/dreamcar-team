# DreamCar — Troubleshooting

Реєстр типових incidents. Кожна ситуація: симптоми → діагностика → виправлення → post-check.

> 🔴 Перед будь-яким destructive fix у проді — повідомити Вадима у TG (`cowork-notify/`).

---

## 1. Cron job не виконався

**Симптоми:**
- Очікувана подія (retention message sent, reminder DM) не відбулася
- У `pg_cron.job_run_details` запис `failed` або відсутній

**Діагностика:**
```sql
SELECT jobid, jobname, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobname = 'retention-scheduler'
ORDER BY start_time DESC LIMIT 20;
```

Перевірити чи job активний:
```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname ILIKE '%retention%';
```

Edge fn logs:
```bash
mcp__supabase__get_logs(service="edge-function", project_id="wotghlaehnvxyeacznvv")
```

**Виправлення:**
- Job неактивний → `SELECT cron.alter_job(jobid, active := true);`
- Edge fn падає → дивитись stack trace у logs, fix → redeploy
- Network timeout → збільшити `statement_timeout` у job command

**Post-check:** дочекатися наступного run, переконатися що `status=succeeded`.

---

## 2. Edge fn повертає 401

**Симптоми:** клієнт отримує `{"code":401, "message":"Invalid JWT"}` або `Missing authorization header`.

**Діагностика:**
- Перевірити чи fn задеплоєна з `--no-verify-jwt` (для anon endpoints типу `track-checkout`)
- Перевірити `Authorization: Bearer <anon_key>` у запиті
- Якщо викликає cron → переконатися що `SUPABASE_SERVICE_ROLE_KEY` env присутній

**Виправлення:**
- Anon endpoint → у `supabase/config.toml` додати `verify_jwt = false` → redeploy
- Client-side → переконатися що `supabase.auth.getSession()` повертає валідний токен (не expired)
- Cron-invoked → у edge fn перевірити `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` — якщо `undefined`, додати у GH Secrets

**Post-check:** `curl -X POST https://.../functions/v1/<fn>` повертає 200.

---

## 3. Edge fn повертає 500

**Симптоми:** `{"code":500,"message":"Internal server error"}`.

**Діагностика:**
```bash
mcp__supabase__get_logs(service="edge-function")
```
Шукати `ERROR` line з timestamp близько до incident.

Часті причини:
- `undefined_column` у SQL → grep migrations на ім'я колонки
- TG API rate limit (429 від api.telegram.org)
- Anthropic API key rotated/expired
- JSON parse error на webhook body

**Виправлення:**
- Schema mismatch → додати колонку через migration або змінити SQL
- Rate limit → exponential backoff у fn (1s, 2s, 4s)
- Key expired → ротувати у Supabase env vars + GH Secrets
- Bad JSON → wrap `JSON.parse` у try/catch + return 400 замість 500

**Post-check:** retry виклику, перевірити logs на відсутність ERROR.

---

## 4. TG bot не реагує на команди

**Симптоми:** `/start`, `/tasks`, `/listen_here` — мовчання.

**Діагностика:**
1. Перевірити webhook URL:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```
Має повернути `"url":"https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-webhook"` + `"pending_update_count":0`.

2. Якщо `last_error_message` не пустий — fn падає на webhook payload.

3. Edge fn logs `tg-webhook` — шукати last invocation timestamp.

**Виправлення:**
- Webhook збитий → reset:
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-webhook&secret_token=<SECRET>"
```
- pending_update_count > 100 → drop queue: `?drop_pending_updates=true`
- fn падає → дивись п.3 (Edge fn 500)

**Post-check:** написати боту `/start` у DM → отримати welcome message.

---

## 5. SMM "Завантаження..." висне на старті

**Симптоми:** `team.dreamcar.ua/hq/` показує спінер 5+ сек, потім нічого.

**Діагностика:**
- Console у DevTools → шукати `SyntaxError` (типово апостроф / merge marker у js)
- Network tab → чи `app.js` повертається 200
- `global-header.js` 404 → CORS проблема з brand.dreamcar.ua
- `supabase.auth.getSession()` зависає → провайдер недоступний

**Виправлення:**
- `grep '^<<<<<<<\|^=======$\|^>>>>>>>' hq/` — merge markers після stash pop
- Якщо global-header 404 → перевірити `dreamcarua/brand-book` deploy
- Login session corrupt → `localStorage.clear()` + reload

**Post-check:** HQ показує таблицю публікацій, jersey у консолі без errors.

---

## 6. Tasks: задача не зберігається

**Симптоми:** click "Зберегти" → modal не закривається або повідомлення "Помилка".

**Діагностика:**
- Console: `permission denied for function enqueue_team_task_notification` → RLS на trigger
- `duplicate key value violates unique constraint` → double-click (race)
- `null value in column "creator_id"` → `current_user_id()` повертає null

**Виправлення:**
- RLS на enqueue → `GRANT EXECUTE ON FUNCTION enqueue_team_task_notification TO authenticated;` через migration
- Double-save → disable submit button одразу після click + idempotency key
- creator_id null → перевірити що `users.auth_id = auth.uid()` записано (Manual bind через CEO)

**Post-check:** створити задачу, перевірити що зявилася у Inbox.

---

## 7. Retention: розсилка не пішла

**Симптоми:** message has `status=approved`, `scheduled_at` пройшов 5+ хв тому, але `status` не змінився на `sending/sent`.

**Діагностика:**
```sql
SELECT id, title, channel, status, scheduled_at, NOW() - scheduled_at AS overdue
FROM retention_messages
WHERE status = 'approved' AND scheduled_at < NOW()
ORDER BY scheduled_at;
```

Перевірити cron run:
```sql
SELECT * FROM cron.job_run_details
WHERE jobname = 'retention-scheduler'
ORDER BY start_time DESC LIMIT 5;
```

**Виправлення:**
- Cron disabled → `cron.alter_job(..., active := true)`
- Edge fn падає на TG broadcast → перевірити `TG_BOT_TOKEN`, права бота у каналі
- Email канал → нагадати: email через SendPulse Dashboard MANUALLY (read-only API rule)
- Stuck `status=sending` >5min → force reset:
```sql
UPDATE retention_messages SET status='approved' WHERE status='sending' AND updated_at < NOW() - INTERVAL '5 min';
```

**Post-check:** cron run → `succeeded`, message `status=sent`.

---

## 8. Dashboard: дані не відображаються

**Симптоми:** dashboard.dreamcar.ua показує пусті cards / "0 продажів сьогодні" коли мали бути.

**Діагностика:**
- SSO bridge — чи передається `access_token` через URL fragment з `/hq/`?
- Browser console → 401 / 403 на запитах до `dashboard_deals`
- Materialized view stale: `SELECT MAX(refreshed_at) FROM mv_upsell_funnel;`
- FB Ads ETL — чи був успішний run (GH Actions у `dreamcarua/dreamcar-dashboard`)

**Виправлення:**
- SSO зламаний → перевірити Cookie `sb-access-token` на `.dreamcar.ua` domain
- Stale MV → `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_upsell_funnel;`
- FB ETL fail → run workflow manually + check System User Volvo_Dashboard_API token

**Post-check:** дані сьогоднішнього дня видимі, MV refresh < 15 хв тому.

---

## 9. Pub status НЕ переходить у approved після approve

**Симптоми:** approver натиснув 📌 у TG, але `publication.status` ще `pending_review`.

**Діагностика:**
- TG webhook logs → чи отримали callback?
- `callback_data` format → має бути `appr:<pub_id>` (без variation selector U+FE0F)
- Перевірити RLS: чи може service-role оновити `publications.status`

**Виправлення:**
- Emoji U+FE0F у callback_data → strip перед comparison у `tg-webhook`
- RLS блокує — додати policy для `service_role` bypass
- Manually fix: `UPDATE publications SET status='approved' WHERE id='<id>';` + log incident

**Post-check:** новий test approve → status flips одразу.

---

## 10. notify-tg DM не приходить stakeholders

**Симптоми:** publication у review, але approvers нічого не отримали.

**Діагностика:**
- `users.telegram_id` NULL для approver → /me у боті → bind
- Edge fn `notify-tg` logs → дивитись HTTP response від `api.telegram.org/bot<TOKEN>/sendMessage`
- 403 "bot was blocked by the user" → юзер заблокував бота
- 400 "chat not found" → telegram_id неправильний

**Виправлення:**
- Manual bind: `UPDATE users SET telegram_id=<id> WHERE id='<uuid>';`
- Юзер заблокував → попросити написати /start боту знову
- Test DM: edge fn `notify-tg` invoke з payload `{entity:'test', id:'x', event:'ping'}`

**Post-check:** /me → бот показує "✅ привʼязаний як CEO".

---

## 11. Mobile UI зламана

**Симптоми:** на iPhone/Android sidebar перекриває контент, кнопки overflow, форми не помістити.

**Діагностика:**
- DevTools → Device toolbar → iPhone 12 (390×844)
- Шукати `position: fixed` без responsive override
- `viewport` meta tag присутній?
- Global header overlap (top: 0 без padding-top на main)

**Виправлення:**
- Додати breakpoints `@media (max-width: 768px)` + `(max-width: 480px)`
- `main { padding-top: var(--dc-header-h, 56px); }`
- Sidebar `transform: translateX(-100%)` на mobile + burger toggle

**Post-check:** Chrome MCP smoke test на 380px viewport.

---

## 12. Branch protection блокує push

**Симптоми:** `git push origin main` → `protected branch hook declined`.

**Діагностика:** GH repo settings → Branches → main protected: requires PR / status check.

**Виправлення:**
- Створити PR: `gh pr create --title "..." --body "..."` → merge
- Для emergency hot-fix → temporarily disable protection (CEO/admin only)
- Якщо CI fail → fix локально, push знову

**Post-check:** merge у main → GH Action deploy → live.

---

## 13. Materialized view не refresh'ується

**Симптоми:** дані у Dashboard відстають від production CRM.

**Діагностика:**
```sql
SELECT schemaname, matviewname,
       (SELECT MAX(refreshed_at) FROM mv_meta WHERE name=matviewname) AS last_refresh
FROM pg_matviews WHERE schemaname='public';
```

Edge fn `refresh-mv-upsell` logs.

**Виправлення:**
- Manual: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_upsell_funnel;`
- Якщо CONCURRENTLY fails → MV не має UNIQUE index → додати
- Cron disabled → reactivate

**Post-check:** `last_refresh` < 15 хв тому.

---

## 14. GH Action deploy провалився

**Симптоми:** червоний хрестик на commit, `deploy-edge-fns` workflow failed.

**Діагностика:**
- `gh run view <run-id> --log-failed`
- Часті причини: `SUPABASE_ACCESS_TOKEN` expired, fn name typo, syntax error у TS

**Виправлення:**
- Token expired → rotate у `dreamcarua/dreamcar-supabase` secrets
- Fix code → push fix → нова GH run
- Якщо потрібен rollback → `git revert` (див. ROLLBACK.md)

**Post-check:** наступний run зелений, fn live.

---

## 15. RLS блокує SELECT / INSERT / UPDATE

**Симптоми:** клієнт отримує empty result або `42501: new row violates row-level security policy`.

**Діагностика:**
```sql
SELECT * FROM pg_policies WHERE tablename = 'team_tasks';
```

Перевірити що `auth.uid()` повертає правильне (logged in?):
```sql
SELECT auth.uid(), current_user_id();
```

**Виправлення:**
- Policy відсутня для INSERT → додати `CREATE POLICY ins ON tbl FOR INSERT WITH CHECK (creator_id = current_user_id())`
- `users.auth_id` не записаний → fix:
```sql
UPDATE users SET auth_id = (SELECT id FROM auth.users WHERE email = users.email)
WHERE auth_id IS NULL;
```
- Для cron / edge fn → використовувати `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS)

**Post-check:** клієнт під цим юзером може SELECT/INSERT свої записи.

---

## Загальні діагностичні команди

```bash
# Edge fn logs
mcp__supabase__get_logs(service="edge-function")

# DB query
mcp__supabase__execute_sql(query="SELECT ...")

# TG bot webhook
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo

# Cron status
SELECT * FROM cron.job WHERE active = true;
```

При повторному incident — додати рядок у CHANGELOG.md + onboarding/CHANGELOG.md (HARD RULE).
