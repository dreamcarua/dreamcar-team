# Відповідь Артьому — outbox pattern + питання по tracker

(можна копіпастити одним повідомленням у TG)

---

Так, робимо. Все що пропонуєш — правильно. По пунктах:

## 1. Адаптації під вашу базу — окей

`dc_payments` замість `orders`, `order_reference` як ідентифікатор, `plan_code` замість `tariff`, реальна сума з платежу — без проблем. Дашборд та edge fn все приймуть, мапінг полів на твоєму боці.

## 2. Outbox + retry — золото, повністю підтримую

5-секундний curl всередині вебхука платіжки — справді ризик. Outbox pattern це правильний production підхід. Жодна подія не загубиться навіть якщо Supabase моргне.

Ідемпотентність `event_id = 'server_' + order_reference + '_' + step` працює як треба — наш edge fn робить `upsert` з `ignoreDuplicates: true`, повторна відправка тієї ж події ігнорується автоматично. Тобто крон може спокійно ретраїти скільки треба.

Пропоную таку схему outbox:

```sql
CREATE TABLE dc_upsell_event_outbox (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT UNIQUE NOT NULL,  -- 'server_<order_ref>_<step>'
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  next_retry_at   TIMESTAMPTZ
);
CREATE INDEX ON dc_upsell_event_outbox (status, next_retry_at) WHERE status = 'pending';
```

Логіка вебхука платіжки:
1. INSERT у outbox зі status=pending
2. Спроба негайної відправки (timeout 2с щоб не блокувати webhook)
3. Якщо ОК → UPDATE status=sent, sent_at=now()
4. Якщо помилка/timeout → UPDATE attempts++, last_error, next_retry_at = now() + exponential backoff (10с, 1хв, 5хв, 30хв, 2год)

Cron кожну хвилину:
```sql
SELECT * FROM dc_upsell_event_outbox
WHERE status = 'pending' AND next_retry_at <= NOW()
ORDER BY created_at LIMIT 50;
```
— ретраїть, той самий event_id, той самий handler. Після 10 спроб → status=failed і алерт.

Можеш вибрати backoff на свій смак, головне щоб був.

## 3. Endpoint + ключ для відправки

```
URL:  https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/track-checkout
METHOD: POST
HEADERS:
  Content-Type: application/json
  apikey: <SUPABASE_ANON_KEY>
  Authorization: Bearer <SUPABASE_ANON_KEY>
BODY:
  { "events": [<payload>] }
```

Anon key уже у DEV-BRIEF. Edge fn робить INSERT із `onConflict: 'event_id', ignoreDuplicates: true` — твої повтори безпечні.

## 4. Tracker на checkout — статус

Так, він уже стоїть. Я перевіряв `iphone.dreamcar.ua` — tracker завантажений, я бачив у window:
- `window.dcTrack`, `dcMarkStepArrival`, `dcGetSessionId`, `dcGetVariant`
- script src: `https://team.dreamcar.ua/checkout-tracker/checkout-tracker.js`
- cookie `__dc_sess` створюється сам при першій загрузці

Якщо на якомусь іншому лендингу його ще нема — підключи 3 рядки в `<head>`:

```html
<script>
  window.dcTrackerConfig = {
    experimentId: 'upsell_window_1',
    apiKey: '<SUPABASE_ANON_KEY>'  // той самий що у webhook
  };
</script>
<script src="https://team.dreamcar.ua/checkout-tracker/checkout-tracker.js" defer></script>
```

Все. Після цього на сторінці чекауту:
- `window.dcGetSessionId()` → `'sess_<uuid>'` (cookie 30 днів, sticky)
- `window.dcGetVariant()` → варіант (поки auto-hash fallback, бо ваша сторона ще не викликає `dcSetVariant`)

## 5. Питання утм-трекера

У вас є свій `utm-tracker.js` — він зберігає `dc_visitor_id` у cookie. Мій трекер тримає окремий `__dc_sess` cookie. Це **різні id**:
- `dc_visitor_id` — це довгоживий visitor id (для CRM)
- `__dc_sess` — це session id для A/B (теж sticky 30д, але інша роль)

Можна жити з двома, можна об'єднати. Якщо хочеш об'єднати — є два шляхи:
- **Простіше:** на стороні фронта при init викликаєш `window.dcSetSessionId(window.utmTracker.getVisitorId())` — додам такий метод у tracker
- **Або:** на твоєму вебхуку відправляєш `session_id = dc_visitor_id` замість того що передав фронт у `payment-init`. Скажу що писати у БД.

Скажи що краще, додам метод. Зараз не критично, але корисно щоб не плодити id.

## 6. Що передавати з фронту у payment-init

```javascript
const initPayload = {
  // ... ваші поля
  session_id: window.dcGetSessionId(),     // 'sess_<uuid>'
  ab_experiment_id: 'upsell_window_1',
  ab_variant: window.dcGetVariant(),        // 'control' | 'A' | 'B'
};
```

Це 3 рядки у тому місці де зараз створюєте платіж.

## 7. Перевірка end-to-end після твоєї роботи

Я можу руками з консолі смикнути edge fn і подивитися, чи подія у Supabase. Після першої тестової оплати глянемо вдвох:

```sql
SELECT event_id, step, outcome, amount_final, tariff_final, ts
FROM public.checkout_events
WHERE event_id LIKE 'server_%'
ORDER BY ts DESC LIMIT 5;
```

Має з'явитися рядок з `step='success'` і реальною сумою.

---

Сідай робити, я на зв'язку. Якщо щось у edge fn payload треба змінити — скажи, додам/перейменую поле без проблем.
