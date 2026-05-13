# Deploy Checklist — Supabase

Чек-лист дій у Supabase Dashboard для повноцінного запуску HQ. Йди зверху вниз — крок за кроком.

---

## 1. SQL міграції (по черзі в SQL Editor)

- [x] `hq/db/schema.sql` — таблиці
- [x] `hq/db/rls.sql` — Row-Level Security
- [x] `hq/db/seed.sql` — демо-дані
- [x] `hq/db/triggers.sql` — `handle_new_user` (critical)
- [x] `hq/db/migrations/002_tg_notifications.sql` — `tg_chat_id`, `tg_username`
- [x] `hq/db/migrations/003_storage_policies.sql` — Storage RLS + `platform_schedule` + `deleted_at`
- [x] `hq/db/migrations/004_cron_daily_digest.sql` — щоденний digest о 09:00 Kyiv (07:00 UTC, jobname `hq-daily-digest`)
- [x] `hq/db/migrations/005_cleanup_cron.sql` — cleanup expired editing_sessions + старі trashed pubs
- [x] `hq/db/migrations/006_last_action_via.sql` — anti-duplicate push маркер
- [x] `hq/db/migrations/007_cron_personal_digest.sql` — daily-personal-digest cron 06:00 UTC (jobname `hq-daily-personal-digest`)

**Перед 004/005/007 переконайся, що pg_cron увімкнено:**
Dashboard → Database → Extensions → знайди `pg_cron` → Enable.

**Важливо:** secret для cron-задач (`HQ_CRON_SECRET`) **зашитий прямо у migration 004/007** — `alter database postgres set` Supabase блокує. Заміни placeholder на справжнє значення з Edge Functions secrets перед запуском міграцій.

---

## 2. Storage bucket `creatives`

- [x] Dashboard → Storage → New bucket
- [x] Name: `creatives` · Public: ✓ · File size limit: 50 MB

---

## 3. Authentication URL Configuration

- [x] Dashboard → Authentication → URL Configuration
- [x] Site URL: `https://dreamcarua.github.io/dreamcar-team/hq/`
- [x] Redirect URLs: `https://dreamcarua.github.io/**`

---

## 4. Edge Functions deploy

```bash
npm install -g supabase
cd dreamcar-team
supabase login
supabase link --project-ref wotghlaehnvxyeacznvv

# notify-tg (webhook — реагує на зміни статусу, нові коментарі, anti-dup)
supabase functions deploy notify-tg --no-verify-jwt --project-ref wotghlaehnvxyeacznvv

# tg-webhook (inbound bot — /start, /today, /queue, /late, /my, /approve, file upload)
supabase functions deploy tg-webhook --no-verify-jwt --project-ref wotghlaehnvxyeacznvv

# daily-digest (cron — щоденне зведення у group chat, 07:00 UTC)
supabase functions deploy daily-digest --no-verify-jwt --project-ref wotghlaehnvxyeacznvv

# daily-personal-digest (cron — персональний DM кожному, 06:00 UTC)
supabase functions deploy daily-personal-digest --no-verify-jwt --project-ref wotghlaehnvxyeacznvv

# tg-login-verify (#27 — TG Login Widget hash verifier + auth.user create)
supabase functions deploy tg-login-verify --no-verify-jwt --project-ref wotghlaehnvxyeacznvv

# drive-init-upload + drive-finalize-upload (для файлів >50 MB; див. DRIVE_SETUP.md)
supabase functions deploy drive-init-upload --no-verify-jwt --project-ref wotghlaehnvxyeacznvv
supabase functions deploy drive-finalize-upload --no-verify-jwt --project-ref wotghlaehnvxyeacznvv
```

Альтернативно — через Dashboard: Functions → Deploy a new function → Via Editor → paste з GitHub raw.

---

## 5. Secrets для Edge Functions

Dashboard → Project Settings → Edge Functions → Manage secrets:

| Secret | Значення |
|---|---|
| `TG_BOT_TOKEN` | токен від `@BotFather` |
| `TG_GROUP_CHAT_ID` | `-5205303628` |
| `HQ_WEBHOOK_SECRET` | згенерувати: `openssl rand -hex 32` |
| `HQ_CRON_SECRET` | окремий: `openssl rand -hex 32` |
| `TG_WEBHOOK_SECRET` | для tg-webhook (Telegram secret_token) |
| `TG_LOGIN_SALT` | для tg-login-verify: `openssl rand -hex 32` |
| `HQ_DB_URL` | fallback до `SUPABASE_URL` (Supabase блокує custom secrets з `SUPABASE_*` префіксом) |
| `HQ_DB_SERVICE_KEY` | fallback до service_role JWT |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` та `SUPABASE_SERVICE_ROLE_KEY` — Supabase встановить автоматично.

---

## 6. Database Webhooks (для notify-tg)

Dashboard → Database → Webhooks → Create:

**Webhook #1: `publication-status-changed`**
- Table: `publications`
- Events: ✓ INSERT, ✓ UPDATE
- Type: Supabase Edge Functions → `notify-tg`
- Headers: `x-hq-secret: <HQ_WEBHOOK_SECRET>`

**Webhook #2: `comment-added`**
- Table: `comments`
- Events: ✓ INSERT
- Type: Supabase Edge Functions → `notify-tg`
- Headers: `x-hq-secret: <HQ_WEBHOOK_SECRET>`

---

## 7. Telegram bot setup

### 7.1. Webhook для tg-webhook (inbound bot)

```bash
curl "https://api.telegram.org/bot<TG_BOT_TOKEN>/setWebhook?url=https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-webhook&secret_token=<TG_WEBHOOK_SECRET>"
```

### 7.2. (Опційно) Login Widget (#27)

Тільки якщо хочеш дозволити вхід через Telegram (поряд з Google OAuth):

1. У `@BotFather` → `/setdomain` → `@dreamcar_team_bot` → `dreamcarua.github.io`
2. Після цього онови `hq/config.js`:
   ```js
   TG_LOGIN_BOT: 'dreamcar_team_bot',
   ```
3. Перевір що `tg-login-verify` функція задеплоєна і `TG_LOGIN_SALT` secret є.

---

## 8. Smoke test

1. Відкрий https://dreamcarua.github.io/dreamcar-team/hq/
2. Залогінься через Google (`dreamcarua@gmail.com` — CEO)
3. Створи нову публікацію → заповни → «На погодження»
4. В TG-групі прилетить «📝 На погодження…» з inline-кнопками ✓ / ↩ / 🔗
5. Натисни ✓ → статус → approved, кнопки зникнуть (anti-dup завдяки `last_action_via`)
6. Перевір **Налаштування** → прив'язка `tg_chat_id` через бот (deep-link «🔗 Прив'язати»)
7. Натисни `?` — оверлей гарячих клавіш
8. Натисни `C` — створити публікацію
9. **Правий клік на дні в календарі** → контекстне меню з пресетами часу (#40)
10. Видали тестову → 7 сек «↶ Повернути» → відновити

---

## 9. Ручний тест Edge Functions

### daily-digest
```sql
select net.http_post(
  url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-digest',
  headers := jsonb_build_object('x-hq-cron-secret', '<HQ_CRON_SECRET>'),
  body := '{}'::jsonb
) as request_id;
-- Через 2 сек:
select status_code, content from net._http_response order by id desc limit 1;
```

### daily-personal-digest
```sql
select net.http_post(
  url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-personal-digest',
  headers := jsonb_build_object('x-hq-cron-secret', '<HQ_CRON_SECRET>'),
  body := '{}'::jsonb
);
```

Має повернути `{"ok":true,"sent":N,"skipped":M}`.

---

## Все що live зараз

### ✅ Виконано (13.05.2026)

- Календар (Місяць/Тиждень/День/Список) з drag-drop
- **Контекстне меню (правий клік)** з пресетами часу (#40)
- Дошка погоджень
- Бібліотека креативів з реальними thumbnails (фото/відео)
- Картка публікації: всі поля, workflow, auto-save, прев'ю всіх 6 платформ
- **Per-platform date/time** — окремий час для IG, TG, TT, YT, FB, Threads
- Drag-drop креативів + Supabase Storage
- Гібридний Store: Supabase + localStorage fallback
- Realtime sync через Supabase channels
- Google OAuth + Auth gate
- handle_new_user trigger (auto-create users, CEO для dreamcarua)
- Real bell counter (queue + urgent + missed)
- **Settings page** (`#settings`) з прив'язкою `tg_chat_id`
- **TG-нотифікації** (webhook → Edge Function → bot, anti-dup)
- **Inbound TG bot** (`/today`, `/queue`, `/late`, `/my`, `/approve`, file upload, `/start hq_<id>`)
- **TG inline buttons** (approve/reject прямо у груповому чаті)
- **Daily digest** (cron → ранкове зведення у групу, 07:00 UTC)
- **Daily personal digest** (cron → персональний DM, 06:00 UTC)
- **Soft-delete з Undo** (7 сек, повне видалення через 30 днів)
- **Soft-lock** через editing_sessions (банер «X редагує»)
- **Дублювання публікації** (📋 у footer картки)
- **ICS експорт** (`window.exportIcs()` у консолі)
- **Keyboard help** (`?` — оверлей)
- Sidebar filter: ✓ + яскравіший active
- Filter click guard (не відкриває знову картку)
- Autosave flush at Modal.close
- **Drive resumable upload >50MB** (код готовий, чекає Service Account)

### 🟡 Code-ready, чекає твоєї дії

- **#27 TG Login Widget** — деплой `tg-login-verify` функції + `/setdomain` у BotFather + `TG_LOGIN_SALT` secret + оновлення `config.js`
- **#62/#30 Google Drive** — Service Account у Google Cloud Console + папка у Drive + secrets `GDRIVE_SA_JSON` + `GDRIVE_FOLDER_ID`

### 🟢 Опційно/майбутнє

- Vacation mode (`user_vacations` поле)
- CSV експорт пайплайну
- Темна/світла тема toggle
- Аналітика — KPI + графіки публікацій по місяцях

---

## Якщо щось не працює

1. **Upload падає** → перевір що міграція 003 виконана; bucket Public; ти залогінений як authenticated.
2. **TG-повідомлення не приходять** → перевір секрети, webhook headers, чи бот доданий у групу.
3. **Daily digest мовчить** → `select * from cron.job_run_details order by start_time desc limit 5;` — глянь на errors.
4. **Login → localhost** → перевір Site URL у Authentication → URL Configuration.
5. **«new row violates RLS»** при upload → міграція 003 не виконана.
6. **Cron не запускається** → перевір що `app.daily_digest_url` НЕ використовується (Supabase блокує); URL зашитий безпосередньо у `cron.schedule`.
7. **TG-кнопки дублюються** → перевір що `last_action_via` колонка створена (міграція 006) і функція notify-tg v4+ задеплоєна.

---

## Корисні консольні команди (DevTools)

```js
HQ.reset()              // скинути demo дані (тільки в demo-режимі)
HQ.signOut()            // вийти з акаунту
HQ.store                // інспектор store
HQ_LOCKS.current()      // які публікації під soft-lock
updateBellBadge()       // оновити лічильник дзвоника
exportIcs()             // експорт календаря у .ics
showKbdHelp()           // оверлей гарячих клавіш
duplicatePub('<id>')    // дублювати публікацію
```
