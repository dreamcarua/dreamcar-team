# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## YYYY-MM-DD` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 2026-05-29

### 🎉 BATCH COMPRESS DONE — 39/39 stuck pending очищено (фінальна архітектура)

**Status:** ready 9 → 48 · pending 41 → 2 (2 = seed-фейки без thumbnail).

**Фінальна архітектура (v3 SDK-only) — все через Supabase SDK:**
1. **Download:** `supabase.storage.from('creatives').download(path)` — обходить CORS через auth headers
2. **Compress у браузері:** `browser-image-compression@2` (resize 2560px, q90) + `heic2any` (HEIC→JPEG) + `ffmpeg.wasm` (video CRF 26)
3. **Upload назад:** `supabase.storage.from('creatives').upload('compressed/{cre_id}.{ext}')` — той самий bucket, новий префікс
4. **Mark ready:** UPDATE `compressed_status='ready'`, `compressed_url=publicUrl`, `compressed_size_bytes`

**5 ітерацій діагностики (всі помилки які зловили):**
- v1: `fetch(thumbnail_url)` → CORS Load failed (public bucket не має CORS headers)
- v2: SDK download → `RLS storage.objects` дозволяв тільки owner → 403
- v3: SDK download OK → `fetch R2 PUT` → Content-Type у preflight ламає signature → 403
- v4: XHR R2 PUT без Content-Type → R2 CORS не дозволяє `team.dreamcar.ua` origin → preflight 403
- v5: ✅ **Все через Supabase SDK** (download + upload). Без R2 у browser. Працює!

#### 🆕 Що було створено
- **`hq/compress-batch-v2.html`** (v3 SDK-only) — admin batch tool. Auth-gate ceo/coo/lead. Прогрес-бар + KPI + retry.
- **`hq/app-client-compress.js`** — основний модуль для нових uploads (browser-image-compression + heic2any + ffmpeg.wasm). Підключений у `hq/index.html`.
- **`service-worker.js` v13 → v14** — новий cache version.

#### 🛡 RLS Policies (`storage.objects`)
- `creatives_admin_select_all` — адмін бачить ВСІ файли (попередньо: тільки own)
- `creatives_admin_insert_all` — адмін може INSERT (потрібно для upload compressed/)
- `creatives_admin_update_all` — адмін може UPDATE (потрібно для upsert)

#### 🔧 До цього сьогодні (раннє)
- HEIC libheif support у `compress-creative-worker.sh` (commit `298d815`) — для GH Actions fallback
- pg_cron safety-net 401 → 200 fix → потім видалили (не потрібно)
- ERR trap visibility fix у worker.sh (commit `f267686`)

#### ⚠️ Лишилось вияснити (нові uploads)
- Звичайний HQ upload через `app-drive.js` для >49MB робить R2 PUT з `team.dreamcar.ua` — теж має падати на CORS preflight. Перевірити на новому upload через HQ — якщо валиться, переключити upload на Supabase Storage за тим же патерном.

**Результат:** stuck pile-up (24 дні застряг) очищено за 5 хв client-side compression у браузері. Без серверного worker.

---

## 2026-05-28

### 🤖 CRITICAL FIX: tg-ai-router Edge Function (DM AI асистент)
- 🆕 `hq/supabase/functions/tg-ai-router/index.ts` — створено відсутню Edge Function. До цього tg-webhook v26 викликав `${SUPABASE_URL}/functions/v1/tg-ai-router` яка НЕ існувала → усі DM до @dreamcar_team_bot падали в 404 (тихо, бо try/catch). Тепер: приймає `{chat_id, user_db_id, user_name, user_role, text, voice_file_id, message_id}` → за наявності voice транскрибує через OpenAI Whisper (uk) → шле в Claude (sonnet) з system prompt про DreamCar контекст і ролі → відповідає в TG через TG_BOT_TOKEN з reply_to_message_id.
- 🚀 GH Action `deploy-edge-functions.yml` авто-деплоїть на push у `hq/supabase/functions/**`.

### Wave 4 — security + повне покриття mobile-стилю
- 🛡 **Push guards у 7 dev pages** — auth-guard.js + _dev-guard.js. Дозволено ceo/coo/lead.
- 🎨 **HQ inner views** (Board / Library / Launches / Settings) — mobile chip-стиль.
- 📊 **Analytics dashboards** (HQ + Tasks) — mobile fit: KPI 2×2, single column.

### Mobile UX rebuild
- 🆕 `tasks/index.html` — slide-in drawer + FAB pattern як у брендбуку.
- 🔧 `hq/index.html` — 'МЕНЮ' inline у topbar справа.
- 🔧 `onboarding.html` — локальний topbar 'DREAMCAR · ОНБОРДИНГ' + 'МЕНЮ'.

### Global search
- 🆕 `brand-book/assets/global-header.js` — `⌕ Пошук` (⌘K) overlay з 3 секціями.

### Daily Health Audit
- 🆕 Edge Function `daily-health-audit` v3 ACTIVE, cron щодня 7:00 CEST

---

## 2026-05-27

### HQ + Tasks
- 🆕 **Overview Modal**, **Analytics V3** (funnel + per-platform + velocity)
- 🆕 **Tasks Analytics**, **Saved filters**, **Bulk actions**, **Templates**, **TG-bind indicator**
- 🆕 **HQ↔Tasks integration** — auto-task при rework
- 🆕 **Compress queue admin** — retry button

### TG Bot
- 🆕 **/audit команда** у `@dreamcar_team_bot`
- 🆕 Task callbacks: «Done», «Snooze +1d», «Comment»

### Compress
- 🆕 **Photo + Gallery compression** + **Bulk drag-drop upload**

### Search
- 🆕 **Cmd+K global search** (HQ + Tasks shared widget)

### Performance + Auth
- ⚡ IndexedDB offline cache, pg_trgm move, RLS initplan fix
- 🆕 Auth-guard на onboarding/orgchart/survey

---

## 2026-05-25 і раніше

### Compress Pipeline (legacy, до 2026-05-29)
- 🗑 R2 + GH Actions worker — **замінено client-side compression 2026-05-29**

### TG Autoposting
- 🆕 Event-driven через `dispatch-workflow` Edge Function
- 🆕 sendMediaGroup для груп фото

### HQ Workflow
- 🆕 Multi-approver AND logic, TG inline buttons, Structured rework feedback
- 🆕 Auto-revert у review якщо approved пост змінили >10 символів
- 🆕 Chain прогрес approvers у TG, Дублювати на платформу
- 🆕 @mention з push у TG DM, SLA reminders

### HQ UX
- 🆕 Per-platform date/time + preview tabs, Char counter
- 🆕 Bulk tag/move, IG feed 3×3, Theme toggle, PWA install, Звуки

### Tasks v3
- 🆕 Tasks app `/tasks/`, TG/Email нотифікації, comments, subtasks, recurring

### Brand Book
- 🆕 ~25 розділів, Brand Post Generator, Voice Linter, Color Checker
- 🆕 Component Storybook, Sidebar search v6 — full-text

### Infrastructure
- 🆕 Cowork → TG bridge через GitHub Action
- 🆕 Event-driven dispatcher, Stuck-task detector, Vacation mode UI

---

## Як оновлювати цей файл

1. Кожна нова фіча / fix / deploy — додати рядок у поточну дату
2. Якщо це NEW день — створити новий `## YYYY-MM-DD` блок зверху
3. Групувати під підзаголовки систем
4. Емодзі обов'язково (🆕 / 🔧 / 🛡 / ⚡ / 🚀 / 📖 / 🗑)

**Це джерело правди для команди.** Хочеш знати що нового — почни тут.

## Дві версії онбордингу

- **`/onboarding.html`** — USER-FACING. Універсальний онбординг для всіх членів команди.
- **`/onboarding/*`** — DEV-ONLY. Тут технічні деталі. Закрито auth-guard для ceo/coo/lead.
