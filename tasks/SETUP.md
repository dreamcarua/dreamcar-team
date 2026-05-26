# Tasks v3 — Setup & Deploy

## Що нового у v3

**Сповіщення (TG + Email):**
- 📌 призначення / зміна виконавця
- 🔄 зміна статусу (assignee + watchers)
- 👋 @mentions у коментарях
- 💬 коментар у твоєму завданні
- ⏰ нагадування за 24h до дедлайну
- 🔥 overdue (раз на 24h)
- ☀️ дайджест 09:00 (CET) — твої задачі на день + overdue
- 🔁 розблоковано (коли blocker → done)
- 🔁 автоматичне створення повторюваних задач

**UX best practices:**
- 💬 коментарі з @mention autocomplete (наживо realtime)
- ☑ subtasks/чек-листи з progress-bar на картці
- 👁 watchers — multi-select; всі нотифікації як у assignee
- 🔁 recurrence (щодня / по буднях / щотижня / щомісяця)
- ⛓ depends_on (uuid[]) — для майбутніх блокувань
- 🔔 notification bell з unread badge + звук
- ⚙ налаштування каналів + тиха година + година дайджесту
- ⌨ гарячі клавіші: `N`, `B`, `?`, `Shift+клік` (bulk), `⌘+Enter`, `⌘+S`, `Esc`
- 📦 bulk operations: status, assignee, delete
- 🔎 розширені фільтри: Мої / Стежу / Сьогодні / Прострочено / @мене
- 🔗 deeplink `#task=uuid` (з нотифікацій → одразу відкриває картку)
- 🟢 realtime — без F5

---

## DEPLOY (3 кроки)

### Крок 1. SQL міграція

У Supabase SQL Editor (`dreamcar-hq` проєкт):

```bash
# спершу — якщо ще не запустив v1
tasks/db/schema.sql

# потім — нова міграція v2
tasks/db/schema_v2_notifications.sql
```

Перевірка:
```sql
select count(*) from public.team_tasks;
select count(*) from public.team_task_comments;
select count(*) from public.team_task_notifications;
select tg_enabled from public.team_task_user_prefs limit 1;
```

### Крок 2. Edge Functions

Дві функції потрібно задеплоїти через Supabase CLI або Dashboard.

**Через CLI:**
```bash
# у корені проєкту dreamcarua/dreamcar-team
supabase login
supabase link --project-ref wotghlaehnvxyeacznvv

# деплой обох
supabase functions deploy team-tasks-notify --no-verify-jwt
supabase functions deploy team-tasks-cron --no-verify-jwt
```

**Через Dashboard:**
1. https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/functions
2. New function → copy `tasks/supabase/functions/team-tasks-notify/index.ts`
3. New function → copy `tasks/supabase/functions/team-tasks-cron/index.ts`

**Secrets (у Dashboard → Edge Functions → Secrets):**
| Ключ | Значення | Призначення |
|---|---|---|
| `TG_BOT_TOKEN` | (вже є з HQ) | DM через `@dreamcar_team_bot` |
| `TEAM_HUB_BASE` | `https://team.dreamcar.ua` | Базовий URL для deeplink |
| `RESEND_API_KEY` | (опційно) | Email канал |
| `RESEND_FROM` | `DreamCar Tasks <tasks@dreamcar.ua>` | From-адреса |

`SUPABASE_URL` і `SUPABASE_SERVICE_ROLE_KEY` додаються автоматично.

### Крок 3. Розклад cron

У Supabase Dashboard → SQL Editor:

```sql
-- кожні 30 хв перевіряє reminders/overdue/recurring
select cron.schedule(
  'team-tasks-cron-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/team-tasks-cron',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.settings.service_role_key'))
  )
  $$
);

-- alt: GitHub Actions з schedule (без pg_cron)
-- див. .github/workflows/team-tasks-cron.yml
```

Перевірка:
```sql
select * from cron.job where jobname like 'team-tasks%';
```

---

## Як підключити Telegram кожному учаснику команди

Кожен користувач має написати `@dreamcar_team_bot` команду `/bind <email>` (формат як у HQ). Бот пише `tg_chat_id` у `public.users.tg_chat_id`.

Перевірка:
```sql
select email, name, tg_chat_id from public.users where is_active = true;
```

Якщо `tg_chat_id` пустий — нотифікації йдуть тільки in-app (через 🔔 в інтерфейсі).

---

## Email (опційно, наступний крок)

1. Зареєструватись на [resend.com](https://resend.com) (3K писем/міс безкоштовно).
2. Підтвердити домен `dreamcar.ua` (DNS TXT-запис).
3. Створити API key → `RESEND_API_KEY` у Supabase secrets.
4. Кожен користувач у Tasks → ⚙ Налаштування → Email = ON.

Без `RESEND_API_KEY` email канал пропускається без помилок.

---

## Тестування end-to-end

```sql
-- 1. створи тестову задачу від свого імені, призначену комусь
insert into public.team_tasks (title, status, priority, assignee_id, created_by, due_date)
select 'TEST: перевірка TG-нотифікації', 'inbox', 'p1',
       (select id from public.users where email = 'davyd@dreamcar.ua' limit 1),
       public.current_user_id(),
       current_date + 1;

-- 2. перевір що нотифікація потрапила у чергу
select * from public.team_task_notifications order by created_at desc limit 5;

-- 3. виклич воркер вручну (через REST)
-- curl -X POST https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/team-tasks-notify
```

Або просто з фронтенду — кожна дія (save / drag-drop / comment) автоматично кличе worker через 500 мс debounce.

---

## Архітектура потоку

```
USER ACTION (frontend)
     ↓
INSERT / UPDATE team_tasks  ←→  trigger team_tasks_notify_trigger
                                       ↓
                       INSERT team_task_notifications (state=pending)
                                       ↓
            ┌──────────────────────────┴──────────────────────────┐
            ↓                                                     ↓
      EDGE FN team-tasks-notify                           EDGE FN team-tasks-cron
      (викликається з фронту + ручно)                   (раз на 30 хв · pg_cron)
            ↓                                                     ↓
      claim_team_task_notifications(25)                  enqueueReminders24h
            ↓                                            enqueueOverdue
      send via Telegram Bot API                          enqueueDailyDigest (09 CET)
            ↓                                            processRecurring
      mark_team_task_notification_done(ok)
            ↓
      [optional] Resend → email
```

---

## Що далі (наступні фази, які можна швидко додати)

1. **Attachments** — drag-drop файлів у task → R2 (як у HQ app-drive.js)
2. **Burndown chart** — графік виконаних/створених задач по днях
3. **Templates** — створити з template (як у HQ Templates)
4. **WIP limits** — обмеження кількості tasks у статусі doing
5. **Time tracking** — start/stop timer → actual_h
6. **Smart filters з sharing** — saved views з URL
7. **Markdown в description** — рендер bold/italic/links/code
8. **Telegram quick-add** — команда `/task <title>` у бота
9. **Browser push notifications** — VAPID + PWA
10. **AI assist** — `/ai розбий задачу на subtasks` через Claude API

---

## Файли v3

- `tasks/index.html` — frontend SPA (~62KB)
- `tasks/db/schema.sql` — v2 (база)
- `tasks/db/schema_v2_notifications.sql` — нотифікації, коментарі, subtasks, watchers
- `tasks/supabase/functions/team-tasks-notify/index.ts` — TG/Email worker
- `tasks/supabase/functions/team-tasks-cron/index.ts` — cron-tasks
- `tasks/SETUP.md` — цей файл

---

vg@dreamcar.ua · 2026-05-26
