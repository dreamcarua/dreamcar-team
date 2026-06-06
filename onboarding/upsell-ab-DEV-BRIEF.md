# 🛠 DEV BRIEF: Подключение Upsell A/B/C tracking

**Кому:** Артём (разработка)
**От:** Vadym (CEO) + Claude
**Срок:** пара часов
**Приоритет:** P0 (без этого дашборд не работает)

---

## TL;DR

1. Подключить `checkout-tracker.js` на checkout страницы (3 строки HTML)
2. Вставить `dcTrack()` на 7 кроках чекаута (по 1-3 строки на каждый)
3. **Найти и пофиксить баг:** вариант B имеет 0 событий `took` при 97 оплатах
4. **Расследовать:** на контроле failure rate 22%, на A/B всего 5-6%

После этого дашборд оживёт автоматически: https://dashboard.dreamcar.ua/upsell-ab/

---

## 1. Что уже готово (НЕ трогать — оно работает)

| Компонент | URL/Путь | Статус |
|---|---|---|
| Edge function `track-checkout` | `https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/track-checkout` | ✅ live |
| DB schema (checkout_events, experiments) | Supabase project `wotghlaehnvxyeacznvv` | ✅ live |
| RPC функции (summary, significance, funnel) | Supabase | ✅ live |
| Materialized views + cron */5 min | Supabase | ✅ live |
| Tracker library | `https://team.dreamcar.ua/checkout-tracker/checkout-tracker.js` | ✅ live (CDN) |
| Dashboard UI | `https://dashboard.dreamcar.ua/upsell-ab/` | ✅ live (без данных) |

---

## 2. Что нужно сделать тебе

### 2.1. Подключить tracker library

В `<head>` страницы checkout добавить:

```html
<script>
  window.dcTrackerConfig = {
    experimentId: 'upsell_window_1',
    apiKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvdGdobGFlaG52eHllYWN6bnZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDc4NjgsImV4cCI6MjA5NDE4Mzg2OH0.Se-y1WawsdSkMLXj7G_O-Kq-jVfjUOBD3KJOvemCR3A'
  };
</script>
<script src="https://team.dreamcar.ua/checkout-tracker/checkout-tracker.js" defer></script>
```

Это даст тебе глобальные функции `window.dcTrack()` и `window.dcMarkStepArrival()`.

После подключения — tracker автоматически:
- Установит sticky cookie `__dc_sess` (30 дней)
- Назначит вариант (control/A/B) через хеш session_id (20/40/40)
- Запишет UTM, device, repeat_visitor
- Отловит beforeunload, popstate, inactivity (5 мин)

### 2.2. Узнать вариант для рендера UI

```javascript
const variant = window.dcGetVariant(); // 'control' | 'A' | 'B'

if (variant === 'control') {
  // не показывать upsell-окно вообще
} else if (variant === 'A') {
  // показать "Возьми Gold за 4999 ₴ вместо Silver за 999 ₴"
} else if (variant === 'B') {
  // показать "Возьми 3 пакета Silver вместо 1 со скидкой 20%"
}
```

⚠ **Variant sticky на 30 дней** — пользователь не должен видеть разные варианты при F5.

### 2.3. Стрелять события на каждом шаге

Базовый шаблон для любого шага:

```javascript
// При входе в шаг:
window.dcMarkStepArrival('phone'); // ← название шага

// При уходе со шага:
window.dcTrack({
  step: 'phone',
  outcome: 'next' // или 'took' / 'dropped' (см. ниже)
});
```

### 2.4. Конкретные точки вставки по шагам

#### Шаг 1: Ввод телефона

```javascript
// onMount компонента / page load
window.dcMarkStepArrival('phone');

// Кнопка "Далее"
function handlePhoneNext() {
  window.dcTrack({ step: 'phone', outcome: 'next' });
  // ... ваша логика перехода
}

// Если есть кнопка "Закрыть" / крестик
function handlePhoneClose() {
  window.dcTrack({
    step: 'phone',
    outcome: 'dropped',
    drop_reason: 'close_btn'
  });
}
```

#### Шаг 2: Подтверждение данных

```javascript
window.dcMarkStepArrival('data_confirm');

function handleDataConfirmNext() {
  window.dcTrack({ step: 'data_confirm', outcome: 'next' });
}
```

#### Шаг 3: Выбор тарифа (если есть)

```javascript
window.dcMarkStepArrival('tariff_pick');

function handleTariffPick(tariff) {
  window.dcTrack({
    step: 'tariff_pick',
    outcome: 'next',
    tariff_base: tariff.name,   // 'silver'
    amount_base: tariff.price,  // 999
    qty_base: 1
  });
}
```

#### Шаг 4: Upsell Window 1 ⭐ КРИТИЧНО

Это место где **БАГ** — для варианта B не стреляет `took`.

```javascript
window.dcMarkStepArrival('upsell_window_1');

// 🔴 ВАЖНО: ОДИН handler для обоих вариантов A и B
function handleUpsellAccept() {
  const variant = window.dcGetVariant();
  const offered = variant === 'A'
    ? { tariff: 'gold', amount: 4999, qty: 1, discount: 20 }
    : { tariff: 'silver', amount: 2997, qty: 3, discount: 20 };

  window.dcTrack({
    step: 'upsell_window_1',
    outcome: 'took',
    tariff_offered: offered.tariff,
    amount_offered: offered.amount,
    qty_offered: offered.qty,
    discount_offered_pct: offered.discount
  });
  // ... обновить корзину пользователя
}

// Если пользователь нажал "продолжить с базовым"
function handleUpsellSkip() {
  window.dcTrack({ step: 'upsell_window_1', outcome: 'next' });
}

// Если нажал крестик
function handleUpsellClose() {
  window.dcTrack({
    step: 'upsell_window_1',
    outcome: 'dropped',
    drop_reason: 'close_btn'
  });
}
```

⚠ **Чек-лист для исправления бага B:**
- [ ] Кнопка "Взять" варианта B вызывает `handleUpsellAccept()`?
- [ ] Или у неё свой `onClick` который НЕ зовёт track?
- [ ] Проверить в DevTools → Sources, найти все handler'ы
- [ ] Console-лог `window.dcGetVariant()` и `window.dcTrack(...)` чтобы проверить ручкой

#### Шаг 5: Payment страница

```javascript
window.dcMarkStepArrival('payment');

function handlePaymentNext() {
  window.dcTrack({ step: 'payment', outcome: 'next' });
  // ... редирект на gateway
}
```

#### Шаг 6: Success (после успешной оплаты)

```javascript
window.dcMarkStepArrival('success');

window.dcTrack({
  step: 'success',
  outcome: 'next',
  tariff_final: actualTariff,    // что в итоге купил
  amount_final: actualAmount,    // итоговая сумма
  qty_final: actualQty           // итоговое количество
});
```

#### Шаг 7: Failure (если оплата провалилась)

```javascript
window.dcMarkStepArrival('failure');

window.dcTrack({
  step: 'failure',
  outcome: 'next',
  meta: { error_code: errorCode, error_message: msg }
});
```

---

## 3. Расследование бага failure на control

На контроле `failure / payment = 22%`, на A и B = 5-6%. Это очень подозрительно. Возможные причины:

| Причина | Как проверить |
|---|---|
| Разный payment gateway | Сравнить config endpoint для control vs A/B |
| Sandbox/test ключ для control | Проверить `paymentGateway.apiKey` в env |
| Sticky session не работает — control видит другой flow | Console.log `getVariant()` и `paymentMethod` |
| Контроль использует старый legacy код | Grep по коду на `variant === 'control'` |

Прошу залогировать в `meta` каждой failure event:
```javascript
window.dcTrack({
  step: 'failure',
  outcome: 'next',
  meta: {
    gateway: 'liqpay',          // какой gateway
    gateway_response: errorObj, // что вернул
    payment_method: '...'       // карта / google pay / ...
  }
});
```

---

## 4. Debug helpers

В консоли браузера:

```javascript
// Узнать свой текущий вариант
window.dcGetVariant();
// → 'A'

// Узнать session_id
window.dcGetSessionId();
// → 'sess_abc123...'

// Сбросить вариант (для теста — пересчитается с новым session)
sessionStorage.removeItem('__dc_variant_upsell_window_1');
document.cookie = '__dc_sess=; path=/; max-age=0';
location.reload();
```

В Supabase SQL editor (либо я могу проверить):

```sql
-- Последние 10 events
SELECT ts, variant, step, outcome, drop_reason, amount_final
FROM public.checkout_events
ORDER BY ts DESC
LIMIT 10;

-- Все ли варианты стреляют 'took' на upsell?
SELECT variant, count(*) AS took_count
FROM public.checkout_events
WHERE step = 'upsell_window_1' AND outcome = 'took'
GROUP BY variant;
-- Должно быть 3 строки: control (0 — нормально), A (>0), B (>0)
-- Если B = 0 — баг не исправлен
```

---

## 5. Контрольный list перед деплоем

- [ ] Tracker library подключён в `<head>` checkout страницы
- [ ] `dcGetVariant()` в консоли возвращает один из `control / A / B`
- [ ] Variant **sticky** — после F5 тот же
- [ ] `dcMarkStepArrival` зовётся на каждом из 7 кроках
- [ ] `dcTrack({outcome: 'next'})` зовётся при переходе далее
- [ ] `dcTrack({outcome: 'took'})` зовётся при принятии upsell — **для ОБОИХ вариантов A и B**
- [ ] `dcTrack({outcome: 'dropped', drop_reason: 'close_btn'})` при клике на крестик
- [ ] На success event передаётся `amount_final`, `tariff_final`, `qty_final`
- [ ] В DB появляются записи (проверить SQL запросом выше)
- [ ] Дашборд https://dashboard.dreamcar.ua/upsell-ab/ показывает свежие цифры

---

## 6. Что Вадиму делать после твоего деплоя

1. Открыть дашборд → должны появиться **свежие данные** (а не demo)
2. Проверить что **аномалии исчезли** (баг B и failure 22%)
3. Дождаться **~500 сессий на гилку** для 95% значимости
4. Если расходится с твоей интуицией — звонок 15 минут разобраться

---

## 7. Если что-то не работает

**Симптом:** `window.dcTrack is not a function`
→ Script не загрузился. Проверь Network tab, должен быть статус 200 на `checkout-tracker.js`

**Симптом:** События не появляются в БД
→ Открой DevTools → Network → POST на `track-checkout`. Должен быть статус 200. Если 401 — проверь `apiKey` в config

**Симптом:** Variant меняется при F5
→ Cookie `__dc_sess` не записывается. Проверь что домен `dreamcar.ua` (без `localhost`), SameSite=Lax, Secure (только HTTPS)

**Симптом:** Дашборд показывает 0 везде
→ Materialized view ещё не обновился. Подожди 5 минут или вручную: `REFRESH MATERIALIZED VIEW public.mv_upsell_funnel`

---

**Вопросы?** → Vadym (CEO) или через TG бота @dreamcar_team_bot.

**Полная техническая спецификация:** [upsell-ab-dashboard-spec-ru.md](./upsell-ab-dashboard-spec-ru.md)
