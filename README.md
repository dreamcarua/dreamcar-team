# DreamCar Team Hub

Production система для команди DreamCar (https://dreamcar.ua) — внутрішня платформа управління SMM, retention, tasks, projects, аналітики.

## Live URLs

- 🏢 SMM (HQ): https://team.dreamcar.ua/hq/
- ✉️ Retention: https://team.dreamcar.ua/retention/
- ✅ Tasks: https://team.dreamcar.ua/tasks/
- 📂 Projects: https://team.dreamcar.ua/projects/
- 📊 Dashboard: https://dashboard.dreamcar.ua/
- 🎨 Brand: https://brand.dreamcar.ua/
- 📖 Onboarding: https://team.dreamcar.ua/onboarding/

## Architecture

- **Frontend:** Vanilla JS SPA на GitHub Pages (CNAME → team.dreamcar.ua)
- **Backend:** Supabase (project_id: wotghlaehnvxyeacznvv) — Postgres 17 + 28 Edge Functions + 32+ cron jobs
- **TG bot:** `@dreamcar_team_bot` — повідомлення, approvals, AI task extraction
- **CDN:** Cloudflare Pages

Детальніше: [ARCHITECTURE.md](onboarding/ARCHITECTURE.md)

## Repository structure

- `hq/` — SMM (publications, calendar, approval workflow)
- `retention/` — Email/TG/Push розсилки
- `tasks/` — Team tasks tracker
- `projects/` — Запуски (launches)
- `onboarding/` — Документація для команди + новий developer
- `cowork-notify/` — GH Action bridge → Telegram повідомлення про commits

## Quick start для нового developer

1. Прочитати: [CHANGELOG.md](onboarding/CHANGELOG.md), [ARCHITECTURE.md](onboarding/ARCHITECTURE.md)
2. Налаштувати: [SECRETS.md](onboarding/SECRETS.md) (отримати access до Supabase, GitHub, TG bot)
3. Локальний дев: `python -m http.server 8000` у root → відкрити http://localhost:8000/hq/
4. Деплой: будь-який commit на main → GH Action автоматично deploy edge functions
5. Проблеми: [TROUBLESHOOTING.md](onboarding/TROUBLESHOOTING.md)

## Key docs

- [CHANGELOG.md](onboarding/CHANGELOG.md) — щоденні зміни
- [ARCHITECTURE.md](onboarding/ARCHITECTURE.md) — архітектурна карта
- [SECRETS.md](onboarding/SECRETS.md) — secrets management + rotation
- [GDPR_PRIVACY.md](onboarding/GDPR_PRIVACY.md) — обробка PII
- [CRON_JOBS.md](onboarding/CRON_JOBS.md) — реєстр cron jobs
- [TROUBLESHOOTING.md](onboarding/TROUBLESHOOTING.md) — типові incidents
- [API.md](onboarding/API.md) — Edge functions API
- [ROLLBACK.md](onboarding/ROLLBACK.md) — як відкатити deploy
- [HANDOFF_REPORT.md](onboarding/HANDOFF_REPORT.md) — production readiness снапшот

## Contacts

- CEO: Vadym Gryshyn (vg@abrisart.com)
- Співзасновник DreamCar: Артем

## License

Internal use only. © DreamCar 2025-2026.
