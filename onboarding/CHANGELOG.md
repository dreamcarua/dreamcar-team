# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## DD.MM.YYYY` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 07.06.2026 — Edit modal attachments + TG attachment debug

### 🆕 Tasks edit modal
- 🆕 **Прикріплення прямо у редагуванні** — у edit-формі задачі додано блок ПРИКРІПЛЕННЯ перед чек-листом: drag-and-drop файлу прямо у вікно, кнопка 📎 Прикріпити, видалення (×) кожного. Раніше було тільки у read-only overview, тепер при створенні/редагуванні теж.
- 🔧 `state.editAttachments` — окремий буфер під edit form, зберігається у `team_tasks.attachments` при Save.

### 🔧 TG bot proposal
- 🔧 **Показ `📎 Прикріплено: N файлів`** у proposal text — раніше не було видно чи AI побачив фото.
- 🔧 **Debug-логи у `downloadTgAttachments`** — додав `console.log` на кожному кроці (items detected → getFile → bytes downloaded → upload key → SUCCESS url) щоб діагностувати чому Storage bucket `tg-attachments` порожній попри 5 спроб з фото.
- 🔧 Перехід з `blob()` на `arrayBuffer()` + явний `contentType` per-extension — стабільніший upload у Supabase Storage.

---

## 07.06.2026 — Production Readiness Audit (3 ітерації × 4 агенти)

### 🛡 Security fixes (P0 з audit iter 1)
- 🛡 **`team_tasks_update_member` RLS** — раніше будь-який authenticated user міг UPDATE будь-яку задачу (включно зі soft-delete). Тепер обмежено до: creator OR assignee OR watcher OR ceo/coo/lead.
- 🛡 **`checkout_events.ce_insert_service`** — `with_check=true` дозволяв anon-ключу INSERT платіжні події з фронта (обходячи backend). Тепер `auth.role()='service_role'` only.
- 🛡 **`retention_message_history.rmh_insert`** — `with_check=true` для public → anon міг підробити approve-historу. Тепер service_role OR authenticated user only.
- 🛡 **`dashboard_deals`/`dashboard_ads_data`/`dashboard_manual_costs`/`dashboard_settings`/`dashboard_webhooks` SELECT** — раніше designer/member бачили клієнтські платежі. Тепер ceo/coo/lead only.
- 🛡 **`dashboard_people_mapping` INSERT/UPDATE/DELETE** — будь-хто міг переписати mapping людей. Тепер ceo/coo/lead only.
- 🛡 **8 SECURITY DEFINER функцій без `SET search_path`** — search-path hijack risk. Додав `SET search_path = public, pg_temp` для: schedule_publication_verify, tg_proposed_tasks_expire, trg_publications_schedule_verify, trg_publications_unschedule_verify, trg_pub_platforms_reschedule_verify, trg_publications_schedule_verify_for, safe_unschedule, verify_pub_job_name.
- 🛡 **`ALLOW_DEMO_FALLBACK: true → false`** у `hq/config.js` — у проді demo-режим без логіну = session leak risk.
- 🛡 **GitHub branch protection** увімкнено на main для `dreamcar-team`, `dreamcar-dashboard`, `brand-book` (allow_force_pushes=false, allow_deletions=false).

### 🚀 Performance fixes
- 🚀 **Cron jobs offset** для `*/5` (4 jobs) і `*/15` (3 MV-refreshes) — раніше всі стартували одночасно на `:00,:15,:30,:45` створюючи 80+ сек одночасного DB load. Тепер розкидано: mv-utm на `:02,:17,:32,:47`, mv-paid-signatures на `:05,:20,:35,:50`, mv-projects-stats на `:08,:23,:38,:53`, autopost-tg-enqueue на `:01-:56/5`, retention-scheduler на `:02-:57/5`, mv-globals на `:12`.
- 🚀 **`mv_dashboard_globals` unique index** + `REFRESH CONCURRENTLY` — раніше блокувало view ~30 сек/год під час hourly refresh.
- 🚀 **DROP 3 unused indexes** (idx_dashboard_deals_campaign_paid, idx_dashboard_ads_campaign, idx_pubs_search) — 880KB+ на найбільшій таблиці, idx_scan=0.
- 🚀 **`cron-reminders` schedule** з щогодини → */15 хв — забезпечує реальні T+10 нагадування (раніше lag до 60 хв).

### 🔧 Integration & reliability fixes (audit iter 2)
- 🔧 **`publication_approved_to_task`** — раніше assignee=created_by (автор). Тепер шукає responsible, fallback на автора. Назва задачі "🚀 Опублікувати: <title>".
- 🔧 **`publications_check_platforms_before_status` trigger** — warning у логи якщо pub без platforms транзитує у review/approved/published. Не блокує (щоб не зламати existing flow), але видно у моніторингу.
- 🔧 **2 publications зі status='published' без verified_at** — виправлено вручну (verified_at=updated_at, verified_status='ok_legacy').
- 🔧 **`track-checkout` v2** — `verify_jwt: true → false`. Anon tracker client з браузера не міг передавати service_role JWT → INSERT падав з 401. Тепер працює.
- 🔧 **`tg_processed_updates` table** — bigint PK для idempotency tg-webhook (TG retry-ить 1 update за 60s, дубль callback ламав approve). Cleanup cron daily на 03:00.
- 🛡 **DROP старого тригера `trg_team_tasks_notify`** (з audit iter 1 ще раніше) — дублював notify-tg fanout, assignee отримував DM 2 рази.
- 🧹 **6 stale verify_pub_* cron jobs** — cleanup (jobs для вже-verified/deleted/published pubs).

---

## 06.06.2026 (вечір) — Universal TG notify + Modal/Tables fixes + HQ recovery

### 🚀 TG notify v10 — універсальна нотифікація ВСІМ stakeholders
- 🚀 **Edge fn `notify-tg` v26→v10 (verify_jwt=false)** — підтримка 3 entities: `publication` (SMM), `retention_message` (РЕТЕНШН), `team_task` (TASKS). Payload format `{entity, id, event, status, old_status}`.
- 🆕 **На review → DM ВСІМ**: approvers + responsibles + author (deduped). Group chat `-1003933841573` теж отримує. Раніше DM йшов тільки approvers — Олександр і Артем не отримували бо тільки responsibles.
- 🆕 **Тригери у БД**: `publications_notify_with_dedup()` (оновлений payload), `retention_messages_notify()` (новий), `team_tasks_notify()` (новий — assignee + author + watchers на INSERT/REASSIGN/STATUS).
- 🔧 **DROP старого тригера** `trg_team_tasks_notify` (дублював через стару чергу — задвоєний DM).
- 🆕 **tg-webhook v27**: новий `rmappr:<msgId>:y|n` callback handler для retention approve flow (✓ Погодити / ↩ Повернути у TG для розсилок).

### 🔧 Modal overlap fix (cross-system)
- 🔧 **`brand.dreamcar.ua/assets/global-header.js`** додано CSS override: `.modal-backdrop / .modal-overlay / .dialog-overlay { z-index:10000 !important; padding-top: var(--dc-header-h)+12px }`. Глобал-header (z=999) більше не перекриває модальні вікна у жодній системі.
- 🔧 **SMM `hq/index.html`** modal-backdrop явно піднято до z=10000 + padding-top 68px (fallback якщо global-header не завантажиться).

### 🔧 Compact tables (Dashboard)
- 🔧 **`dashboard.dreamcar.ua` головний** — padding td/th `10px 12px → 7px 10px`, font-size `13px → 12.5px`, line-height 1.35. **Заголовок числових колонок right-aligned** (раніше left → великий gap зі числами справа). У `renderTable()` тепер class `num/amount/mono` копіюється з col у `<th>`.
- 🔧 **`upsell-ab/`** compare-table padding `14px 8px → 8px 10px`, font 12.5px, num cells right-aligned.

### 🔧 SMM modal: повернув кнопку 💾 Зберегти
- 🔧 У `hq/index.html` була застаріла inline копія `renderCardWorkflowButtons` без кнопки. App-views.js версія мала кнопку, але inline-копія її перевизначала. Видалив дубль повністю (1872 рядки legacy SPA коду, тепер працює через app-core.js + app-views.js modules).

### 🔧 Upsell A/B/C українською (HARD RULE)
- 🔧 `upsell-ab/index.html`: `<html lang="ru">` → `lang="uk"`, `'дней'` → `'днів'`. Funnel logic переписана для control варіанту (без upsell_window_1 step). Динамічні фільтри Device/UTM source/Tariff підтягуються з реальних `checkout_events` (раніше hardcoded Bronze/Gold).

### 🛡 P0 HQ recovery
- 🛡 **Git merge conflict markers у `hq/index.html`** — рядки `<<<<<<< Updated upstream / ======= / >>>>>>>` у `<head>` + у `</body>` блоці. SyntaxError → HQ повністю мертвий. Виправлено.
- 🛡 **Edge fn `retention-scheduler` v2 (verify_jwt=false)** — cron шле без JWT auth, попередньо повертала 401 кожні 5 хв (логи pg_net).

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
- 🔧 **Layout fix (вечір)** — прибрав `body padding-top:60px` + `topbar position:sticky;top:60px` зі всіх систем (HQ/Tasks/Projects/Retention). Global-header.js сам керує padding-top. Прибрав з sidebar SMM "Ретеншн ↗" + "Проєкти ↗" (дублі global header). Прибрав з Projects/Retention topbar cross-links на інші системи. Додав корисні дії: `+ НОВА · КАЛЕНДАР · ПОГОДЖЕННЯ · АНАЛІТИКА · НАЛАШТУВАННЯ` у Retention, `+ НОВИЙ · KANBAN · СПИСОК` у Projects. Cache-bust `?v=20260606b` на global-header.js.
- 🛡 **P0 Session leak fix** — HQ index.html мав hardcoded `<div id='roleName'>Вадим</div><div id='roleTag'>CEO</div>`. До завантаження юзера всі бачили 'Вадим CEO' на ~0.5 сек. Замінив на '…' placeholder. Додав CSS `visibility:hidden` до завантаження + `<meta no-cache/no-store>` на HQ/Tasks/Projects/Retention щоб browser disk cache не залипав.
- 🆕 **SMM modal: повернув кнопку 💾 Зберегти** — Олександр feedback: звичний UX. Force-flush autosave, залишає модал відкритим, показує toast.
- 🆕 **РЕТЕНШН календар — повний parity з SMM** — 5 views (Місяць / Тиждень / День / Список / Дошка), навігація ← / → / СЬОГОДНІ, search box, фільтри каналів (toggle), клік на день у Місяці/Тижні → нова розсилка з prefilled датою. Динамічний label "червень 2026 р." / "10 чер — 16 чер 2026" / "понеділок · 06 червня 2026".
- 🔧 **Dashboard timezone bug P0** — `ymd()` функція використовувала `setHours(0,0,0,0)+toISOString().slice(0,10)`. У CET/CEST (UTC+1/+2) `06.06 00:00 LOCAL` = `05.06 22:00 UTC` → slice → 05.06. "Сьогодні" показував вчорашню дату. Fix: local-форматування `getFullYear/Month/Date`.
- 🔧 **Dashboard projects dropdown** — `fetchProjectsList()` тягнув з `dashboard_settings.value` (hardcoded список без "IPHONE 17 PRO MAX"). Тепер merge live distinct projects з `dashboard_deals` (90 днів) + settings. Нові проекти підхопляться автоматично.

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
