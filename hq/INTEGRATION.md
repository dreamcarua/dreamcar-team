# Підключення Supabase (для розробника)

Покрокова інструкція як перенести MVP з localStorage на повноцінний бекенд на базі Supabase.

**Очікуваний час:** ~6-8 годин для першого підключення (без полірування).

---

## 0. Створити Supabase проект

1. Зареєструватися на [supabase.com](https://supabase.com) (через GitHub).
2. Створити новий проект:
   - Name: `dreamcar-hq`
   - Region: `eu-central-1` (Frankfurt) або найближчий до Києва
   - Password: згенерувати і зберегти в 1Password.
3. Дочекатися провіжнінгу (~2 хвилини).
4. Скопіювати з **Project Settings → API**:
   - Project URL: `https://xxx.supabase.co`
   - `anon` public key
   - `service_role` secret key (тільки для серверних задач — ніколи не публікувати)

---

## 1. Виконати міграції

У послідовному порядку через **SQL Editor** у Supabase Dashboard:

```bash
# 1. Schema
db/schema.sql      → виконати → перевірити що 14 таблиць створено

# 2. RLS policies
db/rls.sql         → виконати → перевірити в Table Editor що
                                "Enabled" indicator поряд із кожною таблицею

# 3. Seed дані (опційно для dev/staging; на prod пропустити)
db/seed.sql        → виконати → перевірити що users/publications заповнені
```

**Перевірка:**
```sql
select count(*) from publications;  -- очікуємо 11
select count(*) from users;         -- очікуємо 5
select count(*) from creatives;     -- очікуємо 12
```

---

## 2. Налаштувати Google OAuth

1. **Google Cloud Console:**
   - Створити OAuth client (Web application)
   - Authorized redirect URIs:
     - `https://xxx.supabase.co/auth/v1/callback`
     - `http://localhost:3000/` (для локальної розробки, якщо буде)
   - Скопіювати Client ID + Client Secret

2. **Supabase Dashboard → Authentication → Providers → Google:**
   - Enable
   - Вставити Client ID + Secret
   - Save

3. **Site URL** в Authentication → URL Configuration:
   - `https://dreamcarua.github.io/dreamcar-team/hq/`
   - + redirect URLs якщо буде окремий домен `hq.dreamcar.ua`

4. **Тригер на створення user:** після успішного OAuth-входу в `auth.users` з'являється запис.
   Потрібен тригер що автоматично створює запис в нашій `public.users`:

   ```sql
   create or replace function handle_new_user() returns trigger as $$
   begin
     insert into public.users (auth_id, email, name, role)
     values (
       new.id,
       new.email,
       coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
       'member'  -- роль за замовчуванням
     );
     return new;
   end;
   $$ language plpgsql security definer;

   create trigger on_auth_user_created
     after insert on auth.users
     for each row execute function handle_new_user();
   ```

5. **Початковий setup:** першого CEO (Вадима) додати вручну:
   - Зайти через `vg@dreamcar.ua`
   - В Table Editor → users → знайти запис → змінити `role = 'ceo'`

---

## 3. Замінити Store layer в index.html

Зараз `Store` в `index.html` — це обгортка над `localStorage`. Треба замінити на Supabase client.

### 3.1. Підключити SDK через CDN

У `<head>` додати:

```html
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  window.supabase = createClient(
    'https://xxx.supabase.co',   // ← Project URL
    'eyJh...'                    // ← anon key
  );
</script>
```

### 3.2. Замінити localStorage-методи

**Стара версія (MVP):**
```js
const Store = {
  pubs() { return this._data.publications; },
  upsertPub(pub) { /* localStorage */ },
};
```

**Нова версія:**
```js
const Store = {
  async pubs() {
    const { data, error } = await supabase
      .from('publications')
      .select('*, publication_platforms(platform), creatives:creative_publications(creative:creatives(*))')
      .order('publish_at');
    if (error) throw error;
    return data.map(transformPub);
  },

  async upsertPub(pub) {
    const { error } = await supabase
      .from('publications')
      .upsert({ ...pub, updated_at: new Date() });
    if (error) throw error;
  },
};
```

**Усі функції стають `async`.** Тому всі виклики треба обернути в await:

```js
// Замість:
const pubs = filteredPubs();
renderMonth(d, pubs);

// Стає:
const pubs = await filteredPubs();
renderMonth(d, pubs);
```

---

## 4. Авторизація в UI

Замінити демо role-switcher на реальний логін.

```js
// При відкритті сторінки:
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  // показати екран логіну
  await supabase.auth.signInWithOAuth({ provider: 'google' });
  return;
}

// Завантажити поточного юзера:
const { data: me } = await supabase
  .from('users')
  .select('*')
  .eq('auth_id', session.user.id)
  .single();
```

Якщо `me.is_active = false` — показати «Очікування доступу».

---

## 5. Realtime для soft-lock і live-апдейтів

Підписатися на зміни publications і editing_sessions:

```js
supabase
  .channel('hq-publications')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'publications' },
    payload => { /* re-render calendar */ })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'editing_sessions' },
    payload => { /* update soft-lock indicator */ })
  .subscribe();
```

**Soft-lock логіка:**
- При відкритті картки: `upsert editing_sessions (publication_id, user_id, expires_at = now() + 2min)`.
- Кожні 30s ping: `update set last_ping = now(), expires_at = now() + 2min`.
- При закритті картки: `delete from editing_sessions where ...`.
- Якщо є інша активна сесія: показати жовтий банер «X редагує».

---

## 6. Google Drive Resumable Upload

1. **Google Cloud Console:** увімкнути Google Drive API.
2. Service Account з доступом до тематичної папки.
3. **Backend endpoint** (наприклад, Vercel Edge Function `api/drive/init-upload`):
   - Приймає `{ filename, mime, size }`.
   - Створює resumable upload session через Drive API.
   - Повертає upload URL.
4. **Клієнт** ріже файл на чанки і завантажує напряму в Drive за upload URL.
5. Після завершення — endpoint `api/drive/finalize-upload` створює запис у `creatives` з `drive_file_id`.
6. **Превью генеруються** через ffmpeg на сервері (для відео — перший кадр) або через Drive thumbnail API (для фото).

Альтернатива «дешево»: на старті використати Supabase Storage до 50 МБ, Drive — тільки для крупних відео.

---

## 7. Telegram бот

1. Створити бота через `@BotFather`. Зберегти токен.
2. Бекенд-сервіс на Node.js + Telegraf:
   ```js
   const { Telegraf } = require('telegraf');
   const bot = new Telegraf(process.env.TG_BOT_TOKEN);

   // ...subscribe to Supabase notifications через webhook чи pg_listen
   // ...for each notification: send message
   ```
3. Хостинг: Railway / Fly.io / Render — безкоштовний tier на старт.
4. **Subscription**: Postgres `LISTEN/NOTIFY` тригер на `INSERT` в `notifications`:
   ```sql
   create or replace function notify_new_notification() returns trigger as $$
   begin
     perform pg_notify('new_notification', row_to_json(new)::text);
     return new;
   end;
   $$ language plpgsql;

   create trigger trg_notify on notifications
     after insert for each row execute function notify_new_notification();
   ```
5. Бот слухає `pg.on('notification', ...)` → форматує і відправляє в TG.

---

## 8. Crontab задачі

Через **Supabase Edge Functions** з cron-розкладом:

| Задача | Розклад | Що робить |
|---|---|---|
| Daily digest | 09:00 Kyiv | Створює notifications для всіх членів стола |
| Cleanup editing_sessions | щохвилини | `delete from editing_sessions where expires_at < now()` |
| Cleanup drafts | щодня 03:00 | Тримає останні 20 чернеток на публікацію |
| Urgency alerts | 09:00 і 15:00 | Знаходить публікації що горять (≤ 1 день, статус ≠ approved) |
| Auto-delegate | 00:01 щодня | Активує/деактивує delegation з `user_vacations` |
| Drive archive cleanup | щодня 04:00 | Видаляє файли з `archived_at + 30 days` |

---

## 9. Деплой

### Опція A: GitHub Pages (як зараз)
- Простий статичний хост.
- Працює якщо backend через Supabase + Edge Functions (бо всі API виклики йдуть із клієнта).
- **Обмеження:** не можна тримати секретний `service_role` key (тому всі задачі що його потребують — на Edge Functions).

### Опція B: Vercel (рекомендую)
- `vercel.json` з `/api/*` для Server-Side функцій.
- Можна мати інтеграцію з Drive через server-side (приховує токени).
- Custom domain `hq.dreamcar.ua`.

---

## 10. Чек-лист готовності до production

- [ ] Усі міграції виконані; RLS увімкнено на всіх таблицях.
- [ ] Google OAuth налаштований; тригер `handle_new_user` працює.
- [ ] Перший CEO/COO має `role` встановлений вручну.
- [ ] Drive API підключений; тестова загрузка ≥ 100MB файлу.
- [ ] Telegram бот живий; тестова доставка повідомлення.
- [ ] 6 cron-задач налаштовані.
- [ ] Backup БД — Supabase точково (`pg_dump`) кожні 24 год.
- [ ] Sentry для frontend і backend помилок.
- [ ] UptimeRobot моніторить hq.dreamcar.ua.
- [ ] Документація для команди оновлена.

---

## Корисні посилання

- Supabase Docs: https://supabase.com/docs
- Supabase JS Client: https://supabase.com/docs/reference/javascript
- Drive Resumable Upload: https://developers.google.com/drive/api/guides/manage-uploads
- Telegraf (TG bot framework): https://telegraf.js.org/

---

## Питання?

Технічні — у GitHub issues цього репо.
Бізнесові — до Вадима (CEO).
