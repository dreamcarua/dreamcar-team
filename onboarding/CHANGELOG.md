# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## DD.MM.YYYY` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 09.06.2026 — Quick-status chip-row + Onboarding alias-aware

### 🆕 Quick-status chip-row для CEO/COO (#194 — Davyd request)
- 🆕 **Tasks / SMM / Retention** — компактний рядок chip-кнопок у деталях задачі/публікації/розсилки. Один клік = миттєвий перехід у будь-який статус без submit form. Тільки `ceo`/`coo`; решта ролей — standard step-by-step flow.
- 🆕 **Tasks** 5 статусів: 📥 Inbox / ⚙ Doing / 👀 Review / 🚧 Blocked / ✅ Done. У `openOverview` action area.
- 🆕 **SMM** 6 статусів: 📝 Draft / ▶ In Work / 👀 Review / ✅ Approved / 🚀 Published / ↩ Rework. Над `ov-foot` у publication overview, реюзає `transitionStatus()`.
- 🆕 **Retention** 9 статусів: Draft / Review / Approved / Scheduled / Sending / Sent / Failed / Rework / Archived. У message modal, повний enum coverage.
- 🚀 Cache bust `retention/app-retention.js` v=20260608d → v=20260609a. SMM/Tasks live після `17a8e34`.
- 📖 Commits: `29c81c8c` (SMM), `912e427f` (Retention CSS), `ee96c936` (Retention JS), `1724970..17a8e34` (Tasks).

### 🛡 #199 P0 Onboarding кнопки fix (Davyd report)
**Корінь #1 — 3 RLS policies на `users` UPDATE не alias-aware:**
- 🛡 `users_update_own_onboarding`, `users_update_own_tg`, `users: update by CEO/COO or self` — переписав з `auth_id = auth.uid()` на `current_user_id() = id` (alias-aware helper, той самий клас бага що #189/#192).
- 🛡 **Хто страждав:** Вадим (CEO з aliases `vg@sneco.ua` + `dreamcarua@gmail.com`) — будь-який UPDATE на власний `users` record falsь → `markStep` silently fail → кнопки онбордингу "не реагували".

**Корінь #2 — `resolve_user_by_auth` RPC повертала subset колонок:**
- 🛡 DROP + CREATE з додаванням `onboarding_steps` + `onboarding_completed_at` до returned TABLE schema. Стара версія повертала тільки 7 колонок (`id, name, email, role, auth_id, tg_chat_id, is_active`).
- 🛡 **Це бомба часу:** frontend `state.publicUser.onboarding_steps = undefined` → онбординг рендерив усі steps як not-done → перший клік `markStep('workflow')` робив `stored={workflow:true}` → UPDATE **перетирав** Давидові 8 існуючих keys!
- 📖 HQ онбординг працював через workaround `hq/app-user-fields-fix.js` (окремий SELECT). Tasks/Retention/Projects того workaround не мали → universal bug. Мій fix у RPC робить workaround непотрібним.
- 🚀 Migrations `users_update_policies_alias_aware_199`, `resolve_user_by_auth_include_onboarding_199_v2`.

### 📖 Documentation
- 📖 Створено feedback memory про pitfall `resolve_user_by_auth` subset + JSON-spread overwrite (`auto-memory/feedback_*`).

---

## 09.06.2026 (ранок) — #192/#193 P0 PROD: Dashboard 0 угод + ETL misclassification

### 🛡 #192 Dashboard 0 угод (RLS alias-aware, друга хвиля)
- 🛡 **10 policies на dashboard_* + team_tasks** переписано на `current_user_has_role()` / `current_user_id()`. Перша хвиля (#189) фіксила helpers, але самi policies на `dashboard_deals`, `dashboard_ads_data`, `dashboard_manual_costs`, `dashboard_settings`, `dashboard_utm_mapping`, `dashboard_webhooks`, `dashboard_people_mapping` (×3), `team_tasks` (update_member) ще мали прямий `auth_id=auth.uid()`. Вадим бачив 0 рядків з усього дашборду.

### 🔧 #193 ETL deal_project misclassification (1094 deals)
- 🔧 **Backfill 1094 misclassified deals:** 744 IPHONE→AUDI E-TRON, 320 MOTO→AUDI E-TRON, 30 IPHONE→MOTORCYCLE. ETL upstream (Make.com) для `event_type='new'` (pending) ставив `deal_project='AUDI E-TRON'` як default fallback замість парсити `deal_name` (`DCI-iphone-*`, `DCI-moto-*`).
- 🔧 **BEFORE INSERT/UPDATE trigger `tg_deals_normalize_project`** — парсить `raw_payload->>'deal_name'` на DCI-prefix і нормалізує `project` атомарно у БД. ILIKE замість regex `\b` (який у Postgres не word boundary — повертає false).
- 🔧 **Funnel semantic fix (#191):** Воронка 2-bar → 3-bar (Замовлення / У обробці / Оплачено). UI labels: "Ліди"→"Замовлення", "Конверсія"→"Success rate" + threshold 5%→70%.

---

## 08.06.2026 (вечір) — #192 P0 PROD Dashboard RLS alias-aware (перша хвиля)

### 🛡 RLS policies — alias-aware migration
- 🛡 **10 policies переписано на `current_user_has_role()` / `current_user_id()`** (alias-aware helper, fix #189). Стара перевірка `users.auth_id = auth.uid()` НЕ враховувала `user_auth_aliases` UNION → Вадим залогінений через alias `dreamcarua@gmail.com` отримував 0 рядків з `dashboard_deals`/`dashboard_ads_data` → 0 угод по всьому дашборду на 08.06 (хоча в БД 883 угоди / 173,928₴).
- 🛡 Зачеплені таблиці: `dashboard_deals`, `dashboard_ads_data`, `dashboard_manual_costs`, `dashboard_settings`, `dashboard_utm_mapping`, `dashboard_webhooks`, `dashboard_people_mapping` (SELECT+UPDATE+DELETE), `team_tasks` (UPDATE — додатково через `current_user_id()` для assignee/creator/watchers).
- 🚀 Migration `rls_alias_aware_dashboard_and_others_192` + `NOTIFY pgrst, 'reload schema'`.

---

## 08.06.2026 — Dashboard 3-round audit & deep fixes (147+ tasks)

### Round 1 (P0 audit fixes)
- 🔧 **`aggViaRPC` skip project_values для UTM-полів** — Кампанії/Виконавець/Джерела/Оголошення/Контент проектний фільтр обнуляв revenue (HUMMER не має deals → 170+ реальних лідів = 0₴). Тепер UTM-аналітика крос-проектна. `973d7cc`.
- 🔧 **`_rpcParams` захист від date inversion** — Moto (07-15.06) + "Вчора" (06.06) → `fromDate=07.06, toDate=06.06` → RPC ігнорувала і повертала 3803 (всі деали). Тепер `from>to` → trivial `1900-01-01..1900-01-01`. `01fd0d3`.
- 🔧 **`kyivOffset()` fallback `+02:00`** — у edge case жовтня могло повертати `undefined` → `T00:00:00undefined` ламав SQL. `8c30cdb`.
- 🔧 **Wrong selector `#date-preset` → `#f-date-range`** — handler змінення проекту мав опечатку → currentPreset завжди = 'today'. `8c30cdb`.
- 🔧 **Duplicate RPC overloads** — DROP 3-arg версій `kpi_summary`, `traffic_type_summary`, `daily_series`, `hourly_series`. Усувало 42725 errors.
- 🚀 **`mv_paid_signatures` refresh** — застарілий 6 днів. CONCURRENTLY refresh.

### Round 2 (P0 + P1)
- 🔧 **Theme toggle defensive fix** — `e.stopPropagation()` + `preventDefault()`. `e7c3c1c`.
- 🔧 **ETL utm_term mapping** — додано CLUB UAH + CLUB USD + CLUB UAH TEST → артем. Backfill 1349 ad rows. Реал breakdown: vadym 87% / artem 7% / vira 6%.
- 🔧 **`adsBaseRange()` helper** — 5 ad-spend queries у frontend тепер враховують перетин period↔project. `dcc48dc`.
- 🔧 **`ROUTE_ALIASES`** — `#traffic→medium, #ads→terms, #creative→content, #executor→terms` bookmark friendly URLs. `dcc48dc`.
- 🔧 **Dropdown cleanup** — `dealProjSet` filter garbage projects (`🔹`, variation selectors); tariff filter "Ручна видача x10/x8". `22966e8`.

### Round 3 (P1 + P2)
- 🔧 **`p_traffic_type` у 7 RPCs** — `kpi_summary`, `kpi_with_delta`, `daily_series`, `hourly_series`, `hourly_heatmap`, `extended_kpi`, `traffic_type_summary`. `_rpcParams` тепер автоматично передає. `5074401`.
- 🔧 **`syncFilterBarFromState`** — повна синхронізація 10 UI controls (granularity / status / customer_type / funnel_type / tariff / pay_provider / traffic_type / source_filter / project / dates).
- 🔧 **Modal click handler guard** — skip-ає `.tb-btn, .nav-item, .filter-bar, .topbar`.
- 🔧 **CSS body scroll wheel** — explicit `overflow-y:auto` + `min-height:100vh`.
- 🔧 **CSS sidebar clipped** — `.content min-width:0 + overflow-x:hidden`.
- 🔧 **`debouncedReload` race guard** — `__lastUserActivity` tracking; postpone якщо user активний < 2s.
- 🔧 **UTM input Enter flush** — миттєво применяє filter.
- 🔧 **`f-project` label clarified** — "Звузити по project (advanced)" + tooltip.

### Round 4 (final hardening)
- 🔧 **`dashboard_hourly_heatmap`** — додано всі 4 фільтри (customer_type, tariff, pay_provider, traffic_type) для full parity.

### Funnel semantic fix (#191)
- 🔧 **Воронка 2-bar → 3-bar (Замовлення / У обробці / Оплачено)** + перейменування "Ліди"→"Замовлення", "Конверсія"→"Success rate". `dashboard_deals` містить тільки checkout records, не маркетингові ліди — UI labels тепер це чесно показують.

### TG/notify
- 🚀 **Auto-close team_tasks при publication.status='published'** — trigger `publication_auto_close_team_task` + backfill. Усуває фейкові "🔥 Завдання прострочено".

---

## 07.06.2026 — Edit modal attachments + TG attachment debug

### 🆕 Tasks edit modal
- 🆕 **Прикріплення прямо у редагуванні** — у edit-формі задачі додано блок ПРИКРІПЛЕННЯ перед чек-листом: drag-and-drop файлу прямо у вікно, кнопка 📎 Прикріпити, видалення (×) кожного.
- 🔧 `state.editAttachments` — окремий буфер під edit form.

### 🔧 TG bot proposal
- 🔧 **Показ `📎 Прикріплено: N файлів`** у proposal text.
- 🔧 **Debug-логи у `downloadTgAttachments`**.
- 🔧 Перехід з `blob()` на `arrayBuffer()`.

---

## 07.06.2026 — Production Readiness Audit (3 ітерації × 4 агенти)

### 🛡 Security fixes (P0 з audit iter 1)
- 🛡 **`team_tasks_update_member` RLS** — обмежено до creator/assignee/watcher/ceo/coo/lead.
- 🛡 **`checkout_events.ce_insert_service`** — `auth.role()='service_role'` only.
- 🛡 **`retention_message_history.rmh_insert`** — service_role OR authenticated only.
- 🛡 **`dashboard_*` SELECT** — обмежено до ceo/coo/lead.
- 🛡 **`dashboard_people_mapping` INSERT/UPDATE/DELETE** — ceo/coo/lead only.
- 🛡 **8 SECURITY DEFINER функцій без `SET search_path`** — додав `SET search_path = public, pg_temp`.
- 🛡 **`ALLOW_DEMO_FALLBACK: true → false`**.
- 🛡 **GitHub branch protection** на main.

### 🚀 Performance fixes
- 🚀 **Cron jobs offset** для `*/5` (4 jobs) і `*/15` (3 MV-refreshes).
- 🚀 **`mv_dashboard_globals` unique index** + `REFRESH CONCURRENTLY`.
- 🚀 **DROP 3 unused indexes**.
- 🚀 **`cron-reminders` schedule** з щогодини → */15 хв.

### 🔧 Integration & reliability fixes
- 🔧 **`publication_approved_to_task`** — assignee=responsible (fallback автор).
- 🔧 **`publications_check_platforms_before_status` trigger**.
- 🔧 **`track-checkout` v2** — `verify_jwt: true → false`.
- 🔧 **`tg_processed_updates` table** — bigint PK для idempotency.

---

## 06.06.2026 (вечір) — Universal TG notify + Modal/Tables fixes + HQ recovery

### 🚀 TG notify v10 — універсальна нотифікація ВСІМ stakeholders
- 🚀 **Edge fn `notify-tg` v26→v10** — підтримка 3 entities: `publication` / `retention_message` / `team_task`.
- 🆕 **На review → DM ВСІМ**: approvers + responsibles + author (deduped).
- 🆕 **Тригери у БД**: `publications_notify_with_dedup()`, `retention_messages_notify()`, `team_tasks_notify()`.

### 🔧 Modal overlap fix (cross-system)
- 🔧 **`brand.dreamcar.ua/assets/global-header.js`** CSS override: `.modal-backdrop { z-index:10000 !important }`.

### 🔧 Compact tables (Dashboard) + SMM modal save FAB
- 🔧 td/th padding tighter + right-aligned numeric. SMM modal save button restored.

### 🛡 P0 HQ recovery
- 🛡 **Git merge conflict markers у `hq/index.html`** — виправлено.
- 🛡 **Edge fn `retention-scheduler` v2 (verify_jwt=false)**.

---

## 06.06.2026 — РЕТЕНШН — нова система розсилок (Phase 1)

### 🆕 РЕТЕНШН — окремий стіл для Email/TG/Push/SMS/Viber розсилок
- 🆕 **Нова сторінка `/retention/`** на team.dreamcar.ua/retention/.
- 🆕 **DB schema**: `retention_messages` + approvers/responsibles/history + 6 каналів + 9 статусів.
- 🆕 **Approval flow як у SMM**.
- 🆕 **3 views**: List, Board, Calendar.
- 🆕 **Audience filter**: тариф + статус.
- 🆕 **Edge function `retention-scheduler`** cron `*/5`.
- 🆕 **TG broadcast** автоматично.
- 🆕 **Global header tab `РЕТЕНШН`**.

### 🔧 Dashboard fixes
- 🔧 **Dashboard timezone bug P0** — `ymd()` local-форматування.
- 🔧 **Dashboard projects dropdown** — merge live distinct projects + settings.

---

## 05.06.2026 — TASKS UX upgrade + HQ throttle + Theme

### 🆕 TASKS — Корзина 30 днів + UI повна перебудова
- 🆕 **Soft-delete + Корзина 30 днів** на `team_tasks`.
- 🆕 **3-кнопковий custom modal** при delete.
- 🆕 **Календарний вид** з drag-drop priority sort.

### 🆕 HQ — Корзина 30 днів (як Tasks)
- 🆕 **`hq/app-trash.js`** ~240 LOC.

### 🎨 UNIFIED THEME — light/dark на ВСІХ apps
- 🆕 **`hq/dc-theme.js` + `tasks/dc-theme.js`** — unified theme toggle.

### 🛡 HQ — TG notify deduplication
- 🆕 **`publications.last_tg_notify_at`** column + dedup trigger.

---

## 04.06.2026 — Dashboard rebuild + Auth aliases + 3 P0 fixes

### 🛡 DASHBOARD — Security + SSO
- 🛡 **Login gate з role check** — ceo/coo/lead only.
- 🛡 **REVOKE SELECT FROM anon** на 8 `dashboard_*` таблицях.
- 🆕 **SSO bridge HQ→Dashboard** через URL fragment.

### 🆕 AUTH — User aliases
- 🆕 **`user_auth_aliases`** + RPC `resolve_user_by_auth()`. Вадим: 3 email aliases.

### 🔧 TG / WEBHOOK FIXES
- 🔧 **`publication-status-changed` trigger split** на 2 INSERT + UPDATE.
- 🔧 **`enqueue_team_task_notification` GRANT EXECUTE TO authenticated**.

---

## 03.06.2026 — BIG SPRINT day (103 коміти)

### 🛡 INFRA / WEBHOOKS (паралельна автономна система)
- 🆕 **Edge Function `webhook-dashboard-sendpulse`**.
- 🆕 **Edge Function `webhook-dashboard-make-com`** fallback.
- 🆕 **`dashboard_webhook_health()` RPC** + `webhook_health_monitor`.
- 🆕 **Cron `webhook-health-alert`** (*/30 хв).

### 🆕 HQ — Board view + Next Action Pipeline
- 🆕 **Board view** kanban 4 колонки.
- 🆕 **Next Action Pipeline** — "Зараз хід" блок з 8 emoji kinds + Modal "Передати".

### ⚡ DASHBOARD — Analytics performance (60-90s → 783ms)
- ⚡ `dashboard_kpi_with_delta` v3 (153ms замість 2722ms).
- ⚡ `mv_dashboard_utm_agg` `#terms` 14s → 34ms.

### 🆕 DASHBOARD — BIG SPRINT
- 🆕 People Merge, Webhook Health KPI cards, Cohort Retention, Source Distribution, Per-page, Projects CRUD, manual_costs, 34-col Deals + UTM filters, Hourly heatmap, Saved Views + Light theme.

---

## 02.06.2026 — Dashboard real-time + повна перебудова

### ⚡ Real-time + FB Ads ETL
- 🆕 ETL cron 1 год → 5 хв. Supabase Realtime.
- 🆕 FB Ads ETL `sync_fb_ads.py` замість Make.com. Backfill 7,131 ad rows, 3.46M UAH.

### 🏎️ Projects + Performance + Analytics + Page "Проекти"
- 🆕 7 проектів. RPC layer (50-100× speedup).
- 🆕 `mv_paid_signatures` + `is_paid_deal()` — реальні 17-32% paid (раніше 50/50).
- 🆕 Аналітика перебудована: KPI delta, погодинний trend, воронка, doughnut.

### 🛡 Supabase IO storm cleanup
- 🆕 TRUNCATE dashboard_webhooks (701 MB → 40 kB).

---

## 30.05.2026 — SendPulse phone export
- 🆕 50 358 унікальних UA з 592k raw записів.

## 29.05.2026 — BATCH COMPRESS DONE (39/39)
- 🆕 Client-side compression v3 SDK-only.

## 28.05.2026 — tg-ai-router Edge Function + Wave 4

## 27.05.2026 — Overview Modal, Analytics V3, Tasks Analytics

## 25.05.2026 і раніше
### Compress Pipeline (legacy)
- 🗑 R2 + GH Actions worker — замінено client-side compression 2026-05-29.

### TG Autoposting / HQ Workflow / Tasks v3 / Brand Book / Infrastructure
- 🆕 Усі базові фічі продуктів.

---

## Як оновлювати цей файл

1. Кожна нова фіча / fix / deploy — додати рядок у поточну дату
2. Якщо це NEW день — створити новий `## DD.MM.YYYY` блок зверху
3. Групувати під підзаголовки систем
4. Емодзі обов'язково (🆕 / 🔧 / 🛡 / ⚡ / 🚀 / 📖 / 🗑)

**Це джерело правди для команди.** Хочеш знати що нового — почни тут.

## Дві версії онбордингу

- **`/onboarding.html`** — USER-FACING.
- **`/onboarding/*`** — DEV-ONLY. ceo/coo/lead.
