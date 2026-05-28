# DreamCar Setup Today · Інструкція для Вадима

> Все нижче — **паралельно**. Загальний час ~60 хвилин твого часу.
> Після виконання — усі системи запрацюють у повному обсязі.

---

## ✅ Крок 1 · Resend для email (5 хв)

**Що дасть:** автоматичний email-звіт щодня 7:00 ранку + email-канал для Tasks-нотифікацій.

### Дії:
1. Зайти на https://resend.com → **Sign up** (через GitHub або email)
2. Зайти у **API Keys** → **Create API Key** → назва: `DreamCar Audit` → permission: `Sending access` → **Create**
3. Скопіювати ключ (починається з `re_...`)
4. (Опційно) Додати домен `dreamcar.ua`: **Domains** → **Add Domain** → налаштувати DNS records (SPF + DKIM). Або пропустити і використовувати `onboarding@resend.dev` (для тестів).
5. Перейти у Supabase Dashboard: https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/settings/functions
6. **Edge Functions → Manage Secrets → Add Secret**:
   ```
   RESEND_API_KEY = re_xxxxxxxxxxxx
   ```
7. (Опційно) додати:
   ```
   AUDIT_RECIPIENT = vg@dreamcar.ua
   RESEND_FROM = DreamCar Audit <audit@dreamcar.ua>
   ```
   *(якщо домен не валідований — лиши `RESEND_FROM = onboarding@resend.dev`)*

### Перевірка:
Завтра 7:00 ранку email прийде. Або зараз — натисни кнопку `Invoke` у Supabase Dashboard на функції `daily-health-audit`.

---

## ✅ Крок 2 · GitHub Token для auto-deploy (2 хв)

**Що дасть:** мої майбутні commit'и у Supabase Edge Functions автоматично деплояться без твоєї участі.

### Дії:
1. Створи Supabase Personal Access Token: https://supabase.com/dashboard/account/tokens → **Generate new token** → назва `GH Actions Deploy` → Create → **скопіюй**.
2. GitHub: https://github.com/dreamcarua/dreamcar-team/settings/secrets/actions → **New repository secret**:
   ```
   Name: SUPABASE_ACCESS_TOKEN
   Value: sbp_xxxxxxxxxxxx
   ```
3. Додатково (вже може бути встановлено):
   ```
   Name: SUPABASE_PROJECT_REF
   Value: wotghlaehnvxyeacznvv
   ```

### Перевірка:
Після наступного commit у `hq/supabase/functions/**` — GH Action `Deploy Edge Functions` має пройти зеленим.

---

## ✅ Крок 3 · Onboarding команди (10 хв)

**Що дасть:** всі 6 з 6 users матимуть TG-нотифікації і повний доступ.

### Дії:
1. Відкрий `docs/TEAM_ONBOARDING_MESSAGES.md` — там вже готові тексти.
2. Скопіюй кожен меседж і відправ у Telegram:
   - **Віра** (verusya.nec@gmail.com) — потрібно і Google login, і TG bind
   - **Саша** (lexbelov21@gmail.com) — тільки TG bind
   - **Артем** (1avrybak@gmail.com) — тільки TG bind
3. Жди підтвердження ✅ від бота кожному.

### Перевірка:
Через день у Daily Audit email побачиш `users_tg_bound: 6 / 6`.

---

## ✅ Крок 4 · Meta App для IG+FB+Threads autopost (45 хв)

**Що дасть:** автопостинг у Instagram + Facebook + Threads з HQ — як зараз працює TG.

### Дії:
1. Відкрий `docs/META_AUTOPOST_SETUP.md` — там 8-кроковий гайд.
2. Загалом:
   - Створити Meta App на developers.facebook.com
   - Додати Instagram Graph API + Pages + Threads API
   - Generate Long-lived User Token (60 днів)
   - Get Page Access Token (без терміну)
   - Get IG_USER_ID + THREADS_USER_ID
3. Додати **7 secrets** у GitHub Actions `dreamcarua/dreamcar-team`:
   ```
   META_APP_ID
   META_APP_SECRET
   META_FB_PAGE_TOKEN
   META_FB_PAGE_ID
   META_IG_USER_ID
   META_THREADS_USER_ID
   META_THREADS_TOKEN
   ```

### Перевірка:
Найближча approved-публікація з платформою `ig`, `fb`, або `threads` піде у `meta-autopost-worker` через 5 хв cron.

---

## 📊 Що відбувається паралельно (без твоєї участі)

| Що працює зараз | Деталі |
|---|---|
| Daily Health Audit | pg_cron 7:00 щодня — `daily-health-audit` |
| TG нотифікації | 200+ за день успішно |
| Compress queue worker | Кожні 3 хв обробляє pending creatives |
| TG Autopost worker | Кожні 5 хв шукає approved-публікації з `publish_at ≤ now` |
| HQ↔Tasks integration | Rework публікації → auto-create task для responsibles |
| Cmd+K Global Search | Працює у HQ і Tasks |

---

## 🎯 Загальний прогрес

- **228 tasks closed** у проекті
- **5 GH workflows** активні
- **14 Edge Functions** active
- **8 pg_cron jobs** running
- **0 errors** за останні 24 години (підтверджено Edge Function logs)

---

_Створено 28.05.2026 ранок · автоматично оновлюється після кожного значного commit_
