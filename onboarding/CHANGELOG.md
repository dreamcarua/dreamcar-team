# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## DD.MM.YYYY` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 02.06.2026 — вечір (audit fixes)

### 🛡 SECURITY + INFRA
- 🛡 **TG_BOT_TOKEN видалено з hq/config.js** — токен жив тільки у клієнтському JS public-faced. Тепер тільки Edge Functions через `Deno.env.get("TG_BOT_TOKEN")`. Старий токен ротувати у @BotFather.
- 🛡 **REVOKE SELECT на MVs** — `mv_dashboard_projects_stats` + `mv_paid_signatures` більше не доступні anon/authenticated через REST. Доступ тільки через RPC `dashboard_projects_with_stats()`.
- 🛡 **dashboard_webhooks видалено з Realtime publication** — WAL спам на write-heavy таблиці.
- 🔧 **webhooks_auto_cleanup_cron зареєстровано** — щодня 03:00 DELETE WHERE received_at < NOW() - 14 days. Запобігає 701MB IO storm.

### 🔧 HQ FIXES
- 🔧 **SW killer видалено** з index.html (жив 2+ тижні замість планованих 1-2 днів).
- 🗑 **app-analytics-v2.js видалено** з index.html (dead code: викликає не-існуючі Store.allPubs/allHistory).
- ⚡ **app-no-hashtags.js**: `setInterval(800ms)` forever → `MutationObserver` (тригериться тільки на DOM mutation).
- 🔧 **z-index fix**: modal-backdrop 100 → 150. Mobile sidebar drawer (110) більше не перекриває модалки.

### 🔧 DASHBOARD FIXES
- 🔧 **Kyiv timezone**: `kyivIsoStart/kyivIsoEnd` helpers замість `'T00:00:00Z'`. Враховує CET (+2) / CEST (+3) DST переходи. «Сьогодні» більше не зрізає 03:00 ранку Києва.
- 🔧 **renderAnalytics CSS**: додано `.kpi-card`, `.kpi-meta` стилі (раніше класи referenced, не визначені).
- 🔧 **live-badge id**: додано `id="live-badge"` у HTML. `setupAutoRefreshIndicator` тепер реально оновлює timestamp.
- 🔧 **Filter selects auto-rerender**: status / customer_type / tariff / pay_provider / funnel_type / traffic_type / source_filter — тепер тригерять renderRoute() на change (раніше чекали Apply).
- 🔧 **fetchDealsRange secondary order**: `.order('id', desc)` після `created_at` — запобігає pagination duplicates при одночасних ETL insertах.

### 🔧 TASKS FIXES
- 🔧 **Prefs hour-selects fix**: `${Array.from(...)}` template literals у статичному HTML не виконувалися → селекти годин в Налаштуваннях були **порожні**. Перенесено у JS `fillHourSelects()` IIFE.
- 🆕 **status='blocked' enum**: додано в `task_status`. UI: `f-status`, `bulkStatusSelect`, `STATUS_LBL` оновлено. Overdue filter ігнорує blocked (як і done).

### 🎨 BRAND BOOK FIXES (legal)
- 🛡 **NEVER-слова прибрано** з власних розділів (раніше документ порушував власні правила):
  - `touchpoints.html`: «Ефір розіграшу» → «Прямий ефір фіналу»; «Більшість не виграли» → «не отримали авто»; «переможці, наступні розіграші» → «нові власники, наступні фінали»
  - `merch.html`: «БЕРИ. ДІЙ. ВИГРАЙ.» (футболка) → «БЕРИ. ДІЙ. ВОЛОДІЙ.»; «Номер розіграшу = номер серії» → «Номер фіналу = номер серії»
  - `audio.html`: «прямого ефіру розіграшу» → «прямого ефіру фіналу»
- 🛡 **PII redaction**: видалено точне ПІБ ФОП + ІПН з публічної `legal-safe-lexicon.html`.

### 📖 ONBOARDING
- 🆕 **[dashboard.html](dashboard.html)** — НОВА сторінка онбордингу для Dashboard (8 секцій: концепція, архітектура, 7 проектів, FB Ads ETL, paid/organic logic, всі сторінки, use cases, troubleshooting).
- 📖 **CHANGELOG формат**: ISO `YYYY-MM-DD` → `DD.MM.YYYY` у заголовках днів (HARD RULE Вадима).

---

## 02.06.2026

### 📊 Dashboard real-time + повна перебудова (dashboard.dreamcar.ua)

**Завдання:** перевести dashboard з годинного ETL на real-time, виправити проекти, додати best-in-class Analytics, інтегрувати Facebook Ads замість Make.com.

#### ⚡ Real-time data flow
- 🆕 **ETL cron 1 год → 5 хв** (`.github/workflows/etl-mysql-sync.yml`)
- 🆕 **Supabase Realtime увімкнено** на `dashboard_deals`, `dashboard_webhooks`, `dashboard_ads_data` (WebSocket push на frontend)
- 🆕 **Composite indexes** `(status,created_at DESC)`, `(project,created_at DESC)`, `(utm_source,created_at DESC)` для швидших агрегацій
- 🆕 **Frontend WebSocket subscription** з debounced auto-reload (3 сек після нової угоди)
- 🆕 **LIVE badge** у топбарі з seconds-ago counter
- 📖 `docs/REALTIME_AUDIT.md` — повна архітектура + Plan B (webhook dual-write для миттєвого <200мс lag)

#### 🚀 FB Ads ETL замість Make.com
- 🆕 `etl/sync_fb_ads.py` — Facebook Marketing API v21.0 клієнт (Python)
  - Spend, impressions, clicks, conversions (lead/registration/purchase)
  - UTM extraction з ad creative link URLs (3 стратегії)
  - Auto-chunk періодів >80 днів (FB API 90-day limit з time_increment=1)
  - Exponential backoff на rate limit (5/10/20/40 сек)
- 🆕 `.github/workflows/fb-ads-sync.yml` — cron `*/15 * * * *`
- 🆕 GH Secrets: `FB_ACCESS_TOKEN` (System User non-expiring), `FB_AD_ACCOUNT_IDS` (4 accounts)
- 🆕 System User `Volvo_Dashboard_API` (id `61584044034889`) з scope `ads_read`/`business_management`/`read_insights`
- 🆕 Backfill 02.04.2025 → 02.06.2026: 7,131 ad rows, 3.46M UAH spend, 25M impressions, 387K clicks, 78K conversions
- 📖 `docs/FB_TOKEN_SETUP.md` — інструкція Business Manager System User setup
- 💰 **Економія:** $9-29/міс на Make.com Pro tier

#### 🏎️ Projects з legacy (7 проектів)
- 🆕 SQL: таблиця `public.dashboard_projects` з полями `code/name/car_model/date_start/date_end/deal_project_values text[]/status/color/sort_order` + RLS + Realtime
- 🆕 7 проектів засіджено: Архів-до-VOLVO / VOLVO XC90 / AUDI Q7 / BMW 330E HYBRID / MERCEDES GLE COUPE / BMW X5 HYBRID / AUDI E-TRON
- 🆕 RPC `dashboard_projects_with_stats()` — full-lifetime stats всіх 7 проектів (200K deals, 153K paid, 64M UAH revenue lifetime)
- 🆕 Materialized view `mv_dashboard_projects_stats` + cron refresh — **3 мс замість 19,000 мс** (6,000× прискорення)
- 🆕 Frontend `loadProjects()` тягне з БД, при виборі auto-fill date range
- 🆕 Sidebar `f-model` синхронізований з dashboard_projects (всі 7 видно у дропдауні Активний розіграш)

#### ⚡ Performance RPC layer (50-100× speedup)
- 🆕 `dashboard_kpi_summary(p_from,p_to,p_project_values,p_customer_type,p_tariff,p_pay_provider)` — KPI cards
- 🆕 `dashboard_kpi_with_delta(...)` — KPI з ▲/▼% vs попередній період
- 🆕 `dashboard_agg_deals(p_field,...)` — universal aggregation
- 🆕 `dashboard_agg_deals_with_traffic(...)` — з paid/organic classification
- 🆕 `dashboard_traffic_type_summary(...)` — donut paid vs organic
- 🆕 `dashboard_daily_series(...)` / `dashboard_hourly_series(...)` — time-series
- 🆕 Frontend `aggViaRPC()`, `trafficTypeRPC()`, `kpiSummaryRPC()`, `dailySeriesRPC()` — замінили `fetchAllDealsBatched`
- ⚡ Mercedes GLE Тип трафіка: 30-60 сек → **<500 мс** (60× швидше)

#### 🎯 Data-driven paid/organic classification
- 🆕 `mv_paid_signatures` MV — унікальні UTM-signatures з FB Ads (utm_campaign/content/term/ad_name)
- 🆕 Cron refresh кожні 15 хв (синхронно з FB Ads ETL)
- 🆕 `is_paid_deal(utm_campaign, utm_content, utm_term)` — точна класифікація через match з реальними FB Ads campaigns
- 🔧 **Виправлено помилку:** раніше `utm_source=instagram` вважався платним, тепер тільки якщо match з реальною FB Ads campaign
- 📊 Реальна частка платних: 17-32% (раніше було хибне 50/50)

#### 📈 Аналітика повністю перебудована (best-in-class)
- 🆕 KPI cards з delta vs попередній період (Ліди / Оплати+конв% / Виручка / AOV)
- 🆕 Погодинний trend для "Сьогодні" / щоденний для періоду
- 🆕 Воронка Ліди→Оплачені
- 🆕 💸 Платний vs 🌱 Органічний doughnut
- 🆕 🏆 Топ-5 каналів utm_medium bar
- 🆕 🎯 Топ-10 кампаній table
- 🆕 📍 Топ-10 джерел table з paid/organic badge

#### 🏎️ Нова сторінка "Проекти"
- 🆕 Sidebar route `🏎️ Проекти` (під "Огляд")
- 🆕 7 KPI cards (всього лідів/оплат/revenue/AOV/buyers/top-revenue/top-conv)
- 🆕 Bar charts: Revenue по проектах (кольори брендів) + Conv %
- 🆕 Full-table 7 проектів з lifetime stats (ігнорує current period filter)

#### 🔧 Інші покращення dashboard
- 🆕 Default state: проект=усі, період=сьогодні (раніше було 30d)
- 🆕 Maintenance/Finance collapsible групи у sidebar
- 🔧 Filter bar overflow fix (no longer sticky)
- 🔧 Дубль лого внизу sidebar прибрано
- 🔧 RPC filter params: `customer_type`, `tariff`, `pay_provider`, `traffic_type` тепер працюють на всіх агрегаційних сторінках (раніше ігнорувались на Тип трафіка/Джерела/Кампанії)

### 🛡 Supabase IO storm — emergency cleanup
- 🆕 **TRUNCATE `dashboard_webhooks`** — 701 MB → 40 kB (логи останніх 14 днів треба, історичні видалені)
- 🆕 Auto-cleanup cron щодня `0 3 * * *` — DELETE webhooks >14 днів
- 🔧 Cron частоти знижено: `refresh_dashboard_projects_stats` 1хв → 5хв, `hq-cleanup-editing-sessions` 1хв → 10хв
- 🛡 Postgres `statement_timeout`: anon 8s → 120s, authenticated → 180s
- 📖 **Email "Disk IO Budget depleting"** від Supabase — критичний sign для upgrade на Pro tier ($25/міс)

### 🔧 HQ session bleed fix
- 🔧 SW killer key `__sw_killed_20260601` → `__sw_killed_20260602_v2` — Олександр бачив Вадима як CEO через старий cached state, тепер SW unregister + cache clear на наступному load

### 🆕 HQ work_status (статус виконання)
- 🆕 SQL: `publications.work_status` text (script/design/editing/done/NULL)
- 🆕 Dropdown у правій колонці картки публікації під "Звʼязаний із запуском": ✍️ Сценарій / 🎨 Дизайн / 🎬 Монтаж / ✅ Зробив
- 🆕 Calendar chips: emoji ✍️🎨🎬✅ біля назви публікації у місяць/тиждень/день/список
- 🆕 Sidebar filter "СТАТУС ВИКОНАННЯ" (Усі/✍️/🎨/🎬/✅), persists у localStorage
- 🆕 Board view sort: script→design→editing→done→unset (priority sort)
- 📁 `hq/app-work-status-extras.js` — decorator pattern як `app-calendar-dots.js`

### 🗑 Cleanup
- 🗑 Видалено Supabase проект `dreamcar-finance` (INACTIVE з 27.03.2026, не використовувався)
- 🗑 Видалено локальні папки `/Users/vadimgrishin/DreamCar.AI/dreamcar-finance/` + `dreamcar-finance-supabase/` (звільнено 81 MB)

### 📋 Активні Supabase проєкти на DreamCar org (станом на 02.06.2026):
- ✅ **dreamcar-hq** (`wotghlaehnvxyeacznvv`) — main production, 342 MB, чекає Pro upgrade
- ✅ **barpi-hq** (`zrcqmwlpsggiqgipvxhv`) — Barpi МойСклад, ~30 MB, мігрує на Cloudflare D1

---
## 30.05.2026

### 📞 SendPulse phone export — повна історія бази

**Завдання:** витягнути ВСІ номери телефонів з усієї SendPulse системи DreamCar (mailing lists, CRM contacts, chatbot subscribers) за весь час, нормалізувати, дедуплікувати, виправити помилки формату.

**Результат:**
- 🆕 **50 358 унікальних UA** номерів `+380XXXXXXXXX` → `~/DreamCar.AI/phones_ua.txt`
- 🆕 **932 міжнародних** у E.164 → `~/DreamCar.AI/phones_intl.txt` (PL, US, DE, UK, RU, CZ, SK, +інші)
- 🆕 **201 invalid** з причиною → `~/DreamCar.AI/phones_invalid.csv` (короткі, неіснуючі префікси, мусор)
- 🆕 **51 296 unique with context** → `~/DreamCar.AI/phones_all.csv` (phone, country, name, email, sources_count, sources_sample)

**Джерела (592k raw записів):**
- 63 mailing lists → 408 713 рядків
- CRM contacts (POST /crm/v1/contacts/get-list, 153k offsets) → 153 567 phone rows (контакти мають масив phones[])
- Chatbot subscribers (TG/IG/FB) → 30 156 (TG variables.Phone — найцінніше)

**Нормалізація fix-up:**
- `+3800XXXXXXXXX` (13 з зайвим 0 після 380) → `+380XXXXXXXXX`
- `38XXXXXXXXX` (11 без 0 між кодом і номером) → `+380XXXXXXXXX`
- `0XXXXXXXXX` (10 з 0 спереду) → `+380XXXXXXXXX`
- `XXXXXXXXX` (9 digits з валідним UA prefix) → `+380XXXXXXXXX`
- `00CC...` (intl prefix) → `+CC...`
- Validation UA mobile/landline prefixes; intl 30+ кодів країн

### 🆕 SendPulse MCP підключено
- 🆕 Офіційний SendPulse MCP server `https://mcp.sendpulse.com/mcp` додано у `~/.claude.json` (scope=user)
- 🆕 Auth через custom headers `X-SP-ID`/`X-SP-SECRET`
- 🆕 Покриває CRM (deals/contacts/companies/tasks), Email lists, Chatbots, SMTP
- 🛡 **READ-ONLY rule** записано у memory — жодних DELETE/PUT/PATCH/create-POST у production CRM
- 📖 Memory: `reference_sendpulse_mcp.md` + `feedback_sendpulse_readonly.md`

---

## 29.05.2026

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

## 28.05.2026

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

## 27.05.2026

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

## 25.05.2026 і раніше

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
