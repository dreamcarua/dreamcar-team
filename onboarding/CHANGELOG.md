# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## DD.MM.YYYY` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 14.06.2026 — #395 Dashboard dropdown — дублі BMW X5 / AUDI E-TRON прибрані

### Dashboard
- 🔧 `public.launches.deal_aliases` був NULL для BMW X5 Hybrid #17 і AUDI E-TRON 2026 → frontend `loadProjects()` дедуп не ловив collision з `dashboard_projects.deal_project_values`. Dropdown показував по два записи на той самий проект.
- 🛡 UPDATE launches: BMW X5 Hybrid #17 → `['BMW X5 HYBRID','DreamCar AI']`, AUDI E-TRON 2026 → `['AUDI E-TRON']`.
- ✅ Verified у Chrome MCP: dropdown 12→10 опцій, BMW X5 і AUDI E-TRON по одному запису.

---

## 14.06.2026 — #394 Dashboard filter-bar fix (Pulse прибрано)

### Dashboard
- 🗑 Active Launch Pulse повністю прибрано з `app-dashboard-extras.js` — sticky pill row перекривав перший ряд фільтрів (Період / Проект / Статус / Новий-старий клієнт). Init() більше не викликає refreshPulse/injectPulseBar; cleanup старого DOM на завантаженні.
- ⚡ Cache bust: `app-dashboard-extras.js?v=20260603a` → `?v=20260614-pulse-removed`. Cloudflare кешував старий v=20260603a 4 години, тому правки positioning не доходили до браузерів.
- 🛡 Verified у Chrome MCP після push: pulseGone=true, filter-bar display:flex, height 153.5px, 9 видимих фільтрів. Commit 05b9cfd.

---

## 14.06.2026 — #393 BIG Financial system по проектах

🆕 **Нова сторінка `dashboard.dreamcar.ua/finance/`** з 4 табами:
- 📁 Категорії (CRUD з parent_id tree, sub-categories, icons/colors, archive)
- ⚙️ Fixed Monthly (overhead-витрати з valid_from/valid_to)
- 💸 Project Costs (per-launch витрати з vendor + invoice)
- 🏆 Запуски (редагування `prize_cost_uah` + дата + notes)

🛡 **DB schema:**
- `public.launches +prize_cost_uah +prize_purchased_at +prize_notes` (ALTER).
- `public.cost_categories` — справочник з 16 seed-записів (PRIZE, CONTENT_TEAM, INFRA_API, PARTNERS_LEGAL + 12 sub).
- `public.fixed_monthly_costs` — pro-rata розподіл по запусках за overlap_days.
- `public.project_costs` — per-launch з category_id + vendor + invoice.
- RLS: team read, ceo/coo/cfo write. Тригери touch_updated_at.

📊 **RPC v4** `dashboard_project_pnl()`:
Нові поля: `prize_cost`, `project_costs_total`, `fixed_allocated`, `total_cost`, **`true_net_profit`**, **`true_net_margin_pct`**, **`true_roi_pct`**, **`true_cac`**, `category_breakdown` (JSONB).

🏆 **Win-Analysis оновлено:**
- KPI: "Усі витрати" (Ads + Приз + Fixed + Project breakdown) + "TRUE Net Profit" (з margin %).
- P&L таблиця: +🏆 Приз +⚙️ Fixed +Project +Всі витрати +TRUE Net +Margin %+True CAC (16 колонок).

🔗 **NAV:** sidebar group "Стратегія" → Win-Analysis + 💰 Фінанси. Win-Analysis topbar має 💰 Фінанси link.

**Commit:** `d66fe1f` (3 files, +648/-31).
**Live:** dashboard.dreamcar.ua/finance/ + /win-analysis/ — HTTP/2 200.

---

## 14.06.2026 — #392 BIG AUDIT + Win-Analysis Hub (5 хвиль)

### Dashboard повний аудит та переосмислення

🆕 **Активний Launch Pulse** — sticky-pill row під topbar показує всі активні запуски (D-N counter, status dot, click → drill-down у Project filter). Auto-refresh 5хв + visibility cleanup. `app-dashboard-extras.js`.

🆕 **Win-Analysis Hub** (`dashboard.dreamcar.ua/win-analysis/`) — стратегічний CEO-екран:
- 5 hero KPI (Запуски / Revenue / Spend+Manual / Net Profit / Weighted avgROAS)
- 📊 ROAS bar chart top-12 + Revenue vs Spend stacked
- 🔮 Forecast (з warning про hockey-stick наївної екстраполяції)
- 📋 Sortable P&L таблиця: Name/Status/Дні/Ліди/Оплати/Conv/Rev/Spend/Manual/Profit/Margin/ROAS/CPA/AOV
- RPC `dashboard_project_pnl()` v3: paid_at-based revenue, UAH-only, word-boundary utm_campaign matching, elapsed_days vs days_duration, true_roi_pct, true_cac.

🛡 **Security P0 — RLS leak fix:** `public.launches` раніше була `auth.role()='authenticated'` → будь-який Google-login бачив business дані. Тепер `current_user_has_role(['ceo','coo','lead','member','designer'])`.

🛡 **Auth-guard SSO bridge:** `applySsoFromHash()` усередині check() — підключаючи `auth-guard.js` отримуєш повний захист + SSO в одному скрипті. Розгорнуто на `/upsell-ab/`, `/meta-analytics/`, `/win-analysis/`.

🔧 **Performance fixes:**
- Capture-phase global listeners → bubble (HARD RULE memory).
- UTM input debounce 350→600ms + onBlur + skip no-op.
- Realtime auto-reload → "+N нових" badge з manual click refresh (Soft reload тільки коли idle >60с).
- fetchLeadsCount retry on 503 + null fallback.
- meta-analytics hardcoded date → live Europe/Kyiv.
- upsell-ab/loadDynamicFilters: UTC → Europe/Kyiv day-aligned.
- Pulse setInterval visibility cleanup.

🧹 **Code health (–347 рядків):**
- Видалено dead CSS `assets/css/dashboard.css` (331 рядків не лінкувалися ніде).
- Видалено `MAIN_PROJECTS` (dead після #98), `aggregateByMonth` (dead), `if (false && byProj7)` блок.
- Helper `renderError(c, e)` замінив 8 копій catch-блоку.

✨ **Cross-page consistency:**
- Filter state propagation: sessionStorage `dc-active-filters` з TTL 1h. Sub-pages читають через `window.__dcInheritedFilters`.
- Saved Views (⭐ topbar) verified рендерить + працює.
- Sidebar group "Стратегія" → Win-Analysis.

📖 **Метод. аудит — 5 паралельних агентів:**
- UI/UX critic: 15 findings (P0 sticky thead, WCAG pills, mobile breakpoints).
- Biz-Dev critic: Forecast має враховувати hockey-stick + cost_of_prize gap.
- Finance critic: paid_at vs created_at + currency + utm tokenize (B1-B5 fixed).
- Marketing critic: CPC/CPM/Frequency gap (deferred).
- Sec+Perf critic: RLS leak (P0 fixed) + Pulse cleanup.

**Commit chain:** `76fdf60` Wave 1 → `fdee4b9` Wave 2 → `ef09c9d` Wave 3 → `f402678` Wave 4 → `5670ff0` Wave 5. Verify: `HTTP/2 200` для всіх 4 сторінок.

---

## 14.06.2026 — #391 Cleanup legacy PHP backend (–197 файлів)

### Dashboard repo (`dreamcarua/dreamcar-dashboard`)
🗑 **Видалено увесь старий PHP-стек який жив на `dreamcar.ai-platform.space`:**
- 116 PHP-скриптів у корені (DIAGNOSTIC, FULL_DIAGNOSTIC, webhook_crm, handler_bulk, manual_costs, upload_*, check_*, fix_*, test_*, debug_*, etc)
- Папки: `ads/`, `api/`, `config/`, `core/`, `cron/`, `finance/`, `migrations/`, `plans/`, `scripts/`, `sql/`, `assets/` (старий UI)
- Legacy docs: WEBHOOK_SETUP.md, WORK-CHECK.md, UX-AUDIT.md, INTEGRATION_REPORT.md
- `.htaccess` (PHP routing) + `apply_*.py` (legacy migration helpers)

**Чому це безпечно:**
1. SendPulse webhook `webhook_crm.php` НЕ потрібен — `etl/sync_sendpulse.py` тягне `GET /crm/v1/deals` напряму у Supabase (Phase 2 #202)
2. `meta-analytics/` уже перенесено Артемом у `docs/meta-analytics/` (комміт c730ad1) як чистий статичний JS+Supabase
3. `utm-dashboard/` дубль уже видалив Артем у e1bf1fa
4. Live `dashboard.dreamcar.ua` (GitHub Pages з `docs/`) НЕ зачеплено
5. Жодного fetch/XHR з `docs/` на `ai-platform.space` — grep підтвердив

**Залишається у корені (живий стек):**
- `docs/` — live Pages dashboard
- `.github/workflows/` — ETL cron (etl-mysql-sync, etl-sendpulse-sync, fb-ads-sync)
- `etl/` — Python ETL scripts (SendPulse + FB Ads → Supabase)
- README.md, CLAUDE.md, SECURITY.md, .env.example, .gitignore, .package-versions.json

**Наслідок:** хостинг `dreamcar.ai-platform.space` можна відключити окремо (більше не deploy-ається з цього репо). Verify: `curl -sI dashboard.dreamcar.ua/` → HTTP/2 200, last-modified 14.06.2026 11:22 → Pages rebuild ok.

Commit `19d9275`. Pushed by Vadym.

---

## 14.06.2026 — #387 SMM: TG caption counter 1024/4096 динамічно

### SMM (#387)
🆕 **`hq/app-char-counter.js` — динамічний TG ліміт залежно від наявності медіа:**
- Без креативів → `TG 4096` (sendMessage)
- З креативами (≥1 у `#f_creatives`) → `TG (caption) 1024` (sendVideo / sendPhoto / sendMediaGroup)
- Telegram рахує усі символи РАЗОМ з HTML тегами (`<b>`, `<i>`, `<a href="...">` тощо)
- MutationObserver на `#f_creatives` — counter перераховується одразу при додаванні/видаленні creative

Корінь — #383: мій тестовий пост з ~1500 chars HTML провалився `Bad Request: caption is too long`. До цього юзер не знав про обмеження 1024.

---

## 14.06.2026 — #385 + #386 TG Autopost: HDR pass-through + spam-loop fix

### Compress Worker (#385)
Після 3 катастроф з HDR→SDR tone mapping (#256 Hable washed, #291 Mobius + eq неприродно, #301 повний rollback) — бенчмарк 4 варіантів на IMG_8472.MP4 (HEVC Main10 HLG bt2020). Vadym: «всі зразки виглядають погано».

**Висновок:** математично неможливо HDR→SDR конверсія, яка зберегла би оригінал.

🔧 **`.github/scripts/compress-creative-worker.sh`:**
- Auto-detect HDR (`color_transfer in arib-std-b67/smpte2084` або `color_primaries=bt2020`)
- Для HDR джерел ≤49MB → **pass-through без ffmpeg encode**: source upload напряму у R2 як compressed_url
- TG приймає HEVC HLG: HDR-клієнти бачать оригінал, SDR — TG-side downconvert
- SDR джерела перекодовуються нормально (H.264 yuv420p)

### TG Autopost Worker (#386)
🔧 **`.github/scripts/tg-autopost-worker.sh` — fix spam-loop у тест-канал:**
- TG `sendMediaGroup` повертає `.result` як **масив**, sendVideo/sendPhoto — як **object**
- Мій fix #382 робив `jq '.result.message_id'` → падав з exit 5 для sendMediaGroup
- `complete_autopost_job` не викликалось → `publication.status` залишався 'approved' → `pg_cron` знов enqueue → infinite loop
- Додав `RESULT_TYPE=$(jq 'if .result then (.result | type)...)` з гілками для array/object

🛡 **Migration `enqueue_pending_autoposts_no_fallback_386`:**
- Прибрав fallback на test channel якщо `tg_channel_id IS NULL`
- Замість fallback → CONTINUE (skip публікації без явного каналу)
- Безпечніше: старі публікації без каналу більше не попадають випадково у автопостинг

**Cleanup:** 9 stale failed jobs cancelled, 2 публікації (cadd4d7f KTM, aee24b59 Сторис) переведено у `rework` (не-approved терминальний стан).

---

## 14.06.2026 — #382 TG Autopost Worker — fix 6+ failed runs (prod channel + bash state leak)

### TG Autopost (#382)
GitHub Actions email: "TG Autopost Worker — main (1a0c3fb): All jobs have failed". Розслідування показало ТРИ проблеми, що накладалися:

**1. Production channel `-1002496656144` — bot @dreamcar_team_bot не доданий.**
Логи: `HTTP 400: Bad Request: chat not found` / `HTTP 403: Forbidden: bot is not a member of the channel chat`. Per memory `project_dreamcar_tg_channels` — prod канал ще не готовий, постимо тільки у test `-1003933841573`.

**2. RPC `enqueue_pending_autoposts` мав hardcoded fallback на prod.**
`v_target := COALESCE(v_pub.tg_channel_id, '-1002496656144')` — будь-яка `approved` публікація з NULL `tg_channel_id` випадково потрапляла у prod. 🛡 **Migration `enqueue_pending_autoposts_safe_fallback_382`** — fallback перенесено на `-1003933841573` (test).

**3. Worker bash script — state leak між iterations of `for`-loop.**
`HTTP` і `GROUP_SENT` як bash vars persist між iterations. Після успішного sendMediaGroup у job#1, у job#2:
- `GROUP_SENT="yes"` зайве → if/elif chain пропускає video branch
- `HTTP="400"` від попередньої job → ловиться як failure
- `/tmp/tg-resp.json` deleted у cleanup → jq fail → exit 2 → trap → `Worker died on line 296`

🔧 **`.github/scripts/tg-autopost-worker.sh`**:
- На початку кожного iteration `unset GROUP_SENT HTTP MSG_ID CHAT_OUT ERR USE_URL NEED_REENCODE CODEC_USED ANY_VIDEO_PENDING IN_SIZE OUT_SIZE FINAL_FILE FW FH FD` + `rm -f` всіх tmp files.
- Guard на порожній `$HTTP` (no send branch matched) + guard на missing `/tmp/tg-resp.json` (HTTP 200 але response відсутній). Замість крешу — fail_autopost_job з explicit error.

**4. Cleanup 9 stale failed jobs** (10.06–13.06) у `tg_autopost_queue`: позначені `cancelled` з суфіксом `[cancelled #382: bot not in prod channel]`.

### Дія Вадима (опційно)
Якщо хочеш постити у production-канал `-1002496656144` — треба додати @dreamcar_team_bot як admin (з правом Post Messages). Поки бот не доданий — fallback на test channel, нічого не ламається.

---

## 12.06.2026 — #363 Retention modal: backdrop click = autosave чернетки (Давид UX)

### Retention (#363)
Давид у TG: «зробіть будь ласка, щоб коли клікаєш поза полем редагування все не зникало і створювалась чернетка». Vadym: «зроби як в SMM».

**Зміни у `retention/app-retention.js`:**
- 🔧 **Autosave для ВСІХ** (раніше тільки для existing): прибрав `if (!isNew)`. Перший autosave для нового message робить INSERT і повертає `msgId`. Наступні autosave вже UPDATE.
- 🔧 **`saveForm` повертає `msgId`** (раніше void). Caller (autosave) запам'ятовує у `overlay.dataset.msgId`.
- 🆕 **`safeClose()` async** — backdrop click + close × тихо зберігає і закриває:
  1. Чекає поки in-flight save завершиться (max 3 сек через `overlay.dataset.saving`)
  2. Flush autosave якщо `dirty=1` через `overlay._flushSave()` — миттєвий save без debounce
  3. Видаляє overlay (без toast, без confirm)
- 🗑 Прибрано toast «Не закриваю — є незбережені зміни» (#217) і `confirm()` «Точно закрити без збереження?» — натомість автоматичний save як у SMM #219
- 🔧 Індикатор показує «✓ чернетка HH:MM» замість «✓ збережено» — Давид просив

**UX:** Vira пише текст → клікає поза модалом → автоматично створюється/оновлюється draft у DB → модал закривається тихо. Можна відкрити пізніше і продовжити. Як у SMM.

Commit `9f99b56`.

---

## 12.06.2026 — #362 Retention TG notify — повний body замість preview_text

### Edge fn notify-tg v34 (#362)
Vadym скрін з DreamCar LTV RETENTION TG group: «Денний мото-факт від Дрімкар» — приходить тільки назва і метадані, **без body**.

**Причина:** `buildRetReviewMsg()` показував `msg.preview_text` обмежено 800 chars. Але Vira пише у `msg.body` (а `preview_text` лишається порожнім). DB перевірено: `body_len=541, preview_len=0` для тестового message.

**Fixes:**
- 🔧 Поле джерела: `msg.body` (preferred) → fallback `msg.preview_text`
- 🔧 Ліміт: `MAX_RETENTION_BODY = 3500` (раніше 800) — Vadym вибір
- 🆕 `smartHtml(s)` — якщо body містить TG-allowed HTML tags (`b/i/u/s/a/code/pre/strong/em/br/tg-spoiler`), pass-through без escape. Інакше escape. Vira пише HTML свідомо (наприклад `<b>Денний мото-факт від Дрімкар:</b>`).
- 🆕 Body загорнутий між роздільниками `━━━━━━━` для візуального розділення метаданих і контенту
- 🗑 Прибрана обгортка `<i>...</i>` яка ламала вкладений HTML

Деплой Supabase Edge Function `notify-tg` v34 успішний. Status flip review→approved→review на тестовому message тригернув notify через DB-trigger.

---

## 12.06.2026 — #361 P0 КАТАСТРОФА Tasks EDIT modal комент+файли

### Tasks (#361 P0)
Vadym скрін: написав "qweqwe" → ВІДПРАВИТИ → нічого. Файли не прикріпляються.

**Корінь:** після #359 я полагодив тільки **OVERVIEW modal** (read-only popup), а **EDIT modal** (повноекранне редагування) має ОКРЕМІ функції — `postComment`, `loadComments`, file upload handler — які лишилися ламаними з display:none на input + Promise.race timeout.

**Fixes EDIT modal:**
- 🔧 `<input id="editAttInput" style="display:none">` → visually-hidden (Safari iOS bug fix)
- 🔧 `<button editAttUploadBtn>` → `<label for="editAttInput">` (native click forward)
- 🗑 Видалено `Promise.race(90s)` + `refreshSession()` з file upload handler
- 🆕 Inline ⏳ progress placeholders у grid (SMM-патерн з spinner + name + size)
- 🆕 `window.postComment` global fn + inline `onclick` через `setAttribute`
- 🔧 `postComment` тепер `.select().single()` + optimistic push у state.comments + state.commentsByTask
- 🆕 `loadComments` — Step 1: миттєвий render з кешу state.commentsByTask, Step 2: async DB refresh
- 🔧 button disabled+"ВІДПРАВЛЯЮ…" поки processing

**Chrome MCP smoke test PASS:**
- ✅ 1 клік ВІДПРАВИТИ = 1 INSERT (раніше було 2 через triple binding — onclick + addEventListener + setAttribute)
- ✅ file upload: файл у Supabase Storage + у state.editAttachments
- ✅ button onclick attr = "window.postComment && window.postComment(); return false;"

**Key insight:** triple bind (`.onclick = fn` + `addEventListener('click', fn)` + `setAttribute('onclick', ...)`) запускав handler 2-3 рази за один click. Залишив тільки `setAttribute(onclick)` + `btn.onclick = null` щоб гарантувати ОДИН виклик. Цей патерн HARD RULE для critical buttons.

Commits `71aa635` + `a57514f`.

---

## 12.06.2026 — #360 BIG ЗВЕДЕНИЙ КАЛЕНДАР SMM+Retention у /projects/

### Projects (#360 BIG)
Vadym: «бачити в одному місці що Олександр у SMM шле і що Віра у Retention шле — щоб не пересікались і різноманіт контент». Розташування: `/projects/#calendar`.

**DB:**
- 🆕 RPC `unified_calendar_events(p_from, p_to, p_systems, p_channels, p_owners, p_statuses)` SECURITY DEFINER — UNION ALL `publications` + `retention_messages` у єдиний формат (`source/scheduled_at/channels[]/ctype/title/status/owner_id/owner_name/has_creative/thumbnail_url`). JOIN на `users` + `creative_publications`+`creatives` для thumbnail. Migration `unified_calendar_phase1`.
- 🆕 RPC `unified_reschedule(p_source, p_id, p_new_at)` — quick reschedule прямо з preview modal. CEO/COO/lead — будь-який. Інакше — тільки власник (creator або responsible).

**5 Views у `app-unified-calendar.js`** (657 рядків JS):
- 🆕 **МІСЯЦЬ** — як SMM: кольорові бейджі (5 events/day + N more)
- 🆕 **ТИЖДЕНЬ** — timeline по годинах 06-23
- 🆕 **ДЕНЬ** — вертикальний timeline для одного дня
- 🆕 **ТИЖД×КАНАЛ** (POWER VIEW) — horizontal grid канал × дні. З одного погляду видно пустоти і перевантаження
- 🆕 **СПИСОК** — flat з виконавцем і конфліктами

**Conflict detection (per-channel thresholds):**
- TG 60 хв / Email 240 / Push 480 / IG 90 / FB 120 / TT 90 / YT 120 / Threads 120 / SMS 240 / Viber 240 / Other 120
- Подія з конфліктом → yellow dashed outline + ⚠️
- Toggle «Тільки конфлікти» у filters
- У preview modal детальний список: «TG: «партнерська назва» (45 хв)»

**Diversity insights:**
- Chip над календарем: `3xREELS · 1xПОСТ · 1xEMAIL | 4xSMM · 2xRET`
- Допомагає балансувати контент

**Inline preview modal (read-only popover):**
- Title, when, channels, ctype, status, owner_name
- Conflict-box з деталями якщо є
- 3 кнопки: ↗ Відкрити у SMM/Retention | ⏰ Перенести час | Закрити
- Quick reschedule prompt() → `unified_reschedule` RPC → auto-refresh

**Filters (persistent у localStorage `uc_prefs`):**
- Source toggle: SMM / Retention (синій / фіолетовий)
- Owner select
- Channel select
- onlyConflicts toggle
- view + cursor + filters зберігаються між сесіями

**Color coding:** SMM = `#3b82f6` (синій) / Retention = `#a855f7` (фіолетовий).

**UI integration:**
- Кнопка `📅 ЗВЕДЕНИЙ` у topbar `/projects/` з gradient синій→фіолетовий
- Route `/projects/#calendar` → `dcUnifiedCalendar.open()`
- HARD RULE: всі дати через `Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv' })`
- Світла/темна теми
- Mobile responsive (768px breakpoint)

**Не модифікує** `/hq/` чи `/retention/` — повна ізоляція через RPC. Не показує Tasks (Vadym обрав тільки SMM+Retention).

Commit `9fb9259`.

---

## 12.06.2026 — #359 Tasks: коментарі + файли РЕФАКТОРИНГ за SMM-патерном

### Tasks (#359 BIG)
Vadym: «коментарі не завантажуються, файли не прикріпляються — викинь і скопіюй точно як у SMM».

**Коментарі** — повний відмова від per-modal fetch на користь preload-in-memory патерну:
- 🗑 Видалено `loadOverviewComments()` з Promise.race 30s timeout (висів на «Завантаження…» через повільний RLS EXISTS-join на `team_task_comments`)
- 🆕 `loadAllComments()` — preload останніх 500 коментарів у `state.commentsByTask` map у boot Promise.all (`tasks/index.html:893`)
- 🆕 `renderOverviewCommentsHtml(taskId)` — синхронний рендер з кешу (миттєво, без spinner)
- 🆕 `pushCommentToCache()` — оптимістичне додавання у map + перерендер відкритого overview modal. Викликається з insert success і з real-time INSERT subscription (idempotent по id)
- 🔧 Send handler тепер `.select().single()` щоб одразу мати fresh row у кеш
- 🔧 Real-time subscription оновлює `state.commentsByTask` автоматично

**Файли** — input винесено з modal innerHTML у `<body>` direct, label-trigger замість programmatic click:
- 🗑 Видалено `tasksTriggerFileInput()` — programmatic `.click()` Safari iOS блокував (повтор 5 разів: #119/#355/#357/#358)
- 🗑 Видалено `Promise.race(90s)` timeout — не потрібен, sb client сам ре-юзає JWT
- 🗑 Видалено `refreshSession()` перед upload — зайвий round-trip
- 🆕 `ensureTaskFileInput()` — створює persistent `<input type="file">` у `<body>` direct (поза modal innerHTML rerender), визивається у boot Promise.all
- 🔧 Кнопка через `<label for="taskAttInput">` — native Safari iOS click forward без `.click()` (HARD RULE: Safari iOS bug)
- 🆕 Inline ⏳ progress placeholder у grid за SMM-патерном (anim spin + ім'я + розмір)
- 🔧 Атомарний DB update після всіх uploads (rollback placeholders при помилці)

**Що НЕ змінено:**
- Схема DB: `team_task_comments` + JSONB `attachments` у `team_tasks` — зберігаються
- TG-нотифікації (`team-tasks-notify` Edge Fn) — працює без змін
- Mentions (`mentions UUID[]`) — підтримується
- RLS policies — лишаються

**Перевірено:** 0 merge markers, 0 JS syntax errors (108k chars), 0 refs на видалені функції, prod показує 18× `commentsByTask` + 5× `ensureTaskFileInput`. Commit `6543b3d`.

---

## 12.06.2026 — #358 SMM Calendar UX

### SMM (#358)
- 🔧 **Календар: плитка більша + 5 карток на день замість 3.** Vadym скрін 10.06 — 3 картки REELS/ПОСТ обрізались знизу (`overflow: hidden` на `.cal-day` ховало нижні рядки).
  - `.calendar-grid { height: calc(100vh - 180px); min-height: 780px }` (було 540px) → 130px на клітинку (було 90px)
  - `.cal-card { flex-wrap: nowrap; align-items: center; padding: 3px 5px; gap: 4px; min-height: 20px }` — одно-рядкове compact layout
  - `.cal-card .ctype-badge { display: inline-block; flex-shrink: 0 }` — chip inline, не block з width:100%
  - `dayPubs.slice(0,3) → slice(0,5)` у `renderMonth()` — до 5 публікацій на день видно
  - Формат рядка: `[REELS] 14:00 ●● На що зробити...` — type+time+title в одному рядку
  - Commit `810cc2a`

---

## 12.06.2026 — #345 BIG нова система СКЛАД (Inventory)

### Inventory (#345 BIG)
- 🆕 **Нова система** `team.dreamcar.ua/inventory/` — облік мерчу та матеріальних цінностей DreamCar (футболки, наклейки, аксесуари, призи у майбутньому).
- 🆕 **DB schema** (migration `inventory_phase1_schema_rls_rpc`):
  - `inventory_items` (id, name, category enum (apparel/print/sticker/accessory/other), notes, photo_url, archived, created_by, timestamps)
  - `inventory_variants` (id, item_id, label, attrs jsonb size/color, sku, low_stock_threshold, archived) + UNIQUE (item_id, label)
  - `inventory_movements` (id, variant_id, type enum intake/release/writeoff/adjust, qty CHECK >0, reason, reference_url, performed_by, performed_at)
  - VIEW `inventory_variant_qty` — SUM по типу (intake +, release/writeoff −) дає поточний залишок
  - 6 FK indexes + low-stock fast filter
- 🆕 **3 RPCs SECURITY DEFINER**:
  - `inventory_move(variant_id, type, qty, reason, ref)` — atomic intake/release/writeoff + спеціальний `adjust_to` (обчислює delta до target qty). Перевірка `current_user_has_role(ceo/coo/lead)` всередині, insufficient-stock guard для release/writeoff. GRANT EXECUTE TO authenticated.
  - `inventory_list_items(include_archived)` — items + nested variants jsonb + total_qty + any_low boolean. authenticated only.
  - `inventory_list_movements(limit)` — журнал з JOIN на users.name для відображення виконавця. authenticated only.
- 🆕 **RLS**:
  - SELECT (всі 3 таблиці): TO authenticated → завжди true (читання всім team).
  - INSERT/UPDATE/DELETE на items+variants: `current_user_has_role(['ceo','coo','lead'])`.
  - `inventory_movements` — write **тільки через RPC** (немає policy на INSERT/UPDATE/DELETE).
- 🆕 **Frontend** (`inventory/index.html` + `inventory/app-inventory.js`):
  - SSO bridge `#sso=base64(json)` + dc-shared-storage cookie + login gate + global header (HARD RULE).
  - 3 views:
    - **📦 Склад** — card-grid товарів з варіантами + кількістю badge (амбер коли low). Per-variant action buttons: `+` intake, `−` release, `±` adjust, `✎` edit variant.
    - **📒 Рух** — таблиця останніх 200 операцій з фільтром по типу та виконавця. Дати у форматі Europe/Kyiv (HARD RULE #330).
    - **📊 Аналітика** — KPI cards (всього на складі, позицій, з низьким залишком, =0), топ-10 видаваних за 30 днів.
  - Sidebar фільтри: Низький залишок · Архів · 5 категорій.
  - Modals (всі через **inline onclick + global window fn** — HARD RULE memory `feedback_inline_onclick_for_critical_buttons`):
    - Прийняти/Видати/Списати/Коригувати (з reason + reference_url)
    - Новий товар + редагування
    - Новий варіант + редагування (розмір/колір/SKU/threshold)
  - Toast feedback + rollback на помилки.
- 🆕 **Seed**: Товар «Футболка DreamCar» з 4 варіантами S/M/L/XL чорна, threshold=3 кожен.
- 🆕 **Інтеграція**:
  - `info.html`: новий tile 📦 СКЛАД (з NEW badge) між RETENTION і ONBOARDING у tools grid; новий info-card блок СКЛАД у grid КОМАНДА І ОНОВЛЕННЯ.
  - `brand.dreamcar.ua/assets/global-header.js`: новий LINK `inventory` (СКЛАД) між RETENTION і ONBOARDING. Active matcher на `/inventory/`.
- 🛡 **Захист**:
  - REVOKE EXECUTE FROM PUBLIC на всіх 3 RPCs.
  - `qty CHECK > 0` на movement.
  - SECURITY DEFINER fn `SET search_path = public, pg_temp` (захист shadow-attack).
- 📖 Commits: `8998b1e` (frontend create) + `b264d4d` (global-header.js у brand-book) + `d80af36` (info.html update).
- 📖 **Vadym Q&A фіксовано**: доступ = CEO/COO + Heads рух / інші read · 1 склад · поки тільки мерч (призи пізніше) · видача знеособлено з вільним текстом причини.

---

## 12.06.2026 — #344 P0 Tasks onboarding кнопки «Знаю» — silent exit fix

### Tasks (#344 P0)
- 🔧 **`tasks/index.html`** line 750: після `createClient()` додав `window.supabase = supabase;`. Раніше клієнт жив тільки у module scope — `app-onboarding.js` чекав на `window.supabase` (line 325 `if (!me || !window.supabase) return;`) → silent exit → кнопки кроків онбордингу візуально клікались, але крок не зберігався у DB. Симптом скаржився Vadym: `/tasks/#onboarding` → клік «✓ Знаю 4 статуси» → нічого не відбувалось.
- 🔧 **`tasks/app-onboarding.js`** `markStep()`:
  - Конкретні `console.warn` (`state.publicUser not ready` / `window.supabase missing`) — без silent exit
  - Перевіряємо `error` від UPDATE на `users.onboarding_steps` — якщо є → `console.error` + `window.toast(error.message)` (якщо toast є) + rollback optimistic-stored (`delete stored[key]`)
  - catch робить те саме для thrown промісів
- 📖 Commit `988c4ee`. Cache bust автомат через GH Action Cloudflare purge.

---

## 11.06.2026 — AUDIT (Phases 1-7 DONE, autonomous session)

### Security (Phase 1+2)
- 🛡 REVOKE anon SELECT з `v_dashboard_webhook_health` (ETL stats leak closed)
- 🛡 SET search_path на 11 функцій (shadow-attack protection)
- 🛡 Public buckets LIST policy → TO authenticated (anon більше не може `.list()` всі URLs)
- 🔧 Видалив dead code на team.dreamcar.ua/index.html (старий Supabase oekoamtgbsklbmqyydzj HTTP 000)

### Performance (Phase 3)
- ⚡ 13 нових FK indexes (DELETE/UPDATE на parent швидші)
- 🗑 1 duplicate index dropped (idx_dashboard_ads_data_date_start)
- ⚡ 4 RLS policies wrap auth.uid() → (SELECT auth.uid()) — InitPlan caching

### Reliability (Phase 4)
- 🔧 r2-sign-upload top-level try/catch (unhandled crash → 500 response)
- ✓ 0× 5xx errors у Edge fn logs за 3h ✓

### Data Integrity (Phase 6)
- ✓ 0 orphan records (9 relations checked)
- ✓ 0 TZ-naked timestamps
- ✓ 0 critical NULL у users/publications/retention_messages

### UX/A11y (Phase 7)
- 🆕 Global :focus-visible CSS у `brand.dreamcar.ua/assets/global-header.js` (червоний outline для keyboard nav)

### Артефакти
- AUDIT_LOG.md, AUDIT_BACKLOG.md, AUDIT_SUMMARY.md у `dreamcar-team/` root

## 10.06.2026 (вечір) — #322+#323+#324+#325 (4 задачі одним пушем)

### SMM (#322 P0)
- 🔧 tg-post-send v14: чіткі коди помилок 401 (`token_expired` / `getuser_error:*` / `no_user_in_token` / `rpc_error:*` / `no_user_row_for_auth_id:*` / `role_blocked:<role>` / `no_auth_header` / `catch:*`)
- 🔧 hq/app-views.js (test button): auto `refreshSession()` + retry один раз якщо 401 reason починається з `token_expired`/`getuser_error`/`no_user_in_token`. Toast тепер показує конкретну причину.

### SMM (#323 P0)
- 🔧 hq/app-ai-copy.js + hq/app-templates.js: AI/Template modal `z-index 300 → 2000`. Раніше модалки відкривались ПІД publication modal (z-index 1241/1383/1500) — Vadym не міг їх побачити.

### team.dreamcar.ua (#324)
- 🔧 orgchart-full.html:
  - "КАРТА ВЛАДИ" → "ЗОНИ ВІДПОВІДАЛЬНОСТІ" (Vadym: менш пафосно)
  - Прибрав пункт у escalation про Артема як партнера/підлеглого (засновник = партнер за замовчуванням, не треба окремо обумовлювати)
  - Повернув на Level 3 третю карточку: **#06 Head of TECH · IT** (Олександр + команда). Зараз 3 Heads: SMM, Retention, TECH
- 🔧 info.html: 3-я карточка Head of TECH у org-row Level 3

### SMM (#325)
- 🗑 /hq/#launches видалено з UI (повністю замінено `/projects/` після Phase 2):
  - hq/index.html — прибрав sidebar nav-item + bottom-nav '🚀 Запуски'
  - hq/app-core.js — route `launches` → `location.replace('/projects/')`
  - Прибрав `navCntLaunches` counter
  - `Store.launches()` залишився (data shared з publication form dropdown — там вибір проекту з тих самих 6 launches)

## 10.06.2026 (день) — #302 P0 /news/ + /regulations/ NO AUTH

🛡 **#302 P0** Сторінки **повністю відкриті**, без авторизації
- **Vadym:** «Видали все, що стосується авторизації. Хай будуть відкриті повністю.»
- **RLS:** anon SELECT відкритий (team_news_read_public + regulations_read_public).
- **Frontend:** видалено loadMe / SSO bridge / getSession / login gate / markRead / admin UI.
- **Init:** одразу loadAll(), без if(!me)return.
- Commit: 64523d7

## 10.06.2026 (день) — #301 P0 КАТАСТРОФА Color full rollback

🔧 **#301 P0** Compress worker — повний rollback HDR tone mapping
- **Vadym:** «Кольоропередача жахлива. Катастрофа.»
- **Викинуто:** #256 Hable, #291 Mobius+eq saturation/contrast/gamma, bt2020→bt709 converter, -color_primaries/trc/colorspace/range bt709 force.
- **Залишилось:** чистий H.264 high\@4.1 2-pass + scale. Source pixels 1:1, без жодного color filter.
- **Retry:** 5 останніх відео заново у черзі (compress workflow перекодує без tone mapping).
- Commit: 576625e

## 10.06.2026 (день) — #300 P0 /news/ + /regulations/ SSO bridge

🛡 **#300 P0** `/news/` і `/regulations/` — login loop повторно (4-й раз сьогодні)
- **Симптом:** Скрін від Vadym — URL `team.dreamcar.ua/news/#sso=eyJ...`, але показано «🔒 Потрібен вхід». Клік «Перейти у HQ» → HQ редиректить назад з НОВИМ `#sso=` → /news/ знов login → loop.
- **Корінь:** `/tasks/index.html` парсить `#sso=base64(json{access_token,refresh_token})` і робить `sb.auth.setSession()` ДО getSession(). У #298 я перевів /news/ і /regulations/ на getSession() + login gate (щоб уникнути auto-redirect loop), але **не додав SSO bridge парсинг**. Тому HQ-токен у URL fragment ігнорувався → session не встановлювалась → loop продовжувався.
- **Fix:** Додав SSO bridge у loadMe() обох сторінок ДО getSession() — копія з `/tasks/index.html` line 753. Парсить `#sso=`, setSession(), очищає hash через replaceState.
- Commit: 0d03c41

## 10.06.2026 (день) — #297 SMM creative thumbnail emoji fix

### 🔧 #297 SMM publication modal — креативи показували 🖼/🎬 emoji замість thumbnail
- **Root cause:** Store кеш для creatives застарівав поки modal відкрита. Realtime refresh (`_refreshAfterChange`) має guard `if (modalBackdrop.open) return` (рядок 173 app-core.js) — щоб не переривати autosave. Але це означало: якщо compress worker записав `thumbnail_url` у DB поки юзер мав modal відкритою — JS Store не дізнавався, `Store.creative(cid).thumbnail_url === null` → render fall through на emoji.
- 🔧 **`hq/app-core.js`** — нова `Store.refreshCreatives(ids)`: targeted SELECT по конкретних IDs (`.in('id', ids)`), patch-имо thumbnail_url/compressed_url/compressed_status/name/type/width/height у локальний cache. Returns `true` якщо хоч щось змінилось.
- 🔧 **`hq/app-views.js`** — рендер creative-strip винесено у `renderCreativeStripItems(ids)` для переюзу. Нова `refreshCreativeStrip(p)` викликається з `openCard()` після `attachCardHandlers(p)`: робить forced fetch + якщо є зміни — re-render тільки `.cs-item` всередині `#f_creatives` (зберігає `+` add button) + re-bind cs-remove handlers.
- 🚀 Cache bust автомат через GH Action Cloudflare purge.

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
