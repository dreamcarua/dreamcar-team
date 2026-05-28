# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## YYYY-MM-DD` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 2026-05-28

### 🤖 CRITICAL FIX: tg-ai-router Edge Function (DM AI асистент)
- 🆕 `hq/supabase/functions/tg-ai-router/index.ts` — створено відсутню Edge Function. До цього tg-webhook v26 викликав `${SUPABASE_URL}/functions/v1/tg-ai-router` яка НЕ існувала → усі DM до @dreamcar_team_bot падали в 404 (тихо, бо try/catch). Тепер: приймає `{chat_id, user_db_id, user_name, user_role, text, voice_file_id, message_id}` → за наявності voice транскрибує через OpenAI Whisper (uk) → шле в Claude (sonnet) з system prompt про DreamCar контекст і ролі → відповідає в TG через TG_BOT_TOKEN з reply_to_message_id. ENV: ANTHROPIC_API_KEY, OPENAI_API_KEY (опціонально для voice), TG_BOT_TOKEN. CORS + try/catch навколо всього, завжди 200 щоб webhook не ретраїв.
- 🚀 GH Action `deploy-edge-functions.yml` авто-деплоїть на push у `hq/supabase/functions/**`.

### Wave 4 — security + повне покриття mobile-стилю
- 🛡 **Push guards у 7 dev pages** (`/onboarding/{index,audit,autopost,compress,hq,tasks,brand-book}.html`) — додано auth-guard.js + _dev-guard.js. Випадковий перехід → login overlay → дозволено лише ceo/coo/lead. Інших → /onboarding.html. Commit `fb3c241`.
- 🎨 **HQ inner views** (Board / Library / Launches / Settings) — mobile chip-стиль як у Календарі. Board single column, library 3-col grid, всі без border-radius, JetBrains Mono для UI-тексту. Commit `3c8a2d8`.
- 📊 **Analytics dashboards** (`hq/analytics-v3.html` + `tasks/analytics.html`) — mobile fit: KPI 2×2 grid, chart-grid single column, padding 14, h1 24px, canvas 220px max. Усе компактно. Commit `8a0979e`.

### Уніфікований mobile UX скрізь — Tasks + HQ + Onboarding
- 🆕 `tasks/index.html` — повний mobile rebuild: прибрав '← HUB', Analytics/Bell/Settings/Help/Exit перенесено у slide-in drawer (як у брендбуці). Topbar тільки 'DREAMCAR · TASKS + МЕНЮ'. FAB '+' bottom-right для швидкого створення задачі. MutationObserver синхронізує bell badge + user name з main у drawer. Commit `ef356a9`.
- 🔧 `hq/index.html` — замінив fixed ☰ hamburger зліва на 'МЕНЮ' текст-кнопку inline у topbar справа (стиль брендбука: JetBrains Mono 11px, letter-spacing 0.2em, border-radius 0). Topbar padding-left 60→12px. Commit `307894d`.
- 🔧 `onboarding.html` — локальний topbar 'DREAMCAR · ОНБОРДИНГ' (Archivo Black) + 'МЕНЮ' 1:1 з брендбука. Commit `8260ea7`.
- 🎨 **Єдина візуальна логіка** скрізь: brand-book / HQ / Tasks / Onboarding / Orgchart / Survey — той самий патерн drawer + topbar + FAB.

### Global search + brand-book sidebar pattern (Vadym critical v3)
- 🆕 `brand-book/assets/global-header.js` — **глобальний пошук** `⌕ Пошук` (⌘K shortcut) у вільному місці справа від лого. Overlay з 3 секціями: Системи (Brand/HQ/Tasks/Onboarding/Org/Survey) + Локальна сторінка (через `window.DC_PAGE_NAV`) + Brand Book search-index.json (29 розділів, full-text). Sticky разом з header. Працює в усіх системах де підключений global-header. Commit `c6f5ac0`.
- 🔧 `onboarding.html` — sidebar тепер як в брендбуку (brand-book pattern):
  - `transform: translateX(-105%) → translateX(0)` slide-in
  - `body.sidebar-open` toggle на body, `::after` backdrop overlay
  - 84vw width / max 320px, box-shadow
  - Click outside / ESC закриває
  - **Sidebar search input** прямо в drawer для фільтру 12 розділів (з aliases)
  - Hamburger «☰ Меню» з червоною рамкою — видно одразу
- 🛑 Прибрав `DC_PAGE_NAV` dropdown з топбару — більше не використовуємо (замість нього глобальний пошук + повноцінний sidebar)
- ⚠️ TG login Bot domain invalid — повідомлено Вадиму, потрібно `/setdomain team.dreamcar.ua` у BotFather

### Universal page-nav dropdown у global-header (Vadym critical v2)
- 🆕 `brand-book/assets/global-header.js` — додано **page-nav dropdown** як універсальний компонент усіх систем (sticky в header):
  - Сторінка декларує `window.DC_PAGE_NAV = { current, pages:[{id,label,num}], onSelect }` ДО завантаження скрипта
  - Header автоматично малює кнопку у `.dc-gh-right` (поряд з ≡): `[01] 👋 Старт ▼`
  - Клік → красивий dropdown під header з усіма розділами, активний підсвічений
  - Click outside / ESC закриває; `__dcUpdatePageNav(id)` для sync ззовні
  - Sticky разом з header при scroll. Mobile: full-width менюшка під header
- 🔧 `onboarding.html` — прибрав mobile-stepper що перекривав контент. Тепер встановлюємо `DC_PAGE_NAV` і експонуємо `__dcGoPage` для синхронізації з sidebar. Commit team: `6c43b89`, commit brand-book: `be94e44`
- **Тепер можна швидко інтегрувати в HQ, Tasks, Brand Book** — просто встановити `window.DC_PAGE_NAV` у конкретній сторінці.

### Onboarding UX rebuild — stepper + no blocker (Vadym critical)
- 🆕 `/onboarding.html` — повний рефакторінг flow:
  - **Прибрано auto-show role-picker** як блокер на старті. Тепер `setRole(stored || 'all')` — контент видно одразу. Picker відкривається через CTA «Знайти свою роль» у Welcome або «змінити» у sidebar.
  - **MOBILE STEPPER** — sticky horizontal chip-nav зверху під global-header (52px). 12 розділів з номерами 01-12, scroll-snap, активний chip auto-scroll у view. На desktop невидимий (sidebar лишається).
  - **Welcome CTA** — нова `.role-cta` плашка з градієнтом і стрілкою для опційного вибору ролі.
  - JS sync: `goPage()` оновлює і sidebar links, і stepper chips одночасно.
  - Користувач тепер ОДРАЗУ бачить Welcome і ОДРАЗУ бачить меню етапів зверху на mobile — розуміє куди йти. Commit `f7098c2`.

### Mobile UX rebuild HQ + onboarding (Артем feedback v3)
- 🔧 `/onboarding.html` — **role-picker scroll fix**: `overflow-y:auto + -webkit-overflow-scrolling:touch`, на mobile `align-items:flex-start` + `env(safe-area-inset-*)`. Артем не міг доскролити 6 ролей бо 100vh контейнер мав `align-items:center` без скролу. Зараз — гладкий scroll.
- 🆕 `/hq/index.html` — **повний mobile-first rebuild** (Артем feedback "коряво на mobile"): off-canvas sidebar (slide-in drawer + backdrop + ESC close), hamburger button (44×44), компактний 52px topbar з iOS safe-area-inset, sticky view-header вертикально, platform-filter horizontal scroll-snap, календар Month компактний (58px клітинки, без time inline), modals slide-up bottom-sheet near-fullscreen, list-table → cards, **FAB (+) bottom-right** для швидкого створення публікації, 38px+ tap-targets (Apple HIG 44×44). `dvh` замість `vh`. Hides global-header на mobile (уникнути дублю навігації). Commit `dac62cd`.

### Mobile UX v2 (Артем feedback)
- 🔧 `/onboarding.html` — fix mobile layout: `.main` override `margin-left:0 + width:100% + max-width:100% + box-sizing:border-box` у `@media (max-width:900px)`. До цього desktop CSS (`margin-left:260px; width:calc(100% - 260px)`) залишався активний → контент тиснувся у вузьку колонку справа. Тепер на телефоні займає повну ширину viewport. Sidebar — overlay через hamburger. Commit `dea24c5`.

### Onboarding (РОЗДІЛЕНО!)
- 🆕 **`/onboarding.html`** — user-facing онбординг для ВСІХ членів команди (SMM/Approver/Member/Designer/COO/CEO)
  - Role-picker на старті (CEO/COO/SMM/Approver/Member/Designer)
  - 12 розділів: welcome / quickstart 8 кроків / глосарій / **карта сповіщень** / HQ / Tasks / Креативи / Autopost / TG бот / Brand Book / FAQ / контакти
  - Role-adaptive (показує тільки релевантне)
  - **Без технічних деталей** — мова користувача
  - Прибрано всі згадки «Давід» — універсальний
- 🆕 **`/onboarding/*`** — dev-only hub (з SQL/архітектурою) — закрито auth-guard + dev-only-guard для admin ролей (ceo/coo/lead)
- 🆕 `_dev-guard.js` — non-admin redirect на user-facing onboarding.html

### Security (Supabase)
- 🛡 Revoke EXECUTE з `anon` + `authenticated` на 12 worker/cron функціях
- 🛡 Storage `creatives` bucket: broad ALL policy → 4 вузькі (own files only)
- 🛡 `register_approval` + `retry_compress`: тільки `authenticated`

### Performance (Supabase)
- ⚡ 18 FK без covering index → додано `idx_*` індекси
- ⚡ 20 RLS policies переписано: `auth.uid()` → `(SELECT auth.uid())` — кеш per query

### Daily Health Audit
- 🆕 Edge Function `daily-health-audit` v3 ACTIVE
- 🚀 Cron jobid=13 щодня 7:00 CEST
- 🆕 Manual test: HTTP 200, score 91/100, email + TG доставлені

### Tasks
- 🔧 Закрита тест-задача "🔥 TEST: Прострочений тест"

### Compress
- 🚀 Compress workflow тригернений → 44 photo + 2 video у черзі
- 🔧 HEIC `IMG_8525.HEIC` retry з libheif

---

## 2026-05-27

### HQ
- 🆕 **Overview Modal** — read-only перед edit
- 🆕 **Analytics V3** — funnel + per-platform + velocity
- 🔧 Brand-sync HQ → v3.9.2
- 🔧 Fix «Перевіряю сесію…» висіння

### Tasks
- 🆕 **Tasks Analytics Dashboard** — KPI + charts
- 🆕 **Saved filters (presets)**
- 🆕 **Bulk actions** — multi-select toolbar
- 🆕 **Task templates**
- 🆕 **TG-bind status indicator**
- 🆕 **HQ↔Tasks integration** — auto-task при rework
- 🆕 **Compress queue admin** — retry button

### TG Bot
- 🆕 **/audit команда** у `@dreamcar_team_bot`
- 🆕 Task callbacks: «Done», «Snooze +1d», «Comment»
- 🚀 tg-webhook v25 deployed

### Compress
- 🆕 **Photo + Gallery compression** — ImageMagick 2560×2560 + sendMediaGroup
- 🆕 **HEIC support** — libheif + ImageMagick policy
- 🆕 **Bulk drag-drop upload**

### Autopost
- 🆕 **Meta autopost Phase 1+2** — IG + FB + Threads code ready (waits creds)
- 🆕 Carousels + Reels support
- 🆕 Per-platform JSONB status

### Notifications
- 🆕 **Email worker для Tasks** (Resend SDK)

### Search
- 🆕 **Cmd+K global search** (HQ + Tasks shared widget)

### Mobile
- ⚡ Mobile responsive аудит — 70+ CSS rules

### Performance
- ⚡ IndexedDB offline cache + lazy-load
- ⚡ pg_trgm move, inline scripts extraction

### Auth/Pages
- 🆕 Auth-guard на onboarding.html + orgchart.html + survey.html
- 🆕 SMM block у orgchart.html (Олександр)
- 🔧 Brand-sync survey.html

### Bridges
- 🔧 Cowork→TG bridge race condition

---

## 2026-05-25 і раніше

### TG Autoposting
- 🆕 Event-driven через `dispatch-workflow` Edge Function
- 🆕 sendMediaGroup для груп фото
- 🚀 Compressed videos автоматично у TG-канал

### Compress Pipeline
- 🆕 R2 bucket + Cloudflare Worker (signed URL proxy)
- 🆕 HQ frontend → direct browser → R2 (>49MB)
- 🆕 Background compress
- 🆕 GH Action compress-creative.yml + bash worker
- 🆕 2-pass H.264 high profile, ≤49.5MB
- 🆕 HEVC second pass (opt-in)

### HQ Workflow
- 🆕 Multi-approver AND logic
- 🆕 TG inline buttons (approve/reject)
- 🆕 Structured rework feedback
- 🆕 Auto-revert у review якщо approved пост змінили >10 символів
- 🆕 Chain прогрес approvers у TG
- 🆕 Дублювати пост на платформу
- 🆕 @mention з push у TG DM
- 🆕 SLA reminders -10 хв + перевірка +10 хв

### HQ UX
- 🆕 Per-platform date/time + preview tabs
- 🆕 Char counter, кольорові точки платформ
- 🆕 Bulk tag/move у Бібліотеці
- 🆕 IG feed 3×3 preview
- 🆕 Theme toggle
- 🆕 PWA install у topbar
- 🆕 Звуки ding/send

### Tasks v3
- 🆕 Tasks app `/tasks/`
- 🆕 TG/Email нотифікації, comments, subtasks, recurring
- 🆕 Universal header

### Brand Book
- 🆕 ~25 розділів, Brand Post Generator, Voice Linter, Color Checker
- 🆕 Component Storybook
- 🆕 Sidebar search v6 — full-text
- 🆕 PDF print без чорного фону

### Infrastructure
- 🆕 Cowork → TG bridge через GitHub Action
- 🆕 Event-driven dispatcher
- 🆕 Stuck-task detector
- 🆕 Vacation mode UI

---

## Як оновлювати цей файл

1. Кожна нова фіча / fix / deploy — додати рядок у поточну дату
2. Якщо це NEW день — створити новий `## YYYY-MM-DD` блок зверху
3. Групувати під підзаголовки систем
4. Емодзі обов'язково (🆕 / 🔧 / 🛡 / ⚡ / 🚀 / 📖 / 🗑)
5. Посилання на сторінку онбордингу де треба

**Це джерело правди для команди.** Хочеш знати що нового — почни тут.

## Дві версії онбордингу

- **`/onboarding.html`** — USER-FACING. Універсальний онбординг для всіх членів команди. Role-picker, без технічних деталей, з кейсами та прикладами.
- **`/onboarding/*`** — DEV-ONLY. Тут технічні деталі (архітектура, SQL, troubleshooting). Закрито auth-guard для admin ролей (ceo/coo/lead).
