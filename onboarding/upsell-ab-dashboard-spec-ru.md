# ТЗ: Дашборд A/B/C тестирования Upsell в Checkout

**Версия:** 1.0
**Дата:** 06.06.2026
**Владелец продукта:** Вадим (CEO), Артём (со-основатель)
**Исполнитель:** TBD
**Статус:** На утверждение

---

## Оглавление

1. [Контекст и проблема](#1-контекст-и-проблема)
2. [Бизнес-цели дашборда](#2-бизнес-цели-дашборда)
3. [Анализ текущих данных и выявленные баги](#3-анализ-текущих-данных-и-выявленные-баги)
4. [Инструментация: новые события](#4-инструментация-новые-события)
5. [Схема базы данных](#5-схема-базы-данных)
6. [Backend: агрегация и статистика](#6-backend-агрегация-и-статистика)
7. [UI дашборда: подробная разбивка по секциям](#7-ui-дашборда-подробная-разбивка-по-секциям)
8. [Статистическая методология](#8-статистическая-методология)
9. [Пробелы инструментации (gaps)](#9-пробелы-инструментации-gaps)
10. [Acceptance criteria](#10-acceptance-criteria)
11. [Технический стек и архитектура](#11-технический-стек-и-архитектура)
12. [Roadmap и приоритеты](#12-roadmap-и-приоритеты)
13. [Примеры расчётов](#13-примеры-расчётов)
14. [Приложение: код реализации](#14-приложение-код-реализации)

---

## 1. Контекст и проблема

### 1.1. Что есть сейчас

На сайте DreamCar.ua идёт A/B/C тестирование upsell-окна в checkout. Эксперимент стартовал **06.06.2026** и работает на пользователях которые начали оформление заказа.

Текущие гилки эксперимента (Window 1):

| Ветка | Описание | Что показывает пользователю |
|---|---|---|
| **Контроль** | Без апсела | Стандартный flow checkout |
| **A: пакет дороже** | Старший тариф со скидкой | "Возьми Gold за 4999₴ вместо Silver за 999₴ — экономия 1500₴" |
| **B: количество + скидка** | Несколько одинаковых пакетов | "Возьми 3 пакета Silver вместо 1 — скидка 20%" |

**Window 2 (количество с дополнительными опциями)** — отключён, в roadmap.

### 1.2. Что не работает

Текущий дашборд (вкладки Мастер / Шаги / Варианты / Аналитика / Сравнение) имеет следующие проблемы:

1. **Таблицы плохо читаемые** — несведённые данные, непонятная семантика колонок
2. **Не видно как работает вариант A vs B в сводке** — приходится переключаться между табами
3. **Нет статистической значимости** — невозможно понять достоверны ли цифры
4. **Нет funnel drop-off** — не видно где теряем людей в чекауте
5. **Не трекаются шаги ДО upsell-окна** (телефон, подтверждение данных)
6. **Вариант B показывает 0 "принял"/0 "отклонил" но 97 оплат** — баг трекинга
7. **На control 22% failure на payment, на A/B 5-6%** — подозрение на разную gateway-логику
8. **Нет рекомендации "что делать"** — пользователь дашборда сам должен интерпретировать
9. **Нет сегментации** — нельзя посмотреть результат по device/source/tariff
10. **Нет графиков динамики** — невозможно увидеть тренд

### 1.3. Целевое состояние

Дашборд должен:
- За **30 секунд** дать ответ "запускать ли в production"
- Показывать **доверительный интервал** для каждой метрики
- Помечать **выявленные баги** (как сейчас 0 принял у варианта B)
- Поддерживать **сегментацию** по 5+ параметрам
- Иметь **рекомендательный движок** с конкретными next steps
- Поддерживать **A/B/C/D/E** и больше веток (масштабируемость)
- Работать в **real-time** (без F5)

---

## 2. Бизнес-цели дашборда

### 2.1. Главные вопросы которые дашборд отвечает

| # | Вопрос | Где ответ |
|---|---|---|
| Q1 | Какой вариант побеждает прямо сейчас? | Hero-секция + сравнительная таблица |
| Q2 | С какой уверенностью можно утверждать что побеждает? | p-value + confidence interval |
| Q3 | Достаточно ли данных чтобы принимать решение? | Sample size estimator + "осталось N сессий" |
| Q4 | Где теряем людей в funnel? | Horizontal funnel + drop-off chart |
| Q5 | Какой сегмент трафика лучше всего реагирует? | Сегментация (device/source/tariff/repeat) |
| Q6 | Что произошло когда у нас выросла/упала выручка? | Time-series chart с маркерами событий |
| Q7 | Стоит ли продолжать эксперимент или зашипить победителя? | Recommendation engine |

### 2.2. Главная метрика: RPS (Revenue Per Session)

**Почему именно RPS:**
- Конверсия `paid/started` обманчива: если поднимем цену пакета — конверсия упадёт, но выручка вырастет. RPS это покажет правильно.
- Учитывает **и количество** оплативших, **и средний чек**
- Бизнесово **самая прямая** метрика: "сколько денег приносит каждый кто начал оформление"

Формула: `RPS = SUM(amount_final WHERE paid=true) / COUNT(sessions WHERE started_checkout=true)`

### 2.3. Вторичные метрики

| Метрика | Что показывает |
|---|---|
| Conversion rate | Доля оплативших среди начавших |
| Средний чек | Среднее значение успешной оплаты |
| Принятие upsell (uptake) | Доля принявших предложение |
| Drop-off rate per step | На каком шаге чаще всего уходят |
| Time on step | Сколько секунд тратят (UX-сигнал) |
| Repeat visitor uptake | Возвращающиеся принимают чаще/реже |

---

## 3. Анализ текущих данных и выявленные баги

### 3.1. Данные из скриншотов (период 30д)

#### Вкладка "Аналитика" (шаг-вариант view)

| Шаг | Вариант | Показов | Принял | Отклонил | Оплат | Конв. |
|---|---|---|---|---|---|---|
| upsell_pkg | A | 612 | 141 | 452 | 76 | 12.4% |
| upsell_pkg | B | 656 | **0** ❌ | **0** ❌ | 97 | 14.8% |
| upsell_qty | A | 0 | 0 | 4 | 0 | 0% |
| upsell_qty | B | 1 | 0 | 0 | 0 | 0% |

**Баг #1:** У варианта B `Принял=0` и `Отклонил=0`, но при этом `Оплат=97` и `Показов=656`. Это значит:
- Event "принял" не трекается у варианта B (вероятно другой selector или event handler)
- Атрибуция оплаты к варианту работает через session_id или cookie, но not через event flow
- Без этого мы не видим **uptake rate** (долю принявших) для варианта B

**Баг #2:** У варианта A `Показов=612`, `Принял+Отклонил=141+452=593`. Разница в 19 сессий — те что показали но не дождались ответа (tab close / timeout / external link). Их нужно классифицировать как `dropped`.

#### Вкладка "Сравнение" (ветка view)

| Ветка | Начали | Оплат | Конв. | Сер.чек | Выручка | ₴/сессию |
|---|---|---|---|---|---|---|
| Контроль | 51 | 35 | 68.6% | 173 ₴ | 6 065 ₴ | **119** |
| A: пакет дороже | 99 | 76 | 76.8% | 200 ₴ | 15 174 ₴ | **153** |
| B: количество | 123 | 97 | 78.9% | 193 ₴ | 18 738 ₴ | **152** |

**Наблюдение #1:** Конверсия `paid/started` на A/B вырастает с 68.6% до 76-79%. Это значит upsell не только увеличивает чек, но и **повышает завершаемость**. Это **подозрительно высокий эффект** для апсела (обычно апсел снижает конверсию).

**Наблюдение #2:** RPS lift = (153-119)/119 = **+29%** для A, +28% для B. Это огромный эффект.

**Баг #3:** Распределение неравномерное: контроль 51, A 99, B 123. Соотношение примерно 17/33/41 = 1:2:2.4. Это сознательное решение (см. ответ Вадима). Но если control не настроен корректно и имеет другой failure rate — сравнение **скомпрометировано**.

**Баг #4:** На control 22% failure на payment, на A/B 5-6%. Это **критичная аномалия**:
- Возможно control использует другой gateway/токен
- Возможно control упрощённый flow и платёж не валидируется правильно
- **До того как принимать решение по upsell — нужно понять почему такой разный failure**

### 3.2. Вопросы которые надо немедленно проверить

1. **Почему B показывает 0 принял?** — проверить event tracking варианта B
2. **Почему control имеет 22% failure а A/B 5-6%?** — проверить gateway control
3. **Точно ли это distinct users, или возможны refresh страницы и двойной учёт?** — нужен sticky session_id
4. **Атрибуция: где фиксируется variant_id?** — query string? cookie? localStorage?

---

## 4. Инструментация: новые события

### 4.1. Структура события `checkout_event`

Каждое событие на чекауте — это один **компактный объект** с обязательными и опциональными полями:

```javascript
// Обязательные поля
{
  // Идентификаторы
  event_id: 'evt_' + uuidv7(),           // уникальный id события
  session_id: '<sticky-uuid>',            // sticky 30 дней (cookie __dc_sess)
  user_id: '<uuid>' | null,               // если авторизован
  ts: '<ISO8601>',                        // время события в UTC

  // Эксперимент
  experiment_id: 'upsell_window_1',       // ID эксперимента (для multi-experiment support)
  variant: 'A' | 'B' | 'control',         // ветка
  variant_first_seen_at: '<ISO>',         // когда впервые назначили вариант (для cross-session)

  // Контекст шага
  step: 'phone' | 'data_confirm' | 'tariff_pick'
      | 'upsell_window_1' | 'upsell_window_2'
      | 'payment' | 'success' | 'failure',
  step_index: 1..7,                       // порядковый номер для funnel

  // Исход (главное поле!)
  outcome: 'next' | 'took' | 'dropped',
  drop_reason: null | 'close_btn' | 'back_btn' | 'tab_close' | 'inactive_5min' | 'external_link',

  // Тайминги
  time_on_step_ms: 12500,                 // от mount до next/took/dropped
  step_arrived_at: '<ISO>',
  step_left_at: '<ISO>',

  // Базовый тариф (что user уже выбрал)
  tariff_base: 'bronze' | 'silver' | 'gold' | 'platinum',
  amount_base: 999,                       // цена базового
  qty_base: 1,

  // Что предложили (если upsell-шаг)
  tariff_offered: 'gold' | null,
  amount_offered: 4999 | null,
  qty_offered: 3 | null,
  discount_offered_pct: 20 | null,

  // Что в итоге купил (заполняется на success-шаге)
  tariff_final: 'gold',
  amount_final: 4999,
  qty_final: 3,

  // Аудитория
  utm_source: 'fb_ads',
  utm_medium: 'cpc',
  utm_campaign: 'audi_etron_q2',
  utm_content: null,
  utm_term: null,
  device: 'mobile' | 'desktop' | 'tablet',
  user_agent: '<short>',
  referrer: '<url>' | null,
  is_repeat_visitor: bool,
  visit_count: 3,
  days_since_first_visit: 14,

  // Технические
  page_url: '<url>',
  page_path: '/checkout/phone',
  app_version: '2.4.1',
  ab_engine_version: '1.0.0',
  geo_country: 'UA',
  geo_city: 'Київ',

  // Произвольные данные
  meta: {}
}
```

### 4.2. Outcomes — подробно

#### outcome = 'next'
Пользователь прошёл шаг **без действия с апселом**. Примеры:
- На upsell window нажал "продолжить с 1 шт", оставил базовый тариф
- На phone-step ввёл телефон и нажал "далее"
- На data_confirm подтвердил данные

#### outcome = 'took'
Пользователь **принял предложение апсела**. Только на upsell-шагах. Примеры:
- Выбрал старший тариф (Gold вместо Silver)
- Увеличил количество (3 пакета вместо 1)

#### outcome = 'dropped'
Пользователь **ушёл с шага** не пройдя его дальше. Критичный негатив. Обязательно с `drop_reason`:

| drop_reason | Когда тригерится |
|---|---|
| `close_btn` | Нажал крестик на модальном окне |
| `back_btn` | Браузерная кнопка "назад" |
| `tab_close` | Закрыл вкладку (`beforeunload` event) |
| `inactive_5min` | 5 минут без действий (mouse/keyboard) |
| `external_link` | Кликнул на внешнюю ссылку (соцсети, support, и т.д.) |
| `error_redirect` | Технический сбой / редирект на error page |

### 4.3. Шаги чекаута (все трекаются)

| step | step_index | Описание | Возможные outcomes |
|---|---|---|---|
| `phone` | 1 | Ввод телефона | next / dropped |
| `data_confirm` | 2 | Подтверждение персональных данных | next / dropped |
| `tariff_pick` | 3 | Выбор базового тарифа (если есть) | next / dropped |
| `upsell_window_1` | 4 | Окно апсела #1 (текущий эксперимент) | next / took / dropped |
| `upsell_window_2` | 5 | Окно апсела #2 (roadmap) | next / took / dropped |
| `payment` | 6 | Страница оплаты | next / dropped |
| `success` | 7 | Успешная оплата | next (терминальное состояние) |
| `failure` | 7 | Сбой оплаты | next (терминальное состояние) |

### 4.4. Когда стрелять события

```javascript
// На mount шага — записать step_arrived_at
componentDidMount() {
  this.stepArrivedAt = Date.now();
}

// На переход к следующему шагу
onNext() {
  trackCheckoutEvent({
    step: 'phone',
    outcome: 'next',
    time_on_step_ms: Date.now() - this.stepArrivedAt
  });
}

// На принятие upsell
onTook(upsellOption) {
  trackCheckoutEvent({
    step: 'upsell_window_1',
    outcome: 'took',
    tariff_offered: upsellOption.tariff,
    amount_offered: upsellOption.amount,
    time_on_step_ms: Date.now() - this.stepArrivedAt
  });
}

// На клик крестика
onClose() {
  trackCheckoutEvent({
    step: this.currentStep,
    outcome: 'dropped',
    drop_reason: 'close_btn',
    time_on_step_ms: Date.now() - this.stepArrivedAt
  });
}

// На закрытие вкладки (beforeunload)
window.addEventListener('beforeunload', () => {
  // Используем sendBeacon — он шлёт даже если страница закрывается
  navigator.sendBeacon('/api/track', JSON.stringify({
    step: this.currentStep,
    outcome: 'dropped',
    drop_reason: 'tab_close',
    time_on_step_ms: Date.now() - this.stepArrivedAt
  }));
});

// Inactivity timer
let inactivityTimer = null;
function resetInactivity() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    trackCheckoutEvent({
      step: currentStep,
      outcome: 'dropped',
      drop_reason: 'inactive_5min',
      time_on_step_ms: 5 * 60 * 1000
    });
  }, 5 * 60 * 1000);
}
['click', 'keydown', 'mousemove', 'scroll'].forEach(ev => {
  document.addEventListener(ev, resetInactivity);
});
```

### 4.5. Sticky session — как обеспечить

```javascript
// На первой загрузке checkout
function ensureSession() {
  let sid = getCookie('__dc_sess');
  if (!sid) {
    sid = 'sess_' + crypto.randomUUID();
    setCookie('__dc_sess', sid, { maxAge: 30 * 24 * 3600, sameSite: 'Lax' });
  }
  return sid;
}

// Назначение варианта — sticky на session_id
function assignVariant(sessionId, experimentId) {
  // Детерминистическое: hash(sessionId + experimentId) % 100 → bucket
  const hash = simpleHash(sessionId + experimentId);
  const bucket = hash % 100;
  // Распределение 20/40/40
  if (bucket < 20) return 'control';
  if (bucket < 60) return 'A';
  return 'B';
}
```

Так пользователь который рефрешит страницу или возвращается через 3 дня — попадает в ту же ветку. Иначе данные искажены.

---

## 5. Схема базы данных

### 5.1. Таблица `checkout_events`

```sql
create table public.checkout_events (
  id                    uuid primary key default gen_random_uuid(),
  -- Идентификаторы
  event_id              text unique not null,    -- frontend-generated id для idempotency
  session_id            uuid not null,
  user_id               uuid references public.users(id) on delete set null,
  ts                    timestamptz not null,
  received_at           timestamptz not null default now(),

  -- Эксперимент
  experiment_id         text not null,
  variant               text not null check (variant in ('A', 'B', 'C', 'D', 'E', 'control')),
  variant_first_seen_at timestamptz,

  -- Шаг и исход
  step                  text not null,
  step_index            smallint,
  outcome               text not null check (outcome in ('next', 'took', 'dropped')),
  drop_reason           text,

  -- Тайминги
  time_on_step_ms       integer,
  step_arrived_at       timestamptz,
  step_left_at          timestamptz,

  -- Тариф и сумма
  tariff_base           text,
  amount_base           numeric(10, 2),
  qty_base              smallint,
  tariff_offered        text,
  amount_offered        numeric(10, 2),
  qty_offered           smallint,
  discount_offered_pct  smallint,
  tariff_final          text,
  amount_final          numeric(10, 2),
  qty_final             smallint,

  -- Аудитория
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  utm_term              text,
  device                text check (device in ('mobile', 'desktop', 'tablet')),
  user_agent            text,
  referrer              text,
  is_repeat_visitor     boolean,
  visit_count           smallint,
  days_since_first_visit smallint,

  -- Технические
  page_url              text,
  page_path             text,
  app_version           text,
  ab_engine_version     text,
  geo_country           text,
  geo_city              text,

  -- Произвольное
  meta                  jsonb default '{}'::jsonb
);

-- Индексы для быстрого аналитического чтения
create index ce_exp_var_ts on public.checkout_events (experiment_id, variant, ts desc);
create index ce_session on public.checkout_events (session_id, ts);
create index ce_ts on public.checkout_events (ts desc);
create index ce_outcome on public.checkout_events (outcome, step);
create index ce_utm_source on public.checkout_events (utm_source) where utm_source is not null;
create index ce_device on public.checkout_events (device);

-- Партиционирование по месяцам (если объём большой)
-- alter table public.checkout_events partition by range (ts);

comment on table public.checkout_events is 'События чекаута для A/B/C тестов. Запись append-only, никогда не апдейтим.';
```

### 5.2. Таблица `experiments` (метаданные экспериментов)

```sql
create table public.experiments (
  id              text primary key,          -- 'upsell_window_1'
  name            text not null,             -- 'Upsell Window 1: тариф vs количество'
  description     text,
  status          text not null default 'running'
                  check (status in ('draft', 'running', 'paused', 'shipped', 'killed')),
  hypothesis      text,                      -- 'Если показать дороже тариф со скидкой 20%, RPS вырастет на 25%+'
  primary_metric  text not null default 'rps' check (primary_metric in ('rps', 'conv_rate', 'uptake')),
  mde_pct         numeric default 5,         -- Minimum Detectable Effect
  power           numeric default 0.8,
  alpha           numeric default 0.05,
  started_at      timestamptz not null default now(),
  paused_at       timestamptz,
  ended_at        timestamptz,
  shipped_variant text,                      -- какой вариант зашипили
  variants        jsonb not null,            -- [{id:'control', name:'Без апсела', allocation:20, enabled:true}, ...]
  created_by      uuid references public.users(id),
  updated_at      timestamptz default now()
);

create index ex_status on public.experiments (status);
```

### 5.3. Таблица `experiment_change_log` (audit для маркеров timeline)

```sql
create table public.experiment_change_log (
  id            uuid primary key default gen_random_uuid(),
  experiment_id text not null references public.experiments(id),
  ts            timestamptz not null default now(),
  user_id       uuid references public.users(id),
  action        text not null,    -- 'paused' | 'resumed' | 'variant_toggled' | 'allocation_changed' | 'mde_changed'
  detail        jsonb,
  note          text              -- человеческий комментарий
);

create index ecl_exp on public.experiment_change_log (experiment_id, ts desc);
```

### 5.4. Materialized view `mv_upsell_funnel` (для быстрого dashboard)

```sql
create materialized view public.mv_upsell_funnel as
with
sessions_with_assignment as (
  -- Одна ветка на сессию (sticky). Берём первое назначение.
  select distinct on (session_id, experiment_id)
    session_id,
    experiment_id,
    variant,
    ts as assigned_at,
    utm_source, utm_medium, utm_campaign,
    device, is_repeat_visitor, tariff_base, geo_country
  from public.checkout_events
  order by session_id, experiment_id, ts asc
),
session_outcomes as (
  select
    s.experiment_id,
    s.variant,
    s.session_id,
    s.assigned_at,
    s.utm_source, s.utm_medium, s.device, s.is_repeat_visitor, s.tariff_base,
    -- Достиг ли шага payment
    bool_or(e.step = 'payment') as reached_payment,
    -- Принял upsell?
    bool_or(e.step like 'upsell%' and e.outcome = 'took') as took_upsell,
    -- Завершил оплату успешно?
    bool_or(e.step = 'success') as paid,
    -- Сумма оплаты
    max(case when e.step = 'success' then e.amount_final end) as revenue,
    max(case when e.step = 'success' then e.qty_final end) as qty_final,
    -- На каком шаге дропнулся (если есть)
    (
      select e2.step
      from public.checkout_events e2
      where e2.session_id = s.session_id
        and e2.experiment_id = s.experiment_id
        and e2.outcome = 'dropped'
      order by e2.ts asc
      limit 1
    ) as drop_step,
    (
      select e2.drop_reason
      from public.checkout_events e2
      where e2.session_id = s.session_id
        and e2.experiment_id = s.experiment_id
        and e2.outcome = 'dropped'
      order by e2.ts asc
      limit 1
    ) as drop_reason,
    -- Время до завершения / дропа
    min(e.ts) as first_event_at,
    max(e.ts) as last_event_at
  from sessions_with_assignment s
  join public.checkout_events e using (session_id, experiment_id)
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9
)
select
  experiment_id,
  variant,
  utm_source, utm_medium, device, is_repeat_visitor, tariff_base,
  count(*) as sessions,
  count(*) filter (where reached_payment) as reached_payment,
  count(*) filter (where took_upsell) as took_upsell,
  count(*) filter (where paid) as paid_sessions,
  count(*) filter (where not paid and drop_step is not null) as dropped_sessions,
  -- Drop breakdown
  count(*) filter (where drop_step = 'phone') as drop_at_phone,
  count(*) filter (where drop_step = 'data_confirm') as drop_at_data_confirm,
  count(*) filter (where drop_step = 'upsell_window_1') as drop_at_upsell_1,
  count(*) filter (where drop_step = 'payment') as drop_at_payment,
  -- Финансы
  coalesce(sum(revenue), 0) as revenue,
  coalesce(avg(revenue) filter (where paid), 0) as avg_check,
  coalesce(sum(revenue) / nullif(count(*), 0), 0) as rps,
  -- Для t-test: сохраняем дисперсию revenue по сессиям
  coalesce(stddev_pop(coalesce(revenue, 0)), 0) as revenue_stddev,
  coalesce(variance(coalesce(revenue, 0)), 0) as revenue_variance
from session_outcomes
group by 1, 2, 3, 4, 5, 6, 7;

create unique index on public.mv_upsell_funnel (experiment_id, variant, utm_source, utm_medium, device, is_repeat_visitor, tariff_base);

-- Concurrent refresh каждые 5 минут
-- Cron: select cron.schedule('mv-upsell-funnel-refresh', '*/5 * * * *',
--   $$refresh materialized view concurrently public.mv_upsell_funnel$$);
```

### 5.5. Materialized view `mv_upsell_daily` (для time-series)

```sql
create materialized view public.mv_upsell_daily as
with daily_sessions as (
  select distinct on (session_id, experiment_id)
    session_id,
    experiment_id,
    variant,
    date_trunc('day', ts at time zone 'Europe/Kyiv')::date as day
  from public.checkout_events
  order by session_id, experiment_id, ts
),
daily_with_outcomes as (
  select
    ds.day,
    ds.experiment_id,
    ds.variant,
    count(*) as sessions,
    count(*) filter (where exists(
      select 1 from public.checkout_events e
      where e.session_id = ds.session_id and e.step = 'success'
    )) as paid,
    coalesce(sum((
      select max(amount_final) from public.checkout_events e
      where e.session_id = ds.session_id and e.step = 'success'
    )), 0) as revenue
  from daily_sessions ds
  group by 1, 2, 3
)
select
  day,
  experiment_id,
  variant,
  sessions,
  paid,
  revenue,
  case when sessions > 0 then revenue::numeric / sessions else 0 end as rps,
  case when sessions > 0 then paid::numeric / sessions else 0 end as conv_rate
from daily_with_outcomes
order by day, experiment_id, variant;

create unique index on public.mv_upsell_daily (day, experiment_id, variant);
```

### 5.6. RPS-history view (для skользящего окна)

```sql
-- Скользящее окно последних 7 дней по дням
create or replace view public.v_upsell_rolling_7d as
select
  d.day,
  d.experiment_id,
  d.variant,
  sum(d.revenue) over w7 as revenue_7d,
  sum(d.sessions) over w7 as sessions_7d,
  sum(d.revenue) over w7 / nullif(sum(d.sessions) over w7, 0) as rps_7d
from public.mv_upsell_daily d
window w7 as (
  partition by d.experiment_id, d.variant
  order by d.day
  rows between 6 preceding and current row
);
```

---

## 6. Backend: агрегация и статистика

### 6.1. RPC `upsell_summary` — главный endpoint для dashboard

```sql
create or replace function public.upsell_summary(
  p_experiment_id text,
  p_period_days integer default 30,
  p_filter jsonb default '{}'::jsonb   -- {utm_source, device, tariff_base, is_repeat_visitor}
)
returns table (
  variant         text,
  sessions        integer,
  reached_payment integer,
  took_upsell     integer,
  paid_sessions   integer,
  dropped_sessions integer,
  drop_at_phone    integer,
  drop_at_data_confirm integer,
  drop_at_upsell_1 integer,
  drop_at_payment integer,
  revenue         numeric,
  avg_check       numeric,
  rps             numeric,
  conv_rate       numeric,
  uptake_rate     numeric,  -- took_upsell / sessions
  revenue_stddev  numeric,
  revenue_variance numeric
)
language sql stable as $$
  select
    variant,
    sum(sessions)::int,
    sum(reached_payment)::int,
    sum(took_upsell)::int,
    sum(paid_sessions)::int,
    sum(dropped_sessions)::int,
    sum(drop_at_phone)::int,
    sum(drop_at_data_confirm)::int,
    sum(drop_at_upsell_1)::int,
    sum(drop_at_payment)::int,
    sum(revenue),
    case when sum(paid_sessions) > 0 then sum(revenue) / sum(paid_sessions) else 0 end,
    case when sum(sessions) > 0 then sum(revenue) / sum(sessions) else 0 end,
    case when sum(sessions) > 0 then sum(paid_sessions)::numeric / sum(sessions) else 0 end,
    case when sum(sessions) > 0 then sum(took_upsell)::numeric / sum(sessions) else 0 end,
    sum(revenue_stddev * sessions) / nullif(sum(sessions), 0),  -- weighted
    sum(revenue_variance * sessions) / nullif(sum(sessions), 0)
  from public.mv_upsell_funnel
  where experiment_id = p_experiment_id
    and (p_filter->>'utm_source' is null or utm_source = p_filter->>'utm_source')
    and (p_filter->>'device' is null or device = p_filter->>'device')
    and (p_filter->>'tariff_base' is null or tariff_base = p_filter->>'tariff_base')
    and (p_filter->>'is_repeat_visitor' is null or is_repeat_visitor = (p_filter->>'is_repeat_visitor')::bool)
  group by variant
  order by variant;
$$;
```

### 6.2. RPC `upsell_significance` — статистика

```sql
create or replace function public.upsell_significance(
  p_experiment_id text,
  p_period_days integer default 30,
  p_filter jsonb default '{}'::jsonb
)
returns table (
  variant         text,
  sessions        integer,
  paid            integer,
  conv_rate       numeric,
  rps             numeric,
  revenue         numeric,
  lift_vs_control_pct numeric,
  p_value_welch_rps numeric,    -- Welch's t-test для RPS
  p_value_chi2_conv numeric,    -- Chi-square для конверсии
  confidence_level text,        -- '95%+' | '90-95%' | '<90%'
  recommendation  text          -- 'ship' | 'continue' | 'kill' | 'need_data'
)
language plpgsql stable as $$
declare
  v_control record;
  v_variant record;
  v_min_sample_size int;
  v_mde numeric;
begin
  select sessions, paid_sessions, rps, revenue_variance, conv_rate
    into v_control
  from public.upsell_summary(p_experiment_id, p_period_days, p_filter)
  where variant = 'control';

  select mde_pct, 1200 into v_mde, v_min_sample_size  -- упростил, нормально вычислять формулой
  from public.experiments
  where id = p_experiment_id;

  return query
  with summary as (
    select * from public.upsell_summary(p_experiment_id, p_period_days, p_filter)
  ),
  with_stats as (
    select
      s.variant,
      s.sessions,
      s.paid_sessions as paid,
      s.conv_rate,
      s.rps,
      s.revenue,
      -- Lift
      case when v_control.rps > 0 then (s.rps - v_control.rps) / v_control.rps * 100 else 0 end as lift,
      -- p-value Welch's t-test для RPS (приближение, для production - в JS на клиенте по полным данным или pg_ml)
      case
        when s.variant = 'control' then 1.0
        else welch_t_test_p_value(
          v_control.rps, v_control.revenue_variance, v_control.sessions,
          s.rps, s.revenue_variance, s.sessions
        )
      end as p_welch,
      -- p-value chi-square для конверсии
      case
        when s.variant = 'control' then 1.0
        else chi_square_p_value(
          v_control.paid_sessions, v_control.sessions,
          s.paid_sessions, s.sessions
        )
      end as p_chi
    from summary s
  )
  select
    variant,
    sessions::int,
    paid::int,
    conv_rate,
    rps,
    revenue,
    lift,
    p_welch,
    p_chi,
    case
      when p_welch < 0.05 then '95%+'
      when p_welch < 0.10 then '90-95%'
      else '<90%'
    end as confidence_level,
    case
      when sessions < 100 then 'need_data'
      when p_welch < 0.05 and lift > 0 then 'ship'
      when p_welch < 0.05 and lift < 0 then 'kill'
      when sessions < v_min_sample_size then 'continue'
      else 'continue'
    end as recommendation
  from with_stats;
end;
$$;
```

### 6.3. Helper-функции для статистики

```sql
-- Welch's t-test: возвращает приближённый p-value
create or replace function welch_t_test_p_value(
  mean1 numeric, var1 numeric, n1 numeric,
  mean2 numeric, var2 numeric, n2 numeric
) returns numeric language plpgsql immutable as $$
declare
  t numeric;
  df numeric;
  abs_t numeric;
begin
  if n1 < 2 or n2 < 2 or (var1 = 0 and var2 = 0) then
    return 1.0;
  end if;
  t := (mean1 - mean2) / sqrt(var1/n1 + var2/n2);
  abs_t := abs(t);
  -- Степени свободы по формуле Welch-Satterthwaite
  df := power(var1/n1 + var2/n2, 2)
        / (power(var1/n1, 2)/(n1-1) + power(var2/n2, 2)/(n2-1));
  -- Приближённый p-value через нормальную аппроксимацию (для большого df)
  -- В production реальный t-distribution использовать через extension pg_ml или JS
  -- Это упрощённый расчёт:
  return 2 * (1 - normal_cdf(abs_t));
end;
$$;

create or replace function normal_cdf(z numeric) returns numeric language sql immutable as $$
  -- Приближённое значение функции распределения нормального распределения
  -- Формула Abramowitz & Stegun 26.2.17
  select 0.5 * (1 + sign(z) * sqrt(1 - exp(-2 * z * z / pi())));
$$;

-- Chi-square для 2x2 таблицы (paid/not_paid × control/variant)
create or replace function chi_square_p_value(
  c_paid numeric, c_total numeric,
  v_paid numeric, v_total numeric
) returns numeric language plpgsql immutable as $$
declare
  c_not numeric := c_total - c_paid;
  v_not numeric := v_total - v_paid;
  total numeric := c_total + v_total;
  row1 numeric := c_paid + v_paid;
  row2 numeric := c_not + v_not;
  exp_c_paid numeric;
  exp_v_paid numeric;
  exp_c_not numeric;
  exp_v_not numeric;
  chi2 numeric;
begin
  if total = 0 or row1 = 0 or row2 = 0 then return 1.0; end if;
  exp_c_paid := row1 * c_total / total;
  exp_v_paid := row1 * v_total / total;
  exp_c_not := row2 * c_total / total;
  exp_v_not := row2 * v_total / total;
  chi2 := power(c_paid - exp_c_paid, 2) / nullif(exp_c_paid, 0)
        + power(v_paid - exp_v_paid, 2) / nullif(exp_v_paid, 0)
        + power(c_not - exp_c_not, 2) / nullif(exp_c_not, 0)
        + power(v_not - exp_v_not, 2) / nullif(exp_v_not, 0);
  -- df = 1 для 2x2
  -- Приближённый p-value через формулу
  return exp(-chi2 / 2);  -- грубо; для production использовать gamma function
end;
$$;
```

> **Замечание:** Реальные функции `welch_t_test_p_value` и `chi_square_p_value` лучше реализовать в `pg_ml` extension или вычислять на стороне JS дашборда через библиотеку `simple-statistics`. Это даст точные значения. Здесь — упрощённый подход для прототипа.

### 6.4. RPC `upsell_funnel` — для horizontal funnel chart

```sql
create or replace function public.upsell_funnel(
  p_experiment_id text,
  p_variant text,
  p_period_days integer default 30,
  p_filter jsonb default '{}'::jsonb
)
returns table (
  step          text,
  step_index    integer,
  visitors      integer,
  next_count    integer,
  took_count    integer,
  dropped_count integer,
  drop_close    integer,
  drop_back     integer,
  drop_tab      integer,
  drop_inactive integer,
  drop_external integer,
  conv_to_next_pct numeric  -- % из этого шага в следующий
)
language sql stable as $$
  with steps_data as (
    select
      e.step,
      e.step_index,
      count(distinct e.session_id) filter (where true) as visitors,
      count(*) filter (where e.outcome = 'next') as next_count,
      count(*) filter (where e.outcome = 'took') as took_count,
      count(*) filter (where e.outcome = 'dropped') as dropped_count,
      count(*) filter (where e.drop_reason = 'close_btn') as drop_close,
      count(*) filter (where e.drop_reason = 'back_btn') as drop_back,
      count(*) filter (where e.drop_reason = 'tab_close') as drop_tab,
      count(*) filter (where e.drop_reason = 'inactive_5min') as drop_inactive,
      count(*) filter (where e.drop_reason = 'external_link') as drop_external
    from public.checkout_events e
    where e.experiment_id = p_experiment_id
      and e.variant = p_variant
      and e.ts >= now() - (p_period_days || ' days')::interval
    group by e.step, e.step_index
  )
  select
    step,
    step_index,
    visitors::int,
    next_count::int,
    took_count::int,
    dropped_count::int,
    drop_close::int,
    drop_back::int,
    drop_tab::int,
    drop_inactive::int,
    drop_external::int,
    case when visitors > 0
      then (next_count + took_count)::numeric / visitors * 100
      else 0
    end as conv_to_next_pct
  from steps_data
  order by step_index;
$$;
```

### 6.5. Recommendation engine

```sql
create or replace function public.upsell_recommendation(
  p_experiment_id text
)
returns jsonb language plpgsql stable as $$
declare
  v_summary jsonb;
  v_winner record;
  v_min_sample integer;
  v_sample_progress numeric;
  v_recommendations jsonb := '[]'::jsonb;
  v_anomalies jsonb := '[]'::jsonb;
  v_status text;
begin
  -- Найти текущего лидера
  select * into v_winner
  from public.upsell_significance(p_experiment_id, 30)
  where variant <> 'control'
  order by rps desc
  limit 1;

  -- Проверки на аномалии
  -- 1. Failure rate сильно отличается между гилками
  if (select count(distinct variant) from
      (select variant, count(*) filter (where step = 'failure') * 100.0 / count(*) filter (where step = 'payment') as failure_rate
       from public.checkout_events
       where experiment_id = p_experiment_id and ts >= now() - interval '30 days'
       group by variant
       having count(*) filter (where step = 'payment') > 0
      ) t
      where failure_rate > 15
     ) > 0 then
    v_anomalies := v_anomalies || jsonb_build_object(
      'level', 'critical',
      'title', 'Высокий failure rate на платеже',
      'description', 'У одной из веток failure > 15% на шаге payment. Сравнение может быть скомпрометировано.',
      'action', 'Проверить payment gateway для контроля. Возможно используется sandbox или старый ключ.'
    );
  end if;

  -- 2. Distribution event-ов "принял" подозрительно неравномерное
  -- (наш баг с вариантом B где 0 принял но 97 оплат)
  if exists(
    select 1 from public.checkout_events
    where experiment_id = p_experiment_id and ts >= now() - interval '30 days'
    group by variant
    having count(*) filter (where outcome = 'took' and step like 'upsell%') = 0
       and count(*) filter (where step = 'success') > 10
  ) then
    v_anomalies := v_anomalies || jsonb_build_object(
      'level', 'critical',
      'title', 'Не трекается событие "took" для одного из вариантов',
      'description', 'Один из вариантов имеет 0 событий "took" но есть успешные оплаты. Frontend event handler не срабатывает.',
      'action', 'Проверить selector кнопки "Взять предложение" в варианте B.'
    );
  end if;

  -- Рекомендации
  v_min_sample := 1200;
  v_sample_progress := v_winner.sessions::numeric / v_min_sample;

  if v_winner.confidence_level = '95%+' and v_winner.lift_vs_control_pct > 0 then
    v_status := 'ship';
    v_recommendations := v_recommendations || jsonb_build_object(
      'priority', 1,
      'action', 'SHIP',
      'title', 'Запустить вариант ' || v_winner.variant || ' в production',
      'reasoning', 'Lift +' || round(v_winner.lift_vs_control_pct, 1) || '%, p<0.05, выборка достаточная'
    );
  elsif v_winner.lift_vs_control_pct > 5 and v_sample_progress < 1.0 then
    v_status := 'continue';
    v_recommendations := v_recommendations || jsonb_build_object(
      'priority', 1,
      'action', 'CONTINUE',
      'title', 'Продолжить эксперимент',
      'reasoning', 'Lift есть, но выборки пока ' || round(v_sample_progress * 100) || '% от нужной. Нужно ещё ~'
                   || (v_min_sample - v_winner.sessions) || ' сессий.'
    );
  elsif v_winner.lift_vs_control_pct < -5 and v_winner.confidence_level = '95%+' then
    v_status := 'kill';
    v_recommendations := v_recommendations || jsonb_build_object(
      'priority', 1,
      'action', 'KILL',
      'title', 'Откатить вариант ' || v_winner.variant,
      'reasoning', 'Отрицательный lift с p<0.05'
    );
  else
    v_status := 'need_data';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'winner', row_to_json(v_winner),
    'recommendations', v_recommendations,
    'anomalies', v_anomalies,
    'sample_progress', v_sample_progress
  );
end;
$$;
```

---

## 7. UI дашборда: подробная разбивка по секциям

### 7.1. Общая структура страницы

URL: `https://dashboard.dreamcar.ua/#upsell-ab` (вкладка существующего дашборда)
Или: отдельный SPA `https://upsell.dreamcar.ua/` (если хотим максимум гибкости)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Header (фиксированный)                                              │
│  ◀ Назад      🎯 UPSELL WINDOW 1 — A/B/C тест    [7д] [14д] [30д]   │
│                                                  Фильтры ▾          │
├──────────────────────────────────────────────────────────────────────┤
│  [1] Hero — Status + Decision                                        │
│  🏆 Победитель пока: Вариант A — +29% RPS, confidence 91%            │
│  📊 Рекомендация: CONTINUE — нужно ещё ~200 сессий                   │
├──────────────────────────────────────────────────────────────────────┤
│  [2] KPI cards (4 в ряд)                                             │
│  ┌────────┬────────┬────────┬────────┐                              │
│  │Выручка │  RPS   │ Конв.  │  Lift  │                              │
│  └────────┴────────┴────────┴────────┘                              │
├──────────────────────────────────────────────────────────────────────┤
│  [3] Главная сравнительная таблица                                   │
│  | Ветка | Сесс | Опл. | Конв. | RPS | Lift | p-value | Действия |  │
├──────────────────────────────────────────────────────────────────────┤
│  [4] Time-series RPS                                                 │
│       Линейный график с 3 линиями + CI shaded                        │
├──────────────────────────────────────────────────────────────────────┤
│  [5] Horizontal funnel (3 колонки рядом)                             │
│       Control | Variant A | Variant B                                │
├──────────────────────────────────────────────────────────────────────┤
│  [6] Drop-off breakdown                                              │
│       Таблица: куда уходят люди и по какой причине                  │
├──────────────────────────────────────────────────────────────────────┤
│  [7] Сегментация (filter chips сверху)                               │
│       Device | Source | Tariff | Repeat visitor                      │
├──────────────────────────────────────────────────────────────────────┤
│  [8] Timeline эксперимента                                           │
│       06.06 ●─────●─────● 06.07                                      │
├──────────────────────────────────────────────────────────────────────┤
│  [9] Recommendation engine                                           │
│       🤖 Что делать прямо сейчас                                     │
├──────────────────────────────────────────────────────────────────────┤
│  [10] Settings tab (вкладка)                                         │
│       Toggle вариантов on/off, изменение allocation, MDE             │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.2. Hero — Status + Decision

**Цель:** За 5 секунд понять статус эксперимента и что делать.

**Логика статуса:**

```
🟢 SHIP        — p-value < 0.05 AND lift > 0 AND sessions > min_sample
🟡 CONTINUE    — есть lift но один из критериев не выполнен
🔴 KILL        — p-value < 0.05 AND lift < 0
⚪ NEED DATA   — sessions < 100 (мало для любых выводов)
🟠 ANOMALY     — выявлен баг трекинга или критическая аномалия (важнее всех остальных)
```

**Mockup:**

```
┌────────────────────────────────────────────────────────────────────┐
│ 🟡 ПРОДОЛЖАЕМ ЭКСПЕРИМЕНТ                                          │
│                                                                    │
│ 🏆 Победитель пока: Вариант A: пакет дороже                        │
│    RPS +29% над контролем (153 ₴ vs 119 ₴)                         │
│    Confidence 91% (нужно ≥ 95%)                                    │
│                                                                    │
│ 📊 Прогресс выборки: 99 / 1200 сессий (8%)                         │
│    ▓▓░░░░░░░░░░░░░░░░░░░░ 8%                                       │
│    Осталось ~1100 сессий до 95% significance                       │
│                                                                    │
│ ⚠ ВНИМАНИЕ: Обнаружены 2 аномалии трекинга                         │
│    [Показать детали ▾]                                             │
└────────────────────────────────────────────────────────────────────┘
```

### 7.3. KPI cards

4 карточки в ряд:

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ ВЫРУЧКА      │ RPS          │ КОНВЕРСИЯ    │ ЛУЧШИЙ ЛИФТ  │
│              │              │              │              │
│  39 977 ₴    │  145 ₴/сес   │   76.2%      │   +29% 🟢    │
│              │              │              │              │
│ всем веткам  │ среднее      │ paid/started │ Вариант A    │
│ ↑ 12% vs    │ взвешенное   │              │              │
│ прошлый      │              │              │              │
│ период       │              │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

**Tech specs:**
- Каждая карточка кликабельна → переход на детальный график
- Hover показывает delta vs предыдущий период (7д до старта)
- Цвет:
  - Зелёный — лучше прошлого периода
  - Жёлтый — на уровне
  - Красный — хуже

### 7.4. Главная сравнительная таблица

```
┌─────────────────────┬──────┬──────┬──────┬───────┬─────────┬──────┬─────────┬──────────┬───────────┐
│ Ветка               │ Сесс │ Опл. │ Конв │ Чек   │ Выручка │ RPS  │ vs Контр│ p-value  │ Действие  │
├─────────────────────┼──────┼──────┼──────┼───────┼─────────┼──────┼─────────┼──────────┼───────────┤
│🟢 Контроль          │  51  │  35  │ 68.6%│ 173₴  │  6 065₴ │ 119₴ │ baseline│    —     │ [Toggle]  │
│                     │      │      │      │       │         │      │         │          │           │
│🟡 A: пакет дороже   │  99  │  76  │ 76.8%│ 200₴  │ 15 174₴ │ 153₴ │ +29% ⚠ │ p=0.091  │ [Toggle]  │
│                     │      │      │      │       │         │      │         │          │ [Подробно]│
│                     │      │      │      │       │         │      │         │          │           │
│🟡 B: количество     │ 123  │  97  │ 78.9%│ 193₴  │ 18 738₴ │ 152₴ │ +28% ⚠ │ p=0.103  │ [Toggle]  │
└─────────────────────┴──────┴──────┴──────┴───────┴─────────┴──────┴─────────┴──────────┴───────────┘

🟢 = control (точка отсчёта)  🟡 = идёт борьба  🟢 = победитель ⚠ = недостаточно данных
```

**Tech specs:**
- Колонки sortable по клику
- Каждая строка имеет toggle (включить/выключить вариант)
  - При выключении — confirm modal "уверены? Это сразу остановит трафик в эту ветку"
  - Логируется в `experiment_change_log` с user_id и note
- Кнопка [Подробно] открывает modal с per-variant breakdown:
  - Распределение по device
  - Распределение по utm_source
  - Кривая обучения (early data может отличаться от поздних)

**Цветовое кодирование:**
- Конв > 75% — зелёный
- Конв 50-75% — жёлтый
- Конв < 50% — красный
- p-value < 0.05 — зелёный (significant)
- p-value 0.05-0.10 — жёлтый
- p-value > 0.10 — серый (not significant)

### 7.5. Time-series RPS chart

**Цель:** Увидеть динамику и тренд.

**Графики (вкладки переключаются):**

1. **RPS daily** — линейный график с 3 линиями
2. **Cumulative revenue** — stacked area chart
3. **Daily conversion** — линейный график
4. **Sessions per day** — bar chart
5. **Uptake rate** — линейный график (доля принявших upsell)

**Mockup для RPS daily:**

```
₴/сессию
180 ┤
160 ┤          ──╮
140 ┤    ╱──╯    ╰──╮           ← Вариант A (153 ₴ avg)
120 ┤  ╱╯           ╰── ─╮      ← Вариант B (152 ₴ avg)
100 ┤              ────  ╰╮     ← Контроль (119 ₴ avg)
 80 ┤
 60 ┤
    └─────────────────────────────────────
    06.06  09.06  12.06  15.06  18.06  21.06  24.06  27.06  30.06  03.07  06.07
              │
              ●────── 12.06: внесли изменение цены пакета B
                          │
                          ●────── 20.06: добавили вариант B2
```

**Tech specs:**
- Используем **Chart.js** (Line chart с tension 0.3 для smooth)
- Каждая линия имеет **shaded confidence interval** (band ±1 SE)
- Маркеры событий (vertical lines) с tooltip "что произошло"
- Toggle "показать confidence interval" / "только средние"
- Период: 7д / 14д / 30д переключается из header
- Hover на точку показывает: дата, RPS, сессий, выручка
- Можно выбрать какие ветки показать (legend кликабельный)

### 7.6. Horizontal funnel (3 колонки рядом)

**Цель:** Увидеть где люди отваливаются.

```
КОНТРОЛЬ                     ВАРИАНТ A                     ВАРИАНТ B

phone                        phone                        phone
▓▓▓▓▓▓▓▓▓▓ 100% (51)         ▓▓▓▓▓▓▓▓▓▓ 100% (99)         ▓▓▓▓▓▓▓▓▓▓ 100% (123)
   │  -4%                       │  -5%                       │  -3%
   ▼                            ▼                            ▼
data_confirm                  data_confirm                  data_confirm
▓▓▓▓▓▓▓▓▓░ 96% (49)          ▓▓▓▓▓▓▓▓▓░ 95% (94)          ▓▓▓▓▓▓▓▓▓░ 97% (119)
   │  -23%                      │  -14%                      │  -16%
   │  [нет upsell]              ▼                            ▼
   │                          upsell_window_1               upsell_window_1
   │                          ▓▓▓▓▓▓▓▓░░ 81% (80)          ▓▓▓▓▓▓▓▓░░ 81% (100)
   │                             │  -5%                       │  -2%
   │                             │ took: 50% (49)            │ took: 60% (60)
   │                             ▼                            ▼
   ▼                           payment                       payment
payment                       ▓▓▓▓▓▓▓░░░ 76% (75)          ▓▓▓▓▓▓▓▓░░ 79% (98)
▓▓▓▓▓▓▓░░░ 73% (37)             │  -7%  fail              │  -1%  fail
   │  -22% fail                  ▼                            ▼
   ▼                           success                       success
success                       ▓▓▓▓▓▓▓░░░ 71% (76)          ▓▓▓▓▓▓▓▓░░ 78% (97)
▓▓▓▓▓░░░░░ 51% (35)
```

**Tech specs:**
- Каждый шаг — прогресс-бар с числом и %
- Hover на стрелку (-X%) показывает breakdown:
  - `next`: X%
  - `took` (если upsell-шаг): Y%
  - `dropped (close)`: Z%
  - `dropped (timeout)`: W%
  - `dropped (tab close)`: V%
  - `payment failure`: U%
- Цветовое кодирование стрелок:
  - -0-5% (нормально) — зелёный
  - -5-15% (заметно) — жёлтый
  - -15%+ (критично) — красный
- Внизу insight box: "📍 Главная проблема: на контроле 22% теряется на payment failure"

### 7.7. Drop-off breakdown

**Цель:** Детальная таблица куда и по какой причине уходят.

```
КУДА УХОДЯТ ЮЗЕРЫ                Control    A        B
                                  (51)     (99)    (123)
                                  ────     ────    ────
✕ phone → close button             1 (2%)  3 (3%)  2 (2%)
✕ phone → tab close                1 (2%)  0       2 (2%)
─────────────────────────────────────────────────────────
✕ data_confirm → close             2 (4%)  2 (2%)  3 (2%)
✕ data_confirm → inactive          0       0       1 (1%)
─────────────────────────────────────────────────────────
✕ upsell_window_1 → close          —       9 (9%)  10 (8%)
✕ upsell_window_1 → tab close      —       2 (2%)  1 (1%)
✕ upsell_window_1 → external       —       1 (1%)  2 (2%)
─────────────────────────────────────────────────────────
✕ payment → close                 12 (23%) 18 (18%) 22 (18%)
✕ payment → FAILURE 🔴            11 (22%)  4 (4%)   6 (5%)  ← АНОМАЛИЯ
─────────────────────────────────────────────────────────
✓ Total success                  35 (68%) 76 (77%) 97 (79%)
```

**Tech specs:**
- Таблица sortable по любой колонке
- Цвет ячейки = % от total. Красный gradient для drop, зелёный для success
- 🔴 marker для аномалий (значение в 3+ раза отличается от других веток)
- Кликабельные ячейки → drill-down модал со списком session_id и details

### 7.8. Сегментация

**Filter chips в header:**

```
┌────────────────────────────────────────────────────────────┐
│ Фильтры:                                                   │
│ Device:  [Все]  [Mobile]  [Desktop]  [Tablet]              │
│ Source:  [Все]  [FB Ads]  [Google]  [Direct]  [Email]      │
│ Tariff:  [Все]  [Bronze]  [Silver]  [Gold]  [Platinum]     │
│ Repeat:  [Все]  [Новые]  [Повторные]                       │
└────────────────────────────────────────────────────────────┘
```

При выборе фильтра — **все секции дашборда** пересчитываются.

**Tech specs:**
- Multi-select chip
- URL state: фильтры сохраняются в hash для шаринга `#device=mobile&source=fb_ads`
- "Сравнить сегменты" — режим где показывает Mobile vs Desktop side by side
- Когда выборка после фильтрации < 50 сессий — баннер "недостаточно данных для этого сегмента"

### 7.9. Timeline эксперимента

**Цель:** Видеть когда что менялось (для корреляции с метриками).

```
ВРЕМЕННАЯ ШКАЛА ЭКСПЕРИМЕНТА
───────────────────────────────────────────────────────────────
06.06          12.06          20.06          27.06        Сегодня
  ●             ●             ●              ●             ▌
  │             │             │              │
  Запуск       Изменили      Добавили       Включили
  Window 1     цену          вариант B      Window 2
  20/40/40    пакета (B):    с разной
              4999 → 4499    скидкой
                                             ⚠ С этого момента
                                             данные несравнимы
                                             со старыми
───────────────────────────────────────────────────────────────
```

**Tech specs:**
- Маркеры из `experiment_change_log`
- Hover показывает кто внёс изменение и note
- Можно фильтровать "только данные ПОСЛЕ маркера X"

### 7.10. Recommendation engine

```
┌──────────────────────────────────────────────────────────────────┐
│ 🤖 ЧТО ДЕЛАТЬ ПРЯМО СЕЙЧАС?                                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 🟢 ПРИОРИТЕТ 1: Продолжаем эксперимент                            │
│    • Lift +29% над control — экономически выгодно                 │
│    • Confidence 91% — близко к 95%                                │
│    • Нужно ещё ~200-300 сессий                                    │
│    • Прогноз: достигнем 95% после накопления нужной выборки       │
│                                                                  │
│ 🔴 ПРИОРИТЕТ 1: Исправить баг трекинга варианта B                  │
│    • У варианта B: 0 событий "took" но 97 успешных оплат          │
│    • Невозможно посчитать честный uptake rate                    │
│    • Action: проверить event handler на кнопке варианта B         │
│    • Контакт: @artem (разработка)                                 │
│                                                                  │
│ 🟠 ПРИОРИТЕТ 2: Расследовать высокий failure на control            │
│    • На control payment failure = 22%                            │
│    • На A/B failure = 5-6%                                       │
│    • Возможные причины:                                          │
│      - Разный payment gateway                                    │
│      - Sandbox/test mode для control                             │
│      - Sticky session проблема                                   │
│    • Это спотворює сравнение конверсии                           │
│                                                                  │
│ 📋 NEXT EXPERIMENTS (queue)                                       │
│    1. Window 2 (qty + bundle) — coming next                       │
│    2. Variant C (bundle 2x + premium бонус)                       │
│    3. A/B на price anchoring (зачёркнутая старая цена)            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Tech specs:**
- Источник: RPC `upsell_recommendation`
- Каждая рекомендация имеет:
  - Priority (1-3)
  - Color (🔴 critical / 🟠 important / 🟢 nice-to-have)
  - Action (что делать)
  - Reasoning (почему)
  - Owner (кому назначено)
  - Кнопка "Создать задачу" → создаёт task в `/tasks/` с context

### 7.11. Settings tab

Отдельная вкладка для управления экспериментом:

```
┌──────────────────────────────────────────────────────────────┐
│ ⚙ НАСТРОЙКИ ЭКСПЕРИМЕНТА UPSELL WINDOW 1                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ID:               upsell_window_1                            │
│ Название:        [Upsell Window 1: тариф vs количество]      │
│ Описание:        [Тестируем какой апсел работает лучше...]   │
│ Гипотеза:        [Если показать дороже тариф со скидкой...]  │
│                                                              │
│ Период:                                                      │
│ Начало:          06.06.2026                                  │
│ Конец:           автоматически когда 95% confidence          │
│                  □ Или принудительно: [          ]           │
│                                                              │
│ Метрика успеха:  ● RPS  ○ Conv. rate  ○ Uptake               │
│ MDE:             [5] %                                       │
│ Power:           [80] %                                      │
│ Alpha:           [0.05]                                      │
│                                                              │
│ Гилки:                                                       │
│ ┌─────────────────┬────────┬──────────┬──────────────────┐   │
│ │ Имя             │ Alloc  │ Status   │ Действия         │   │
│ ├─────────────────┼────────┼──────────┼──────────────────┤   │
│ │ Контроль        │ 20%    │ ●Active  │ [Pause] [Edit]   │   │
│ │ A: пакет дороже │ 40%    │ ●Active  │ [Pause] [Edit]   │   │
│ │ B: количество   │ 40%    │ ●Active  │ [Pause] [Edit]   │   │
│ └─────────────────┴────────┴──────────┴──────────────────┘   │
│                                                              │
│ [+ Добавить вариант]                                         │
│                                                              │
│ ────────────────────────────────────────────────────────     │
│                                                              │
│ AUDIT LOG последних изменений:                               │
│ 06.06.2026 14:32 — vadym — запустил эксперимент              │
│ 12.06.2026 10:15 — artem — изменил цену пакета B: 4999→4499  │
│ 20.06.2026 09:00 — vadym — добавил вариант B (количество)    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Tech specs:**
- Все изменения через RPC, чтобы залогировать в `experiment_change_log`
- При pause варианта — confirm modal "это сразу остановит трафик в эту ветку"
- При unlocking варианта — пересчёт sticky session (новые попадают в это распределение)
- Audit log показывает последние 20 изменений

---

## 8. Статистическая методология

### 8.1. Primary metric: RPS

**Тест:** Welch's two-sample t-test
**Почему:** RPS — continuous переменная, неравные variance между группами

**Формула t-statistic:**
```
t = (mean₁ - mean₂) / sqrt(var₁/n₁ + var₂/n₂)
```

**Степени свободы (Welch-Satterthwaite):**
```
df = (var₁/n₁ + var₂/n₂)² / ((var₁/n₁)²/(n₁-1) + (var₂/n₂)²/(n₂-1))
```

**Confidence interval 95%:**
```
CI = (mean₂ - mean₁) ± t_(critical,df,0.025) * sqrt(var₁/n₁ + var₂/n₂)
```

### 8.2. Secondary metric: Conversion rate

**Тест:** Chi-square test для пропорций (2×2 таблица)
**Альтернатива:** Bayesian beta-binomial (более интуитивно для пользователей)

**Mockup Bayesian подхода:**
```
P(вариант A > control) = 91%   ← интерпретируется как
                                  "с вероятностью 91% вариант A лучше"
```

Это легче понять чем p-value.

### 8.3. Multiple comparisons correction

При **3+ вариантах** растёт вероятность false positive. Решение:

**Bonferroni correction:**
```
alpha_corrected = alpha / k
где k — количество сравнений (для 3 веток vs control: k=2)
```

Для alpha=0.05, k=2: `alpha_corrected = 0.025`

**Holm-Bonferroni** (мощнее):
1. Отсортировать p-values по возрастанию
2. Применять alpha/(k-i+1) к каждому i-му p-value

### 8.4. Sequential testing — для production

Стандартный t-test НЕ позволяет "подглядывать" (peek) данные во время эксперимента — каждый peek увеличивает false positive rate.

**Решение: mSPRT (mixture Sequential Probability Ratio Test)**

Позволяет в любой момент посмотреть данные без inflate alpha. Подходит для real-time дашбордов.

**Альтернатива (проще):** Alpha-spending function (O'Brien-Fleming):
- Определить planned peeks (например 4 раза: на 25%, 50%, 75%, 100% от запланированной выборки)
- На каждом peek alpha распределена по уменьшающейся scale

### 8.5. Sample size calculator

**Formula:**
```
n_per_variant = 2 * (z_α/2 + z_β)² * σ² / δ²

где:
  z_α/2 = 1.96 (для alpha=0.05 two-tailed)
  z_β   = 0.84 (для power=80%)
  σ     = стандартное отклонение RPS (по нашим данным ~200₴)
  δ     = MDE × baseline_RPS = 0.05 × 119 = 6 ₴
```

**Расчёт для наших данных:**
```
n = 2 × (1.96 + 0.84)² × 200² / 6²
n = 2 × 7.84 × 40000 / 36
n = 17422 сессии на гилку для 5% MDE
```

⚠ Это **очень много** для маленького MDE. Решения:

1. **Увеличить MDE до 15%** → n ≈ 1900/гилка
2. **Признать lift на confidence 90%** вместо 95% → n ≈ 1200/гилка
3. **Bayesian подход** с prior — может дать вывод быстрее

**Для нашего конкретного случая** (lift +29% это HUGE effect) — нужно гораздо меньше:
```
δ = 29% × 119 = 34.5 ₴
n = 2 × 7.84 × 200² / 34.5²
n = 2 × 7.84 × 40000 / 1190
n = 527 сессий на гилку
```

То есть для lift в +29% — **достаточно ~500 сессий на гилку** для 95% significant.
Сейчас A=99, B=123 — нужно набрать ещё ~400 сессий на гилку.

### 8.6. Учёт unequal allocation

При неравном распределении (20/40/40) формулы корректируются:
```
weighted_n = n_total × allocation_pct
```

Это уже учтено в t-test и chi-square — они используют фактические размеры выборок.

---

## 9. Пробелы инструментации (gaps)

| # | Gap | Текущее состояние | Как фиксить | Приоритет |
|---|---|---|---|---|
| 1 | Variant B не трекает `took` | 0 событий, 97 оплат | Найти event handler на кнопке "Взять" варианта B, добавить `trackCheckoutEvent({outcome:'took'})` | 🔴 P0 |
| 2 | Нет `session_id` sticky | Возможны двойные подсчёты при F5 | Cookie `__dc_sess` 30d, генерируется на первой загрузке | 🔴 P0 |
| 3 | `amount_final` не пишется в event | Считаем revenue из отдельной таблицы | Добавить в success event поле `amount_final` | 🔴 P0 |
| 4 | Нет трекинга steps `phone`, `data_confirm`, `tariff_pick` | Видим только upsell window | Добавить `trackCheckoutEvent` в onMount/onLeave каждого шага | 🟡 P1 |
| 5 | Нет sub-states для `dropped` | Только бинарно "ушёл" | Добавить `drop_reason` (close_btn / back_btn / tab_close / inactive / external) | 🟡 P1 |
| 6 | Нет `time_on_step_ms` | Не понимаем где UX слишком медленный | Timer onMount → onLeave каждого шага | 🟡 P1 |
| 7 | Нет device tracking | Не можем сегментировать mobile/desktop | Парсить `navigator.userAgent` на frontend | 🟡 P1 |
| 8 | Нет utm consistency | UTM могут потеряться между шагами | На phone-step сохранять в session storage, прикреплять к каждому event | 🟢 P2 |
| 9 | Нет `is_repeat_visitor` | Не отличаем new vs returning | Cookie check, инкрементировать `visit_count` | 🟢 P2 |
| 10 | Нет abandon timeline | Не знаем сколько ждать "dropped (timeout)" | Реализовать inactivity timer 5 минут | 🟡 P1 |
| 11 | Нет геолокации | Не можем сравнить по странам | Использовать Cloudflare CF-IPCountry header | 🟢 P3 |
| 12 | Нет error tracking | Не видим JS ошибки на чекауте | Sentry или альтернатива | 🟢 P3 |

### 9.1. Конкретные технические задачи по каждому gap

#### Gap 1: Variant B `took`

**Расследование:**
```javascript
// Найти где варіант B рендерится
// Проверить:
// 1. data-variant атрибут совпадает?
// 2. onClick handler attached?
// 3. Эвент action правильный?

// Скорее всего в коде что-то вроде:
<button onClick={() => acceptUpsell('A')}>Взять</button>  // Вариант A
<button onClick={() => acceptUpsell('B')}>Взять</button>  // Вариант B

// Проверить функцию acceptUpsell:
function acceptUpsell(variant) {
  if (variant === 'A') {
    trackEvent('took', {variant: 'A'});  // ← возможно баг: нет аналогичного для B
  }
  // ...
}
```

#### Gap 2: Sticky session_id

```javascript
// Добавить в checkout/index.html или main.js
(function initSession() {
  let sid = document.cookie.match(/__dc_sess=([^;]+)/);
  if (!sid) {
    sid = 'sess_' + crypto.randomUUID();
    const expires = new Date(Date.now() + 30*24*3600*1000).toUTCString();
    document.cookie = `__dc_sess=${sid}; path=/; expires=${expires}; SameSite=Lax; Secure`;
    window.__sessionId = sid;
  } else {
    window.__sessionId = sid[1];
  }
})();
```

#### Gap 3: amount_final в success event

```javascript
// На странице success после оплаты
trackCheckoutEvent({
  step: 'success',
  outcome: 'next',
  tariff_final: paymentResult.tariff,
  amount_final: paymentResult.amount,
  qty_final: paymentResult.qty
});
```

---

## 10. Acceptance criteria (что значит "готово")

### 10.1. Backend / DB

- [ ] Создана таблица `public.checkout_events` с indexes
- [ ] Создана таблица `public.experiments` с CRUD RPC
- [ ] Создана таблица `public.experiment_change_log`
- [ ] Создан materialized view `mv_upsell_funnel` с unique index
- [ ] Создан materialized view `mv_upsell_daily`
- [ ] Создан cron `mv-upsell-funnel-refresh` каждые 5 минут
- [ ] RPC `upsell_summary` возвращает корректные данные
- [ ] RPC `upsell_significance` рассчитывает p-value (Welch + chi-square)
- [ ] RPC `upsell_funnel` возвращает per-step breakdown
- [ ] RPC `upsell_recommendation` выдаёт рекомендации и аномалии
- [ ] RLS политики настроены: read для CEO/COO/Lead, write для service_role

### 10.2. Frontend tracking

- [ ] На всех 7 шагах чекаута стреляет `trackCheckoutEvent`
- [ ] Outcomes: `next`, `took`, `dropped` корректно трекаются
- [ ] `drop_reason` имеет sub-states (close_btn / back_btn / tab_close / inactive / external)
- [ ] `time_on_step_ms` рассчитывается
- [ ] `session_id` sticky через cookie 30d
- [ ] UTM, device, is_repeat_visitor захватываются
- [ ] Используется `navigator.sendBeacon` для `beforeunload` events
- [ ] Variant B `took` баг исправлен (event handler срабатывает)
- [ ] `amount_final` в success event

### 10.3. Backend API

- [ ] POST `/api/track` принимает batch events (для performance)
- [ ] POST `/api/track` отвечает быстро (<100ms) для не блокирования UX
- [ ] Idempotency через `event_id` (rejection дубликатов)
- [ ] Rate limiting (защита от spam)

### 10.4. Dashboard UI

- [ ] Hero-секция с status (SHIP / CONTINUE / KILL / NEED DATA / ANOMALY)
- [ ] 4 KPI cards (Выручка / RPS / Конв / Lift)
- [ ] Сравнительная таблица с p-value и toggle on/off вариантов
- [ ] Time-series chart с 3 линиями и confidence interval
- [ ] Horizontal funnel в 3 колонки (по веткам)
- [ ] Drop-off breakdown table с sub-reasons
- [ ] Сегментация (device / source / tariff / repeat)
- [ ] Timeline экспериментa с маркерами
- [ ] Recommendation engine с приоритетами
- [ ] Settings tab с CRUD вариантов и audit log
- [ ] Реалтайм обновление через Supabase Realtime
- [ ] Responsive: работает на desktop, tablet, mobile
- [ ] Dark theme (соответствует остальному дашборду)
- [ ] Тесты для всех расчётов (jest для frontend, pgTAP для SQL)

### 10.5. Документация

- [ ] README по использованию дашборда
- [ ] Glossary терминов (RPS, MDE, p-value, lift, etc.)
- [ ] How-to guide для запуска нового A/B теста
- [ ] How-to guide для интерпретации результатов
- [ ] Onboarding section в team.dreamcar.ua/onboarding.html

---

## 11. Технический стек и архитектура

### 11.1. Стек

| Слой | Технология | Обоснование |
|---|---|---|
| **Frontend tracking** | Vanilla JS + `navigator.sendBeacon` | Минимум зависимостей, работает с любым framework |
| **Tracking API** | Cloudflare Worker → Supabase | Низкая латентность, scale-to-zero |
| **DB** | Supabase Postgres | Уже используется, materialized views, pg_cron |
| **Backend stats** | PostgreSQL RPC + JS fallback | Простые расчёты в SQL, сложные — на frontend через simple-statistics.js |
| **Dashboard UI** | HTML + Vanilla JS + Chart.js | В стиле остального дашборда, без React/Vue |
| **Realtime** | Supabase Realtime | Уже используется в HQ/Tasks |

### 11.2. Архитектура data flow

```
┌─────────────────────────────────────────────────────────────┐
│  User Browser                                               │
│  • Open checkout page                                       │
│  • assignVariant() через sticky session_id                  │
│  • trackCheckoutEvent() на каждом шаге                      │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ POST /api/track (batch до 10 events)
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker `track-checkout`                          │
│  • Валидация payload                                        │
│  • Обогащение (geo, device parsing)                         │
│  • INSERT batch в Supabase                                  │
│  • Возвращает 200 быстро (без ожидания обработки)           │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ INSERT INTO checkout_events
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase Postgres                                          │
│  • checkout_events (append-only)                            │
│  • cron каждые 5 мин:                                       │
│    REFRESH MATERIALIZED VIEW mv_upsell_funnel               │
│    REFRESH MATERIALIZED VIEW mv_upsell_daily                │
│  • RPC функции для дашборда                                 │
│  • Supabase Realtime publishes mv changes                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Realtime subscription / RPC fetch
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Dashboard `dashboard.dreamcar.ua/#upsell-ab`               │
│  • Подписка на realtime updates                             │
│  • Перерисовка KPI / графиков / таблиц                      │
│  • Cache в memory для responsiveness                        │
└─────────────────────────────────────────────────────────────┘
```

### 11.3. Performance considerations

- **Batch tracking events** — frontend копит до 10 events, шлёт одним запросом
- **sendBeacon** для критичных событий (beforeunload)
- **Materialized view** для агрегации — обновляется раз в 5 мин, дешёво для UI
- **Realtime только для последних изменений** — не для исторических данных
- **Lazy loading графиков** — Chart.js только когда нужно

### 11.4. Безопасность

- **No PII в events** — не пишем имя, телефон, email (только session_id и user_id)
- **RLS policies** — только authenticated CEO/COO/Lead могут читать
- **Service role** для tracking endpoint
- **Rate limiting** — не более 100 events/min с одного IP
- **CORS** — разрешён только с dreamcar.ua

---

## 12. Приоритеты реализации (без сроков — делается единым спринтом)

### Блок 1: Фундамент (P0)

- DB schema: `checkout_events`, `experiments`, `experiment_change_log`
- Materialized views: `mv_upsell_funnel`, `mv_upsell_daily`
- Cron `mv-upsell-funnel-refresh` (каждые 5 минут)
- RPC: `upsell_summary`, `upsell_significance`, `upsell_funnel`, `upsell_recommendation`
- Frontend bug fix: трекинг `took` для варианта B
- Frontend: session_id sticky cookie 30d
- Frontend: `amount_final` в success event

### Блок 2: Расширение tracking (P1)

- Frontend: track все 7 шагов чекаута
- Frontend: `drop_reason` sub-states (close_btn / back_btn / tab_close / inactive / external)
- Frontend: `time_on_step_ms`
- Frontend: device / utm / repeat visitor tracking
- Frontend: inactivity timer 5 мин
- Frontend: `sendBeacon` для beforeunload

### Блок 3: Dashboard MVP (P0)

- UI: Hero-секция со статусом и решением
- UI: 4 KPI cards
- UI: Сравнительная таблица с p-value и toggle on/off вариантов
- UI: Time-series chart (RPS / conv / cumulative revenue)
- UI: Horizontal funnel в 3 колонки
- UI: Drop-off breakdown table

### Блок 4: Polish (P1)

- UI: Сегментация (device / source / tariff / repeat)
- UI: Timeline маркеров изменений эксперимента
- UI: Recommendation engine
- UI: Settings tab с audit log
- Realtime обновление через Supabase Realtime
- Документация + onboarding
- Подготовка инструментации Window 2 (qty)

---

## 13. Примеры расчётов

### 13.1. Текущие данные (по скриншоту)

```
Контроль: n=51, paid=35, revenue=6065 ₴
   conv = 35/51 = 68.6%
   RPS = 6065/51 = 119 ₴/сессию
   var(revenue) ≈ ?  (нужны индивидуальные транзакции)

Вариант A: n=99, paid=76, revenue=15174 ₴
   conv = 76/99 = 76.8%
   RPS = 15174/99 = 153.3 ₴/сессию

Вариант B: n=123, paid=97, revenue=18738 ₴
   conv = 97/123 = 78.9%
   RPS = 18738/123 = 152.3 ₴/сессию
```

### 13.2. Lift расчёт

```
Lift A vs Control = (153 - 119) / 119 = 28.6% relative
Lift B vs Control = (152 - 119) / 119 = 27.7% relative

Lift в абсолютных значениях:
A vs Control: +34 ₴/сессию
B vs Control: +33 ₴/сессию
```

### 13.3. Welch's t-test (приближённый)

Предположим var(revenue per session) ≈ 200² = 40000 (по нашему опыту):

```
t = (153 - 119) / sqrt(40000/99 + 40000/51)
  = 34 / sqrt(404 + 784)
  = 34 / sqrt(1188)
  = 34 / 34.5
  = 0.99

df ≈ 89 (Welch-Satterthwaite)
p-value (two-tailed) ≈ 0.32  (НЕ significant)
```

Hmm — это **противоречит** интуитивному "lift +29%". Причина:
- Variance очень высокая (некоторые юзеры платят 999, другие 4999)
- Выборка мала (n=51 control)
- Нужно либо больше данных, либо снизить variance (например через сегментацию)

### 13.4. Chi-square для конверсии

```
              Control  Variant A  Total
Paid            35       76        111
Not paid        16       23         39
Total           51       99        150

E(C,paid) = 51 * 111 / 150 = 37.74
E(C,not)  = 51 * 39 / 150 = 13.26
E(A,paid) = 99 * 111 / 150 = 73.26
E(A,not)  = 99 * 39 / 150 = 25.74

chi² = (35-37.74)²/37.74 + (16-13.26)²/13.26
     + (76-73.26)²/73.26 + (23-25.74)²/25.74
     = 0.199 + 0.566 + 0.102 + 0.292
     = 1.16

p-value (df=1) ≈ 0.28  (НЕ significant)
```

### 13.5. Sample size для нашего случая

```
δ = 34 ₴ (наблюдаемый lift)
σ² ≈ 40000

n_per_variant = 2 * (1.96 + 0.84)² * 40000 / 34²
              = 2 * 7.84 * 40000 / 1156
              = 542

Текущее: 99 / 542 = 18% от нужной выборки.
Нужно ещё ~450 сессий на гилку.
```

Если темп набора сессий мал, есть варианты ускорить вывод:
1. Увеличить аллокацию контроля (60/20/20 → быстрее накопить baseline)
2. Снизить variance: фиксированная цена upsell вместо нескольких опций
3. Признать на confidence 90% — для большого lift этого может быть достаточно

---

## 14. Приложение: код реализации

### 14.1. Frontend tracking library

```javascript
// /assets/js/checkout-tracker.js
(function() {
  const API_URL = 'https://track.dreamcar.ua/api/track';
  const BATCH_SIZE = 5;
  const FLUSH_INTERVAL_MS = 2000;

  let queue = [];
  let flushTimer = null;
  let stepArrivedAt = Date.now();
  let inactivityTimer = null;

  // Sticky session
  function getSessionId() {
    let sid = document.cookie.match(/__dc_sess=([^;]+)/);
    if (!sid) {
      sid = 'sess_' + crypto.randomUUID();
      const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toUTCString();
      document.cookie = `__dc_sess=${sid}; path=/; expires=${expires}; SameSite=Lax; Secure`;
      return sid;
    }
    return sid[1];
  }

  // Стикки variant
  function getVariant(experimentId) {
    const cacheKey = `__dc_variant_${experimentId}`;
    let cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    const sid = getSessionId();
    const hash = simpleHash(sid + experimentId);
    const bucket = hash % 100;
    let variant;
    if (bucket < 20) variant = 'control';
    else if (bucket < 60) variant = 'A';
    else variant = 'B';

    sessionStorage.setItem(cacheKey, variant);
    return variant;
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // Device detection
  function detectDevice() {
    const ua = navigator.userAgent;
    if (/Mobile|Android|iPhone/.test(ua)) return 'mobile';
    if (/Tablet|iPad/.test(ua)) return 'tablet';
    return 'desktop';
  }

  // UTM persistence
  function getUtm() {
    const params = new URLSearchParams(window.location.search);
    const utm = {};
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(k => {
      const v = params.get(`utm_${k}`);
      if (v) utm[`utm_${k}`] = v;
    });
    if (Object.keys(utm).length) {
      sessionStorage.setItem('__dc_utm', JSON.stringify(utm));
      return utm;
    }
    try {
      return JSON.parse(sessionStorage.getItem('__dc_utm') || '{}');
    } catch (_) {
      return {};
    }
  }

  // Repeat visitor
  function getVisitorInfo() {
    const firstVisit = localStorage.getItem('__dc_first_visit');
    const visitCount = parseInt(localStorage.getItem('__dc_visit_count') || '0') + 1;
    const isRepeat = !!firstVisit;
    if (!firstVisit) {
      localStorage.setItem('__dc_first_visit', new Date().toISOString());
    }
    localStorage.setItem('__dc_visit_count', visitCount.toString());
    const days = firstVisit
      ? Math.floor((Date.now() - new Date(firstVisit).getTime()) / (24 * 3600 * 1000))
      : 0;
    return { is_repeat_visitor: isRepeat, visit_count: visitCount, days_since_first_visit: days };
  }

  // Public API
  window.dcTrack = function(eventData) {
    const visitor = getVisitorInfo();
    const utm = getUtm();
    const event = {
      event_id: 'evt_' + crypto.randomUUID(),
      session_id: getSessionId(),
      ts: new Date().toISOString(),
      experiment_id: eventData.experiment_id || 'upsell_window_1',
      variant: getVariant(eventData.experiment_id || 'upsell_window_1'),
      device: detectDevice(),
      page_url: window.location.href,
      page_path: window.location.pathname,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent.slice(0, 200),
      app_version: window.__APP_VERSION__ || '1.0.0',
      time_on_step_ms: Date.now() - stepArrivedAt,
      ...visitor,
      ...utm,
      ...eventData
    };
    queue.push(event);
    if (queue.length >= BATCH_SIZE) flush();
    else scheduleFlush();
  };

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }

  function flush() {
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    clearTimeout(flushTimer);
    flushTimer = null;
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true
    }).catch(err => {
      console.warn('[track] failed', err);
      // Re-queue для retry
      queue = batch.concat(queue);
    });
  }

  // Step transitions
  window.dcMarkStepArrival = function(step) {
    stepArrivedAt = Date.now();
    window.__currentStep = step;
    resetInactivity();
  };

  // Inactivity detection
  function resetInactivity() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      window.dcTrack({
        step: window.__currentStep,
        outcome: 'dropped',
        drop_reason: 'inactive_5min'
      });
    }, 5 * 60 * 1000);
  }
  ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, resetInactivity, { passive: true });
  });

  // beforeunload — flush через sendBeacon
  window.addEventListener('beforeunload', () => {
    if (queue.length) {
      navigator.sendBeacon(API_URL, JSON.stringify({ events: queue }));
      queue = [];
    }
  });

  // Pagehide — track tab close
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted && window.__currentStep && window.__currentStep !== 'success') {
      navigator.sendBeacon(API_URL, JSON.stringify({
        events: [{
          event_id: 'evt_' + crypto.randomUUID(),
          session_id: getSessionId(),
          ts: new Date().toISOString(),
          experiment_id: 'upsell_window_1',
          variant: getVariant('upsell_window_1'),
          step: window.__currentStep,
          outcome: 'dropped',
          drop_reason: 'tab_close',
          time_on_step_ms: Date.now() - stepArrivedAt
        }]
      }));
    }
  });
})();
```

### 14.2. Cloudflare Worker для tracking endpoint

```javascript
// track-worker/index.js
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders()
      });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const body = await request.json();
      if (!body.events || !Array.isArray(body.events)) {
        return json({ error: 'Invalid payload' }, 400);
      }
      if (body.events.length > 20) {
        return json({ error: 'Batch too large' }, 400);
      }

      // Обогащение
      const geo = {
        country: request.cf?.country || null,
        city: request.cf?.city || null
      };
      const enriched = body.events.map(e => ({
        ...e,
        geo_country: geo.country,
        geo_city: geo.city,
        received_at: new Date().toISOString()
      }));

      // INSERT в Supabase через REST API
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/checkout_events`, {
        method: 'POST',
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal,resolution=ignore-duplicates'
        },
        body: JSON.stringify(enriched)
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[supabase]', err);
        return json({ error: 'DB error' }, 500);
      }

      return json({ ok: true, count: enriched.length });
    } catch (err) {
      console.error('[track]', err);
      return json({ error: err.message }, 500);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
```

### 14.3. Dashboard главный JS

```javascript
// dashboard/assets/js/upsell-ab.js
(async function() {
  const sb = await initSupabase();
  const state = {
    experimentId: 'upsell_window_1',
    period: 30,
    filters: {}
  };

  async function loadData() {
    const [summary, significance, recommendation] = await Promise.all([
      sb.rpc('upsell_summary', {
        p_experiment_id: state.experimentId,
        p_period_days: state.period,
        p_filter: state.filters
      }),
      sb.rpc('upsell_significance', {
        p_experiment_id: state.experimentId,
        p_period_days: state.period,
        p_filter: state.filters
      }),
      sb.rpc('upsell_recommendation', {
        p_experiment_id: state.experimentId
      })
    ]);
    return {
      summary: summary.data || [],
      significance: significance.data || [],
      recommendation: recommendation.data || {}
    };
  }

  async function render() {
    const data = await loadData();
    renderHero(data);
    renderKPI(data);
    renderTable(data);
    renderTimeSeries();
    renderFunnel();
    renderDropOff(data);
    renderRecommendation(data.recommendation);
  }

  function renderHero({ significance, recommendation }) {
    const winner = significance
      .filter(s => s.variant !== 'control')
      .sort((a, b) => b.rps - a.rps)[0];
    const status = recommendation.status;
    const el = document.getElementById('hero');
    el.innerHTML = `
      <div class="hero-status hero-${status}">
        ${statusIcon(status)} ${statusLabel(status)}
      </div>
      <h2>Победитель пока: ${winner?.variant || '—'}</h2>
      <div>RPS +${(winner?.lift_vs_control_pct || 0).toFixed(1)}% над контролем</div>
      <div>Confidence: ${winner?.confidence_level || '—'}</div>
      <div class="progress-bar">
        Прогресс выборки: ${(recommendation.sample_progress * 100).toFixed(0)}%
      </div>
    `;
  }

  // ... renderKPI, renderTable, renderTimeSeries и т.д.

  // Realtime подписка
  sb.channel('upsell_realtime')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'checkout_events'
    }, () => {
      // debounce: ререндер не чаще раз в 5 сек
      debounce(render, 5000)();
    })
    .subscribe();

  await render();
})();
```

---

## Подытоживая

Этот дашборд — это **не просто красивые таблицы**. Это инструмент принятия бизнес-решений с встроенной статистикой и автоматическими рекомендациями.

**Главные принципы которыми руководствовался:**

1. **Decision-first design** — каждая секция отвечает на конкретный бизнес-вопрос
2. **Honest statistics** — показываем p-value и confidence интервалы, не врём про "значимый рост" когда он не значимый
3. **Anomaly detection** — автоматически выявляем баги трекинга (как у нас сейчас с вариантом B)
4. **Action-oriented** — каждая рекомендация имеет конкретный action item
5. **Scalable** — поддерживает A/B/C/D/E и больше веток, multiple experiments одновременно
6. **Auditable** — всё что менялось остаётся в логе

**Что критично сделать в первую очередь:**

🔴 P0 — фиксить баг трекинга варианта B (0 took события)
🔴 P0 — sticky session_id для честного подсчёта unique users
🔴 P0 — расследовать высокий failure rate на control
🟡 P1 — расширить трекинг на все 7 шагов чекаута
🟡 P1 — добавить drop_reason sub-states

После того как инструментация наладится — можно строить дашборд. Без хороших данных самый красивый дашборд бесполезен.

---

**Конец документа.**

Дата: 06.06.2026
Автор: Claude (DreamCar AI assistant)
Согласовано: ожидается утверждение Вадим + Артём
