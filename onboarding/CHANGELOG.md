# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## YYYY-MM-DD` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 2026-05-29

### 🚀 ARCHITECTURE: Client-side compression releases (replaces server worker)

**Контекст:** ранкові GH Actions runs усі валялись (HEIC IMG_8525 + JPG 60КБ — обидва). Корінь — крихкий 8-ланковий ланцюг: upload → Supabase Storage → pg_cron → Edge Function → GH API → runner → bash worker → R2. Будь-яка ланка падає → весь pipeline лягає.

**Рішення:** перенесли стиснення у БРАУЗЕР. FREE, миттєво, без черг.

#### 🆕 `hq/app-client-compress.js` — основний модуль
- **Photo:** `browser-image-compression@2.0.2` (CDN jsDelivr) — resize до 2560px, q90, useWebWorker
- **HEIC:** `heic2any@0.0.4` (CDN jsDelivr) — конвертує HEIC/HEIF → JPEG q95 перед resize
- **Video:** `ffmpeg.wasm@0.12.10` (CDN unpkg) lazy load — CRF 26, max 1920px, AAC 128k. SharedArrayBuffer detection — якщо browser не підтримує → залишає original
- **Patch:** ще один layer на `window.uploadCreativeFile`. Порядок: orig → R2 patch → client-compress patch. Файл → compress → R2 PUT.
- **Post-upload:** одразу `UPDATE creatives SET compressed_status='ready', compressed_size_bytes=X` → autopost worker бачить ready миттєво
- **Fallback:** якщо стиснення впало (старий iPhone, SAB disabled) → заливає original, нічого не ламається
- **Toast прогрес:** % завантаження + результат "−85% · 1.2 MB"

#### 🆕 `hq/compress-batch.html` — admin batch tool для existing pending
- Auth-gate: тільки ceo/coo/lead
- Автозавантажує всі pending з `compress_attempts < 5`
- По одному: fetch → compress у браузері → R2 PUT → mark ready
- Progress bar + KPI (готово / помилок / залишилось) + skip on error
- Старт: відкрий `team.dreamcar.ua/hq/compress-batch.html` → «Стиснути всі»

#### 🚀 Інфраструктура
- `service-worker.js` v13 → v14 (новий cache version)
- pg_cron `compress-safety-net-5min` (jobid 16) — **видалений**. Не потрібен.
- GH Actions cron `compress-creative.yml` `*/3min` — лишається активним як emergency fallback (треба workflow scope PAT щоб commit `# schedule:`)

#### 🔧 До цього сьогодні (раннє)
- HEIC libheif support у `compress-creative-worker.sh` (commit `298d815`) — для GH Actions fallback
- pg_cron safety-net 401 → 200 fix (hq-cron-secret як Bearer) — потім видалили
- ERR trap visibility fix — wrap convert у `if !` блок (commit `f267686`)

**Результат:** наступний user upload → стиск у браузері за 2-5 секунд → R2 → ready. Жодних серверних ланок. Існуючі 41 pending — батч-tool обробить.

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

### Daily Health Audit
- 🆕 Edge Function `daily-health-audit` v3 ACTIVE
- 🚀 Cron jobid=13 щодня 7:00 CEST

### Tasks
- 🔧 Закрита тест-задача "🔥 TEST: Прострочений тест"

---

## 2026-05-27

### HQ
- 🆕 **Overview Modal** — read-only перед edit
- 🆕 **Analytics V3** — funnel + per-platform + velocity
- 🔧 Brand-sync HQ → v3.9.2

### Tasks
- 🆕 **Tasks Analytics Dashboard** — KPI + charts
- 🆕 **Saved filters (presets)**, **Bulk actions**, **Templates**, **TG-bind indicator**
- 🆕 **HQ↔Tasks integration** — auto-task при rework
- 🆕 **Compress queue admin** — retry button

### TG Bot
- 🆕 **/audit команда** у `@dreamcar_team_bot`
- 🆕 Task callbacks: «Done», «Snooze +1d», «Comment»
- 🚀 tg-webhook v25 deployed

### Compress
- 🆕 **Photo + Gallery compression** — ImageMagick 2560×2560 + sendMediaGroup
- 🆕 **HEIC support** (заявлено, але по факту libheif лишався відсутній на runner — fix 2026-05-29)
- 🆕 **Bulk drag-drop upload**

### Search
- 🆕 **Cmd+K global search** (HQ + Tasks shared widget)

### Performance
- ⚡ IndexedDB offline cache, pg_trgm move, RLS initplan fix

### Auth/Pages
- 🆕 Auth-guard на onboarding.html + orgchart.html + survey.html
- 🆕 SMM block у orgchart.html (Олександр)

---

## 2026-05-25 і раніше

### TG Autoposting
- 🆕 Event-driven через `dispatch-workflow` Edge Function
- 🆕 sendMediaGroup для груп фото

### Compress Pipeline (legacy, до 2026-05-29)
- 🆕 R2 bucket + Cloudflare Worker (signed URL proxy)
- 🆕 HQ frontend → direct browser → R2 (>49MB)
- 🆕 GH Action compress-creative.yml + bash worker
- 🆕 2-pass H.264 high profile, ≤49.5MB
- 🗑 **Replaced by client-side compression 2026-05-29**

### HQ Workflow
- 🆕 Multi-approver AND logic, TG inline buttons, Structured rework feedback
- 🆕 Auto-revert у review якщо approved пост змінили >10 символів
- 🆕 Chain прогрес approvers у TG, Дублювати на платформу
- 🆕 @mention з push у TG DM, SLA reminders

### HQ UX
- 🆕 Per-platform date/time + preview tabs, Char counter, кольорові точки платформ
- 🆕 Bulk tag/move, IG feed 3×3, Theme toggle, PWA install, Звуки

### Tasks v3
- 🆕 Tasks app `/tasks/`, TG/Email нотифікації, comments, subtasks, recurring

### Brand Book
- 🆕 ~25 розділів, Brand Post Generator, Voice Linter, Color Checker
- 🆕 Component Storybook, Sidebar search v6 — full-text, PDF print без чорного фону

### Infrastructure
- 🆕 Cowork → TG bridge через GitHub Action
- 🆕 Event-driven dispatcher, Stuck-task detector, Vacation mode UI

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
