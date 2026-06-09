# 🚀 TG Autopost v2 — Що нового (10.06.2026)

## Як публікувати у TG канал

### 1. Просто розклад
1. Створи публікацію у SMM (`/hq/`)
2. Постав `Telegram` у платформи
3. Виставь `Дата+час публікації` (по Києву)
4. Заповни text/title/креативи
5. Пройди approval flow → status `approved` → `published`

**При переході на `published`** — DB trigger `AFTER UPDATE OF status` миттєво викликає `tg-post-send` (без cron lag 5 хв як раніше).

### 2. Inline кнопки під постом
У SMM modal з'явилася синя секція **"✈️ Telegram автопост — налаштування"** (тільки коли `tg` у platforms).

**Типи кнопок:**
- **🔗 URL** — звичайне посилання (з автоматичним UTM)
- **📱 Web App** — відкриває mini-app inline (URL формату `https://t.me/<bot>/<app>`)
- **👆 Callback** — tracking event у `tg_button_clicks` (для analytics)

**Row** — кнопки з однаковим row у одній лінії. Max 2-3 у row для mobile.

### 3. Опції
- **📌 Pin** — закріпити після публікації
- **🔕 Silent** — без notification для підписників
- **🚫 Disable preview** — без розкритого preview лінків

### 4. Soft Urgency (Countdown)

**Як працює:**
1. У тексті постав `{{countdown}}` як placeholder
2. У SMM modal виставь дату `⏰ tg_countdown_until`
3. Бот публікує з реальним залишком ("23г 47хв")
4. Cron `tg-countdown-updater` кожні 5 хв робить `editMessageText`/`editMessageCaption` — оновлює залишок

**Приклад:**
```
🔥 Знижка X2 на пакет BOOST!
Залишилось {{countdown}} до завершення.
```
→ У каналі: "Залишилось 8г 32хв до завершення." → через 5 хв: "8г 27хв" → ...

### 5. Curiosity Gap (Spoiler)

Обгорни секрет у `<<<...>>>` → у TG буде сірою плашкою.

**Приклад:**
```
🎯 Сьогодні розкриваємо приз для проєкту #18:
<<<Можливо це твій новий KTM Duke 390 🏍️>>>
```

→ User бачить сірий блок, клікає щоб побачити.

### 6. Тест у тестовий канал
Кнопка **"🧪 Тест у тестовий канал"** — відправляє пост у `-1003933841573` (DreamCar SMM test) перед production.

Дозволено тільки CEO/COO/Lead через JWT.

## Що НЕ зробив (Phase 4 roadmap)

- **MTProto worker (Telethon)** для real views/reactions/forwards — TG Bot API не дає цю інфу
- **Engagement bot setWebhook** — треба прив'язати `tg-channel-engage` як webhook у каналі (зробить Vadym через bot owner)
- **Forward bonus mechanism** — окремий roadmap пункт (виплачуємо токени за shares)
- **A/B headlines** — 2 версії пост у 2 канали + порівняння CTR

## Архітектура (для розробників)

### Tables
- `publications.tg_*` (10 колонок) — конфігурація поста
- `tg_post_analytics` — stats per published post
- `tg_engagement_replies` — AI reply log (з UNIQUE channel_id+orig_msg_id для dedup)
- `tg_button_clicks` — callback events

### Trigger
`trg_publications_tg_instant_fire` — `AFTER UPDATE OF status ON publications` → `pg_net.http_post` до `tg-post-send`.

### Edge Functions
| Fn | Trigger | Purpose |
|---|---|---|
| `tg-post-send` v2 | DB trigger + manual test | Send/test publication з buttons/pin/silent/album |
| `tg-channel-engage` v2 | TG webhook | AI Claude Haiku auto-reply на коментарі |
| `tg-post-stats-sync` v2 | Cron 30 хв | Sync comments+clicks (views потребує MTProto) |
| `tg-countdown-updater` v2 | Cron 5 хв | editMessageText для {{countdown}} placeholders |

### Cron
- `tg-post-stats-sync-30min` — `*/30 * * * *`
- `tg-countdown-updater-5min` — `*/5 * * * *`

### Brand voice HARD RULE
Edge fn `tg-channel-engage` має `FORBIDDEN_WORDS` regex: `лотерея/розіграш/квиток/шанс`. Якщо Claude генерує — блокуємо (category=`forbidden_words_blocked`, юридичний ризик).

---

## Best practices для max engagement (з research)

### Soft Urgency
- countdown у тексті → CTR +15-30%
- "Останній день" з deadline + бот updates у real-time
- Avoid false urgency — реальний deadline тільки

### Curiosity gap
- Spoiler для price reveals / next-prize hints
- Open rate +60% при добре сформованому intro

### CTAs
- Тестуй варіанти: "ВЗЯТИ УЧАСТЬ" / "Я В ГРІ" / "ХОЧУ KTM!"
- Web App > URL (відкривається inline без leaving TG)
- Кнопок 1-2 у row для mobile

### Frequency
- Max 3 пости/день (TG algorithm penalty)
- Уникай 02:00-08:00 (dead zone — AI analyst буде попереджати)
- Variety: chered chart photo/video/longform/poll
