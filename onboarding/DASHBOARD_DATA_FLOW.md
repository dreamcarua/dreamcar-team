# DreamCar Dashboard — архітектура даних

**Версія:** 03.06.2026
**Документ для:** Вадим (CEO), Артем (співзасновник), Давид (COO), нові розробники
**Джерело правди:** `dashboard.dreamcar.ua` (frontend) + Supabase project `dreamcar-hq` (`wotghlaehnvxyeacznvv`)

---

## TL;DR

Dashboard агрегує дані з 4 незалежних джерел через шар Materialized Views та RPC функцій. Real-time оновлення через Supabase Realtime WebSocket. Основні ризики — залежність від зовнішніх webhook (SendPulse) та cron job (FB Ads ETL).

---

## 1. ПОТОКИ ДАНИХ — 4 точки входу

### 1.1 Продажі (deals) — основний потік

```
SendPulse CRM (CRM-система клієнтів)
    │
    │ webhook "Вебхуки об успешной оплате"
    │
    ├──► Legacy: сервер Олександра ──ETL──► raw mysql
    │                                          │
    │                                          ▼ */5min cron
    │                                    dashboard_deals
    │
    └──► Наш Edge Function (з 03.06.2026 паралельно)
             webhook-dashboard-sendpulse
             │
             ▼
         dashboard_webhooks (raw payload log)
             │
             ▼ normalize у Edge fn
         dashboard_deals
```

**Затримка:** <1 секунда (webhook real-time).
**Об'єм:** 201,824 deals станом на 03.06.2026.
**Status сьогодні:** dual-write активний, перша справжня оплата очікується у суботу 06.06.2026 для перевірки нашого Edge endpoint.

### 1.2 Реклама (FB Ads spend / clicks / impressions)

```
Facebook Marketing API v21.0
    │
    │ System User token "Volvo_Dashboard_API" (id 61584044034889)
    │ Scope: ads_read / business_management / read_insights
    │
    ▼
etl/sync_fb_ads.py (Python client)
    │
    │ GH Action cron */15 хв (.github/workflows/fb-ads-sync.yml)
    │ Repo: dreamcarua/dreamcar-dashboard
    │
    ▼
dashboard_ads_data (6,676 rows)
    │
    │ + витяг UTM з ad creative link URLs (3 стратегії)
    │
    ▼
mv_paid_signatures (унікальні UTM-signatures платних кампаній)
    │
    │ використовується для класифікації deals → paid / organic
    │
    ▼
is_paid_deal(utm_campaign, utm_content, utm_term) → boolean
```

**Затримка:** до 15 хв (cron interval).
**Object:** 3 ad accounts (UAH / CLUB USD / CLUB UAH).
**Backfill:** 02.04.2025 → today, 7131 ad rows, 3.46M UAH spend, 25M impressions, 387K clicks, 78K conversions.

### 1.3 Проекти / UTM mapping (статичні довідники)

```
Admin UI #settings → dashboard_projects (7 авто-проектів)
    │
    │ code / name / car_model / date_start / date_end
    │ deal_project_values text[] (як угоди мапляться на проект)
    │
    ▼ використовується у:

filters.project_values → RPC параметр p_project_values
```

**Затримка:** миттєво (admin вручну).
**Поточні 7 проектів:** Архів-до-VOLVO / VOLVO XC90 / AUDI Q7 / BMW 330E HYBRID / MERCEDES GLE COUPE / BMW X5 HYBRID / AUDI E-TRON.

### 1.4 Ручні витрати (manual costs)

```
Admin UI #manual-costs → dashboard_manual_costs
    (партнерства, призи, сервіси, інше не-FB-Ads)
```

**Object:** усе що не Facebook Ads, але впливає на ROI.

---

## 2. ШАР АГРЕГАЦІЇ — між raw і UI

```
                  Raw tables
        (dashboard_deals / ads_data /
        manual_costs / projects)
                    │
                    │ cron jobs refresh
                    ▼
        ┌──────────────────────────────┐
        │  5 Materialized Views        │
        │  ─────────────────────────   │
        │  mv_dashboard_globals    │ hourly
        │  mv_dashboard_utm_agg    │ */15 min
        │  mv_dashboard_projects   │ */15 min
        │  mv_paid_signatures      │ */15 min
        │  mv_cohort_retention     │ daily 04:00
        └──────────────────────────────┘
                    │
                    ▼
        41 RPC SECURITY DEFINER функцій
        (виконуються від service role)
                    │
                    ▼
        Supabase JS SDK у браузері
                    │
                    ▼
        Frontend rendering (Chart.js + tables)
```

**Чому MV:** агрегації по 200K deals + 6700 ad rows інакше тривають 30-60 секунд. MV дозволяють тримати pre-computed данні і брати їх за <100 мс.

**Чому RPC:** RLS на raw tables дозволяє юзеру бачити тільки свої дані. RPC `SECURITY DEFINER` обходить це і повертає агреговані числа всім авторизованим.

### Швидкість RPC (warm cache, 03.06.2026)

| Route | RPC | Час |
|---|---|---|
| `#analytics` KPI | `dashboard_kpi_with_delta` | 69 мс |
| `#sources` / `#terms` | `dashboard_agg_deals_with_traffic` | 34 мс |
| `#projects` overview | `dashboard_projects_with_stats` (MV) | 3 мс |
| `#cohort` heatmap | `dashboard_cohort_retention` (MV) | <50 мс |
| `#webhooks` health | `dashboard_webhook_health` | <100 мс |
| Live updates | Supabase Realtime WS | <200 мс push |

---

## 3. REAL-TIME ШАР

```
INSERT у dashboard_deals (від webhook)
    │
    │ Supabase WAL → Realtime publication
    │
    ▼
WebSocket push → всі підключені dashboard tabs
    │
    │ debounced auto-reload (3 сек)
    │
    ▼
loadCurrentRoute() з новими даними
LIVE badge оновлює seconds-ago counter
```

**Що передається через Realtime:**
- `dashboard_deals` (нові оплати) ✅
- `dashboard_ads_data` (нові ad metrics) ✅
- `dashboard_webhooks` ❌ ВИМКНЕНО (WAL спам, write-heavy)

---

## 4. ВУЗЬКІ МІСЦЯ ТА РИЗИКИ

Ранжовано за impact + ймовірністю.

### 🔴 HIGH — SendPulse webhook = single point of failure

**Опис:** SendPulse надсилає payment webhook один раз. Без retry policy. Якщо наш endpoint не відповів за timeout — оплата не потрапляє в систему.

**Що зараз:**
- Legacy webhook (сервер Олександра) — основний канал, працює стабільно.
- Наш Edge Function `webhook-dashboard-sendpulse` доданий паралельно з 03.06.2026.

**Mitigation:**
- Dual-write 1 тиждень → звірка лічильників → cutover тільки якщо parity 100%.
- Cron `webhook-health-alert` */30 хв шле DM Вадиму при success_rate <90%.

**Action items:**
- Моніторинг `#webhooks` route щодня цього тижня.
- Перевірити що SendPulse передає всі потрібні поля (utm_source / medium / campaign / content / term / deal_id / amount / currency / project_id).

### 🟠 MEDIUM — FB Ads ETL gap

**Опис:** Якщо `fb-ads-sync.yml` GH Action впаде на годину — реклама на дашборді відстає.

**Ризики:**
- FB API rate limit 200 calls/hour на System User. Великі backfill = ризик блокування.
- Якщо токен `Volvo_Dashboard_API` стане invalid (Page видалили / app permissions знято) → silent fail у GH Action логах.

**Mitigation:**
- Exponential backoff (5/10/20/40 сек) у `sync_fb_ads.py`.
- Auto-chunk періодів >80 днів (FB API 90-day limit).

**Action items:**
- Додати GH Action notification на 2+ підряд fail → Telegram alert.
- Раз на квартал — перевіряти що System User не deactivated.

### 🟠 MEDIUM — Currency split в Revenue header

**Опис:** Тарифи мають різні валюти (UAH / USD / EUR). Revenue header показує сумовану цифру **без конвертації**.

**Що мати на увазі:**
- AOV / Revenue у KPI cards — це сума "сирих" чисел. Точність низька якщо є CLUB USD проекти у періоді.
- `dashboard_extended_kpi` має currency split breakdown.

**Action items:**
- Додати exchange rate сервіс (НБУ API чи Open Exchange Rates) → конвертувати всі суми в UAH у момент query.

### 🟡 LOW-MEDIUM — MV freshness gap (15 хв)

**Опис:** MV refresh */15 хв. Перші 15 хв нової оплати показуються у `#deals` (Realtime), але НЕ у Analytics aggregations (MV).

**Mitigation:**
- LIVE badge показує `MAX(created_at)` з deals → user розуміє свіжість.
- Для Analytics можна тригерити manual refresh через RPC `refresh_all_dashboard_views()` (admin only).

### 🟡 LOW — Realtime WebSocket bandwidth

**Опис:** Кожна нова deal → WS push на всі вкладки.

**Поточний стан:** 5+ юзерів, ~10 оплат/хв пік → OK.

**Mitigation:** debounced auto-reload (3 сек), не reload на КОЖНУ deal.

### 🟡 LOW — Supabase IO budget

**Опис:** 02.06.2026 був email "Disk IO Budget depleting" — `dashboard_webhooks` росла до 701 MB.

**Mitigation вже застосована:**
- TRUNCATE + cron auto-cleanup >14 днів.
- DROP unused indexes на `dashboard_deals` (4 застарілих).
- DROP redundant single-col indexes.
- Pro tier upgrade ($25/міс) → +budget.

**Що моніторити:** Supabase Dashboard → Reports → Database → Disk usage. Тримати <70%.

### 🟡 LOW — People merge (CRM ↔ ADS) manual

**Опис:** Один клієнт може мати кілька email/телефонів у CRM, але один FB click. Merge — вручну через `#people` route. Без merge counts завищені (один юзер рахується як кілька).

**Mitigation:** `dashboard_people_mapping` table + UI у `#people`. Адмін регулярно merge нових клієнтів.

---

## 5. МОНІТОРИНГ — що дивитись регулярно

### Щодня
- `#webhooks` route → success_rate за 24h, мають бути 100%
- Telegram DM від `@dreamcar_team_bot` (cron alert)

### Щотижня
- Звірка lifetime revenue legacy vs наш webhook (поки dual-write)
- Manual costs введені актуально

### Щомісяця
- FB System User token check (просто залогінитись у Business Manager)
- Supabase Disk usage <70%
- Supabase Compute usage (CPU) <80%

### Раз на квартал
- Currency conversion sanity check
- People merge backlog (нові клієнти без mapping)
- Архівація `dashboard_webhooks` >90 днів (зараз cleanup */14 днів)

---

## 6. ШО ПРАЦЮЄ ВЖЕ ЗАРАЗ (03.06.2026)

- 20 Edge Functions ACTIVE
- 18 cron jobs (всі succeeded last 24h)
- 5 Materialized Views свіжі
- 41 RPC SECURITY DEFINER
- Real-time deals push <200 мс lag
- KPI <100 мс (warm cache)
- 24h webhooks: 4/4 = 100% success (тестові, поки нема реальних оплат після додавання нашого endpoint)

## 7. ЩО ОЧІКУЄМО

- 🟡 06.06.2026 (субота) — перша справжня оплата → перевірка нашого Edge endpoint
- 🟡 10.06.2026 — звірка legacy vs наш (parity check)
- 🟢 Якщо parity 100% — cutover з сервера Олександра на наш endpoint
- 🟢 Якщо parity <100% — debug різниці, не вимикаємо legacy

---

## 8. SOURCES

- Frontend: `dashboard-dreamcar/docs/index.html`
- ETL FB Ads: `dreamcarua/dreamcar-dashboard/etl/sync_fb_ads.py`
- Webhook Edge: `dreamcarua/dreamcar-hq/supabase/functions/webhook-dashboard-sendpulse/`
- DB migrations: `dreamcarua/dreamcar-hq/supabase/migrations/`
- Onboarding: `dreamcarua/dreamcar-team/onboarding/dashboard.html`
- Previous audit: `DASHBOARD_PARITY_AUDIT_2026-06-03.md`
