# DreamCar TG Task Bot — Technical Specification

**Версія:** 05.06.2026
**Підхід:** Hybrid (Variant C) — Reactive emoji + Daily proactive scan
**Бот:** `@dreamcar_team_bot` (existing)
**LLM:** Claude Haiku 4.5 (через Anthropic API)

---

## 1. Загальна архітектура

```
TG чат (whitelisted)
    │
    ├─ Hot path (Sprint 1): user реагує emoji 📌
    │     │
    │     ▼
    │   tg-webhook (message_reaction event)
    │     │
    │     ▼
    │   tg-task-extract (нова edge fn)
    │     │
    │     ├─→ Claude Haiku: extract task structure
    │     ├─→ INSERT into tg_proposed_tasks (state=proposed)
    │     └─→ DM reactor: "Знайдена задача: X. Створити?" + 3 buttons
    │
    └─ Cold path (Sprint 2): кожне повідомлення йде у buffer
          │
          ▼
        INSERT into tg_chat_buffer
          │
          ▼ (cron 16:00 UTC = 18:00 CET)
        tg-daily-task-scan (нова edge fn)
          │
          ├─→ Claude Haiku batch: scan day of messages
          ├─→ INSERT кожної знайденої у tg_proposed_tasks
          └─→ Post у чат: "Помітив N можливих задач..." + кнопки
```

## 2. DB schema (нові таблиці)

### 2.1 `tg_listening_chats` (whitelist)
```sql
create table public.tg_listening_chats (
  chat_id        bigint primary key,           -- TG chat id (negative for groups)
  chat_title     text,                          -- людська назва для UI
  added_by       uuid references public.users(id),
  added_at       timestamptz default now(),
  reactive       boolean default true,          -- Sprint 1 active
  proactive      boolean default true,          -- Sprint 2 active (digest)
  default_assignee_id uuid references public.users(id),  -- fallback assignee
  notes          text                           -- внутрішні нотатки
);
```

### 2.2 `tg_proposed_tasks` (queue запропонованих)
```sql
create type tg_proposed_state as enum (
  'proposed',   -- LLM extract + ждуть confirm
  'editing',    -- юзер натиснув ✏ Змінити, у режимі редагування
  'accepted',   -- створено task у team_tasks
  'dismissed',  -- ❌ Скасувати
  'expired'     -- > 24 год без дії
);

create table public.tg_proposed_tasks (
  id                uuid primary key default gen_random_uuid(),
  state             tg_proposed_state not null default 'proposed',
  -- джерело
  source            text not null check (source in ('emoji','digest','command')),
  chat_id           bigint not null,
  message_id        bigint,                              -- source TG message (null для digest)
  proposer_id       uuid not null references public.users(id), -- хто запропонував (натиснув emoji)
  source_text       text not null,                       -- оригінальний текст
  -- LLM extracted
  title             text not null,
  description       text,
  assignee_hint     text,                                -- e.g. "Саша", "@artem"
  assignee_id       uuid references public.users(id),    -- resolved
  due_date          date,
  priority          task_priority,
  confidence        numeric(3,2) not null default 0.5,
  -- transactional
  created_task_id   uuid references public.team_tasks(id), -- якщо accepted
  dm_chat_id        bigint,                              -- куди прислати confirmation DM
  dm_message_id     bigint,                              -- TG message id confirmation
  created_at        timestamptz default now(),
  decided_at        timestamptz
);

create index on public.tg_proposed_tasks (proposer_id, state) where state = 'proposed';
create index on public.tg_proposed_tasks (chat_id, created_at desc);
```

### 2.3 `tg_chat_buffer` (Sprint 2)
```sql
create table public.tg_chat_buffer (
  chat_id      bigint not null,
  message_id   bigint not null,
  user_tg_id   bigint not null,
  user_name    text,                          -- snapshot first_name + last_name
  text         text not null,
  reply_to     bigint,                        -- thread context
  ts           timestamptz not null default now(),
  processed_at timestamptz,                   -- коли пройшов digest
  primary key (chat_id, message_id)
);

create index on public.tg_chat_buffer (chat_id, ts desc);

-- Auto cleanup > 7 днів через pg_cron
```

## 3. Edge Functions

### 3.1 `tg-task-extract` (Sprint 1, новий)

**Endpoint:** `POST /functions/v1/tg-task-extract`

**Вхід:**
```json
{
  "source": "emoji",
  "chat_id": -1001234567890,
  "message_id": 999,
  "proposer_tg_id": 123456,
  "text": "Саша, доробити лендинг мото до п'ятниці!",
  "thread_context": []  // опц.: list of previous messages
}
```

**Логіка:**
1. Resolve proposer (TG id → users.id)
2. Resolve potential assignees from chat members
3. Call Claude Haiku з prompt (див. секція 4)
4. Parse JSON response
5. Якщо `is_task=true`:
   - Resolve `assignee_hint` → users.id через name match
   - INSERT into tg_proposed_tasks (state=proposed)
   - Send DM до proposer з proposal + 3 inline buttons
   - Зберегти dm_message_id для майбутнього edit
6. Return result

### 3.2 `tg-daily-task-scan` (Sprint 2, новий)

**Trigger:** pg_cron щодня 16:00 UTC (18:00 CET)

**Логіка для кожного чату у `tg_listening_chats WHERE proactive=true`:**
1. Pull unprocessed messages з buffer за останні 24 год
2. Якщо < 3 msgs — skip (нема про що говорити)
3. Format conversation як conversational log
4. Call Claude Haiku batch prompt
5. Parse JSON list of tasks
6. Filter: confidence >= 0.6
7. INSERT proposed tasks
8. Mark buffer entries processed
9. Якщо знайдено > 0 — post у чат summary message з кнопками per task

### 3.3 `tg-webhook` (existing — РОЗШИРИТИ)

Додати handling:

**(a) `message_reaction` event** (TG Bot API ≥7.0):
```ts
if (update.message_reaction) {
  // emoji whitelist: 📌 📋 ✅
  if (TASK_TRIGGER_EMOJIS.includes(emoji)) {
    if (chat is in tg_listening_chats with reactive=true) {
      // отримати original message — БІдА: API не дає content reaction'у!
      // workaround: треба буферити кожне msg (Sprint 2 buffer покриває це)
      // на Sprint 1 — спершу беремо з buffer, fallback request to AI router
    }
  }
}
```

**(b) Callback `taskprop:*`:**
- `taskprop:accept:<id>` → fetch tg_proposed_tasks → INSERT team_tasks → mark accepted → edit DM
- `taskprop:dismiss:<id>` → mark dismissed → edit DM
- `taskprop:edit:<id>` → state→editing → send field-select menu
- `taskprop:set_assignee:<id>:<user_id>` → update assignee
- `taskprop:set_priority:<id>:<p>` → update priority
- `taskprop:set_due:<id>:<date>` → update due
- `taskprop:confirm:<id>` → final accept after edit

**(c) Кожне msg → buffer (Sprint 2):**
```ts
if (update.message && chat in whitelist) {
  await insertBuffer({...});
}
```

## 4. LLM Prompts

### 4.1 Single message extraction (Sprint 1)

**Model:** `claude-haiku-4-5-20251001`
**Max tokens:** 400
**System:**
```
Ти — асистент-помічник української команди DreamCar.
Аналізуєш повідомлення у Telegram-чаті і визначаєш чи це постановка задачі.

ЩО Є ЗАДАЧЕЮ:
- Конкретна дія яку потрібно зробити людині
- Має дієслово в наказовому/майбутньому часі ("зроби", "треба", "доробити", "запусти")
- Має чіткий результат що очікується

ЩО НЕ Є ЗАДАЧЕЮ:
- Питання про статус ("як справи з лендингом?")
- Обговорення без action item ("цікавий підхід...")
- Згадка вже зробленої роботи ("я закрив ту таску")
- Привітання, дисципліна спілкування

Витягни структуру і відповідай ЛИШЕ валідним JSON.

Пріоритет:
- p1 (терміново): "терміново", "ASAP", "вчора треба було", "критично", "горить"
- p2 (важливо): "важливо", "не забути", "обовʼязково"
- p3 (звичайний): дефолт

Дедлайн (today=YYYY-MM-DD): конвертуй "до пʼятниці", "до 10 червня", "до кінця тижня" → YYYY-MM-DD або null.

JSON-структура:
{
  "is_task": boolean,
  "title": string|null,        // 60 chars max, у наказовій формі
  "description": string|null,  // 250 chars max, без води
  "assignee_hint": string|null, // ім'я або @nick зі знайдених
  "due_date": string|null,     // YYYY-MM-DD
  "priority": "p1"|"p2"|"p3"|null,
  "confidence": number          // 0.0-1.0, наскільки впевнений
}
```

**User:** саме повідомлення + опц. контекст thread + список членів команди як hint для assignee.

### 4.2 Batch daily scan (Sprint 2)

System аналогічний, але prompt:
```
Я даю тобі лог повідомлень з робочого чату за день.
Знайди ВСІ потенційні задачі що згадувались але не оформлені.

Поверни JSON:
{ "tasks": [{...}, {...}] }

Якщо нічого — { "tasks": [] }.
Тільки high-confidence (>= 0.6) задачі.
```

## 5. UX — формат DM confirmation

### 5.1 Initial proposal
```
🤖 Знайшов можливу задачу у чаті <Назва чату>

📌 Заголовок: Доробити лендинг мото
👤 Виконавець: Саша (з тексту)
📅 Дедлайн: 12.06.2026 (з "до пʼятниці")
🔵 Пріоритет: P2

Контекст: "Саша, доробити лендинг мото до пʼятниці!"

Створити цю задачу?

[✅ Створити]  [✏ Змінити]  [❌ Не задача]
```

### 5.2 Edit mode
```
✏ Що змінити?
[👤 Виконавця]  [📅 Дедлайн]  [🔵 Пріоритет]
[📝 Назва]      [↩ Назад]
```

### 5.3 Daily digest у чат
```
🤖 Підсумок дня — потенційні задачі

За сьогодні я помітив 3 можливі задачі що не оформлені у Tasks:

1. Доробити лендинг мото (Саша, до пʼятниці) — [Створити] [Skip]
2. Зробити ТЗ по новому проекту (Артем, до 10.06) — [Створити] [Skip]
3. Запустити тестовий рекламний кампейн (Віра) — [Створити] [Skip]

Якщо щось не потрібно — просто ігнорь, я більше не нагадуватиму.
```

## 6. Конфігурація

**Secrets (Supabase Vault):**
- `ANTHROPIC_API_KEY` — для Claude (вже є)
- `TG_BOT_TOKEN` — токен бота (вже є)
- `TG_WEBHOOK_SECRET` — webhook secret (вже є)

**Env vars edge functions:**
- `SUPABASE_URL`, `SERVICE_ROLE_KEY` — auto

**TG Bot setup:**
- `setMyCommands`: додати `/task`, `/proposed`
- `setWebhook` з `allowed_updates`: треба включити `message_reaction` (зараз тільки message + callback_query)

## 7. Acceptance Criteria

### Sprint 1
- [ ] DB migration applied
- [ ] tg-task-extract deployed
- [ ] tg-webhook handle message_reaction + taskprop:*
- [ ] Whitelist 1 test chat
- [ ] Add 📌 emoji to a message → DM прилітає за <5 сек
- [ ] Натиск ✅ → task у team_tasks → notification у TG (через існуючу систему)
- [ ] Натиск ❌ → dismiss, нічого не створено
- [ ] Натиск ✏ → можу змінити assignee/due/priority перед створенням
- [ ] Expired (>24h) tasks автоматично переходять у expired

### Sprint 2
- [ ] tg_chat_buffer заповнюється
- [ ] Cron 18:00 CET fires
- [ ] tg-daily-task-scan повертає список tasks
- [ ] Post у чат якщо >0 знайдено
- [ ] Buffer cleanup > 7 днів

## 8. Ризики і mitigation

| Ризик | Mitigation |
|---|---|
| Privacy чутливих чатів | Whitelist only, default off |
| LLM hallucinations | confidence >= 0.6 threshold + manual confirm |
| Спам у груповому чаті | Тільки daily digest у груповому, hot path → DM |
| TG bot permissions | Бот має бути admin у group для message_reaction |
| Cost overflow | Monitoring через Anthropic dashboard, alert якщо >$50/міс |
| False assignee | Fallback на proposer якщо name не resolved |
| Multi-language (укр/рос/англ) | Haiku підтримує всі три |
| Bot privacy mode | Має бути disabled щоб бачити всі messages у group |

## 9. Метрики успіху

Через 2 тижні після Sprint 1:
- `proposed`/день — скільки emoji-реакцій було (raw demand)
- `accepted` / `proposed` — конверсія (target: 50%+)
- Mean time `proposed → accepted` — швидкість UX (target: <2 хв)
- LLM precision — manual review 20 outputs (target: 80%+ correct)
- User feedback — DM до Вадима після 1 тижня
