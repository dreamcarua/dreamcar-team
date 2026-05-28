# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## YYYY-MM-DD` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання на онбординг`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 2026-05-28

### Onboarding
- 🆕 Створено окремий хаб `/onboarding/` з 6 системами + цей CHANGELOG
- 🆕 Сторінки: [HQ](hq.html), [Tasks](tasks.html), [Compress](compress.html), [Autopost](autopost.html), [Daily Audit](audit.html), [Brand Book](brand-book.html)
- 🆕 Швидкий старт за роллю (CEO / COO / SMM / Approver)
- 📖 Базова концепція + швидка навігація + посилання на CHANGELOG

### Security (Supabase)
- 🛡 Revoke EXECUTE з `anon` + `authenticated` на 12 worker/cron функціях: `claim_*`, `complete_*`, `fail_*`, `mark_platform_autopost`, `enqueue_pending_autoposts`, `detect_stuck_tasks`, `retry_compress_all_failed`, `enqueue_team_task_notification`, `mark_team_task_notification_done`
- 🛡 Storage `creatives` bucket: broad ALL policy → 4 вузькі (own files only)
- 🛡 `register_approval` + `retry_compress`: тільки `authenticated`

### Performance (Supabase)
- ⚡ 18 FK без covering index → додано `idx_*` (access_requests, comments, creatives, desk_members, editing_sessions, launches, pub_templates, publication_drafts, publication_history, publications, team_task_notifications, team_tasks, user_vacations, creative_publications)
- ⚡ 20 RLS policies переписано: `auth.uid()` → `(SELECT auth.uid())` — PostgreSQL тепер кешує per query замість per row (massive boost для team_tasks/users/publications)

### Daily Health Audit
- 🆕 Edge Function `daily-health-audit` v3 ACTIVE з повним пайплайном (score / 6 sections / red+yellow issues)
- 🚀 Cron jobid=13 щодня 7:00 CEST (виправлено undefined `service_role_key` setting)
- 🆕 Manual test пройшов: HTTP 200, score 91/100, email + TG обидва доставлені
- 📖 [audit.html](audit.html)

### Tasks
- 🔧 Закрита тест-задача "🔥 TEST: Прострочений тест"

### Compress
- 🚀 Compress workflow тригернений → 44 photo + 2 video у черзі (cron */3min опрацює)
- 🔧 HEIC `IMG_8525.HEIC` скинутий у pending для retry з libheif support

---

## 2026-05-27

### HQ
- 🆕 **Overview Modal** — read-only перегляд публікації перед edit (двокроковий patern)
- 🆕 **Analytics V3** — funnel + per-platform breakdown + velocity
- 🔧 Brand-sync HQ → v3.9.2 (токени, шрифти, кольори, статуси)
- 🔧 Сховано дубль логотипу у sidebar
- 🔧 Fix «Перевіряю сесію…» висіння (safety timeouts 8s + 6s)

### Tasks
- 🆕 **Tasks Analytics Dashboard** (`/tasks/analytics.html`) — KPI + charts
- 🆕 **Saved filters (presets)** — зберігати фільтри per-user
- 🆕 **Bulk actions** — multi-select toolbar (move/assign/priority/delete)
- 🆕 **Task templates** — шаблони повторюваних задач
- 🆕 **TG-bind status indicator** у sidebar
- 🆕 **HQ↔Tasks integration** — auto-task при rework публікації (DB trigger)
- 🆕 **B5: Compress queue admin** — retry button

### TG Bot
- 🆕 **/audit команда** у `@dreamcar_team_bot` — on-demand health-report
- 🆕 Task callbacks: «Done», «Snooze +1d», «Comment»
- 🚀 tg-webhook v25 deployed

### Compress
- 🆕 **Photo + Gallery compression** — ImageMagick 2560×2560 q90 + sendMediaGroup
- 🆕 **HEIC support** — libheif + ImageMagick policy unlock
- 🆕 **Bulk drag-drop upload** у HQ Library

### Autopost
- 🆕 **Meta autopost Phase 1+2** — IG + FB + Threads code ready (waits creds)
- 🆕 Carousels + Reels support
- 🆕 Per-platform JSONB status (`mark_platform_autopost` RPC)

### Notifications
- 🆕 **Email worker для Tasks** (Resend SDK)

### Search
- 🆕 **Cmd+K global search** (HQ + Tasks shared widget)

### Mobile
- ⚡ Mobile responsive аудит — 70+ CSS rules для ≤768px і ≤480px

### Performance
- ⚡ IndexedDB offline cache + lazy-load
- ⚡ pg_trgm move, inline scripts extraction

### Auth/Pages
- 🆕 Auth-guard на onboarding.html + orgchart.html + survey.html
- 🆕 SMM block у orgchart.html (Олександр)
- 🔧 Brand-sync survey.html

### Bridges
- 🔧 Cowork→TG bridge race condition (concurrency group + push retry)

---

## 2026-05-25 і раніше

### TG Autoposting
- 🆕 Event-driven через `dispatch-workflow` Edge Function (replace cron */5min)
- 🆕 sendMediaGroup для груп фото
- 🚀 Compressed videos автоматично у TG-канал

### Compress Pipeline
- 🆕 R2 bucket + Cloudflare Worker (signed URL proxy)
- 🆕 HQ frontend → direct browser → R2 (>49MB)
- 🆕 Background compress with `compressed_url`, `compressed_status`, `compressed_size_bytes`
- 🆕 GH Action compress-creative.yml + bash worker
- 🆕 2-pass target-bitrate H.264 high profile, ≤49.5MB
- 🆕 HEVC second pass (opt-in)

### HQ Workflow
- 🆕 Multi-approver AND logic (всі погодили → approved)
- 🆕 TG inline buttons (approve/reject)
- 🆕 Structured rework feedback (модалка)
- 🆕 Auto-revert у review якщо approved пост змінили >10 символів
- 🆕 Chain прогрес approvers у TG
- 🆕 Дублювати пост на платформу
- 🆕 @mention з push у TG DM
- 🆕 SLA reminders -10 хв + перевірка +10 хв

### HQ UX
- 🆕 Per-platform date/time
- 🆕 Per-platform preview tabs
- 🆕 Char counter, кольорові точки платформ
- 🆕 Bulk tag/move у Бібліотеці
- 🆕 IG feed 3×3 preview
- 🆕 Theme toggle (темна/світла)
- 🆕 PWA install у topbar
- 🆕 Звуки ding/send

### Tasks v3
- 🆕 Tasks app `/tasks/`
- 🆕 TG/Email нотифікації, comments, subtasks, recurring
- 🆕 Universal header (brand-book + team + tasks + hq)

### Brand Book
- 🆕 ~25 розділів, Brand Post Generator, Voice Linter, Color Checker
- 🆕 Component Storybook
- 🆕 Sidebar search v6 — full-text по вмісту
- 🆕 PDF print без чорного фону (для Давида)

### Infrastructure
- 🆕 Cowork → TG bridge через GitHub Action
- 🆕 Event-driven dispatcher
- 🆕 Stuck-task detector
- 🆕 Vacation mode UI

---

## Як оновлювати цей файл

1. Кожна нова фіча / fix / deploy — додати рядок у поточну дату
2. Якщо це NEW день — створити новий `## YYYY-MM-DD` блок зверху
3. Групувати під підзаголовки систем (`### HQ`, `### Tasks`, etc)
4. Емодзі обов'язково для категорізації (🆕 / 🔧 / 🛡 / ⚡ / 🚀 / 📖 / 🗑)
5. Якщо є посилання на сторінку онбордингу — додати `[посилання](audit.html)`

**Це джерело правди для команди.** Хочеш знати що нового — почни тут.
