# ТЗ: Dashboard A/B/C тестування Upsell у Checkout

**Створено:** 06.06.2026 · **Власник:** Vadym + Артем
**Контекст:** Поточний дашборд (Майстер/Кроки/Варіанти/Аналітика/Порівняння) — нечитабельні таблиці, відсутня статистика significance, нема funnel drop-off, не трекаються кроки до upsell window.

---

## 1. Бізнес-питання які дашборд має відповісти за 30 секунд

1. **Який варіант перемагає прямо зараз?** (з confidence-рівнем)
2. **Чи достатня вибірка щоб приймати рішення?** (sample size estimator)
3. **Де ми втрачаємо людей у checkout funnel?** (drop-off by step)
4. **Чи варто продовжувати експеримент / зупиняти / переможця rollout-ити?**
5. **Який сегмент трафіку реагує найкраще?** (utm/тариф/device)

---

## 2. Нова інструментація — Frontend events

### 2.1. Структура events

На КОЖНОМУ кроці чекауту трекаємо 1 event з 3 можливими станами:

```js
// JS-структура події
trackCheckoutEvent({
  experiment_id: 'upsell_window_1',   // ідентифікатор експерименту
  variant: 'A' | 'B' | 'control',      // гілка
  step: 'phone' | 'data_confirm' | 'upsell_window_1' | 'payment',  // крок
  outcome: 'next' | 'took' | 'dropped', // що сталося
  session_id: '<uuid>',                // sticky 30 днів
  user_id: '<uuid>' | null,            // якщо авторизований
  time_on_step_ms: 12500,              // скільки часу провів
  tariff_base: 'silver',               // базовий тариф (для context)
  amount_base: 999,                    // базова сума
  amount_offered: 4999,                // якщо upsell — що пропонували
  amount_final: 999,                   // що в результаті заплатив
  qty_base: 1,                         // базова кількість
  qty_offered: 3,                      // якщо qty upsell — скільки пропонували
  qty_final: 1,                        // що в результаті
  utm_source, utm_medium, utm_campaign,
  device: 'mobile' | 'desktop' | 'tablet',
  is_repeat_visitor: bool,
  referrer: '<url>',
  ts: '<iso>'
})
```

### 2.2. Outcomes детально

| outcome | Коли тригериться | Приклад |
|---|---|---|
| `next` | Юзер пройшов крок БЕЗ дії з апселом | На upsell window натиснув "продовжити з 1 шт", залишив базовий тариф |
| `took` | Юзер прийняв пропозицію апсела | Вибрав старший тариф або більшу кількість |
| `dropped` | Юзер закрив вікно / закрив таб / 5+ хв тиша | Критичний негатив. Включає soft (close button) і hard (tab close/timeout) |

### 2.3. Sub-states для `dropped` (важливо для діагностики)

- `dropped_close_btn` — натиснув ✕
- `dropped_back_btn` — браузерна "назад"
- `dropped_tab_close` — закрив таб (page unload)
- `dropped_inactive_5min` — 5 хвилин без активності
- `dropped_external` — клік на зовнішнє посилання

### 2.4. Кроки checkout (всі трекаємо)

1. `phone` — введення телефону
2. `data_confirm` — підтвердження персональних даних
3. `tariff_pick` — вибір тарифу (якщо є)
4. `upsell_window_1` — апсел вікно №1 (поточний експеримент)
5. `payment` — крок оплати
6. `success` — успішна оплата
7. `failure` — невдала оплата (потрібно для виключення з конверсії)

---

## 3. DB зміни

### 3.1. Нова таблиця `checkout_events`

```sql
create table public.checkout_events (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null,
  user_id         uuid references public.users(id),
  experiment_id   text not null,
  variant         text not null,          -- 'A' | 'B' | 'control'
  step            text not null,
  outcome         text not null,          -- 'next' | 'took' | 'dropped'
  drop_reason     text,                   -- sub-state для dropped
  time_on_step_ms integer,
  tariff_base     text,
  amount_base     numeric,
  amount_offered  numeric,
  amount_final    numeric,
  qty_base        integer,
  qty_offered     integer,
  qty_final       integer,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  device          text,
  is_repeat       boolean,
  ts              timestamptz not null default now(),
  meta            jsonb                   -- referrer, user_agent, etc.
);
create index on public.checkout_events (experiment_id, variant, step, ts desc);
create index on public.checkout_events (session_id, ts);
create index on public.checkout_events (ts desc);
```

### 3.2. Materialized view для швидкого dashboard

```sql
create materialized view public.mv_upsell_funnel as
with sessions_with_assignment as (
  -- Одна гілка на сесію (sticky)
  select distinct on (session_id, experiment_id)
    session_id, experiment_id, variant, ts as assigned_at
  from public.checkout_events
  order by session_id, experiment_id, ts
),
session_outcomes as (
  select
    s.experiment_id,
    s.variant,
    s.session_id,
    -- Чи дойшов до payment
    bool_or(e.step = 'payment') as reached_payment,
    -- Чи прийняв upsell
    bool_or(e.step like 'upsell%' and e.outcome = 'took') as took_upsell,
    -- Чи завершив оплату
    bool_or(e.step = 'success') as paid,
    -- Скільки заплатив
    max(case when e.step = 'success' then e.amount_final end) as revenue,
    -- На якому кроці dropped (якщо є)
    min(case when e.outcome = 'dropped' then e.step end) as drop_step
  from sessions_with_assignment s
  join public.checkout_events e using (session_id, experiment_id)
  group by 1, 2, 3
)
select
  experiment_id,
  variant,
  count(*) as sessions,
  count(*) filter (where reached_payment) as reached_payment,
  count(*) filter (where took_upsell) as took_upsell,
  count(*) filter (where paid) as paid_sessions,
  coalesce(sum(revenue), 0) as revenue,
  coalesce(sum(revenue) / nullif(count(*), 0), 0) as rps -- revenue per session
from session_outcomes
group by 1, 2;

-- Refresh кожні 5 хвилин cron-ом
```

### 3.3. RPC для statistical significance

```sql
create or replace function public.upsell_significance(
  p_experiment_id text,
  p_period_days integer default 30
)
returns table (
  variant         text,
  sessions        integer,
  paid            integer,
  conv_rate       numeric,
  revenue         numeric,
  rps             numeric,         -- revenue per session
  lift_vs_control numeric,         -- %
  p_value         numeric,         -- Welch's t-test для RPS
  confidence_95   text             -- 'significant' | 'not yet' | 'losing'
)
language plpgsql as $$
  -- Реалізація: бере window 30d, рахує per-variant metrics,
  -- порівнює з control через Welch's two-sample t-test (для RPS — continuous)
  -- + Chi-square для conv_rate (binomial)
  -- ...
$$;
```

---

## 4. Dashboard UI — Layout сторінки `/dashboard/#upsell-ab`

### 4.1. Hero-секція (top, завжди видима)

```
┌─────────────────────────────────────────────────────────────┐
│  🎯 UPSELL WINDOW 1                          [7д][14д][30д] │
│  Період: 06.06 → 06.07.2026 · 273 сесії · GO/NO-GO?         │
├─────────────────────────────────────────────────────────────┤
│  🏆 ПЕРЕМОЖЕЦЬ ПОКИ                                          │
│  Варіант A (пакет дорожче):  +29% RPS · 91% confidence ⚠    │
│  Рекомендація: ЩЕ ~200 сесій до 95% significance            │
└─────────────────────────────────────────────────────────────┘
```

**Логіка статусу:**
- 🟢 SHIP — 95%+ confidence + позитивний lift
- 🟡 CONTINUE — є lift але <95% confidence
- 🔴 KILL — control або negative lift достовірно
- ⚪ NEED DATA — недостатня вибірка

### 4.2. KPI cards (4 в ряд, key metrics)

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   ВИРУЧКА    │   RPS        │   КОНВЕРСІЯ  │  ЛІФТ vs КОН │
│ 39 977 ₴     │ 145 ₴/сес    │ 76.2%        │ +28% 🟢      │
│ всі гілки    │ зважена сер. │ paid/started │ найкращий    │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

### 4.3. Таблиця порівняння (покращена)

```
┌─────────────┬────────┬────────┬────────┬─────────┬──────────┬────────┬──────────────────┐
│ Гілка       │ Сесій  │ Опл.   │ Конв.  │ Сер.чек │ Виручка  │ RPS    │ vs Контроль     │
├─────────────┼────────┼────────┼────────┼─────────┼──────────┼────────┼──────────────────┤
│ 🟢 Контроль │  51    │  35    │ 68.6%  │  173 ₴  │  6 065 ₴ │ 119 ₴  │ baseline        │
│ 🟡 A: тариф │  99    │  76    │ 76.8%  │  200 ₴  │ 15 174 ₴ │ 153 ₴  │ +29% (p=0.09) ⚠ │
│ 🟡 B: к-сть │ 123    │  97    │ 78.9%  │  193 ₴  │ 18 738 ₴ │ 152 ₴  │ +28% (p=0.10) ⚠ │
└─────────────┴────────┴────────┴────────┴─────────┴──────────┴────────┴──────────────────┘
```

Колонки клікабельні → sort. Кожна гілка має toggle "увімкнено/вимкнено" з confirmation.

### 4.4. Конверсійна вирва (HORIZONTAL FUNNEL)

```
КОНТРОЛЬ        ▓▓▓▓▓▓▓▓▓▓ 100% phone
                ▓▓▓▓▓▓▓▓▓░ 96% data_confirm  (-4%)
                [нема upsell window]
                ▓▓▓▓▓▓▓░░░ 73% payment      (-23%)
                ▓▓▓▓▓░░░░░ 51% success      (-22% fails)

ВАРІАНТ A       ▓▓▓▓▓▓▓▓▓▓ 100% phone
                ▓▓▓▓▓▓▓▓▓░ 95% data_confirm (-5%)
                ▓▓▓▓▓▓▓▓░░ 81% upsell shown (-14%) ← КУДИ ЙДУТЬ?
                ▓▓▓▓▓▓▓░░░ 76% payment      (-5%)
                ▓▓▓▓▓▓▓░░░ 71% success      (-7% fails)
```

При hover на кожен крок — breakdown:
- `next` X%  · `took` Y% · `dropped (close)` Z% · `dropped (timeout)` W%

### 4.5. Time-series graph (динаміка)

**Lift chart** — лінійний графік:
- X: дні
- Y: RPS (₴/сесію)
- 3 лінії — control / A / B з shaded confidence interval
- Vertical lines для маркування змін (deploy, config tweak)

**Сумарна виручка** — stacked area:
- Скільки сумарно вже отримали з кожної гілки

### 4.6. Drop-off chart (де втрачаємо)

```
КУДИ ЗНИКАЮТЬ ЮЗЕРИ                  Control   A      B
phone → drop                          2%       3%     2%
data_confirm → drop                   4%       2%     3%
upsell_window → drop (close)          —        9%     8%
upsell_window → drop (timeout 5min)   —        2%     1%
payment → drop                        23%      19%    18%
payment → failure                     22%      5%     6%  ← !!!
```

**Insight box:** "На контролі 22% з payment-кроку = failure. На варіантах A/B лише 5-6%. Чому?"

### 4.7. Сегментація (filterable)

Toggle-фільтри зверху таблиці:
- **Device:** all / mobile / desktop / tablet
- **Source:** all / FB ads / Google / Direct / Email
- **Tariff base:** all / bronze / silver / gold / platinum
- **Repeat visitor:** all / new / returning

Таблиця і графіки перебудовуються при зміні фільтрів.

### 4.8. Тимчасова шкала експерименту

```
06.06 ────────●────────────────●─────────────●──── зараз
              │                │             │
        Запуск A/B           Внесли          Додали
        Window 1             зміну ціни      Window 2
                             пакета (B)
```

Маркери на time-series графіках. Логіка: якщо була зміна на проміжку — треба перерахувати significance тільки з останнього маркера.

### 4.9. Recommendation engine (внизу)

```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 Що робити прямо зараз?                                    │
│                                                              │
│ ✅ ЗАЛИШАЄМО Window 1 запущеним                              │
│    • Lift +29% над control — економічно вигідно              │
│    • Confidence 91% — близько до 95%                         │
│    • Потрібно ще ~200 сесій                                  │
│                                                              │
│ ⚠ УВАГА на failure rate                                      │
│    • На control failure = 22%, на A/B = 5-6%                 │
│    • Це може спотворювати порівняння                         │
│    • Перевір що control gateway працює коректно              │
│                                                              │
│ 📋 NEXT EXPERIMENTS (queue)                                  │
│    1. Window 2 (qty) — coming next                           │
│    2. Variant C (bundle 2x з premium бонусом) — ідея          │
└─────────────────────────────────────────────────────────────┘
```

### 4.10. Налаштування експерименту (Settings tab)

- Перейменувати experiment_id
- Toggle on/off per variant (з аудит-логом хто і коли вимкнув)
- Min sample size для prematurely stop
- Confidence threshold (default 95%)
- Allocation %

---

## 5. Statistical methodology

### 5.1. Primary metric: RPS (Revenue Per Session)

- Тест: **Welch's two-sample t-test** (непарний, нерівні variance)
- Continuous distribution → коректно для виручки
- Confidence interval 95%

### 5.2. Secondary metric: Conversion rate

- Тест: **Chi-square** для пропорцій
- Або **Bayesian beta-binomial** (більш інтуїтивно)

### 5.3. Multiple comparisons correction

При 3+ варіантах: **Bonferroni** correction або **Holm-Bonferroni** — щоб не false-positive.

### 5.4. Sample size calculator

Formula для мінімальної вибірки на гілку при:
- Baseline conversion = 68.6% (control)
- MDE (minimum detectable effect) = 5% relative
- Power = 80%, alpha = 0.05

→ **n ≈ 1 200 сесій на гілку** для 95% significant lift >5%

Dashboard має показувати: `вибрали 99/1200 (8%)` для A — поки треба збирати.

### 5.5. Sequential testing

Замість static t-test — **mSPRT** (mixture sequential probability ratio test) дозволяє "peek" результати у будь-який момент без inflate alpha. Це best practice для production A/B.

---

## 6. Що чого зараз НЕ ВИСТАЧАЄ (instrumentation gaps)

| Gap | Як виправити | Пріоритет |
|---|---|---|
| Варіант B показує 0 `прийняв`/0 `відхилив` але 97 оплат | Перевірити event tracking варіанту B — мабуть selector кнопок інший | 🔴 P0 |
| Немає трекінгу step `phone`, `data_confirm` | Додати `trackCheckoutEvent({step, outcome})` на onload + onleave | 🟡 P1 |
| Немає sub-states для dropped | Розширити event з `drop_reason` | 🟡 P1 |
| Немає `session_id` sticky | Cookie `__dc_session` 30d або localStorage | 🔴 P0 |
| Немає `time_on_step_ms` | Timer onMount → onLeave кожного кроку | 🟡 P1 |
| Немає device/utm consistency | Витягати один раз на phone-step і прив'язувати до session | 🟢 P2 |
| Немає `is_repeat_visitor` | Cookie перевірка | 🟢 P2 |
| Виручку рахуємо approved, але не amount_final | Додати `amount_final` до event success | 🔴 P0 |

---

## 7. Acceptance criteria (definition of done)

- [ ] DB: створена `checkout_events` + `mv_upsell_funnel` + RPC `upsell_significance`
- [ ] Frontend: інструментовані всі 7 кроків чекауту з 3 outcomes
- [ ] Frontend: `dropped` має sub-state
- [ ] Backend: cron refresh mat-view кожні 5 хв
- [ ] Dashboard: hero-секція з win/loss decision
- [ ] Dashboard: KPI cards (виручка/RPS/конв/lift)
- [ ] Dashboard: таблиця порівняння з p-value і toggle вмикання
- [ ] Dashboard: horizontal funnel з hover-breakdown
- [ ] Dashboard: time-series RPS lift chart з confidence interval
- [ ] Dashboard: drop-off table з sub-reasons
- [ ] Dashboard: segmentation filters (device/source/tariff/repeat)
- [ ] Dashboard: timeline маркерів змін
- [ ] Dashboard: recommendation engine
- [ ] Dashboard: settings tab з audit log toggle on/off

---

## 8. Технічна реалізація — рекомендований стек

- **Frontend tracking:** простий `window.dcTrack(event)` що шле POST на `/api/track` (Cloudflare Worker) → InsertIntoDB
- **Dashboard:** новий tab `dashboard.dreamcar.ua/#upsell-ab` (PHP/HTML як решта) АБО окрема SPA `/upsell/` (краще — повна свобода для charts)
- **Charts:** Chart.js (уже використовується у системі) або Recharts якщо переходимо на React
- **Stats:** PostgreSQL `pg_ml` / або pure SQL Welch's t-test (можна написати на pg_function)
- **Realtime:** Supabase Realtime channel `upsell_ab` — оновлення без F5

---

## 9. Roadmap пропозиція

**Тиждень 1 (07-13.06)**
- ✅ DB schema + materialized view + cron
- ✅ Frontend tracking всіх 7 кроків
- ✅ Зафіксувати session_id sticky cookie
- ✅ Виправити баг трекінгу варіанту B

**Тиждень 2 (14-20.06)**
- ✅ Dashboard MVP: hero + KPI + таблиця + funnel
- ✅ RPC для statistical significance

**Тиждень 3 (21-27.06)**
- ✅ Time-series chart + segmentation
- ✅ Recommendation engine
- ✅ Settings tab з audit log

**Тиждень 4 (28.06-04.07)**
- ✅ Window 2 (qty) інструментовано і доданий до тих самих views
- ✅ Documentation + onboarding розширений

---

**END OF SPEC**
