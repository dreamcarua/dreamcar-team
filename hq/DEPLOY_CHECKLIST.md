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
- [ ] `hq/db/migrations/004_cron_daily_digest.sql` — щоденний digest о 09:00 Kyiv
- [ ] `hq/db/migrations/005_cleanup_cron.sql` — cleanup expired editing_sessions + старі trashed pubs

**Перед 004/005 переконайся, що pg_cron увімкнено:**
Dashboard → Database → Extensions → знайди `pg_cron` → Enable.

**Перед 004 додай налаштування для cron:**
```sql
alter database postgres set app.daily_digest_url =
  'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-digest';
alter database postgres set app.hq_cron_secret = '<значення_HQ_CRON_SECRET>';
```

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

# notify-tg (webhook — реагує на зміни статусу, нові коментарі)
supabase functions deploy notify-tg --no-verify-jwt --project-ref wotghlaehnvxyeacznvv

# daily-digest (cron — щоденне зведення)
supabase functions deploy daily-digest --no-verify-jwt --project-ref wotghlaehnvxyeacznvv
```

---

## 5. Secrets для Edge Functions

Dashboard → Project Settings → Edge Functions → Manage secrets:

| Secret | Значення |
|---|---|
| `TG_BOT_TOKEN` | токен від `@BotFather` |
| `TG_GROUP_CHAT_ID` | `-5205303628` |
| `HQ_WEBHOOK_SECRET` | згенерувати: `openssl rand -hex 32` |
| `HQ_CRON_SECRET` | окремий: `openssl rand -hex 32` |

`SUPABASE_URL` та `SUPABASE_SERVICE_ROLE_KEY` — Supabase встановить автоматично.

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

## 7. Smoke test

1. Відкрий https://dreamcarua.github.io/dreamcar-team/hq/
2. Залогінься через Google (`dreamcarua@gmail.com` — CEO)
3. Створи нову публікацію → заповни → «На погодження»
4. В TG-групі прилетить «📝 На погодження…»
5. Поверни як CEO → «✓ Погодити» → прилетить «✅ Погоджено»
6. Перевір **Налаштування** (👤 у топбарі → Профіль): можна вписати `tg_chat_id` для персональних DM
7. Натисни `?` — оверлей гарячих клавіш
8. Натисни `C` — створити публікацію
9. Видали тестову → 7 сек «↶ Повернути» → відновити

---

## 8. Ручний тест daily-digest

```sql
select net.http_post(
  url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-digest',
  headers := jsonb_build_object('x-hq-cron-secret', '<HQ_CRON_SECRET>'),
  body := '{}'::jsonb
);
```

Має прилетіти у TG-групу повідомлення «📅 Daily digest · DD.MM.YYYY».

---

## Все що live зараз

### ✅ Виконано

- Календар (Місяць/Тиждень/День/Список) з drag-drop
- Дошка погоджень
- Бібліотека креативів з реальними thumbnails (фото/відео)
- Картка публікації: всі поля, workflow, auto-save, прев'ю всіх 6 платформ
- **Per-platform date/time** — окремий час для IG, TG, TT, YT, FB, Threads
- Drag-drop креативів + Supabase Storage
- Гібридний Store: Supabase + localStorage fallback
- Realtime sync через Supabase channels
- Google OAuth + Auth gate
- Spinner на workflow-кнопках + lock проти подвійних натискань
- handle_new_user trigger (auto-create users, CEO для dreamcarua)
- Real bell counter (queue + urgent + missed)
- **Settings page** (`#settings`) з прив'язкою `tg_chat_id`
- **TG-нотифікації** (webhook → Edge Function → bot)
- **Daily digest** (cron → ранкове зведення)
- **Soft-delete з Undo** (7 сек, повне видалення через 30 днів)
- **Soft-lock** через editing_sessions (банер «X редагує»)
- **Дублювання публікації** (📋 у footer картки)
- **ICS експорт** (`window.exportIcs()` у консолі)
- **Keyboard help** (`?` — оверлей)
- Sidebar filter: ✓ + яскравіший active
- Filter click guard (не відкриває знову картку)
- Autosave flush at Modal.close

### 🟡 Опційно/майбутнє

- **TG Login Widget** — потрібен bot username + `/setdomain` у `@BotFather`
- **Google Drive resumable upload** — для файлів > 50 MB
- **Telegram bot inbound** — щоб автоматично прив'язувати chat_id через `/start hq_<userid>`

---

## Якщо щось не працює

1. **Upload падає** → перевір що міграція 003 виконана; bucket Public; ти залогінений як authenticated.
2. **TG-повідомлення не приходять** → перевір секрети, webhook headers, чи бот доданий у групу.
3. **Daily digest мовчить** → `select * from cron.job_run_details order by start_time desc limit 5;` — глянь на errors.
4. **Login → localhost** → перевір Site URL у Authentication → URL Configuration.
5. **«new row violates RLS»** при upload → міграція 003 не виконана.

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
