# Event-Driven Pipeline Setup — Варіант A

Інструкція як активувати миттєвий тригер GH Actions замість cron *15min waits.

**Час налаштування:** ~5 хвилин (твоїх дій)

---

## 🎯 Що буде після цього

Зараз: upload → cron compress (5-15min wait) → cron autopost (5-15min wait) → TG. **Загалом 15-30 хв**.

Після setup: upload → instant trigger compress (~1s) → ffmpeg (~3-5 min) → instant trigger autopost (~1s) → TG. **Загалом 4-6 хв**.

Cron залишиться як safety net (раз на 15 хв).

---

## 📋 КРОК 1 — Створити GitHub Personal Access Token

1. Відкрий: https://github.com/settings/tokens/new
2. Заповни:
   - **Note:** `DreamCar HQ workflow dispatch`
   - **Expiration:** `No expiration` (або 1 year)
   - **Scopes:**
     - ✅ **repo** (full)
     - ✅ **workflow**
3. Внизу клікни **`Generate token`**
4. **Скопіюй** показаний `ghp_XXXXXXXXXXXXXXXXXX` — більше не покаже!

---

## 📋 КРОК 2 — Додати у Supabase Edge Function Secrets

1. Відкрий: https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/settings/functions
2. Прокрути до **`Secrets`** внизу сторінки
3. Клікни **`Add new secret`**
4. Name: `GH_DISPATCH_TOKEN`
5. Value: `ghp_XXXX...` (з кроку 1)
6. **`Save`**

---

## 📋 КРОК 3 — Deploy Edge Function

Edge Function код вже у репо: `hq/supabase/functions/dispatch-workflow/index.ts`

**Спосіб A — Supabase CLI** (якщо встановлений):
```bash
cd /Users/vadimgrishin/DreamCar.AI/dreamcar_team
supabase functions deploy dispatch-workflow --project-ref wotghlaehnvxyeacznvv
```

**Спосіб B — через Dashboard**:
1. Відкрий: https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/functions
2. Клікни **`Deploy a new function`** → **`Via Editor`**
3. Function name: `dispatch-workflow`
4. Скопіюй вміст з https://raw.githubusercontent.com/dreamcarua/dreamcar-team/main/hq/supabase/functions/dispatch-workflow/index.ts
5. Встав → **`Deploy function`**
6. **ВАЖЛИВО:** після deploy → Settings → **Verify JWT** → **OFF** (щоб приймало Bearer від anon)

---

## ✅ КРОК 4 — Перевірка

Відкрий DevTools у HQ (https://dreamcarua.github.io/.../hq/index.html), Console → побачиш:

```
[dispatch] ✓ Realtime hooks armed
```

Це означає що фронтенд слухає INSERT events і одразу тригерить workflows.

**Тест:**
1. Завантаж нове відео-creative у HQ
2. У Console побачиш: `[dispatch] New video creative — triggering compress`
3. У GH Actions через ~2 секунди стартує `Compress Creative Worker`
4. Після завершення compress воркер сам викличе dispatch для autopost

---

## 🔄 Як це працює (схема)

```
HQ Frontend
   │
   │ INSERT creative (video)
   ├─────────────────────────────┐
   │                             ▼
   │             Supabase Realtime (postgres_changes)
   │                             │
   │                             ▼
   │             app-dispatch-hooks.js (browser)
   │                             │
   │             POST /functions/v1/dispatch-workflow
   │                             ▼
   │                  ┌──────────────────┐
   │                  │ Edge Function    │
   │                  │ dispatch-workflow│
   │                  └──────┬───────────┘
   │                         │
   │                         ▼ GitHub API workflow_dispatch
   │                  ┌──────────────────┐
   │                  │ Compress Worker  │
   │                  │ (GH Action)      │
   │                  └──────┬───────────┘
   │                         │
   │                         ▼ End of compress
   │                  curl POST dispatch-workflow {workflow:autopost}
   │                         │
   │                         ▼
   │                  ┌──────────────────┐
   │                  │ Autopost Worker  │
   │                  └──────┬───────────┘
   │                         │
   │                         ▼
   │                       Telegram
   │
   ↓ (фолбек якщо щось не спрацює)
   Cron */15 min → catches missed jobs
```

---

## 🛠 Troubleshooting

**Console показує `[dispatch] failed 500 GH_DISPATCH_TOKEN secret not configured`**
→ Не зробив Крок 2 (Supabase secret)

**Console показує `[dispatch] failed 401`**
→ Edge Function має Verify JWT = ON. Вимкни у Settings.

**Console показує `[dispatch] failed 404`**
→ Edge Function не задеплоєно. Крок 3.

**Workflow не стартує навіть з GH side**
→ PAT scope недостатній. Регенеруй з ✅ repo + ✅ workflow.

**GH Actions UI каже `manually triggered`** — все правильно, це наш dispatch.

---

## 📊 Cron як safety net

Залишається `compress-creative.yml` cron `*/15 min` і `tg-autopost.yml` cron `*/15 min` (раніше були */3 і */5).

Якщо event-driven dispatch не спрацював (Edge Function down, мережа, etc) — cron підхопить через 15 хв max. Це backup.

Якщо хочеш повністю прибрати cron — закоментуй `schedule:` блоки у обох `.yml` файлах.
