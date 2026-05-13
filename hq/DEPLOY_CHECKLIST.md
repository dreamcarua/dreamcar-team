# Deploy Checklist — що треба зробити в Supabase

Коротко: усі файли і код вже в репозиторії та на live сайті. Тут — що ще треба натиснути руками в Supabase Dashboard, щоб бекенд запрацював на 100%.

Кожен крок — окремий чекбокс. Можна йти зверху вниз.

---

## 1. Виконати SQL-міграції

Відкрий **Supabase Dashboard → SQL Editor → New query**. По черзі копіюй вміст файлів і тисни Run:

- [ ] `hq/db/schema.sql` — створює таблиці
- [ ] `hq/db/rls.sql` — Row-Level Security
- [ ] `hq/db/seed.sql` — демо-дані (опційно; для prod пропусти)
- [ ] `hq/db/triggers.sql` — **критично** — auto-створення public.users + backfill
- [ ] `hq/db/migrations/002_tg_notifications.sql` — додає tg_chat_id для нотифікацій

Після `triggers.sql`:
```sql
-- Перевірка: твій акаунт у public.users?
select email, role, active from public.users where email = 'vg@abrisart.com';
-- Має бути: vg@abrisart.com | ceo | t

-- Якщо dreamcarua@gmail.com ще не логінився — він з'явиться при першому логіні автоматично з role=ceo.
```

---

## 2. Створити Storage bucket «creatives»

- [ ] Supabase Dashboard → **Storage** → **New bucket**
- [ ] Name: `creatives`
- [ ] Public bucket: ✓ так
- [ ] File size limit: 50 MB (можна збільшити пізніше)

Без цього креативи (фото/відео) з drag-drop не завантажуватимуться.

---

## 3. Налаштувати Google OAuth Site URL

- [ ] Supabase Dashboard → **Authentication → URL Configuration**
- [ ] Site URL: `https://dreamcarua.github.io/dreamcar-team/hq/`
- [ ] Redirect URLs (Add URL): `https://dreamcarua.github.io/**`

Без цього після Google-логіну виникає редірект на `localhost:3000`.

---

## 4. Edge Function `notify-tg` — деплой

Потрібен Supabase CLI на локальному компі.

```bash
# Встановити CLI (один раз)
npm install -g supabase

# З репо
cd dreamcar-team
supabase login                          # → відкриє браузер для авторизації
supabase link --project-ref wotghlaehnvxyeacznvv

# Деплой функції
supabase functions deploy notify-tg --no-verify-jwt --project-ref wotghlaehnvxyeacznvv
```

---

## 5. Secrets для Edge Function

- [ ] Dashboard → **Project Settings → Edge Functions → Manage secrets**
- [ ] Додай:
  - `TG_BOT_TOKEN` = `<токен бота @YourBot>` (взяти у @BotFather)
  - `TG_GROUP_CHAT_ID` = `-5205303628` (з пам'яті — group chat команди)
  - `HQ_WEBHOOK_SECRET` = `<згенеруй випадковий рядок>`. Наприклад: `openssl rand -hex 32` у терміналі. Збережи цей рядок — знадобиться у кроці 6.

`SUPABASE_URL` та `SUPABASE_SERVICE_ROLE_KEY` встановлюються Supabase автоматично — нічого додавати не треба.

---

## 6. Database Webhooks

- [ ] Dashboard → **Database → Webhooks** → **Create a new hook**

**Webhook #1: publication-status-changed**

| Поле | Значення |
|---|---|
| Name | `publication-status-changed` |
| Table | `publications` |
| Events | ✓ INSERT, ✓ UPDATE |
| Type | Supabase Edge Functions |
| Edge Function | `notify-tg` |
| Method | POST |
| HTTP Headers | `x-hq-secret: <те ж значення, що в HQ_WEBHOOK_SECRET>` |

**Webhook #2: comment-added**

| Поле | Значення |
|---|---|
| Name | `comment-added` |
| Table | `comments` |
| Events | ✓ INSERT |
| Type | Supabase Edge Functions |
| Edge Function | `notify-tg` |
| Method | POST |
| HTTP Headers | `x-hq-secret: <те ж значення>` |

---

## 7. Smoke test

1. [ ] Відкрий `https://dreamcarua.github.io/dreamcar-team/hq/`
2. [ ] Залогінься через Google під `vg@abrisart.com`
3. [ ] Створи нову публікацію (Cmd+N або `+ Нова публікація`)
4. [ ] Заповни мінімум: назва, дата, майданчик, рубрика, текст
5. [ ] Натисни «На погодження»
6. [ ] У TG-групі команди має з'явитися:
   ```
   📝 На погодження
   «...»
   ...
   🔗 Відкрити в HQ
   ```
7. [ ] Натисни «Погодити» — у групу прилетить підтвердження.

---

## Опційно

### Прив'язка персональних TG для DM

Поки немає TG Login Widget — DM прив'язуються вручну:

```sql
update public.users
set tg_chat_id = <твій chat_id>
where email = 'твій-email';
```

Як знайти свій `chat_id`: напиши боту `/start`, потім відкрий:
`https://api.telegram.org/bot<TOKEN>/getUpdates`
у `result[0].message.chat.id` буде твій номер.

### Доступ для dreamcarua@gmail.com

`triggers.sql` уже видає CEO роль автоматично коли цей email логіниться вперше. Нічого додатково не треба.

Якщо акаунт уже логінився ДО того, як ти виконав `triggers.sql`, backfill-блок з кінця файлу проставить йому правильну роль.

---

## Що тоді live зараз?

Все що нижче — **вже на проді** (`https://dreamcarua.github.io/dreamcar-team/hq/`):

- Календар (Місяць/Тиждень/День/Список) з drag-drop
- Дошка погоджень
- Бібліотека креативів з реальними thumbnails
- Картка публікації: усі поля, workflow, auto-save, прев'ю IG/TG
- Drag-drop креативів у картку + Supabase Storage
- Гібридний Store: Supabase + localStorage fallback
- Realtime sync через Supabase channels
- Google OAuth + Auth gate
- Spinner на workflow-кнопках + lock проти подвійних натискань
- Урядові ribbon-фільтри платформ
- handle_new_user trigger (auto-create users + CEO для VG/dreamcarua)

Що **в файлах, але ще не задеплоєно**:

- Edge Function `notify-tg` (кроки 4–6 вище)
- Колонки `tg_chat_id`, `tg_username` у `users` (крок 1.5 — `migrations/002_tg_notifications.sql`)
