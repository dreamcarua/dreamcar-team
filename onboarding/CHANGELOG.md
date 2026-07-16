# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## DD.MM.YYYY` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 16.07.2026 — SMM + Ретеншн: медіа в TG-апруві

### SMM · notify-tg
- 🔧 Апрув публікації з відео приходив **лише текстом**: `tgSendVideo` слав `compressed_url` (~48 МБ), а Telegram по URL тягне лише ≤20 МБ → завжди фейл → відкат на текст.
- 🆕 Тепер для відео в апруві шлемо **POSTER-кадр** (JPG з R2, `creatives.poster_url`, який compress-worker уже генерує) як фото-прев'ю + клікабельний лінк «▶️ Відео» на повний кліп у підписі. Фото-креативи — без змін. (notify-tg, commit a654a96)
- 🆕 **Ретеншн-апрув** мав ще ширшу ваду: медіа не слалось **взагалі** (лише `tgSend` текст) — 92 розсилки з фото/відео приходили голим текстом. Додав `loadRetCreatives` + `sendRetReviewToChat` (фото + відео-постер + лінк), дзеркально до публікацій. (commit 58cda29)

## 15.07.2026 — Каса: вартовий застряглого банк-синку (захист ФОП-ліміту)

### Каса · Фінанси
- 🆕 RPC `kasa_stale_accounts(p_days)` — детектор рахунків із живим балансом, але без нових транзакцій N днів (синк банку впав). SECURITY DEFINER, grant anon.
- 🆕 Банер на Касі у ФОП-секції: «Синк банку застряг — ФОП-надходження нижче реальних» + назва рахунку і дні тиші (kasa/index.html, commit 48de42e).
- 🆕 GH workflow `kasa-stale-watchdog.yml` — щодня 08:00 UTC перевіряє застряглі рахунки, шле DM Вадиму через @dreamcar_team_bot (протестовано, доставка OK).
- 🔍 Діагностовано: ПриватБанк Спірін ·9785 не синкає транзакції з 01.07 (14 дн) — банк обриває виписку (statements), баланс віддає живий. ФОП Спірін занижений ~на 0.6 млн; потрібен перевипуск токена Автоклієнта Приват24.

## 30.06.2026 — P0 Fixes: Video compress workflow degradation + SMM TG approval notifications

### SMM TG Approval Notifications (#551, Vadym P0)
- 🔧 Edge fn `notify-tg` v14: **CRITICAL FIX** для video у media items. Раніше: frontend ставить `compressed_status='ready'` + `compressed_url=URL_оригіналу` одразу при upload, але video НЕ скомпрессований → TG отримує HEVC HDR оригінал → НЕ показує inline. Новий logic: перевіряє `compressed_at IS NOT NULL` перед додаванням у media. Якщо NULL: `hadPendingVideo=true` + text-only notice "🎬 Відео ще обробляється".
- 🛡 HARD RULE 30.06.2026 (оновлено у Memory): **compressed_at IS NOT NULL обов'язково** для всіх відеосендерів (notify-tg, tg-post-send, dc-media-archive, future). НЕ `compressed_status`, НЕ `compressed_url` — ці поля брехливо ствердні на фронтенді.
- 📖 Історія: 01-02.06 було 100% real compressed, 30.06 деградувало до 0-25% (в залежності від дня).

### Compress Workflow Degradation (#552, Vadym P1)
- 🔧 **ROOT CAUSE:** Frontend fake-ready immediately (status='ready' + url=original), DB trigger NOT forcing 'pending' → workflow шукає `compressed_status='pending'` → 0 rows to process → 0 compression за 30 днів.
- ⚡ **DB Trigger** `trg_creatives_force_pending_video` (BEFORE INSERT/UPDATE OF compressed_status, compressed_at ON creatives): якщо video + compressed_at IS NULL + compressed_status='ready' → перевизначає на 'pending'. Жодних front-end змін.
- ⚡ **Backfill 23 unconverted video** за 7 днів: `UPDATE creatives SET compressed_status='pending' WHERE type='video' AND uploaded_at > now() - interval '7 days' AND compressed_at IS NULL AND compressed_status='ready'`.
- ⚡ **Manual workflow_dispatch** × 4 на compress-creative.yml → workflow queue-ється (concurrency=1). Першу video (Captions_C3D4A5.MP4) обробив за 2 хв ✅. Залишок черги: 22 video × ~3 хв/кожна = ~1.5 год.
- 📊 **Verify:** `SELECT COUNT(*) FILTER (WHERE compressed_status='pending') / compressed_at IS NOT NULL FROM creatives WHERE type='video' AND uploaded_at > now() - interval '7 days'`. Нові videos одразу в очереди через trigger.
- 🚀 **Deployment:** Migration `fix_551_video_fake_ready_to_pending` + TG notify з рецептом для burst-прискорення (workflow_dispatch × 3).

### SMM Drag-and-Drop Calendar (#553, Олександр UX)
- 📖 **DISCOVERY:** Функціональність вже **100% готова** у `hq/app-core.js` (lines 1289-1314) + CSS (623, 647). Drag-and-drop для Month view: `draggable="true"` на `.cal-card` → ondragstart/ondrop на `.cal-day` → `Store.upsertPub()` з optimistic UI + toast. НЕ потребує нових розробок. Рекомендація: smoke-test через Chrome MCP + verify з Олександром що працює.

### 🔴 P0 ESCALATION — потребує доступу
- ❓ **Workflow failures:** [dreamcarua/dreamcar-dashboard] "Attach Engagement Post" × 4 failed runs (19s, 15s, 22s, 9s). IMPACT: TG engagement auto-reply (`tg-channel-engage` Edge fn) не працює. Потребує: access до dreamcar-dashboard repo + logs diagnose.
- ❓ **Supabase RLS Alert:** dreamcar-hq project — "Table publicly accessible (RLS disabled)". IMPACT: security vulnerability. Потребує: access до dreamcar-hq Supabase + ENABLE RLS.

---

## 29.06.2026 — Календарі: рубрика-колір на cards (Давид UX)

### SMM / Retention / Projects (#547)
- 🆕 Усі картки публікацій/розсилок у календарях (Місяць/Тиждень/День/Список/Дошка) тепер мають `border-left: 4px solid <rubric.color>` — миттєво видно тип контенту: 🔴 Продажний `#ff6577` · 🔵 Експертний `#7ab0ff` · 🟡 Розважальний `#fbbf24` · 🟢 Новинний `#6ee7b7` · 🟣 Партнерський `#c89af0`. Fallback `#666` коли рубрика не задана.
- 🆕 DB migration `unified_calendar_events_add_rubric_id` — RPC `unified_calendar_events(...)` повертає нову колонку `rubric_id uuid` (UNION з `publications.rubric_id` + `retention_messages.rubric_id`). Не ламаюча зміна — старі виклики продовжать працювати.
- 🆕 `hq/app-core.js` — `Store.rubricColor(rubricId)` helper. Застосовано у `renderMonth/Week/Day/List` + `boardCard` (`app-views.js`).
- 🆕 `retention/app-retention.js` — рубрики тепер вантажаться у `Store.rubrics` + `Store.rubricsById`. Helper `rubricColor()`. Застосовано у `calItem(short/medium/full)` + `renderList` + `renderBoard` + `renderCalList`.
- 🆕 `projects/app-unified-calendar.js` — `state.rubrics/rubricsById` + `loadRubricsIfNeeded()` + `rubricColor()` helper. Застосовано у `eventChipHtml` (Month/Week/Day) + `renderGrid` + `renderList`.

---

## 20.06.2026 — Compress оптимізація + SMM published_at + Health Report fixes

### Compress Worker (#526, Vadym P0)
- ⚡ `preset veryslow → slow` (3× швидше CPU, втрата стиснення <1.5% непомітна у TG/IG/Reels). Тепер 1-min iPhone клип компресує ~10-12 хв (було 25-30 хв). 30-min runner timeout з запасом.
- ⚡ x264 params: `subme=10→8`, `merange=32→24`, `rc-lookahead=80→60`, `bframes=12→8`, `ref=8→6` — сумарно ~50% швидше encoding.
- ⚡ HDR HEVC: `preset slow → medium`, `bframes=8→6`, `rc-lookahead=60→40` (HDR pass-through покриває 99% iPhone — HEVC шлях рідкий, можна швидше).
- 🔧 Reset 4 failed creatives (IMG_7942 ×2, IMG_8473, Captions_7D6B54.MP4) — старі fail від 10-12.06 ще на HDR mobius logic. Тепер новий worker (HDR pass-through #385) їх повторно обробить.

### SMM Publications (#527, Vadym P0)
- 🛡 Trigger `fn_publications_auto_published_at` (BEFORE UPDATE/INSERT): автоматично заповнює `published_at = now()` коли status→published. Раніше код фронтенду іноді не виставляв timestamp → 52 публікації мали `status='published'` АЛЕ `published_at IS NULL`.
- 🔧 Backfill 52 записів: `published_at = COALESCE(updated_at, created_at)`. Тепер DC Media archive ETL, /finance/, dashboard sort by published_at працюють правильно для історичних публікацій.
- 📖 **Корінь Олександр-issue**: 3 публікації від ранку 20.06 висять у `status='review'` бо `approver_policy='all'` чекає підтвердження ВСІХ approvers. Давид схвалив 1 → status=approved. Інші чекають Vira/Vadym. Це бізнес-логіка, не bug.

### TG Олександр "Спамер" (#528, Vadym P1)
- 📖 Це **Telegram custom_title** (адмін заголовок) у чаті DreamCar SMM. Виставляється у Telegram chat settings → Адміни → custom title. Vadym/Артем як власники чату можуть прибрати: TG → Адміни → Олександр → custom title = очистити поле. Не системний bug.

---

## 19.06.2026 — Daily TG Finance BOARD Report (09:30 Київ) #524–525

### Daily BOARD Report
- 🆕 Edge fn `daily-finance-board-report` + pg_cron jobid 1777 (щодня 06:30 UTC = **09:30 Київ**). Шле у BOARD chat `-1003883456849` (4 учасники: Vadym/Артем/Давид + ще).
- 🆕 RPC `dashboard_active_projects_lifetime(p_to)` повертає JSON з усіма `status='active'` проектами і lifetime метриками (від `starts_on` до `p_to`): revenue, ad_spend, % з угод, fixed, prize (amortized), variable, total_cost, net_profit, margin_pct + days_active + days_to_finish.
- 🆕 Формат TG: 💰 P&L вчора (як для DM) → 📈 vs позавчора → 📅 MTD → 🏁 **Активні проєкти (від старту)** з повним lifetime breakdown + дати/днів. **Без блоку каси** (це відмінність від DM-звіту).

### Daily BOARD Report v2 — блок ПО ВИКОНАВЦЯХ (#525, Vadym UX)
- 🆕 RPC `dashboard_executors_stats(p_from, p_to)` — агрегація по `utm_term` з `dashboard_deals` + spend з `dashboard_ads_data`. Повертає `executor / leads / paid / revenue / ad_spend`. SECURITY DEFINER, ::date через `AT TIME ZONE 'Europe/Kyiv'`.
- 🆕 Edge fn v2: викликає `dashboard_executors_stats` тричі — `(yesterday, yesterday)`, `(day_before, day_before)`, `(starts_on, yesterday)` для кожного активного проекту.
- 🆕 Нормалізація у 4 buckets: **Vadym (Meta)** = paid · **Vira (ретеншн)** = organic · **Artem (органіка)** = organic · **Інші** = решта (`claude/dreamcar/ai_dreamcar/club_dreamcar/inший` сумуються разом).
- 🆕 Блок «👥 Виконавці (вчора vs позавчора)» — revenue + paid count + Δ% vs позавчора + spend (для Vadym).
- 🆕 Під кожним активним проектом — «*👥 Виконавці за весь проєкт*» — revenue + % частка від загального + paid count + spend.
- ⚙️ Тест на 18.06.2026: 200 OK, text_length=1458, sent.ok=true.

---

## 17.06.2026 — Daily Finance TG Report (09:30 Київ) + ghost-блоки fix + % з угод

### Daily Finance Report (#513)
- 🆕 Edge fn `daily-finance-report` + pg_cron jobid 1520 (щодня 06:30 UTC = **09:30 Київ**). Шле DM Vadym + Артем (CFO).
- 🆕 RPC `dashboard_daily_finance_report(p_date)` повертає JSON з: P&L вчора (revenue/ad_spend/% з угод/fixed/призовий/variable/net), порівняння з позавчора, MTD сума, каса (надходження/витрати + к-сть транзакцій без internal/excl_pnl), баланси активних рахунків.
- 🆕 Формат TG: 💰 заголовок → 📊 P&L з emoji 🟢/🔴 на net → 📈 vs prev day → 📅 MTD → 🏦 каса за день → 💼 баланси Σ + breakdown по рахунках. Лінки на /finance/ + /kasa/.
- ⚙️ TZ Europe/Kyiv (yesterday вираховується з kyivYesterday()).

### Ghost блоки світла тема (#511, Vira UX)
- 🔧 У світлій темі `cal-item-ghost` (Retention) і `cal-ghost` (SMM) — текст темно-сірий #475569 (slate-600). Фон блакитний rgba(59,130,246,0.08).
- 🔧 Sync `dc-theme.js` на 5 системах: hq/retention/tasks/projects/inventory. Раніше тільки hq мав останню версію.

### Period P&L (#512)
- 🔧 % з угод тепер коректно береться з таблиці `percent_rates` (ФОП 3% + ФОПоводи 5% + Бух 2% + ВЗ 2% = **12%**) × daily revenue. Раніше було 0 ₴ бо matview підтягував з project_costs.

---

## 17.06.2026 — Finance Period P&L: 920× швидше + presets "Сьогодні/7д/30д/MTD" + skeleton

### Performance (#509)
- ⚡ Створено `mv_finance_daily_pnl` (matview daily aggregation): revenue/ad_spend/percent/fixed/prize/variable/active_projects по днях.
- ⚡ Новий RPC `dashboard_period_pnl_v2(p_from, p_to, p_granularity)` читає з matview → **8119мс → 8.8мс** (920×).
- 🔧 pg_cron `refresh-mv-finance-daily-pnl`: щогодини о :07 та :37 хвилині (CONCURRENTLY).
- 🔧 Frontend: автоматично перемикається на v2 коли немає project filter (v1 використовується для проектного фільтру).

### UX (#509)
- 🆕 Range presets: **Сьогодні / 7 днів / 30 днів / Цей місяць (MTD)** + 3м / 6м / YTD / 12м / Все.
- 🆕 Auto-granularity: вибір range автоматично перемикає granularity (today→day, 30d→day, YTD→month, all→quarter). Можна перевизначити вручну.
- 🆕 Помітний skeleton-loader: KPI cards, chart-блок ⏳ "агрегую дані…", 5 skeleton-рядків у таблиці. Більше не "майже невидимий лоадер".
- 🆕 Display elapsed time у meta (типу "по днях · 17.05 → 17.06 · 31 рядків · 12мс").

---

## 17.06.2026 — Finance: P&L по періодах + fix tooltip "Структура витрат"

### Finance (`dashboard.dreamcar.ua/finance/`)
- 🆕 **Новий блок "P&L по періодах"** під таблицею проектів. Агрегований P&L по часовим інтервалам.
- 🆕 RPC `dashboard_period_pnl(p_from, p_to, p_granularity, p_project_ids)` — повертає рядки з period_start/end/label, active_projects, revenue, ad_spend, % з угод, fixed, призовий, variable, total_cost, net_profit, margin_pct.
- 🆕 Granularity selector: **День / Тиждень / Місяць (default) / Квартал / Рік**.
- 🆕 Range presets: 3 міс / 6 міс / YTD (default) / 12 міс / Все. + custom date pickers + Проєкт filter.
- 🆕 KPI cards: Σ Revenue, Σ Total Cost, Σ Net Profit, Avg Margin %, найкращий/найгірший період.
- 🆕 Stacked Chart.js: Revenue (bar) + Total Cost (bar) + Net Profit (line) по періодах.
- 🆕 Таблиця: 12 колонок включаючи **Δ Net vs prev period** (наглядно видно growth/decline).
- ⚙️ Алгоритм: TZ Europe/Kyiv (paid_at AT TIME ZONE), амортизація призового по днях проекту, fixed розмазаний по днях, виключення CONTENT + idea/planning launches.
- 🔧 **Fix `chartCommon()` tooltip**: chCost "Структура витрат" показував NaN/3₴/1₴ замість значень. Причина: для горизонтального bar (`indexAxis:'y'`) `ctx.parsed.y` повертає індекс label-а, не значення. Тепер `ctx.raw` → справжнє число.

---

## 17.06.2026 — Finance P&L: Net/день + дати+днів проекту

### Finance (`dashboard.dreamcar.ua/finance/`)
- 🆕 Колонка **"Net/день"** у P&L таблиці — true_net_profit / днів проекту. Допомагає порівнювати ефективність проектів різної довжини.
- 🆕 У колонці "Проєкт" біля назви тепер відображаються **дати проведення** (`DD.MM.YY → DD.MM.YY`) + **кількість днів** (`· N дн.`) дрібним шрифтом.
- 🔧 Footer (підсумок): зважений середній Net/день через сумарну кількість днів усіх проектів.
- 🔧 Default `colspan` empty state: 14 → 15.

---

## 17.06.2026 — Marketing Critic UI + Alert + DC Media + BOARD bot fix

### Marketing Critic (NEW)
- 🆕 RPC `dashboard_marketing_critic(p_from, p_to, p_project, p_min_spend)` — verdicts: winner/ad_fatigue/low_ctr/overspend/ok з benchmark CTR. Frequency = impressions/raw_data->>'reach'.
- 🆕 UI сторінка `dashboard.dreamcar.ua/marketing-critic/` — KPI cards + таблиця з verdict badges + date pickers + project filter. Sidebar parity з `/meta-analytics/`.
- 🆕 Edge fn `marketing-critic-alert` v1 + pg_cron jobid 1506 (щодня 10:00 Київ): шле TG alert у BOARD chat -1003883456849 при fatigue/overspend/low_ctr або winners. Silent якщо все ok.
- 🔧 Marketing-critic sticky th — `top:0` замість `top:64px` (sticky relative до scroll container, не topbar).

### DC Media Archive (#411 fixed)
- 🔧 `dashboard_settings.dc_media_chat_id` був порожній. Probe знайшов і зареєстрував `-1003912295530` ("DreamCar Media"). Нові published тепер автоматично архівуються через trigger.

### Quiet Hours (#494 verified)
- ✅ Виявлено що `team-tasks-notify` v8 ВЖЕ має власну quiet hours логіку через `team_task_notifications.next_attempt_at` + urgent whitelist (mention/overdue/reminder_1h/creator_done). Refactor не потрібен.
- ✅ Створено helper RPC `enqueue_tg_notify(...)` для ad-hoc нотифікацій з auto quiet-hours scheduling.

### BOARD bot (#490 P0)
- 🔧 `tg-task-extract` v12: 3-pattern robust JSON extractor + graceful fallback + system prompt інструкція вибирати першу задачу з multi-task list. Раніше 500 "LLM returned invalid JSON" на повідомленнях з 1./2./3. структурою.

### Supabase Optimization (Шар 2.x)
- ⚡ SHAR 2.1: `kasa-sync-privat` cron 10хв→15хв (-27 хв CPU/добу).
- ⚡ SHAR 2.3: `mv_dashboard_project_pnl` UNIQUE INDEX → CONCURRENTLY refresh працює fast-path (6.7s→3.4s).
- ⚡ SHAR 2.4: Realtime cleanup -2 unused tables (dashboard_ads_data 18MB, dashboard_projects).
- 🖥 Compute upgrade: Micro → **Small** (2GB RAM, 2-core ARM, $15/міс). Параметри auto-tuned.

---

## 17.06.2026 — P0 Dashboard #472: iPhone 06.06 single-day collapse

### Dashboard (dashboard.dreamcar.ua)
- 🔧 **#472 P0**: completed/single-day проект (наприклад iPhone 17 PRO MAX: starts_on=2026-06-06, ends_on=2026-06-06) + preset "Сьогодні" (17.06) → `spEnd < toDate` → `toDate=06.06` → `fromDate=17.06 > toDate=06.06` → trivial empty `1900-01-01` → **дашборд показував 0/0/0/0**.
- ✅ Fix у `_rpcParams()` (docs/index.html line 2349-2360): якщо проект вибраний і period не перетинається → **fallback на проектний період** замість 1900-01-01. Trivial empty залишається тільки коли проект НЕ вибраний (raw filter без sp).
- 📊 Тепер iPhone з preset "Сьогодні" або "Тиждень" → показує дані за повний проектний день 06.06.

---

## 17.06.2026 — P0 Retention TG approval: відео-креатив

### Edge Function notify-tg v35 (v12)
- 🔧 **#488 P0** (Vira: «воно не показує тут відео що я додала»): `handleRetentionMessageEvent` НЕ завантажував креативи, шле тільки текст. SMM publication review ВЖЕ мав sendPubReviewToChat з media, retention — ні. Регресія аналогічна #225/#315 для retention pipeline.
- ✅ Додано `loadAllRetentionCreatives()` (query на `creative_retention_messages` за `retention_message_id`)
- ✅ Додано `sendRetReviewToChat()` — full SMM-parity: single media → sendPhoto/sendVideo з caption + buttons; multi → sendMediaGroup + окреме повідомлення з кнопками.
- ✅ Caption обрізаний до 1024 chars (TG limit) з smartHtml pass-through.
- 🔄 Ретригер для повідомлення `98b2a1ae-e6ce-47e6-92dd-fa4b2e238ad0` («Відео про Зірве дах…») — відео-креатив 45.5MB доставлений у retention груп-чат + DM Vira/Давиду.

---

## 17.06.2026 — Шар 2: Edge fn audit + MV CONCURRENTLY

### Supabase Performance
- ⚡ **SHAR 2.1**: `kasa-sync-privat` cron 10хв → 15хв (`7,22,37,52 * * * *`). Найважча Edge fn (28-32 sec/call). Звільнено ~27 хв CPU/добу.
- ⚡ **SHAR 2.3**: `mv_dashboard_project_pnl` — додано `UNIQUE INDEX (launch_id)`. Функція `refresh_mv_dashboard_project_pnl()` вже мала `CONCURRENTLY` з fallback — тепер працює fast-path. Refresh 6.7s → 3.4s (-50%), ZERO block на /finance/. Усі 8 MV тепер CONCURRENTLY-refresh.
- 📊 Edge fn audit (top-5 жорти): kasa-sync-privat (45 хв CPU/добу після -27), kasa-sync-mono (5 хв), daily-morning-runner (146 sec/добу 1×), daily-ai-analyst (49.6 sec 1×), tg-notify-queue-flush (1440 calls/добу).

### Supabase Health post-Шар 1+1.7
- ✅ 1 active conn, 0 LWLock waits, 0 cron failures за 15 хв (раніше десятки)
- ✅ DB size 787 MB (раніше 1.2 GB до VACUUM)
- ✅ Peak cron load: 4 jobs/min (раніше 6+)
## 17.06.2026 — IG-аналітика: цикл ↔ продажі

### IG-аналітика
- 🆕 Цикл-рівнева кореляція органіки і продажів: RPC ig_cycle_sales (security definer, paid-угоди+виручка по dashboard_projects×dashboard_deals, Kyiv tz). Таблиця циклів отримала колонки «Угоди»/«Виручка», + скатер «охоплення циклу ↔ виручка». Directional, не атрибуція (канали змішані).

---

## 17.06.2026 — IG-аналітика: hook-кластери + Stories

### IG-аналітика
- 🆕 Hook-кластери: AI-класифікатор у ig_digest (Anthropic) тегує капшни (intrigue/proof/urgency/prize/social/value) + has_cta → блок «Гаки» (ER/sends по типу). Keyword-fallback поки AI не протегував. Колонки hook_type/has_cta.
- 🆕 Stories у ETL → dashboard_ig_stories (forward-only, IG віддає активні ~24 год) + блок на дашборді.

---

## 17.06.2026 — IG-аналітика v3 (ревізія маркетолога)

### IG-аналітика (team.dreamcar.ua/hq/instagram-analytics.html)
- 🔧 Переосмислено за критикою senior-маркетолога: акаунт міряємо не як медіа-бренд, а з поправкою на giveaway-базу.
- 🆕 Когорти по циклах запусків (dashboard_projects): метрики цикл-до-циклу замість пласких 90д (прибрали хибне «ER -51%» від сезонності).
- 🆕 RAG проти ВЛАСНОЇ цілі = базлайн +50% (мотивація), а не проти ринкових бенчмарків. Метрики: останні 30д vs попередні 60д.
- 🆕 Power-пости (saves×sends квадрант), блок «Аудиторія» (досяжність/відток), Reels plays/reach.
- 🔧 Демоут vanity: sends/reach прибрано з hero (тепер ER by reach + досяжна аудиторія); ER-by-followers більше не червоний алярм (спотворений giveaway-базою); best-time heatmap з n-count і сірими комірками при n<3; аномалії — в межах фази.
- 🗑 Revenue-блок свідомо НЕ додано (атрибуція IG-органіки брудна через інші канали).

---

## 17.06.2026 — Instagram-аналітика (HQ) + AI-дайджест

### IG-аналітика (team.dreamcar.ua/hq/instagram-analytics.html)
- 🆕 Нова сторінка HQ «Instagram» (пункт у сайдбарі): KPI 2025-26 (sends/reach, saves/reach, reach rate, ER by reach/followers), формати Reels vs стрічка, ER-тренд з аномаліями, частота×ER, best-time heatmap, топ/слабкі пости, рекомендації, бенчмарк конкурентів. Читає dashboard_ig_* напряму (anon+RLS).
- 🆕 ETL sync_ig_insights.py + cron 2x/день (dreamcar-dashboard) → dashboard_ig_account_daily / dashboard_ig_media. @dreamcar.ua, IG_USER_ID 17841403783002317.
- 🆕 AI-дайджест etl/ig_digest.py + cron 09:00 Київ → dashboard_ig_ai_daily + DM Вадиму (@dreamcar_team_bot). Claude-наратив (ANTHROPIC_API_KEY) з fallback на rule-based сигнали.
- 🛡 RLS select-політики на dashboard_ig_* для authenticated.

---

## 16.06.2026 — Каса: стабільна ширина (скролбар)

### Каса (dashboard.dreamcar.ua/kasa)
- 🔧 `html{overflow-y:scroll;scrollbar-gutter:stable}` — ширина сторінки більше не стрибає при переході між вкладками (місце під вертикальний скролбар тепер резервується завжди).

---

## 16.06.2026 — Каса: критичний фікс верстки (панелі вкладок)

### Каса (dashboard.dreamcar.ua/kasa)
- 🐛 Виправлено корінь скарг «порожні вкладки / крива верстка / немає пагінації»: давній swap блоків «Пошук»/«Останні» зламав розмітку `tblSearch` (між `<table><thead><tr>` і заголовками встромився блок Останніх). Браузер робив foster-parenting → передчасно закривав `.wrap`(#app) → панелі bank/cash/div/transfers/accounts/banks випадали з головної колони у колонку сайдбару й накладались на нього.
- 🔧 Відновлено коректну вкладеність: усі панелі знову всередині `.wrap`. Перевірено jsdom-тестом проти live-файлу (усі 7 панелей у головній колоні, 0 «втікачів»).

---

## 16.06.2026 — Каса: динамічне порівняння періодів

### Каса (dashboard.dreamcar.ua/kasa)
- 🔧 «Порівняння періодів» тепер залежить від обраного періоду (тиждень/місяць/12 міс/довільний) і порівнює з попереднім рівним за тривалістю періодом; спарклайн будується по бакетах поточного періоду.
- 🐛 Виправлено tz-баг: `new Date(y,m,1).toISOString()` у поясі +3 зсував місяць на попередній (показувало «тра» замість «чер»). Дати тепер беруться локально (`toLocaleDateString('sv-SE')`).
- 🛡 Додано захисну перевірку null у перемикачі вкладок. (Перемикання вкладок перевірено headless-тестом jsdom проти live-файлу — працює.)

---

## 16.06.2026 — Каса: Сигнали + Порівняння періодів

### Каса (dashboard.dreamcar.ua/kasa)
- 🆕 Блок «🔔 Сигнали» в Огляді: розбіжність API vs операції, рахунок не синкався >6 год / немає даних балансу, низький (<5К) або відʼємний баланс, великі операції (≥100К) за 7 днів. Колір за критичністю.
- 🆕 Блок «📈 Порівняння періодів»: надходження / витрати / чистий потік за поточний місяць із дельтою % до минулого + SVG-спарклайн чистого потоку за 12 місяців.

---

## 16.06.2026 — Каса: дивіденди у витрати (реконсиляція потоку)

### Каса (dashboard.dreamcar.ua/kasa)
- 🔧 `kasa_cashflow` / `kasa_account_cashflow`: дивіденди тепер рахуються у «витрати» (це фактичний вихід коштів з рахунку). Виключаються ЛИШЕ внутрішні перекази та переміщення в готівку (`excl_pnl` без `div_to`).
- 📖 Реконсиляція: надходження 9.81М − витрати 9.19М = +0.62М ≈ банк-баланс 0.58М. Залишок ~37К — асиметрія внутрішніх переказів (одна нога на неактивному рахунку), у роботі.

---

## 16.06.2026 — Каса: пагінація таблиць операцій

### Каса (dashboard.dreamcar.ua/kasa)
- 🆕 Пагінація на вкладках Безготівка / Готівка / Дивіденди / Перекази: вибір 10/50/100 рядків на сторінку, перемикач сторінок (« ‹ X/Y › »), авто-скид на 1-шу сторінку при зміні фільтра/пошуку (дефолт 50).
- 🔧 В Огляді блок «Пошук операцій» переміщено вище «Останніх операцій».

---

## 15.06.2026 — Каса: видима позначка дивідендів на операції

### Каса (dashboard.dreamcar.ua/kasa)
- 🆕 Операція, переведена в дивіденди, тепер має бейдж «💰 Дивіденди · Вадим/Артем/Порівну» у всіх списках (безготівка, останні, пошук); переказ у готівку — «↪ поза P&L».
- 🔧 `editTransaction`: при повторному відкритті модалка відображає стан «Переміщення → дивіденди/готівка» (раніше показувала як звичайну витрату).
- 🛡 `saveMove` (готівка): захист від повторного створення готівкового надходження при ре-редагуванні вже виключеної операції.

---

## 15.06.2026 — Каса: hotfix після оптимізації

### Каса (dashboard.dreamcar.ua/kasa)
- 🔧 Виправлено: у вибірці переказів помилково вказано колонку `occurred_ts`, якої немає в `kasa_transfers` (помилка 42703) — це ламало всю сторінку (хибний банер «таблиці не створені»). Повернуто `select('*')` для переказів.

---

## 15.06.2026 — Каса: оптимізація швидкості

### Каса (dashboard.dreamcar.ua/kasa)
- ⚡ Прибрано важку колонку `raw` (повний JSON банк-транзакцій) з вибірки списків операцій — payload зменшено ~на 85%, сторінка вантажиться значно швидше.
- ⚡ Додано `sessionStorage`-кеш: при відкритті сторінка миттєво показує останній знімок, а свіжі дані підтягуються у фоні (TTL 10 хв).

---

## 15.06.2026 — Каса: тег-модель дивідендів/готівки + фільтри + частіший баланс mono

### Каса (dashboard.dreamcar.ua/kasa)
- 🔧 «Переміщення → дивіденди/готівка» тепер пере-позначає саму банк-операцію (`excl_pnl` + `div_to`), без окремого переказу й подвійного рахунку. Дивіденди: Вадим / Артем / Порівну (50/50). RPC `kasa_dividends`; `kasa_cashflow`/`kasa_account_cashflow` виключають `is_internal OR excl_pnl`.
- 🆕 Вкладка «Безготівка»: фільтри «тип операції» (дохід/витрата) і «період дат» (сьогодні/вчора/7/30/90 днів/12 міс/весь час/довільний діапазон).
- ⚡ `kasa-sync-mono`: API-баланс монобанку оновлюється кожні ~5 хв (було 55) — усуває відʼємну розбіжність «баланс vs операції» (баланс лагав, операції свіжі кожні ~2 хв).

---

## 15.06.2026 — #407 Каса — внутрішні перекази не рахуються в П&Л

### Kasa
## 15.06.2026 — #421+#422 Cross-system координація SMM ⇄ Retention

### Calendar / Library
- 🆕 RPC `ghost_calendar_events(p_source, p_from, p_to)` — повертає планові події з іншої системи (SMM публікації для Retention, retention розсилки для SMM). Filter: status NOT IN draft/cancelled/failed/rework.
- 🆕 #421 У `/retention/#calendar` — ghost SMM пости як приглушені chips (синя смужка 📢, opacity 0.7, неклікабельні). Hover показує канал+час+назву. fetch у boot.
- 🆕 #421 У `/hq/#calendar` (SMM) — ghost retention розсилки (фіолетова смужка 🤖). Render у renderMonth перед публікаціями. Vira і Олександр одразу бачать конкуренцію часу.
- 🆕 VIEW `v_creative_usages` (creative_id, source, ref_id, ref_title, ref_at, channels) — UNION creative_publications + creative_retention_messages з JOIN на publications/retention_messages.
- 🆕 #422 Used-бейдж 🔗 N у retention picker: лівий верхній кут картки, фіолетовий 85%. Hover/click показує tooltip зі списком: «📢 SMM · назва · 14.06 12:00 / 🤖 Ret · назва · 15.06 18:00». Перші 8 + counter "+ще N".
- 📖 Мета: оператори SMM і Retention не пересікаються по часу і не дублюють креативи між каналами.

---

## 15.06.2026 — #416-#418 Retention: креативи + спільна бібліотека

### Retention / Library
- 🆕 #416 DB pivot `creative_retention_messages (retention_message_id, creative_id, sort_order)` як `creative_publications` для SMM. RLS authenticated read+write.
- 🆕 `creatives.scopes text[]` (GIN index) + триггери на INSERT у `creative_publications` → tag 'smm', на INSERT у `creative_retention_messages` → tag 'retention'. Backfill: 45 креативів вже tagged 'smm'.
- 🆕 #417 У Retention modal блок «📸 КРЕАТИВИ» між Нотатками і Погоджують. Кнопки «🖼 З бібліотеки» (picker overlay multi-select з 200 останніх креативів) + «📤 Завантажити нові →» (новa вкладка /hq/#library).
- 🆕 Render thumbnail grid (відео з ▶ label) + кнопка × для прибирання. Save sync: DELETE+INSERT у `creative_retention_messages`.
- 🆕 #418 Sidebar Retention: новий nav-item «🖼 Бібліотека креативів» → /hq/#library (нова вкладка).
- 📖 Vadym + Davyd UX request: Vira не могла додавати фото/відео у retention — тепер може.

---

- 🆕 `kasa_transactions.is_internal` + тригер `kasa_mark_internal`: авто-визначає перекази між власними рахунками (контрагент = наш IBAN, або імʼя Спірін/Заяць, або «переказ власних коштів»).
- 🔧 Дашборд: внутрішні виключені з доходів/витрат і графіка cashflow; показуються з тегом «🔄 внутр.». На баланси рахунків впливають як і раніше. Знайдено 30 таких операцій.

---

## 15.06.2026 — #406 Каса — fix кодування ПриватБанк (windows-1251)

### Kasa
## 15.06.2026 — #413 + #414 Finance: edit % rate + Запуски → Проєкти

### Finance
- 🆕 #413 Поле «📊 Поточна ставка %» у modal редагування категорії типу «% з угод» (PCT_BANK / PCT_FOP / PCT_ZSU / PCT_ACC). Save → UPDATE `percent_rates.rate_pct` для active row або INSERT нової. P&L matview оновлюється /15min — нова ставка перераховує всі проєкти.
- 🔤 #414 Глобальний rename «Запуски» → «Проєкти» у всіх UI labels:
  - /finance/: 11 lables (Запуски (приз) / P&L по запусках / Запуск select / Пошук запуску / тощо)
  - /kasa/: th Запуск → Проєкт у Income/Expense/Cash таблицях
  - app-dashboard-extras.js: Pulse bar «Активні запуски» → «Активні проєкти»
  - /hq/: launches CRUD, projects sub, autopost-status, views
  - /projects/, /info/, /onboarding/, /orgchart-full/, index.html
  - БД launches таблиця / launch_id ідентифікатори — НЕ чіпали

---

- 🔧 Privat ACP віддає тіло у windows-1251 — декодую через `TextDecoder('windows-1251')` (раніше UTF-8 → кирилиця = сміття).
- 🔧 upsert операцій тепер оновлює existing рядки (onConflict без ignoreDuplicates), `?repair=1` скидає курсор для повного перетягу. ~10k рядків перезаписано з правильним текстом.

---

## 15.06.2026 — #405 Каса — фактичні API-баланси банків + детектор розбіжностей

### Kasa
## 15.06.2026 — #415 Каса Privat — кодування Windows-1251

### Kasa
- 🔧 Privat ACP API віддає JSON у Windows-1251 (не UTF-8). `r.json()` декодував кирилицю як UTF-8 → `?????`. Vadym показав скрін з крякозябрами.
- 🔧 Fix у `kasa-sync-privat` v5: `arrayBuffer()` + `TextDecoder("windows-1251").decode()` + `JSON.parse`. Auto-detect charset з Content-Type.
- 🛡 Видалено крякозябрні рядки з `kasa_transactions`. Resync 10089 транзакцій з правильним декодуванням. Verify: "DCI-moto-... за iнформацiйнi послуги (1 токен). Без ПДВ." ✓

---

- 🆕 `kasa_accounts.api_balance/api_balance_at` — реальний залишок з API банку: monobank `client-info.balance` (щогодини), Privat `statements/balance` (щозапуску). Дашборд показує саме його, не суму операцій.
- 🆕 Детектор розбіжностей: якщо API-баланс ≠ (opening + операції) → позначка «⚠ розбіжність з операціями» на картці (поки історія добирається).
- 🔧 Активні лише 4 бізнес-рахунки (mono fop ·0536/·1764 + Privat ФОП ·9785/·2155); порожні/особисті картки вимкнено.
- 🔧 Межа backfill — не глибше 2026-03-01. cron розділено: mono */2 хв, privat */10 хв.
- 🛡 Усі одноразові `kasa-migrate*/addcred/status/monoinfo/check` вимкнено (410) — guard-ключі були у публічній git-історії.

---

## 15.06.2026 — #404 Каса — авто-синк банків (4 рахунки ФОП)

### Kasa
- 🆕 Таблиця `kasa_bank_creds` (bank/label/token/privat_id) + `kasa_config(cron_key)`. Токени вводяться у вкладці «🔑 Банки» (RLS, лише 2 email; cron_key недоступний фронту).
## 15.06.2026 — #412c Dashboard RPC cache + катастрофа врятована

### Dashboard / DB
- ⚡ **dashboard_kpi_summary 92с → 13мс на cache hit (7100×)**. Universal RPC cache layer (`dashboard_rpc_cache` table) + `dashboard_kpi_summary_cached()` wrapper з 15хв TTL.
- 🆕 Cache cleanup cron `rpc-cache-cleanup-30min` (видаляє >2год).
- 🆕 Expression index `idx_deals_is_paid` на `is_paid_deal(utm_campaign, utm_content, utm_term)` — раніше Postgres сканував всі 211k рядків при traffic_type filter.
- 🔧 Frontend `kpiSummaryRPC` дзвонить cached RPC, fallback на оригінальну якщо помилка.

### КАТАСТРОФА #432 + рятування
- 💥 P0: `python3 << 'PYEOF'` heredoc у Desktop Commander **обрізав docs/index.html з 5404 → 220 рядків**. Push a34789e (-2200 deletions) пройшов на prod.
- 🛡 Rescue: `git revert a34789e` (commit 39c77f1) → файл повернувся до 5404. Прод працює.
- 🚀 Правильна заміна через `sed -i.bak` (1 рядок змінено, 5404 збережено). Commit b74f0de.
- 📖 HARD RULE до пам'яті: НЕ python heredoc для великих HTML — тільки `sed` / `Edit` tool. Завжди `wc -l` + `git diff --stat` перед push. Якщо `-2000 deletions` → revert НЕГАЙНО.

---
## 15.06.2026 — #412b Dashboard швидкість — fewer waits

### Dashboard / DB
- ⚡ **Filter dropdowns: 1-4с → 10мс** (`pay_provider` / `tariff` / `project` / `customer_type` / `utm_*` dropdowns). Раніше: 936 викликів × distinct query = ~40 хв waiting. Тепер: 1 раз кеш + 30хв refresh.
- 🆕 Materialized view `mv_dashboard_filter_options(field, val)` + UNIQUE INDEX (field, val) + `mv_filter_options_field` для швидкого `.eq('field', ...)`.
- 🆕 pg_cron `mv-filter-options-30min` `6,36 * * * *` → `refresh_mv_dashboard_filter_options()`.
- 🔧 Frontend `loadTariffs` / `loadPayProviders` тепер читають з matview через `from('mv_dashboard_filter_options').select('val').eq('field', 'tariff')`. Fallback на старий distinct sql якщо matview недоступна.
- 🆕 **UNIQUE INDEX `mv_utm_agg_pk` (field, key, project, day, COALESCE(tt, ''))** на `mv_dashboard_utm_agg` — тепер cron може REFRESH CONCURRENTLY (раніше блокував читачів на 25-34с × 4 рази/год). Cron `mv-utm-agg-refresh-15min` оновлено.
- 🚀 Cache: `dc-build` → `20260615-speed-412b`.
- 📖 Залишилось: dashboard_extended_kpi RPC 53с avg, max 132с — буде окремо у #412c (matview по основних пресетах today/7d/30d).

---
## 15.06.2026 — #412 P0 Finance швидкість — matview + SWR cache (17.4с → ~50мс)

### Finance / DB
- ⚡ **870× швидше:** `dashboard_project_pnl()` 17.4с → `dashboard_project_pnl_cached()` ~20мс. Vadym: «це біда» — підвантаження 15-20с при кожному відкритті /finance/ — виправлено.
- 🆕 Materialized view `mv_dashboard_project_pnl` (UNIQUE INDEX на launch_id) — snapshot повної P&L по запусках.
- 🆕 pg_cron job `mv-pnl-refresh` `*/15 * * * *` → `refresh_mv_dashboard_project_pnl()` (CONCURRENTLY, з fallback на non-concurrent). Лог тривалості у `dashboard_settings.mv_pnl_last_refresh`.
- 🆕 RPC `dashboard_project_pnl_cached()` повертає `{data jsonb, refreshed_at, age_seconds}` — frontend знає вік даних для індикатора.
- 🆕 Frontend stale-while-revalidate: `fetchPnlSWR(onData)` — кеш у `localStorage` (`dc_finance_pnl_cache_v1`, TTL 10хв). Рендерить миттєво з кешу → у фоні тягне fresh → перерендерює.
- 🔧 `reloadOverview` показує статус-бар: «⚡ З кешу (5с) · свіже» / «Показано з кешу (3хв) · оновлюю...» / «⚡ Оновлено · matview 16:42 Київ» — користувач бачить що дані актуальні.
- 🚀 Cache version: `finance-build` → `20260615-pnl-cache`. Cloudflare Pages auto-deploy + _headers purge.
- 📖 Метрика: при першому відкритті — 1с (server matview); при повторному (cache hit) — миттєво (0с); фон refresh не блокує UI.

---
## 15.06.2026 — #411 DC Media archive — автопостинг published у архівну групу

### SMM / Telegram
- 🆕 Edge fn `dc-media-archive` v3 — постить публікацію у групу **«DreamCar Media»** (`-1003912295530`) як media-group (до 10 креативів) з caption = `<b>title</b> + text_body + дата Київ`.
- 🆕 DB trigger `dc_media_archive_on_published` (AFTER UPDATE OF status ON publications WHEN NEW.status='published' AND OLD.status<>'published') → `net.http_post` до Edge fn. Помилка HTTP не ламає main update.
- 🛡 Probe-mode `?probe=1` (без secret) — викликає `getChat` на всіх listening chats, auto-register групу з 'media' у title. Знайдено: `Group 6` (-1003912295530) → live title «DreamCar Media». Записано у `dashboard_settings.dc_media_chat_id`.
- 🔧 Виправлено заголовки у `tg_listening_chats` для Group 3 (DreamCar TECH), Group 4 (DreamCar BOARD), Group 5 (DreamCar потєряшкі), Group 6 (DreamCar Media).
- 🔧 Caption: TG HTML parse_mode (`<b>`/`<i>`/`<u>` рендеряться), text_body не strip-ається, `<br>`→`\n`, інші теги залишені, обріз 1024 chars (HARD RULE caption ліміт).
- 🔧 `disable_notification: true` — архів без піків у учасників групи.
- 🚀 Тест: `ff35c79f-eab8-48dc-99cf-4aefbb42eab7` (#383) → `{ok:true, mode:'media-group', media_count:1, chat_id:-1003912295530}`. Доставлено у DreamCar Media.
- 📖 Запит Давида: «коли публікація переходить в статус опубліковано Бот постить в групі медіа з текстом і креативами — для архіву і легкої передачі для гугл едс».

---

- 🔧 `kasa-sync-mono` + `kasa-sync-privat` тепер читають креди з БД (мульти-ФОП), guard по cron_key. Privat — backfill-курсор per-cred; mono — 1 statement/60с на токен.
- 🚀 Автосинк через `pg_cron` job `kasa-sync` кожні 10 хв → `net.http_post` обох функцій. Історія підтягується backfill-вікнами (~3 роки).
- 🆕 Вкладка «🔑 Банки» у Касі: CRUD підключень + статус останнього синку.

---

## 15.06.2026 — #403 Каса (факт) — облік фактичного руху коштів

### Kasa
- 🆕 Сторінка `dashboard.dreamcar.ua/kasa/` — безготівка / готівка / дивіденди / перекази між книгами. Доступ лише 2 email (1avrybak@, dreamcarua@) на рівні UI + RLS.
- 🆕 Таблиці `kasa_accounts` / `kasa_transactions` / `kasa_transfers` (адитивно, без FK на launches/cost_categories — soft-refs). Застосовано через одноразову Edge `kasa-migrate` напряму по `SUPABASE_DB_URL`.
- 🆕 Edge Functions `kasa-sync-mono` (ФОП, ліміт 1 req/60с, backfill-курсор) + `kasa-sync-privat` (Автоклієнт). Cron+secrets — pending банк-токени.
- 🆕 Імпорт виписки ПУМБ (CSV/XLSX) у UI з дедуплікацією по `source+external_id`.
- 🆕 Категорії доходів/витрат + прив'язка до запусків (тягне `cost_categories`/`launches`).
- 🆕 Лінк «Каса» у сайдбарі дашборду (секція Стратегія).

---

## 15.06.2026 — #402 Finance trend chart — Виручка vs Реклама (замість cumulative profit)

### Finance UI
- 🔧 На «Revenue & Profit Trend» прибрав золоту лінію cumulative profit (Vadym: не потрібна, краще витрати).
- 🆕 RPC `dashboard_finance_overview` тепер повертає `ad_spend` (total) + `daily_ads` array (по днях).
- 🆕 `drawTrend` рендерить два grouped bars: «Виручка» (DC red) + «Реклама» (gold). За 30 днів видно дисбаланс: 7.24M ₴ revenue vs 856k ₴ spend → ROAS ~8.5×.
- 🔤 Заголовок чарта: «💰 Виручка та витрати на рекламу».

---

## 15.06.2026 — #401 Finance Категорії — accordion tree замість таблиці

### Finance UI
- 🔧 Стара таблиця «Order / Іконка / Назва / Код / Тип / Sub of / Дії» — parents та children виглядали однаково, неочевидна ієрархія.
- 🆕 Новий accordion-tree:
  - кожна корінна категорія = картка з gradient parent-header (DC red акцент 3px зліва), іконка 22px, назва жирним, код моноширинним поряд
  - чевpon ▶ → ▼ при розкритті, бейдж «N підкатегорій»
  - type pill кольорами: Variable синій, Fixed зелений, % з угод золотий
  - children з branch lines `┣ ┗`, приглушеним кольором, типом pill
  - hover на child — підсвічування + повна opacity дій
- 🗑 Прибрана колонка «Sub of» (інформація вже у дереві).
- 🆕 Пошук розкриває релевантні групи автоматично; meta показує «20 категорій · 8 груп · показано 20».
- ✅ Verified prod: 8 груп + 16 children, всі читаються з першого погляду.

---

## 15.06.2026 — #400 Ad Spend атрибуція у P&L — fuzzy + period fallback

### Finance / Ads attribution
- 🔧 У `dashboard_project_pnl` Ad Spend був 0₴ для всіх запусків. Причина: 91% spend у `dashboard_ads_data` (3.66M₴) має `utm_campaign=NULL`, а решта 9% має campaign-назви типу `audiq7_anons`, `bmw_iphone_anons`, `ob|atrib1d|bmw+iphone|video|adv|17.01`. Старий regex `\m{ALIAS}\M` (word-boundary) на utm_campaign не зловлював.
- 🔧 RPC v7: трирівнева attribution. **L1 explicit**: ILIKE substring проти `utm_campaign` АБО `campaign_name` (FB Ads Manager назви). **L2 period fallback**: для рядків з NULL обома полями — рівномірно ділити spend між запусками що активні у той день. Lifetime/idea запуски (DreamCar CONTENT, HUMMER H2) виключені, щоб не поглинати все.
- 🔧 Розширив `launches.deal_aliases`: AUDI E-TRON 2026 → +audi_etron/etron, BMW X5 #17 → +bmw_x5, Мото → +moto, iPhone → +iphone17/айфон 17.
- ✅ Verified prod: AUDI 560.8k₴ spend (ROAS 13.6×), BMW X5 466k (ROAS 4.0×), Мото 154.7k (ROAS 8.8×), iPhone 32.6k (ROAS 17×). True margin 66-85% замість 91.5% (тепер з рекламою).

---

## 15.06.2026 — #399 Team bot quiet hours 00:00–09:00 Київ (Давид)

### TG team bot
- 🔴 Раніше `team-tasks-notify` мав quiet hours, але у `Europe/Warsaw` (CET) з дефолтами `quiet_from=22, quiet_to=8`. Тобто реально quiet починався о 23:00 Київ (літом). Plus `cron-reminders` НЕ мав quiet hours узагалі.
- 🆕 SQL helper: `public.is_quiet_hours_kyiv(p_at)` повертає true якщо година Київ <9. `public.next_send_time_kyiv(p_at)` повертає 09:00 Київ якщо ще quiet, інакше переданий час.
- 🆕 Інфраструктура queue: `public.tg_notify_queue` table + `public.enqueue_tg_notify()` SECURITY DEFINER + Edge fn `tg-notify-queue-flush` що читає pending і шле через TG. Pg_cron `tg-notify-queue-flush-minute` (`* * * * *`).
- 🔧 `team-tasks-notify` v8: timezone → Europe/Kyiv. Дефолти `team_task_user_prefs.quiet_from=0, quiet_to=9` (раніше 22/8). Урgent whitelist (mention/overdue/reminder_1h/creator_done) тримається — критичні events не блокуються.
- 🔧 `cron-reminders` v4: early-return у quiet hours — G2/G3/G4/G6 нагадування про публікації не стріляють вночі. T+10хв (пропущена публікація) має 24h anti-spam → ранком о 09:00 розбудить нагадуванням якщо треба.
- ✅ Verified: 23:30 Київ → send-now, 00:30/08:30 → quiet, 09:00 → send-now, ніч → scheduled на 09:00 наступного дня.

---

## 15.06.2026 — #398 Finance Dashboard P0 — швидке завантаження + правильна виручка

### Finance / Dashboard
- 🔧 KPI Revenue показував 11.37M (lifetime з PnL) — мав показувати 7.24M (за період). Створив новий RPC `dashboard_finance_overview(p_from, p_to)` SECURITY DEFINER що агрегує `revenue/paid/prev_revenue + daily series + by_project` на бекенді (без 1000-row REST ліміту Supabase).
- ⚡ `dashboard_project_pnl` RPC висів 44с через cartesian `LEFT JOIN ON true` (8 launches × 60k+ deals = 480k агрегацій). Переписав на `matched_deals` CTE з реальним JOIN ON ANY(aliases). 44с → 20с. Додав індекси: `dashboard_deals (status, created_at DESC) INCLUDE (amount, project) WHERE status='pay' AND amount>0` + `(project, created_at DESC)`.
- ⚡ Frontend 2-фазне завантаження: Phase 1 (~5с) — RPC overview → KPI/trend/forecast/insights з proxy margin. Phase 2 (~20с у фоні) — PnL → уточнення margin + cost-структура + ranking + точні insights. Skeleton shimmer + loading bar поки чекає.
- 🔧 `init()` тепер запускає `reloadOverview()` БЕЗ чекання `loadAll()` — миттєвий старт RPC.
- ✅ Verified prod: Revenue 7.24M ₴, Profit 6.62M ₴, Margin 91.5%, CAC×AOV 11.8×, 17 431 оплат за 30 днів. Skeleton зникає через ~5с після відкриття.

---

## 15.06.2026 — #397 BIG Finance Dashboard v2 — повноцінний аналітичний огляд

### Finance / Dashboard
- 🆕 `/finance/` — новий перший таб **📈 Огляд** (default).
- 🆕 **6 KPI cards** (Hero): Net Profit (gold, 38px), Revenue, Margin %, Total Cost, CAC/AOV ratio, Daily Run Rate. Кожна з delta vs попередній рівнозначний період і target-badge.
- 🆕 **Period switcher**: 7d / 30d / Цей місяць / 90d / YTD / All + кастомні from/to. Active state з gold underline на DC red.
- 🆕 **Revenue & Profit Trend** combo chart (Chart.js): bars (daily revenue) + line (cumulative profit gradient gold→transparent). 2 осі.
- 🆕 **Cost breakdown** horizontal bars (НЕ donut — Stephen Few rule): Реклама / % з угод / Fixed / Призовий / Variable, sorted by sum.
- 🆕 **P&L таблиця** 14 колонок з conditional formatting (margin&lt;20% жовтий, &lt;0 червоний; ROI&lt;100% жовтий, &lt;0 червоний), sticky first col, footer totals.
- 🆕 **MTD Forecast**: progress bar поточного місяця + run-rate end-of-month projection.
- 🆕 **Top &amp; losers**: топ-3 по net profit + 2 з найнижчою маржею.
- 🆕 **Auto insights**: margin, revenue delta vs попередній період, ROI&gt;500%, проекти з негативним прибутком, AOV/CAC ratio &lt;3×.
- ✅ Verified: Revenue 11.37M ₴ / Profit 10.40M ₴ / Margin 91.5% / CAC×AOV 11.8× / MTD прогноз 480.3k ₴. 7 P&L рядків + footer. 4 insights, 4 ranking. CRUD таби intact.

---

## 15.06.2026 — #396 Daily AI Analyst v6 — більше не алярмить по завершених проектах

### AI/Analytics
- 🔧 Ранковий дайджест видавав термінову ескалацію по AUDI E-TRON («5+ днів, 0₴ виручки → вимкнути проєкт») попри те що проект завершився 31.05.
- 🔧 Дві першопричини: (1) `dealsDay()` агрегувала `pay`-записи з `amount=NULL` як `paid: count++, rev += 0` — хвостові операції (refund/retry/test) виглядали як проблема з платежами; (2) AI взагалі не знав які проекти зараз active vs completed.
- 🔧 daily-ai-analyst v6: фільтр `amount > 0` у pay-аггрегації + окремий `tail_pay_null` counter (для діагностики) + нова функція `launchesStatus()` що передає у промпт `ACTIVE_LAUNCHES` та `COMPLETED_LAUNCHES` + явна інструкція в system prompt не давати alarm-ів про завершені проекти.
- ✅ Dry-run verified: AI правильно класифікує AUDI E-TRON як «завершений проєкт, хвости у порядку» і фокусується тільки на активних запусках.

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
