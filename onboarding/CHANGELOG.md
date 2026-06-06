# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## DD.MM.YYYY` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 06.06.2026 — РЕТЕНШН — нова система розсилок (Phase 1)

### 🆕 РЕТЕНШН — окремий стіл для Email/TG/Push/SMS/Viber розсилок
- 🆕 **Нова сторінка `/retention/`** — повний клон структури SMM але для прямих комунікацій з підписниками. URL: `team.dreamcar.ua/retention/`.
- 🆕 **DB schema**: `retention_messages` + `retention_message_approvers` + `retention_message_responsibles` + `retention_message_history`. ENUMs: `retention_channel` (email/tg/push/sms/viber/other), `retention_status` (draft/review/approved/scheduled/sending/sent/failed/rework/archived). RLS + indexes.
- 🆕 **6 каналів** (Email через SendPulse READ-ONLY, Telegram broadcast через `@dreamcar_team_bot`, Push/SMS/Viber/Інше — placeholders для Phase 2).
- 🆕 **Approval flow як у SMM**: draft → review (approvers DM) → approved (всі ✅) → scheduled → sending → sent / failed. Кнопка ↩ rework з причиною.
- 🆕 **Sidebar з 4 секціями**: Робочий простір (Всі/Дошка/Календар/Шаблони), Канали (6), Статуси (6), Системи (cross-link на SMM/Tasks/Projects/Analytics).
- 🆕 **3 views**: List, Board (Kanban 6 колонок по статусам), Calendar (місячний грід з розсилками).
- 🆕 **Audience filter**: тариф (Бронза/Срібло/Золото/Платина) + статус (Активний/Потенційний/Відтік/Переможці). Кнопка ↻ ОЦІНИТИ показує розмір.
- 🆕 **Approvers / Responsibles** multi-select у формі, синхронізуються з retention_message_approvers/responsibles.
- 🆕 **History log** видимий через `📜 ІСТОРІЯ ПОДІЙ` details у формі.
- 🆕 **Project link**: розсилку можна прикріпити до проєкту (FK на `launches`).
- 🆕 **Edge function `retention-scheduler`** — кожні 5 хвилин (cron `retention-scheduler-5min`) перевіряє approved/scheduled розсилки з `publish_at <= now()` і шипає. Підтримує `?dry=1` для тестування.
- 🆕 **TG broadcast** працює автоматично — для каналу `tg` chat_id у `audience_list_id`, body форматується як HTML. Email — заглушка з error message (READ-ONLY rule SendPulse).
- 🆕 **Global header tab `РЕТЕНШН`** (📬) у `brand.dreamcar.ua/assets/global-header.js`.
- 🆕 **Onboarding section** `data-page="retention"` з повним описом каналів/lifecycle/use cases.
- 🆕 **Cross-link**: SMM sidebar (Ретеншн ↗), Projects topbar (📬 РЕТЕНШН), Retention topbar (SMM/TASKS/ПРОЄКТИ).

---

## 05.06.2026 — TASKS UX upgrade + HQ throttle + Theme

### 🆕 TASKS — Корзина 30 днів + UI повна перебудова
- 🆕 **Soft-delete + Корзина 30 днів** на `team_tasks`. SQL: `deleted_at/deleted_by/deleted_reason` колонки, trigger `team_tasks_soft_delete_guard` для прав, RPC `tasks_trash()` (CEO/COO бачить ВСЕ, member — лише свої), cron `team-tasks-trash-purge` (04:30 щодня DELETE >30d).
- 🆕 **3-кнопковий custom modal** при delete (Назавжди / У корзину / Cancel). Member отримує 2 кнопки (без Назавжди), CEO/COO — 3 з двоступеневим confirm для hard delete.
- 🆕 **`🗑 КОРЗИНА (N)` chip** у filter-rad з лічильником (refresh */2min). Route `#trash` — список deleted з полями: title, **видалив**, дата, **залишилось N днів** (color-coded ≤3 red, ≤7 yellow). Кнопки ↩ Відновити / 🗑 Purge.
- 🆕 **Клік на фільтр-chip у корзині** → автозакриття trash + перехід на board з фільтром.
- 🆕 **Idempotency guard для saveTask** + disable button під час save → не створює дубль при double-click. Realtime UPDATE handler дедуплікує по id (race save+loadTasks+realtime).
- 🆕 **Watchers UI переписаний** — простий `<select>` як ВИКОНАВЕЦЬ + chips зверху. Native dropdown, множинний вибір через repeated select. Прибраний custom autocomplete dropdown.

### 🆕 TASKS — Сортування по дедлайну + Календарний вид (Давид)
- 🆕 **`sortByDeadline()`** у renderBoard: overdue → today → +1d → +2d → ... → без дедлайну → done. У кожній колонці найгарячіше зверху.
- 🆕 **Календарний вид** `#calendar` — кнопка `📅 КАЛЕНДАР` у chip row. Місячний grid 7×N (ПН-НД). Сьогодні підсвічена. Кожна задача — pill з прізвищем ініціалом, кольоровий border (P1 red / P2 yellow / P3 blue / P4 grey). Прострочені — червоний текст. До 4 на день + "+N ще".
- 🆕 **Навігація календаря**: ← Місяць / Місяць → / Сьогодні / `tільки мої` checkbox.
- 🆕 **Клік на день** → нова задача з prefilled `due_date`. **Клік на pill** → відкрити task modal.

### 🆕 HQ — Корзина 30 днів (як Tasks)
- 🆕 SQL: `publications.deleted_by/deleted_reason`, trigger `publications_soft_delete_guard`, RPC `publications_trash()`, cron `publications-trash-purge` (04:35).
- 🆕 **Файл `hq/app-trash.js`** (~240 LOC) — overrides `Store.deletePub` на 3-кнопковий modal, додає sidebar link `🗑 Корзина (N)`, route `#trash` з restore/purge.
- 🗑 Старий 7-секундний undo-delete з `app-patches.js` **прибраний** (replaced 30-day проперами).
- 📖 Same permissions matrix: автор + CEO/COO видаляють/відновлюють; member НЕ автор отримує "тільки автор або CEO/COO" toast.

### 🎨 UNIFIED THEME — light/dark на ВСІХ apps (Давид)
- 🆕 **`hq/dc-theme.js` + `tasks/dc-theme.js`** — unified theme toggle. Один localStorage key `dc-theme` для всіх apps. Cross-tab sync через `storage` event.
- 🆕 CSS базовий інверт через `html[data-dc-theme="light"] body.dc-light` — background білий, text чорний, sidebars/topbars/modals/inputs/chips інвертовані.
- 🆕 Auto-inject `<button class="dc-theme-toggle">` у `.topbar .actions` чи fallback fixed top-right.
- 📁 Підключено у HQ і Tasks. Dashboard вже мав свій `app-dashboard-extras.js` light toggle — sync з тим самим key.

### 🛡 HQ — TG notify deduplication
- 🆕 **`publications.last_tg_notify_at`** column. Trigger `publications_notify_with_dedup()` — skip notify якщо last sent <5 хвилин тому. Олександр зламнинусь "обновил страницу — снова прилетает": тригер `publication-status-changed-update` мав WHEN DISTINCT, але якісь rapid UPSERTs обходили. Тепер server-side throttle.

### 🔧 TASKS — RLS soft-delete fix
- 🔧 SELECT policy `team_tasks_select_authed_active` (з `deleted_at IS NULL`) блокувала RETURNING після UPDATE → "new row violates RLS". Переписано на `team_tasks_select_authed` без deleted clause; UI вручну фільтрує `is('deleted_at', null)` у `loadTasks()` + realtime handler видаляє з board при UPDATE з deleted_at не NULL.
- 🔧 `restoreTask` тепер re-rendering trash list одразу (раніше треба було reload).

### 🔧 HQ — Save FAB + open-close-open fix
- 🔧 `Modal.close` тепер resetує hash на `#calendar` — раніше hash залишався `#publication/<id>` після close, повторний клік не fired hashchange → modal не відкривався знов.
- 🔧 Креатив preview у edit modal через окремий fullscreen overlay (НЕ Modal.open щоб не втратити pub-edit context).

### 🆕 TG — Tasks callbacks у tg-webhook
- 🆕 Handler для `task:done` / `task:doing` / `task:open` callbacks. Раніше відповідало "Невідома дія" бо webhook знав тільки pub callbacks.
- 🆕 **"👀 Відкрити" — URL button** (1 клік → браузер) замість callback з текстом URL.

---

## 04.06.2026 — Dashboard rebuild + Auth aliases + 3 P0 fixes

### 🛡 DASHBOARD — Security + SSO
- 🛡 **Login gate з role check** — `dashboard.dreamcar.ua` тепер показує login screen перед усім контентом. Доступ лише `ceo/coo/lead` (member → "Доступ заборонено"). Раніше була публічна "guest" mode де anon бачив проекти.
- 🛡 **REVOKE SELECT FROM anon** на ВСІХ 8 `dashboard_*` таблицях + DROP policy "Allow anon read" на `dashboard_projects`.
- 🆕 **SSO bridge HQ→Dashboard** через URL fragment. HQ TG login + `?dashboard=1` → передає `{access_token, refresh_token}` у `#sso=<base64>` → Dashboard читає, робить `setSession()`, очищає hash. Cross-domain працює.
- 🔧 **SyntaxError fix** — `alert('Обов\\'язкові...')` ламав весь JS bootstrap (login gate не показувався) → виправлено на double-quoted string.

### 🆕 AUTH — User aliases (multiple Google accounts на одного user)
- 🆕 **Таблиця `user_auth_aliases`** + RPC `resolve_user_by_auth(p_auth_id)` — приймає auth_id, повертає users row з users.auth_id ПЕРШИЙ choice, потім user_auth_aliases fallback.
- 🆕 Вадим тепер може заходити через `dreamcarua@gmail.com`, `vg@abrisart.com`, `vg@sneco.ua` — всі ведуть на CEO record `aaaaaaa1`.
- 🗑 Видалено 2 дублі Вадима з `public.users`: `Vadym Gryshyn` (vg@sneco.ua) + `Вадим Гришин` (vg@abrisart.com) — обидва без attached даних.
- 🔧 Tasks `checkAuth()` + HQ `loadCurrentUser()` + Dashboard bootstrap → всі використовують RPC alias-aware resolve.

### 🔧 TG / WEBHOOK FIXES
- 🔧 **`publication-status-changed` trigger split** на 2: INSERT завжди + UPDATE з `WHEN OLD.status IS DISTINCT FROM NEW.status` — Олександр отримував дубль notification при reload (UI робив full upsert з status у SET clause).
- 🔧 **`enqueue_team_task_notification` GRANT EXECUTE TO authenticated** — Давид не міг зберегти задачу, бо SECURITY DEFINER функція не мала GRANT для authenticated → 42501 permission denied. + preemptive grants на `publication_to_task_on_rework`, `claim_team_task_notifications`, `mark_team_task_notification_done`.

### 🔧 HQ — Various UX
- 🔧 Олександр overview-modal "+ ЗАВДАННЯ" дубль кнопки прибрана з filter-rad (повторно з'являлась через мою помилкову ін'єкцію + native кнопку).
- 🔧 Save FAB → `display: none` (native footer save достатньо, перекривав modal-body).
- 🔧 MutationObserver throttle 200ms (не bомбардуємо modal-body при кожній зміні DOM).
- 🔧 Креатив тайли video — додано circular `<div class="cs-video-play">▶</div>` overlay (CSS `::before` на `<video>` не працює). Hover red outline, клік → fullscreen player не зачіпає pub-edit modal.

### 🆕 TASKS — Багато UX правок Давида
- 🆕 Esc dirty-state guard з capture:true + stopImmediatePropagation (раніше Esc просто закривав модалку, втрачаючи правки).
- 🆕 FAB кнопка "+" справа знизу видима на ВСІХ viewports (раніше тільки mobile).
- 🆕 + ЗАВДАННЯ + 📋 ШАБЛОНИ всередині filter-rad як chips (раніше окремі buttons ламали верстку).
- 🆕 Tasks save використовує saveTask v3 у HTML з alert + console.log + `.select().single()` (старий saveTaskV2 у app-tasks-fixes.js крашив `toast` як bare identifier — disabled).
- 🆕 Watchers timeout/dedup. Comments timeout (8s) + try/catch — placeholder "Завантаження..." більше не висне вічно при network error.

### 📖 ONBOARDING
- 🆕 `/onboarding/DASHBOARD_DATA_FLOW.md` — повна архітектура data flow (4 джерела → MV → RPC → UI), вузькі місця, моніторинг.

---

## 03.06.2026 — BIG SPRINT day (HQ + Dashboard + Webhooks)

> 103 коміти (80 у team, 23 у dashboard-dreamcar). Всі P0/P1/P2 проблеми зачищені.

### 🛡 INFRA / WEBHOOKS (паралельна автономна система)
- 🆕 **Edge Function `webhook-dashboard-sendpulse`** (v1 ACTIVE) — прийом оплат напряму у Supabase, минаючи сервер Олександра. URL: `https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/webhook-dashboard-sendpulse`.
- 🆕 **Edge Function `webhook-dashboard-make-com`** (v1 ACTIVE) — fallback endpoint для legacy Make.com сценаріїв.
- 🆕 **`dashboard_webhook_health()` RPC** + `webhook_health_monitor` view — success_rate, avg processing_ms, error breakdown за 24h по source.
- 🆕 **Cron `webhook-health-alert`** (*/30 хв) — якщо success_rate <90% → автоматичний DM у TG.
- 🔧 **`webhooks_auto_cleanup_cron` fix** — колонка `received_at` не існує, переписано на `created_at`.
- 📖 Dual-write monitoring: legacy webhook (сервер Олександра) залишається активним 1 тиждень для звірки до cutover.
- 🚀 SendPulse webhook URL доданий у `Вебхуки об успешной оплате` (паралельно з legacy).

### 🆕 HQ — Board view + Next Action Pipeline + UX
- 🆕 **Board view (5-й режим календаря)** — kanban 4 колонки (script→design→editing→done) з drag-drop та transitionStatus. Файл: `hq/app-board-view.js` (225 LOC). Запит Давида.
- 🆕 **Next Action Pipeline** — "Зараз хід" блок у edit modal: emoji за kind (8 типів: script/video/design/copy/review/revise/approve/other) + Modal "Передати" з user picker, kind radio, note textarea. AFTER UPDATE trigger у БД + notify-tg v24 handler `handleNextActionChange`. Файл: `hq/app-next-action.js`. Запит Артема+Олександра.
- 🆕 **flatpickr заміна нативного datetime-local/date** — uk локаль, dark theme, minuteIncrement=5.
- 🆕 **+ Cell button у cal-day**, **DreamCar Life launch styling** (white bg), **Floating Save FAB**, **Cell click blocker**, **Optimistic re-render**, **візуальна різниця "+" vs "+N ще"**.
- 🆕 **Orphan Untitled drafts fix** — `createPub` → `upsertPub` тримає `_isNew`, persist лише при save з title.

### 🛡 HQ session bleed (CRITICAL)
- 🛡 **Session-bleed guard** — на login перевіряти `currentUserId` mismatch → wipe `localStorage`.

### 🔧 Compress pipeline fix
- 🔧 **app-drive.js INSERT compressed_status fix** — 3 відео >50MB (e-tron_1.mp4 376MB, 210MB, test.mp4 131MB) застрягли як `n/a`.

### 🆕 TASKS — 10 багів Давида + global UX
- 🆕 saveTaskV2, dirty-state guard, workflow buttons, Cmd+S, + НОВА ЗАДАЧА CTA, flatpickr, watchers, tags datalist, priority hint, postComment errors.

### ⚡ DASHBOARD — Analytics performance (60-90s → 783ms)
- ⚡ `dashboard_kpi_with_delta` v3 (153ms замість 2722ms), `mv_dashboard_utm_agg` (`#terms` 14s → 34ms), `dashboard_globals()` RPC sub-ms, DROP unused indexes.

### 🆕 DASHBOARD — BIG SPRINT (P1 + P2 повністю зачищені)
- 🆕 People Merge `#people`, Webhook Health KPI cards `#webhooks`, Cohort Retention `#cohort`, Source Distribution doughnut, Per-page selector, Projects CRUD у Settings, manual_costs by category, Deals 34 колонки + UTM free-text filters, Hourly heatmap, Saved Views ⭐ + Light theme ☀️ + Notifications tray, Extended KPI.

### 🔧 DASHBOARD — UX fixes
- 🔧 f-model "Усі проекти" reset, Ads Overview pagination 455K → 3.7M actual spend.

### 🔧 BUG FIX — notify-tg duplicate
- 🔧 `AFTER UPDATE OF status` замість generic `AFTER UPDATE`.

### 🆕 NEXT ACTION PIPELINE (DB)
- 🆕 SQL: 5 нових колонок у `publications` + AFTER UPDATE TRIGGER + `handleNextActionChange` у `notify-tg` v24.

### 🛡 SECURITY / CLEANUP
- 🛡 DROP unused indexes, redundant single-col indexes.

### 📖 ONBOARDING / AUDITS
- 📖 `DASHBOARD_PARITY_AUDIT_2026-06-03.md` (80% parity, Finance gap).

### 👤 TEAM NAME FIX (HARD RULE)
- 📖 У команді — Давид (David Gennadievich, COO). Не плутати з Daniel / Денис / Даніл.

---

## 02.06.2026 — вечір (audit fixes)

### 🛡 SECURITY + INFRA
- 🛡 TG_BOT_TOKEN видалено з hq/config.js. REVOKE SELECT на MVs. dashboard_webhooks видалено з Realtime publication.
- 🔧 webhooks_auto_cleanup_cron зареєстровано (запобігає 701MB IO storm).

### 🔧 HQ FIXES
- 🔧 SW killer видалено. app-analytics-v2.js (dead code) видалено. app-no-hashtags.js: setInterval → MutationObserver. z-index fix.

### 🔧 DASHBOARD FIXES
- 🔧 Kyiv timezone helpers. renderAnalytics CSS. live-badge id. Filter selects auto-rerender. fetchDealsRange secondary order.

### 🔧 TASKS FIXES
- 🔧 Prefs hour-selects (template literals у static HTML не виконувались). status='blocked' enum.

### 🎨 BRAND BOOK FIXES (legal)
- 🛡 NEVER-слова прибрано. PII redaction (ФОП + ІПН).

### 📖 ONBOARDING
- 🆕 [dashboard.html](dashboard.html) — НОВА сторінка онбордингу для Dashboard.
- 📖 CHANGELOG формат: ISO → DD.MM.YYYY.

---

## 02.06.2026

### 📊 Dashboard real-time + повна перебудова (dashboard.dreamcar.ua)
**Завдання:** перевести dashboard з годинного ETL на real-time, виправити проекти, додати best-in-class Analytics, інтегрувати Facebook Ads замість Make.com.

#### ⚡ Real-time data flow
- 🆕 ETL cron 1 год → 5 хв. Supabase Realtime увімкнено на dashboard_deals/webhooks/ads_data. Composite indexes. Frontend WebSocket subscription з debounced auto-reload. LIVE badge у топбарі.

#### 🚀 FB Ads ETL замість Make.com
- 🆕 `etl/sync_fb_ads.py` (Python). `.github/workflows/fb-ads-sync.yml` cron `*/15`. System User `Volvo_Dashboard_API`. Backfill 02.04.2025 → 02.06.2026: 7,131 ad rows, 3.46M UAH spend, 25M impressions, 387K clicks, 78K conversions. Економія $9-29/міс на Make.com.

#### 🏎️ Projects з legacy (7 проектів)
- 🆕 dashboard_projects table + RPC dashboard_projects_with_stats + mv_dashboard_projects_stats (3 мс замість 19,000 мс). 7 проектів: Архів-до-VOLVO / VOLVO XC90 / AUDI Q7 / BMW 330E HYBRID / MERCEDES GLE COUPE / BMW X5 HYBRID / AUDI E-TRON.

#### ⚡ Performance RPC layer (50-100× speedup)
- 🆕 dashboard_kpi_summary/with_delta, agg_deals, traffic_type_summary, daily/hourly_series. Mercedes GLE Тип трафіка: 30-60s → <500ms.

#### 🎯 Data-driven paid/organic classification
- 🆕 mv_paid_signatures MV + is_paid_deal() function. Реальна частка платних: 17-32% (раніше 50/50 хибне).

#### 📈 Аналітика повністю перебудована (best-in-class)
- 🆕 KPI cards з delta, погодинний trend, воронка, paid/organic doughnut, Топ-5 каналів, Топ-10 кампаній, Топ-10 джерел.

#### 🏎️ Нова сторінка "Проекти"
- 🆕 7 KPI cards, Bar charts, Full-table 7 проектів з lifetime stats.

### 🛡 Supabase IO storm — emergency cleanup
- 🆕 TRUNCATE dashboard_webhooks (701 MB → 40 kB). Auto-cleanup cron. statement_timeout: anon 8s → 120s.

### 🔧 HQ session bleed fix
- 🔧 SW killer key bumped.

### 🆕 HQ work_status (статус виконання)
- 🆕 publications.work_status (script/design/editing/done). Calendar emoji chips. Sidebar filter. Board view sort.

### 🗑 Cleanup
- 🗑 dreamcar-finance проект (INACTIVE з 27.03.2026). 81 MB local звільнено.

### 📋 Активні Supabase проєкти на DreamCar org (02.06.2026):
- ✅ dreamcar-hq (`wotghlaehnvxyeacznvv`) — main production, 342 MB
- ✅ barpi-hq (`zrcqmwlpsggiqgipvxhv`) — мігрує на Cloudflare D1

---

## 30.05.2026 — SendPulse phone export
- 🆕 50 358 унікальних UA + 932 intl + 201 invalid + 51 296 with context (з 592k raw записів).
- 🆕 SendPulse MCP підключено. READ-ONLY rule у memory.

## 29.05.2026 — BATCH COMPRESS DONE (39/39 stuck pending очищено)
- 🆕 Client-side compression v3 SDK-only. hq/compress-batch-v2.html. hq/app-client-compress.js. SW v14.

## 28.05.2026 — tg-ai-router Edge Function + Wave 4
- 🆕 tg-ai-router create. Mobile UX rebuild. Global search ⌘K. Daily Health Audit.

## 27.05.2026 — Overview Modal, Analytics V3, Tasks Analytics
- 🆕 HQ↔Tasks integration. /audit команда. Cmd+K global search. IndexedDB offline cache.

## 25.05.2026 і раніше
### Compress Pipeline (legacy)
- 🗑 R2 + GH Actions worker — замінено client-side compression 2026-05-29.

### TG Autoposting / HQ Workflow / HQ UX / Tasks v3 / Brand Book / Infrastructure
- 🆕 Усі базові фічі продуктів (див. історичну версію CHANGELOG).

---

## Як оновлювати цей файл

1. Кожна нова фіча / fix / deploy — додати рядок у поточну дату
2. Якщо це NEW день — створити новий `## DD.MM.YYYY` блок зверху
3. Групувати під підзаголовки систем
4. Емодзі обов'язково (🆕 / 🔧 / 🛡 / ⚡ / 🚀 / 📖 / 🗑)

**Це джерело правди для команди.** Хочеш знати що нового — почни тут.

## Дві версії онбордингу

- **`/onboarding.html`** — USER-FACING. Універсальний онбординг для всіх членів команди.
- **`/onboarding/*`** — DEV-ONLY. Тут технічні деталі. Закрито auth-guard для ceo/coo/lead.
