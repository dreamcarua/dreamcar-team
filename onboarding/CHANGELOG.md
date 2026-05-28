# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## YYYY-MM-DD` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 2026-05-28

### Onboarding (РОЗДІЛЕНО!)
- 🆕 **`/onboarding.html`** — user-facing онбординг для ВСІХ членів команди (SMM/Approver/Member/Designer/COO/CEO)
  - Role-picker на старті (CEO/COO/SMM/Approver/Member/Designer)
  - 12 розділів: welcome / quickstart 8 кроків / глосарій / **карта сповіщень** / HQ / Tasks / Креативи / Autopost / TG бот / Brand Book / FAQ / контакти
  - Role-adaptive (показує тільки релевантне)
  - **Без технічних деталей** — мова користувача
  - Прибрано всі згадки «Давід» — універсальний
- 🆕 **`/onboarding/*`** — dev-only hub (з SQL/архітектурою) — закрито auth-guard + dev-only-guard для admin ролей (ceo/coo/lead)
- 🆕 `_dev-guard.js` — non-admin redirect на user-facing onboarding.html

### Security (Supabase)
- 🛡 Revoke EXECUTE з `anon` + `authenticated` на 12 worker/cron функціях
- 🛡 Storage `creatives` bucket: broad ALL policy → 4 вузькі (own files only)
- 🛡 `register_approval` + `retry_compress`: тільки `authenticated`

### Performance (Supabase)
- ⚡ 18 FK без covering index → додано `idx_*` індекси
- ⚡ 20 RLS policies переписано: `auth.uid()` → `(SELECT auth.uid())` — кеш per query

### Daily Health Audit
- 🆕 Edge Function `daily-health-audit` v3 ACTIVE
- 🚀 Cron jobid=13 щодня 7:00 CEST
- 🆕 Manual test: HTTP 200, score 91/100, email + TG доставлені

### Tasks
- 🔧 Закрита тест-задача "🔥 TEST: Прострочений тест"

### Compress
- 🚀 Compress workflow тригернений → 44 photo + 2 video у черзі
- 🔧 HEIC `IMG_8525.HEIC` retry з libheif

---

## 2026-05-27

### HQ
- 🆕 **Overview Modal** — read-only перед edit
- 🆕 **Analytics V3** — funnel + per-platform + velocity
- 🔧 Brand-sync HQ → v3.9.2
- 🔧 Fix «Перевіряю сесію…» висіння

### Tasks
- 🆕 **Tasks Analytics Dashboard** — KPI + charts
- 🆕 **Saved filters (presets)**
- 🆕 **Bulk actions** — multi-select toolbar
- 🆕 **Task templates**
- 🆕 **TG-bind status indicator**
- 🆕 **HQ↔Tasks integration** — auto-task при rework
- 🆕 **Compress queue admin** — retry button

### TG Bot
- 🆕 **/audit команда** у `@dreamcar_team_bot`
- 🆕 Task callbacks: «Done», «Snooze +1d», «Comment»
- 🚀 tg-webhook v25 deployed

### Compress
- 🆕 **Photo + Gallery compression** — ImageMagick 2560×2560 + sendMediaGroup
- 🆕 **HEIC support** — libheif + ImageMagick policy
- 🆕 **Bulk drag-drop upload**

### Autopost
- 🆕 **Meta autopost Phase 1+2** — IG + FB + Threads code ready (waits creds)
- 🆕 Carousels + Reels support
- 🆕 Per-platform JSONB status

### Notifications
- 🆕 **Email worker для Tasks** (Resend SDK)

### Search
- 🆕 **Cmd+K global search** (HQ + Tasks shared widget)

### Mobile
- ⚡ Mobile responsive аудит — 70+ CSS rules

### Performance
- ⚡ IndexedDB offline cache + lazy-load
- ⚡ pg_trgm move, inline scripts extraction

### Auth/Pages
- 🆕 Auth-guard на onboarding.html + orgchart.html + survey.html
- 🆕 SMM block у orgchart.html (Олександр)
- 🔧 Brand-sync survey.html

### Bridges
- 🔧 Cowork→TG bridge race condition

---

## 2026-05-25 і раніше

### TG Autoposting
- 🆕 Event-driven через `dispatch-workflow` Edge Function
- 🆕 sendMediaGroup для груп фото
- 🚀 Compressed videos автоматично у TG-канал

### Compress Pipeline
- 🆕 R2 bucket + Cloudflare Worker (signed URL proxy)
- 🆕 HQ frontend → direct browser → R2 (>49MB)
- 🆕 Background compress
- 🆕 GH Action compress-creative.yml + bash worker
- 🆕 2-pass H.264 high profile, ≤49.5MB
- 🆕 HEVC second pass (opt-in)

### HQ Workflow
- 🆕 Multi-approver AND logic
- 🆕 TG inline buttons (approve/reject)
- 🆕 Structured rework feedback
- 🆕 Auto-revert у review якщо approved пост змінили >10 символів
- 🆕 Chain прогрес approvers у TG
- 🆕 Дублювати пост на платформу
- 🆕 @mention з push у TG DM
- 🆕 SLA reminders -10 хв + перевірка +10 хв

### HQ UX
- 🆕 Per-platform date/time + preview tabs
- 🆕 Char counter, кольорові точки платформ
- 🆕 Bulk tag/move у Бібліотеці
- 🆕 IG feed 3×3 preview
- 🆕 Theme toggle
- 🆕 PWA install у topbar
- 🆕 Звуки ding/send

### Tasks v3
- 🆕 Tasks app `/tasks/`
- 🆕 TG/Email нотифікації, comments, subtasks, recurring
- 🆕 Universal header

### Brand Book
- 🆕 ~25 розділів, Brand Post Generator, Voice Linter, Color Checker
- 🆕 Component Storybook
- 🆕 Sidebar search v6 — full-text
- 🆕 PDF print без чорного фону

### Infrastructure
- 🆕 Cowork → TG bridge через GitHub Action
- 🆕 Event-driven dispatcher
- 🆕 Stuck-task detector
- 🆕 Vacation mode UI

---

## Як оновлювати цей файл

1. Кожна нова фіча / fix / deploy — додати рядок у поточну дату
2. Якщо це NEW день — створити новий `## YYYY-MM-DD` блок зверху
3. Групувати під підзаголовки систем
4. Емодзі обов'язково (🆕 / 🔧 / 🛡 / ⚡ / 🚀 / 📖 / 🗑)
5. Посилання на сторінку онбордингу де треба

**Це джерело правди для команди.** Хочеш знати що нового — почни тут.

## Дві версії онбордингу

- **`/onboarding.html`** — USER-FACING. Універсальний онбординг для всіх членів команди. Role-picker, без технічних деталей, з кейсами та прикладами.
- **`/onboarding/*`** — DEV-ONLY. Тут технічні деталі (архітектура, SQL, troubleshooting). Закрито auth-guard для admin ролей (ceo/coo/lead).
