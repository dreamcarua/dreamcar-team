# Як привʼязати Telegram до HQ — інструкція для команди

**Версія:** 05.06.2026 (виправлено критичний баг із deep-link).

## Навіщо це треба

Без привʼязки TG ти **НЕ отримаєш**:
- Сповіщення про задачі (асайн, дедлайн, @mentions)
- Запити на погодження публікацій
- DM від AI-асистента
- Daily digest 9:00

## ✅ Простий шлях (для тих хто ще не привʼязаний)

### Крок 1 — зайди у HQ

1. Відкрий https://team.dreamcar.ua/hq/
2. Залогінься через **Google** (своїм робочим email)
3. **Cmd+Shift+R** (важливо — оновити кеш, бо банер виправлено)

### Крок 2 — натисни банер привʼязки

Зверху на сторінці буде червоний банер:

> 🔗 **Telegram не привʼязано.** Ти не отримуєш сповіщень…  
> [Прив'язати]

Натисни **«Прив'язати»** — відкриється Telegram з ботом **@dreamcar_team_bot**.

### Крок 3 — натисни Start у Telegram

У боті є кнопка **START** знизу. Тиснеш — бот відразу скаже:

> ✅ **Привʼязано!**  
> Акаунт: <твоє ім'я>  
> Команди: /me /today /queue /approve /late /my

**Все. Готово.**

---

## ⚠ Якщо НЕ працює

### Симптом 1: «бот показав chat_id але далі не йде / і не привʼязує»

Це значить що ти писав `/start` руками **без deep-link**. Бот без payload не знає кого привʼязувати.

**Що робити:**
1. Зайди у HQ → Cmd+Shift+R
2. Зайди у **Налаштування** (іконка ⚙ або #settings)
3. Знайди блок «Швидка прив'язка через бот» → натисни **Прив'язати через @dreamcar_team_bot**
4. У Telegram натисни **START** (не пиши `/start` руками!)

### Симптом 2: «логінюсь, кидає на календар і знову сторінка логіну» (Tasks)

Це Tasks login loop. Кроки:

1. Вийди з усіх вкладок HQ і Tasks
2. Очисти cookies для `team.dreamcar.ua` (Chrome → Settings → Privacy → Cookies for specific site)
3. Зайди заново у **HQ через Google** — спочатку HQ
4. Після того як зайшов у HQ → відкрий https://team.dreamcar.ua/tasks/ у **тій же вкладці** (не у новій!)
5. SSO автоматично перенесе session з HQ у Tasks

Якщо знов loop — напиши Вадиму свої:
- Email яким логінишся
- Скрін Console (F12 → Console tab)

---

## 🔄 Для адмінів (CEO / COO)

Якщо хтось з команди застряг — можеш привʼязати їх **руками через бота**:

1. Юзер відкриває **@dreamcar_team_bot** у Telegram
2. Натискає START — бот покаже:
   ```
   🆔 chat_id: 123456789
   📛 @username
   ```
3. Юзер шле тобі **скрін** з цим chat_id
4. Ти у Supabase SQL Editor виконуєш:

   ```sql
   UPDATE public.users
   SET tg_chat_id = <chat_id>,
       tg_username = '<username>'  -- без @
   WHERE email = '<його email>';
   ```

Все, привʼязано.

---

## 📞 Якщо нічого не допомогло

Напиши Вадиму у DM скрін бота + скрін HQ-банера. Я подивлюся логи Supabase і знайду причину.

---

## Технічні деталі (для розробників)

### Що було за баг (05.06.2026)

`app-tg-bind-banner.js` генерував deep-link БЕЗ префіксу `hq_`:
```
❌ https://t.me/dreamcar_team_bot?start=aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaaa
```

А `handleStart()` у tg-webhook чекає regex `^hq_(uuid)$`:
```
✅ https://t.me/dreamcar_team_bot?start=hq_aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaaa
```

**Fix:** commit `e06bd67` — додав префікс `hq_` у banner.

### Як працює bind flow тепер

```
Юзер у HQ → клік "Прив'язати"
    ↓
Browser → https://t.me/dreamcar_team_bot?start=hq_<users.id>
    ↓
Telegram → @dreamcar_team_bot з payload "hq_<uuid>"
    ↓
Юзер тисне START → TG шле tg-webhook { message.text: "/start hq_<uuid>" }
    ↓
handleStart() парсить hq_<uuid>:
    1. SELECT user by id = uuid
    2. UPDATE users SET tg_chat_id = msg.chat.id, tg_username = msg.from.username
    3. tgSend("✅ Привʼязано!")
```
