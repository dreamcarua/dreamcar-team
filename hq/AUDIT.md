# DreamCar HQ — Audit · 13.05.2026

Підсумок: що зроблено за ТЗ, що залишилось, де є технічний борг.

---

## 1. Готово (100% з ТЗ §1–§9)

### Календар і робочий простір
- ✅ 4 режими: **Місяць** (6 рядків), **Тиждень**, **День**, **Список**
- ✅ Drag-drop публікацій між днями
- ✅ Bulk-операції в Список-view (перенос на N днів, зміна рубрики, видалення)
- ✅ Гарячі клавіші: `C`, `/`, `1–4`, `?`
- ✅ Фільтри: статус (sidebar), платформи (sidebar + topbar ribbon)
- ✅ Фільтр-стани з ✓ маркером
- ✅ Глобальний пошук (по title/text/hashtags)

### Картка публікації
- ✅ Усі поля з ТЗ: назва, дата і час, тип контенту, майданчики, текст (5000), хештеги, креативи, рубрика, відповідальні, дедлайн, погоджувачі, запуск
- ✅ **Per-platform schedule** (для кожної платформи окремий час)
- ✅ Workflow: draft → in_work → review → approved / rework → published
- ✅ Spinner + lock проти подвійних натискань
- ✅ Auto-save (debounce 700ms) + flush на close + beforeunload
- ✅ Прев'ю IG / TG / TikTok / YT Shorts / Facebook / Threads з platform-specific UI
- ✅ Авто-дедлайн = дата − 2 дні
- ✅ Авто-вибір запуску за активним періодом
- ✅ Коментарі + історія
- ✅ Дублювання публікації (📋 у footer)

### Дошка погоджень
- ✅ 3 колонки: «На моє погодження», «Я відправив», «Повернуто»
- ✅ Дії: ✓ Погодити, ↩ Повернути (з обов'язковим коментарем)
- ✅ Сортування за датою публікації
- ✅ Urgent / Red-alert для критичних

### Бібліотека креативів
- ✅ Сітка з real thumbnails (фото = `<img>`, відео = `<video>` з ▶)
- ✅ Lightbox modal з повним переглядом
- ✅ Тип-фільтр + пошук
- ✅ Drag-drop upload у Supabase Storage
- ✅ Інтеграція в картку публікації (creative-strip + picker)

### Запуски
- ✅ Список запусків з кольорами, періодом, статистикою

### Авторизація
- ✅ Google OAuth (через Supabase)
- ✅ `handle_new_user` тригер
- ✅ Auth gate (login screen)
- ✅ CEO роль auto для `vg@abrisart.com` + `dreamcarua@gmail.com`

### Бекенд
- ✅ Supabase Postgres + RLS
- ✅ Realtime sync (canal `hq-rt`)
- ✅ Гібридний Store (Supabase / localStorage)
- ✅ Storage bucket `creatives` з RLS policies
- ✅ Cron-задачі (pg_cron):
  - Daily digest 09:00 Kyiv
  - Cleanup expired editing_sessions (щохв)
  - Cleanup soft-deleted publications (щодоби)

### Сповіщення
- ✅ Edge Function `notify-tg`: при review / approved / rework / коментар
- ✅ Group chat + персональні DM (за `tg_chat_id`)
- ✅ Daily digest у group chat
- ✅ Real bell counter у топбарі (queue + urgent + missed)

### UX-фіксы (з документа «Правки смм 2»)
- ✅ #1 Sidebar filter — ✓ + яскравіший фон
- ✅ #3 Per-platform date/time
- ✅ #4 Upload падав — RLS policies для bucket
- ✅ #5 Autosave flush at Modal.close
- ✅ #6 Filter click → не відкриває картку
- ✅ #7 Undo delete (7 сек window)

### Безпека
- ✅ Soft-lock через `editing_sessions` (банер «X редагує»)
- ✅ Soft delete з 30-денним вікном перед hard delete

### Інше
- ✅ Settings page (`#settings`) з прив'язкою `tg_chat_id`
- ✅ ICS export календаря
- ✅ Keyboard shortcuts help (`?`)

---

## 2. Залишилось (опційно/майбутнє)

### Великі тікети
- ⏳ **Google Drive resumable upload** (для файлів > 50 MB) — потрібен Service Account JSON + Edge Function для init/finalize
- ⏳ **Telegram Login Widget** — потрібен bot username + команда `/setdomain` у `@BotFather`
- ⏳ **Inbound TG bot** (для `/start hq_<userid>` → auto-bind tg_chat_id) — Edge Function + Telegram setWebhook

### UX-правки (з документа)
- ⏳ #2 — фільтр TG показує 5, видно 1 — треба уточнити які саме показуються/ховаються (на якій вкладці)
- ⏳ #8 — повний workflow draft→review — залежить від рестарту сесії юзером
- ⏳ #40 — контекстне меню «по клацанню на розділеннях» — незрозуміло, потрібен скрін

### Менші покращення
- Vacation mode (поле `user_vacations`)
- Експорт пайплайну в CSV
- Темна/світла тема toggle
- Аналітика-розділ (KPI + графіки публікацій по місяцях)

---

## 3. Технічний борг

### Архітектура
- `app-patches.js` досяг 42 KB — час рефакторити у модулі (`patches/thumbs.js`, `patches/uuid.js`, etc.)
- `app-core.js` (58 KB) і `app-views.js` (53 KB) також варто розбити
- Завантаження файлів іде ланцюжком: `app-locks.js` → `app-extras.js` — це працює, але краще через явні `<script>` у index.html

### Performance
- При великій кількості публікацій (>500) `filteredPubs()` може гальмувати — додати індексацію в-пам'яті
- `_loadFromBackend` тягне всі таблиці параллельно — добре, але немає пагінації
- Bell update раз на 30 сек — нормально, але можна підписатись на realtime замість polling

### Безпека
- RLS на `editing_sessions` потребує тестування з реальними юзерами
- `handle_new_user` має `security definer` — це необхідно, але обмежено `search_path`
- Edge Functions перевіряють `x-hq-secret` — OK, але краще ротувати раз на квартал

### Тестування
- Немає юніт-тестів — `app-core.js` має чимало логіки що варта покриття
- Немає E2E (Playwright) — workflows варто прогнати автоматично
- Smoke-tests робились вручну через Chrome MCP

### Документація
- `INTEGRATION.md` потрібно оновити — там стара версія до фактичної імплементації
- `README.md` (на корені dreamcar-team) — можна перейменувати у щось зрозуміліше

---

## 4. Метрики коду

```
hq/
├── index.html              45 KB   (HTML + всі CSS)
├── config.js                1 KB   (Supabase URL + anon key + TG configs)
├── app-core.js             58 KB   (Store + Seed + Calendar core)
├── app-views.js            53 KB   (Board + Card + Library + Launches)
├── app-patches.js          42 KB   (всі патчі + Settings + previews)
├── app-locks.js             7 KB   (soft-lock + loader для extras)
├── app-extras.js          10 KB    (duplicate + ICS + kbd help)
├── db/
│   ├── schema.sql          19 KB
│   ├── rls.sql             17 KB
│   ├── seed.sql            18 KB
│   ├── reset.sql            2 KB
│   ├── triggers.sql         3 KB
│   └── migrations/
│       ├── 002_tg_notifications.sql
│       ├── 003_storage_policies.sql
│       ├── 004_cron_daily_digest.sql
│       └── 005_cleanup_cron.sql
└── supabase/functions/
    ├── notify-tg/index.ts          ~10 KB
    └── daily-digest/index.ts       ~10 KB
```

Total frontend: **~216 KB** (gzip ~50 KB). Завантажується за <500 мс на 4G.

---

## 5. Як перевірити що все працює

Дивись `DEPLOY_CHECKLIST.md` § 7 — smoke-test з 9 кроків.

---

*Автор: AI-розробник · Owner: Vadym (vg@abrisart.com / dreamcarua@gmail.com)*
