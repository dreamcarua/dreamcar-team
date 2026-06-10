# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## DD.MM.YYYY` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 10.06.2026 (ранок) — #296 SMM AI/Template buttons defensive binding

### 🔧 #296 SMM publication modal — кнопки `✨ AI` і `📋 З шаблону` не реагували на клік
- 🔧 **`hq/app-templates.js`** + **`hq/app-ai-copy.js`** — defensive binding:
  - Унікальні ID: `#hq_tpl_btn` / `#hq_ai_btn` (легко знайти у DOM/Inspector).
  - `bindTplHandler` / `bindAiHandler` — bind через `btn.onclick` **AND** `addEventListener('click', ...)` (двойна страховка).
  - MutationObserver re-inject перевіряє: якщо кнопка існує але `__hqTplBound`/`__hqAiBound` === undefined (handler null'd) — перевʼязує заново.
  - `console.log` на кожен click (debug у майбутньому).
  - **Ultimate fallback** — body-level delegated `click` listener (window.__hqTplDelegated / __hqAiDelegated), ловить кнопку через `closest()` навіть якщо native onclick десь обнулено. De-dupe 500ms.
- 🚀 Cache bust автомат через GH Action Cloudflare purge.

---

## 10.06.2026 (ранок) — #267 + #268 TG task notify v6 + Creator notifications

### 🆕 #267 TG task notify — формат з ID + Project + Duplicate detection
- 🆕 **`team-tasks-notify` v6** — кожне TG-повідомлення про задачу містить:
  - `<code>#abc12345</code>` — короткий 8-char task ID (для копіювання у код/коментарі)
  - Project emoji + назва (📱 iPhone 17 PRO MAX / 🏍 Мото / 🚗 BMW X5 Hybrid / 🛻 HUMMER / 🎬 DreamCar CONTENT) через lookup `public.projects`
  - **⚠ Можливий дубль** — fuzzy text similarity через `pg_trgm` (threshold 0.4, поріг 40% збігу заголовку з іншою відкритою задачею)
- 🆕 RPC `find_similar_open_task(p_task_id, p_title, p_threshold)` — повертає найбільш схожу не-done не-deleted задачу.
- 🛡 `CREATE EXTENSION pg_trgm WITH SCHEMA extensions` — для similarity().

### 🆕 #268 Постановник (creator) — TG нотифікації status/comment/done
**Раніше: creator (created_by) НЕ отримував жодної події.** Зараз:
- 🆕 **Trigger `team_tasks_notify_trigger`** оновлений — при `status_changed` додає `created_by` як recipient (якщо ≠ assignee і ≠ watcher і ≠ current_user_id).
- 🆕 **Окремий kind `creator_done`** — коли assignee закрив (status → done) і creator ≠ assignee: спецформат "🎉 Готово! Твою задачу виконано". Кнопка "👀 Відкрити задачу".
- 🆕 **Trigger `team_task_comments_notify_trigger`** оновлений — `created_by` як recipient для коментарів (з seen-dedupe щоб не дублювати з mention/watcher).
- 🆕 Edge fn `formatMessage` — префікс "**Постановнику:**" для `status_changed` / `comment` якщо recipient = created_by (видно що це твоя задача, не власна робота).
- 🚀 Migration: `creator_notifications_20260610` + `creator_notifications_triggers_20260610` + `creator_comment_notifications_20260610` + `enable_pg_trgm_for_dup_check`.
- 📖 ENUM `team_task_notify_kind` додано value `creator_done`.

### 📋 Backlog — Davyd проєктні правки (10.06.2026)
- 📖 **#269 BIG** — "Потребує перевірки" галочка при постановці + 2-stage done (verified_by_creator). DB: requires_review + verified_at/verified_by + UI signal "сіра+перекреслена" або "виділена очікує перевірки".
- 📖 **#270** — Архів змінити порядок: старе ліворуч, теперішнє центр, майбутнє праворуч.
- 📖 **#271 BIG** — `/regulations/` нова сторінка з регламентами/чек-листами (download).
- 📖 **#272 BIG** — `/news/` Новини/Анонси (план проекту, акції, звернення CEO).

---

## 10.06.2026 (ніч) — TG Autopost v2 (BIG #233) + AI ranok + SMM polish

### 🆕 #233 BIG TG Autopost v2 — instant + buttons + AI engage + analytics
**DB schema:**
- 🆕 10 нових колонок `publications.tg_*` (buttons jsonb, pin, silent, disable_preview, channel_id, test_log, countdown_until, message_id jsonb, published_channel_id, utm_campaign).
- 🆕 3 нові tables з RLS: `tg_post_analytics`, `tg_engagement_replies` (UNIQUE channel_id+orig_msg_id для dedup race), `tg_button_clicks`.
- 🆕 Function `tg_button_clicks_aggregate(uuid)` SQL-side aggregation.

**Instant trigger:**
- 🆕 `trg_publications_tg_instant_fire AFTER UPDATE OF status` → `pg_net.http_post(tg-post-send)` миттєво при `→ published`. Скасовано 5-хв cron lag.
- 🛡 `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` на `tg_autopost_instant_fire()` (security audit fix).

**Edge functions:**
- 🆕 **`tg-post-send` v2** — full publisher з: inline buttons (url/web_app/callback) з UTM auto-append, photo/video/sendMediaGroup album, pin/silent/disable_preview, exponential retry (30s/60s/120s/300s), idempotency check, countdown `{{countdown}}` placeholder, spoiler tags `<<<...>>>`, JWT auth для test=true (ceo/coo/lead).
- 🆕 **`tg-channel-engage` v2** — Claude Haiku 4.5 AI replies на коментарі. Brand voice post-filter (FORBIDDEN_WORDS regex для лотерея/розіграш/квиток/шанс — юридичний ризик). Atomic dedup-insert + UNIQUE constraint. TG webhook secret auth (`X-Telegram-Bot-Api-Secret-Token`). is_bot author skip.
- 🆕 **`tg-post-stats-sync` v2** — cron `*/30` синкає comments+clicks через `tg_button_clicks_aggregate` SQL. **НЕ пише views/reactions/forwards** (TG Bot API не дає — треба MTProto Telethon worker Phase 4).
- 🆕 **`tg-countdown-updater` v2** — cron `*/5` editMessageText/editMessageCaption (choice через has_media). "not modified" як success.

**SMM UI:**
- 🆕 Синя секція "✈️ Telegram автопост" у publication modal (тільки коли tg у platforms).
- 🆕 Inline buttons editor: add/edit/delete, 3 типи (URL/Web App/Callback), row indexing, validation (text 64 chars, https://, web_app URL pattern t.me/<bot>/<app>).
- 🆕 Чекбокси: 📌 Pin, 🔕 Silent, 🚫 Disable preview.
- 🆕 ⏰ Countdown datetime picker.
- 🆕 🧪 Тест у тестовий канал (-1003933841573) через JWT auth (НЕ hardcoded secret).
- 🆕 Підказки: spoiler/countdown/web_app/callback usage.

**3-agents post-implementation audit + P0 hardening:**
- 🛡 Idempotency check у `tg-post-send` (skip if `tg_message_id[channel]` вже існує) — fix duplicate send на network glitch retry.
- 🛡 JWT auth path для UI test (замість cron-secret hardcoded у frontend).
- 🛡 Brand voice post-filter у `tg-channel-engage` (юридичний ризик).
- 🛡 Прибрав `copyMessage`+`deleteMessage` hack у stats-sync (писав 0 у views/reactions замість real data).
- 🛡 UNIQUE constraint `tg_engagement_replies (channel_id, original_message_id)` для dedup race.
- 🛡 NO hardcoded fallback CRON_SECRET у edge fns (throw on missing env).
- 🛡 Full pubId у callback_data (8-char prefix collision risk fix).
- 🚀 Cache bust `app-views.js?v=20260610b`.
- 📖 Документація `/onboarding/tg-autopost-v2-summary.md`.

### 🆕 #231 Daily AI analyst → 10:00 Київ за вчора
- 🚀 Pg_cron `daily-ai-analyst-1000kyiv-morning` (`0 7 * * *` UTC = 10:00 Київ) замінив старий 18:00.
- 🆕 Edge fn v4: `report_day = D-1` (вчора — повний день), `prev_day = D-2`, `week_ago_day = D-8`. Дані стабільні (опівніч закрилися).
- 📖 Header: "🌅 DreamCar Ранковий AI звіт — за {YYYY-MM-DD}".

### 🎨 #229b SMM Week view: ctype-badge зверху картки
- 🎨 Додав плашку типу контенту у `renderWeek` (.week-card з .wc-ctype-badge). Раніше було тільки у Month (.cal-card). Тепер скрізь де картка публікації — є badge "ПОСТ/REELS/STORY/VIDEO".

---

## 09.06.2026 (вечір) — AI Analyst екосистема (#210/#211/#212/#213) + Light theme + Video fixes

### 🆕 #210 Daily AI Analyst v1 → v2
- 🆕 **Edge fn `daily-ai-analyst` v2** — щодня 18:00 Київ (pg_cron `0 15 * * *`). Збирає deals/ads/upsell + (нове v2) team_tasks/publications/retention metrics + WoW (7-day comparison) + previous_state з `dashboard_settings.ai_analyst_last_state` для оцінки попередніх рекомендацій → Claude Sonnet 4.6 → HTML TG DM Вадиму. Зберігає нові recommendations як JSON у `ai_analyst_last_state` для оцінки наступного дня.
- 🆕 **System prompt guard:** SRM detected або p>0.1 → НЕ давати "лідера", чесно казати "рекомендація невалідна". Конкретика > вода, мінімум emoji (тільки 🔴 ⚠ ✅ 🎯 як секційні маркери).
- 🚀 Pg_cron `daily-ai-analyst-1800kyiv` (`0 15 * * *`).

### 🆕 #212 Weekly AI Analyst
- 🆕 **Edge fn `weekly-ai-analyst` v1** — щонеділі 19:00 Київ (pg_cron `0 16 * * 0`). Глибокий 7-day vs 7-day звіт.

### 🆕 #213 Anomaly Alerter
- 🆕 **Edge fn `anomaly-alerter` v1** — кожні 30 хв.

### 🎨 #218 BIG Світла тема — повна ревізія всіх 5 систем
- 🎨 Token-level overrides (--bg-*, --steel, --ash, --bone), inline color:var(--ash) → темніший, .sidebar text force.
- 🎨 #220/#221 — accent тексти (warning/amber/success/info) темніші для WCAG AA.

### 🎬 #225/#227/#228 Video creatives end-to-end
- 🎬 SMM modal preview, lightbox player, TG album з відео.
- 🎬 #225: notify-tg v11 — sendMediaGroup для photo+video album.

### 🛡 #222 P0 HQ login gate alias-aware (CEO dreamcarua@gmail.com)
### 🛡 #224 P0 Dashboard UTM tables 2x overcount (AT TIME ZONE bug)
### 🛡 #230 P0 RLS — ads_account_to_executor + tg_processed_updates

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

### 📖 Documentation
- 📖 Створено feedback memory про pitfall `resolve_user_by_auth` subset + JSON-spread overwrite (`auto-memory/feedback_*`).

---

## 09.06.2026 (ранок) — #192/#193 P0 PROD: Dashboard 0 угод + ETL misclassification

### 🛡 #192 Dashboard 0 угод (RLS alias-aware, друга хвиля)
- 🛡 **10 policies на dashboard_* + team_tasks** переписано на `current_user_has_role()` / `current_user_id()`.

### 🔧 #193 ETL deal_project misclassification (1094 deals)
- 🔧 **Backfill 1094 misclassified deals:** 744 IPHONE→AUDI E-TRON, 320 MOTO→AUDI E-TRON, 30 IPHONE→MOTORCYCLE.
- 🔧 **BEFORE INSERT/UPDATE trigger `tg_deals_normalize_project`** — парсить `raw_payload->>'deal_name'` на DCI-prefix.
- 🔧 **Funnel semantic fix (#191):** Воронка 2-bar → 3-bar (Замовлення / У обробці / Оплачено).

---

## 08.06.2026 (вечір) — #192 P0 PROD Dashboard RLS alias-aware (перша хвиля)

### 🛡 RLS policies — alias-aware migration
- 🛡 **10 policies переписано на `current_user_has_role()` / `current_user_id()`**.

---

## 08.06.2026 — Dashboard 3-round audit & deep fixes (147+ tasks)

### Rounds 1-4: aggViaRPC project_values, _rpcParams date inversion, kyivOffset fallback, duplicate RPC overloads, theme toggle, ETL utm_term mapping, adsBaseRange helper, ROUTE_ALIASES, dropdown cleanup, p_traffic_type у 7 RPCs, syncFilterBarFromState, Modal click guard, CSS scroll/sidebar, debouncedReload race, UTM input Enter, f-project label, hourly_heatmap, funnel 2→3 bars, Auto-close team_tasks при publication=published

---

## 07.06.2026 — Edit modal attachments + TG attachment debug + Production Readiness Audit (3 ітерації × 4 агенти)

---

## 06.06.2026 (вечір) — Universal TG notify v10 + Modal/Tables fixes + HQ recovery

---

## 06.06.2026 — РЕТЕНШН — нова система розсилок (Phase 1)

---

## 05.06.2026 — TASKS UX upgrade + HQ throttle + Theme

---

## 04.06.2026 — Dashboard rebuild + Auth aliases + 3 P0 fixes

---

## 03.06.2026 — BIG SPRINT day (103 коміти)

---

## 02.06.2026 — Dashboard real-time + повна перебудова

---

## 30.05.2026 — SendPulse phone export (50 358 унікальних UA)

## 29.05.2026 — BATCH COMPRESS DONE (39/39)

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
