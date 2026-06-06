# Secrets & Credentials — DreamCar Production

> ⚠️ Цей файл — публічний у репо. Тут описано **що існує**, де і як rotate. **Самі значення** ніколи не комітити.

## Where secrets live

### Supabase Edge Functions secrets
Path: https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/settings/functions → Secrets

| Name | Purpose | Used by |
|---|---|---|
| `TG_BOT_TOKEN` | Telegram Bot API — `@dreamcar_team_bot` | tg-webhook, notify-tg, cron-reminders, retention-scheduler, tg-personal-digest, verify-publication-ig |
| `TG_WEBHOOK_SECRET` | Перевірка `X-Telegram-Bot-Api-Secret-Token` у webhook'у | tg-webhook |
| `HQ_WEBHOOK_SECRET` | Перевірка `x-hq-secret` header (cross-fn auth) | notify-tg, verify-publication-ig |
| `HQ_CRON_SECRET` | Перевірка `x-hq-cron-secret` header (cron→edge fn auth) | cron-reminders, daily-digest, daily-personal-digest, tg-personal-digest, verify-publication-ig |
| `DCSMM_GROUP_CHAT_ID` | TG group chat для notify fanout (default `-1003933841573`) | notify-tg, verify-publication-ig, retention-scheduler |
| `SUPABASE_URL` | Auto-injected | усі edge fns |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected — service_role JWT | усі edge fns |
| `ANTHROPIC_API_KEY` | Claude Haiku (Sonnet) для tg-task-extract / tg-daily-task-scan | tg-ai-router, tg-task-extract, tg-daily-task-scan |
| `OPENAI_API_KEY` | Whisper STT (voice messages → text) | tg-webhook (voice flow) |
| `META_PAGE_ID` | Facebook Page ID DreamCar.ua (1676843282640684) | webhook-dashboard-make-com (legacy) |
| `IG_BUSINESS_ACCOUNT_ID` | Instagram Business Account ID для @dreamcar.ua | (опційно — для majout верифікації; зараз НЕ використовується після переходу на manual confirmation) |
| `IG_PAGE_ACCESS_TOKEN` | System User token Volvo_Dashboard_API | (опційно — не використовується після переходу) |
| `SENDPULSE_ID`, `SENDPULSE_SECRET` | SendPulse REST API (READ-ONLY!) | sendpulse-books-list, webhook-dashboard-sendpulse |
| `R2_*` | Cloudflare R2 storage (відео креативів) | r2-sign-upload |

### GitHub Actions secrets
Per repo: Settings → Secrets and variables → Actions

| Repo | Secret | Purpose |
|---|---|---|
| dreamcar-team | `SUPABASE_ACCESS_TOKEN` | Deploy edge functions |
| dreamcar-team | `SUPABASE_PROJECT_ID` | wotghlaehnvxyeacznvv |
| dreamcar-team | `DREAMCAR_TG_BOT_TOKEN` | Cowork-tg-notify GH Action |
| dreamcar-dashboard | `FB_SYSTEM_USER_TOKEN` | FB Ads ETL (sync_fb_ads.py) |
| dreamcar-dashboard | `SUPABASE_SERVICE_ROLE_KEY` | ETL INSERT у dashboard_ads_data |

### Frontend (anon — safe to commit)
- `SUPABASE_ANON_KEY` у `*/config.js` — OK комітити (anon JWT, RLS-protected)

## Rotation policy

| Secret | Frequency | Trigger |
|---|---|---|
| `TG_BOT_TOKEN` | Never (BotFather) | Тільки якщо leak |
| `HQ_WEBHOOK_SECRET` | Кожні 6 місяців | Якщо у БД cron.job хтось зчитав |
| `HQ_CRON_SECRET` | Кожні 6 місяців | Те ж саме |
| `SUPABASE_SERVICE_ROLE_KEY` | Кожні 12 місяців | Якщо leak detected |
| `ANTHROPIC_API_KEY` | По потребі | Якщо API costs spike |
| `FB_SYSTEM_USER_TOKEN` | Never (System User) | Якщо leak — revoke + regenerate |
| `SENDPULSE_*` | Кожні 12 місяців | Якщо leak |

## Rotation procedure

### TG_BOT_TOKEN
1. Telegram: `@BotFather` → `/revoke` → `@dreamcar_team_bot`
2. Отримай новий token
3. Supabase Dashboard → Edge Functions → Secrets → оновити `TG_BOT_TOKEN`
4. GitHub Actions → `dreamcar-team` → оновити `DREAMCAR_TG_BOT_TOKEN`
5. Перевірити: написати `/start` боту → має відповісти

### HQ_WEBHOOK_SECRET / HQ_CRON_SECRET
1. Згенерувати новий: `openssl rand -hex 32`
2. Supabase Dashboard → Edge Functions → Secrets → оновити
3. Оновити у БД cron.job через SQL:
   ```sql
   UPDATE cron.job SET command = REPLACE(command, '<OLD>', '<NEW>') 
   WHERE command LIKE '%<OLD>%';
   ```
4. Перевірити: `curl` до edge fn з новим secret → 200, без → 401

### SUPABASE_SERVICE_ROLE_KEY
1. Supabase Dashboard → Settings → API → Generate new
2. Оновити в Edge Functions Secrets
3. Оновити в GitHub Actions secrets
4. Старий ключ revoke після 24h grace period

## Incident response — secret leak

1. **Знайди джерело leak'у** — який secret, де leaked (commit / log / DM)
2. **Revoke** старий secret через відповідну UI
3. **Generate** новий і застосуй у всіх місцях (див. rotation procedure)
4. **Audit** активність — `net._http_response` логи, `cron.job_run_details`, edge fn logs
5. **Notify** Vadym + Phillip (співзасновник) у TG → `@dreamcar_vg`
6. **Документ** інцидент у `INCIDENTS.md` (створити якщо нема)

## Access control

| Role | Has access to | How |
|---|---|---|
| CEO (Vadym) | Все | Supabase Dashboard owner |
| Phillip | Все | Supabase Dashboard admin |
| Артем (співзасновник) | Edge fns, GitHub repos | Member access |
| Інші | Тільки frontend (anon key) | None |

## See also

- `CRON_JOBS.md` — список cron jobs (TODO)
- `GDPR_PRIVACY.md` — обробка персональних даних
- `INCIDENTS.md` — журнал інцидентів (TODO)
