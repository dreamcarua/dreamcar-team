# Передача success/failure event через server-side webhook

**Кому:** Артём (бэкенд)
**Зачем:** на success-page нельзя полагаться — юзер может закрыть вкладку до её загрузки. Сейчас в БД 0 событий `success` хотя реальные оплаты есть. Без них дашборд показывает RPS=0 ₴ и lift=0%.

---

## Принцип: фронт пишет session_id в заказ, бэк шлёт event при webhook

```
1. Юзер на чекауте
   ├─ tracker создаёт cookie __dc_sess = 'sess_<uuid>'
   └─ window.dcGetSessionId() возвращает его

2. Юзер жмёт «Оплатить»
   ├─ Фронт собирает order
   ├─ Фронт читает window.dcGetSessionId() и window.dcGetVariant()
   └─ POST /api/create-order { ..., session_id, ab_variant }

3. Бэк сохраняет order
   └─ orders table: order_id, amount, tariff, qty, session_id, ab_variant, ...

4. Юзер закрывает вкладку — НЕ ВАЖНО

5. Платёжка (LiqPay/etc) присылает webhook на /api/payment-webhook
   ├─ Бэк находит order по order_id из webhook
   ├─ Бэк достаёт session_id и ab_variant из order
   └─ Бэк шлёт POST на наш edge fn track-checkout
      → step='success', amount_final=<реальная сумма>, session_id, variant
```

Теперь даже если фронт ничего не отправил — `success` event приходит **на 100% надёжно** с реальной суммой.

---

## Что нужно сделать (5 пунктов)

### 1. Frontend: передать session_id и variant в order

При создании заказа добавь в body:

```javascript
const orderPayload = {
  // ... всё что уже шлёшь
  session_id: window.dcGetSessionId(),      // 'sess_<uuid>'
  ab_experiment_id: 'upsell_window_1',
  ab_variant: window.dcGetVariant(),         // 'control' | 'A' | 'B'
  amount: actualAmount,
  tariff: 'gold',
  qty: 1
};
fetch('/api/create-order', { method: 'POST', body: JSON.stringify(orderPayload), ... });
```

### 2. Backend: сохранить в orders table

Добавь колонки если их нет:

```sql
alter table orders
  add column if not exists session_id text,
  add column if not exists ab_experiment_id text,
  add column if not exists ab_variant text;
```

И сохраняй вместе с остальными полями заказа.

### 3. Backend: webhook handler шлёт event

Когда платёжка присылает webhook (payment success / failure):

```php
// api/payment-webhook.php (примерный шаблон)
<?php
// 1. Найти order по order_id из webhook
$order = $db->query("SELECT * FROM orders WHERE order_id = ?", $orderId);
if (!$order || !$order['session_id']) return;  // нет привязки — выходим

// 2. Определить status
$paymentStatus = $webhook['status'];  // 'approved' | 'failed' | etc
$step = ($paymentStatus === 'approved') ? 'success' : 'failure';

// 3. Собрать event
$event = [
  'event_id' => 'server_' . $orderId . '_' . $step,
  'session_id' => $order['session_id'],
  'ts' => date('c'),
  'experiment_id' => $order['ab_experiment_id'] ?: 'upsell_window_1',
  'variant' => $order['ab_variant'],
  'step' => $step,
  'step_index' => 7,
  'outcome' => 'next',
  'tariff_final' => $order['tariff'],
  'amount_final' => floatval($order['amount']),
  'qty_final' => intval($order['qty']),
  'utm_source' => $order['utm_source'],
  'utm_medium' => $order['utm_medium'],
  'utm_campaign' => $order['utm_campaign'],
  'meta' => [
    'order_id' => $orderId,
    'gateway' => $webhook['gateway'],
    'payment_method' => $webhook['payment_method'] ?: null,
    'error_code' => $webhook['error_code'] ?: null
  ]
];

// 4. Отправить на edge fn
$ch = curl_init('https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/track-checkout');
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_TIMEOUT => 5,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvdGdobGFlaG52eHllYWN6bnZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDc4NjgsImV4cCI6MjA5NDE4Mzg2OH0.Se-y1WawsdSkMLXj7G_O-Kq-jVfjUOBD3KJOvemCR3A',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvdGdobGFlaG52eHllYWN6bnZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDc4NjgsImV4cCI6MjA5NDE4Mzg2OH0.Se-y1WawsdSkMLXj7G_O-Kq-jVfjUOBD3KJOvemCR3A'
  ],
  CURLOPT_POSTFIELDS => json_encode(['events' => [$event]])
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// 5. Логируем результат (для отладки)
if ($httpCode !== 200) error_log("[upsell-track] failed: $httpCode $response");
```

### 4. Node.js версия (если бэк на Node)

```javascript
async function sendUpsellEvent(order, paymentStatus, webhook) {
  if (!order.session_id) return;
  const step = paymentStatus === 'approved' ? 'success' : 'failure';
  const event = {
    event_id: `server_${order.id}_${step}`,
    session_id: order.session_id,
    ts: new Date().toISOString(),
    experiment_id: order.ab_experiment_id || 'upsell_window_1',
    variant: order.ab_variant,
    step,
    step_index: 7,
    outcome: 'next',
    tariff_final: order.tariff,
    amount_final: parseFloat(order.amount),
    qty_final: parseInt(order.qty),
    utm_source: order.utm_source,
    utm_medium: order.utm_medium,
    utm_campaign: order.utm_campaign,
    meta: {
      order_id: order.id,
      gateway: webhook.gateway,
      payment_method: webhook.payment_method,
      error_code: webhook.error_code
    }
  };
  try {
    const r = await fetch('https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/track-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ events: [event] }),
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) console.error('[upsell-track] failed:', r.status, await r.text());
  } catch (e) {
    console.error('[upsell-track] exception:', e.message);
  }
}
```

### 5. Idempotency — почему `event_id = 'server_<order_id>_<step>'`

Webhook от платёжки может прийти **дважды** (retry при сетевой ошибке). Чтобы не дублировать события:

- `event_id` уникален в БД (unique constraint)
- Используем детерминированный формат `server_<order_id>_<step>`
- При повторном webhook → INSERT с тем же `event_id` → DB rejects дубль через `on conflict ignore`
- Никаких дубликатов выручки в дашборде ✅

---

## Что НЕ меняется на фронте

- Все остальные шаги (`phone`, `data_confirm`, `upsell_window_1`, `payment`) остаются как есть — фронт продолжает их отправлять
- `dcMarkStepArrival` + `dcTrack` для них работают как раньше
- Только `success` и `failure` теперь идут с сервера

---

## Проверка что всё работает

После деплоя webhook:

1. Сделай тестовую оплату через тестовую карту платёжки
2. После того как платёжка прислала webhook → проверь в Supabase:

```sql
select event_id, step, outcome, amount_final, tariff_final, ts
from public.checkout_events
where event_id like 'server_%'
order by ts desc
limit 5;
```

Должна появиться строка с `step='success'` и реальной суммой.

3. Дашборд https://dashboard.dreamcar.ua/upsell-ab/ должен в течение 5 минут показать ненулевой RPS.

---

## TL;DR схема

```
Фронт:
  Order create → передаёт session_id + ab_variant
  Tracker: phone/data_confirm/upsell/payment (НЕ success/failure)

Бэк:
  orders table — хранит session_id, ab_variant
  Webhook от gateway → POST на supabase edge fn → step='success'|'failure'

Идемпотентность:
  event_id = 'server_<order_id>_<step>' → дубли откидываются автоматически
```

После этого данные будут точными даже если юзер закрыл вкладку.
