# 🔌 setWebhook — інструкція для Vadym (#244)

> Без цього `tg-channel-engage` Edge function існує, але **НЕ отримує events** про коментарі у каналі.
> Після setup AI бот почне auto-reply на коментарі під автопостами.

## Що потрібно зробити (5 кроків, ~10 хв)

### Крок 1: Згенерувати TG_WEBHOOK_SECRET

```bash
openssl rand -hex 32
# Скопіюй вивід — наприклад: a1b2c3d4e5f6...
```

Це випадковий 64-символьний рядок. Використовується для перевірки що webhook calls приходять реально від TG (а не зловмисника).

### Крок 2: Додати у Supabase Edge Functions Secrets

1. Зайди: https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/settings/functions
2. Секція **Secrets** → **Add new secret**:
   - Name: `TG_WEBHOOK_SECRET`
   - Value: `<вставити секрет з кроку 1>`
3. Save

Edge fn автоматично підтягне на наступному виклику.

### Крок 3: Бот має бути admin у Discussion Group каналу

**Discussion Group** — це окрема група для коментарів під постами каналу.

1. Зайди у production канал DreamCar SMM (`-1002496656144`) → Manage Channel → Discussion → переконайся що Discussion Group зв'язана. Якщо нема — створи (Group → Convert to Supergroup → Link to channel).
2. Додай `@dreamcar_team_bot` у Discussion Group → Promote to admin → права: Read Messages + Send Messages.
3. **Те ж саме** для test каналу `-1003933841573` (для тестів).

### Крок 4: Виконати setWebhook

```bash
# Замінити <TG_BOT_TOKEN> на реальний токен (з @BotFather)
# Замінити <WEBHOOK_SECRET> на той що генерував у кроці 1
# Опціонально замінити <ALLOWED_UPDATES> щоб слухати тільки потрібні events

TG_BOT_TOKEN="<токен з @BotFather>"
WEBHOOK_SECRET="<секрет з кроку 1>"
WEBHOOK_URL="https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-channel-engage"

curl "https://api.telegram.org/bot${TG_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\", \"channel_post\", \"edited_channel_post\"],
    \"drop_pending_updates\": true
  }"
```

Очікувана відповідь:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

> ⚠ Бот має тільки один webhook URL глобально. Якщо у тебе вже є інший webhook (наприклад, для tg-task-extract або tg-webhook) — `setWebhook` його **перепише**. У такому разі треба об'єднати logic у один endpoint або вибирати один бот для autopost engagement (можна окремий @dreamcar_engage_bot).

### Крок 5: Перевірити getWebhookInfo

```bash
curl "https://api.telegram.org/bot${TG_BOT_TOKEN}/getWebhookInfo"
```

Очікувана відповідь повинна містити:
- `"url": "https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-channel-engage"`
- `"has_custom_certificate": false`
- `"pending_update_count": 0`
- `"allowed_updates": ["message", "channel_post", "edited_channel_post"]`

Якщо `last_error_date` чи `last_error_message` — щось не так, Supabase повертає 5xx або 401.

## Як перевірити що працює

1. Зайди у production канал DreamCar SMM
2. Відкрий пост (будь-який, з включеною Discussion)
3. Натисни **💬 коментарі** → відкриється Discussion Group
4. Напиши тестовий коментар: `"як купити токен?"`
5. **Очікуваний результат:** через 2-5 секунд bot відповідає reply на твій коментар: *"Тицяй бота @dreamcar_team_bot — він допоможе"*

Якщо AI не відповідає:
- Перевір логи у Supabase Edge Functions → `tg-channel-engage` → Logs
- Якщо бачиш 401 → secret не співпадає
- Якщо бачиш 500 → ANTHROPIC_API_KEY не виставлений
- Якщо взагалі немає logs → webhook не доходить до Supabase (перевір getWebhookInfo)

## Безпека

- `TG_WEBHOOK_SECRET` ніколи не комітити у git
- Тільки Supabase Dashboard Settings бачить його
- Якщо подозра що skompromise — згенеруй новий secret, оновлю Supabase, повтори `setWebhook`

## Що далі (Phase 4)

Після того як engagement bot буде live кілька днів — можна додати:
- **FAQ knowledge base** — окрема edge fn з documents щоб AI міг точніше відповідати на specific питання
- **Sentiment tracking** — у `tg_engagement_replies` додати `ai_sentiment` ('positive'/'neutral'/'negative') → dashboard tracking
- **Auto-DM follow-up** — якщо comment = `"скільки коштує"` → AI відповідає у канал + DM user-у з конкретним посиланням на оплату

## Trouble-shooting

| Симптом | Причина | Рішення |
|---|---|---|
| `webhook_set: false` | URL invalid або HTTPS cert проблема | Supabase URL завжди валідний — перевір копіювання |
| `ok: false, error_code: 401` | Secret mismatch | Згенеруй новий, додай у Supabase Secrets, repeat setWebhook |
| Logs показують `unauthorized` | Header X-Telegram-Bot-Api-Secret-Token не співпадає | Те ж саме що ↑ |
| Бот не бачить commentів | Bot не admin у Discussion Group | Додай як admin |
| Discussion Group немає | Канал не linked з групою | Channel settings → Discussion → Link |
