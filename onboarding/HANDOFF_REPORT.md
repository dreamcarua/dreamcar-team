# DreamCar Production Handoff Report

> Дата: 07.06.2026
> Підготовлено: production audit (3 iterations × 4 agents)
> Версія системи: SMM / Retention / Tasks / Projects / Dashboard
> Сompiled by: Senior Engineering Manager handoff pass

---

## Executive Summary

**DreamCar** — платформа де користувачі купують токени ШІ-сервісу, а серед учасників розігруються автомобілі мрії. Розіграно 16 авто з 2019. База 30-40 тис. учасників. Виручка ~$30K/міс при високій маржі. Live проект #17 — BMW X5 Hybrid (фінал 19.04.2026).

**Внутрішня платформа команди** складається з 5 під-систем на одному Supabase проєкті (`dreamcar-hq / wotghlaehnvxyeacznvv`, eu-central-1, Postgres 17.6):

| Система | URL | Призначення |
|---|---|---|
| **SMM** | team.dreamcar.ua/hq/ | Календар публікацій, approval flow, autopost у TG, креативи |
| **Retention** | team.dreamcar.ua/retention/ | Прямі розсилки (Email/TG/Push/SMS/Viber) |
| **Tasks** | team.dreamcar.ua/tasks/ | Командний task tracker з soft-delete + корзина 30 днів |
| **Projects** | team.dreamcar.ua/projects/ | Запуски (BMW X5, IPHONE 17 PRO MAX) — окремо від SMM |
| **Dashboard** | dashboard.dreamcar.ua | Real-time analytics — продажі / FB Ads / Upsell A/B/C |

**Stakeholders:** Vadym Gryshyn (CEO, vg@abrisart.com) · Phillip (co-founder, operations) · Артем (co-founder developer, smth.mario@gmail.com) · Давид (COO) · Олександр (SMM lead) · Олеся / Віра (operational).

---

## Architecture Overview

```
                            ┌────────────────────────┐
                            │  brand.dreamcar.ua     │
                            │  global-header.js      │  ← cross-system UI
                            └────────────────────────┘
                                       │
        ┌──────────┬───────────┬───────┴───────┬───────────┬──────────┐
        │   SMM    │ Retention │     Tasks     │  Projects │ Dashboard│
        │  (hq/)   │(retention/)│   (tasks/)   │(projects/)│   (—)    │
        └────┬─────┴─────┬─────┴───────┬───────┴─────┬─────┴────┬─────┘
             │           │             │             │          │
             ▼           ▼             ▼             ▼          ▼
        ┌────────────────────────────────────────────────────────────┐
        │      Supabase Postgres 17 (wotghlaehnvxyeacznvv)           │
        │  publications · team_tasks · retention_messages · launches │
        │  dashboard_deals · dashboard_ads_data · checkout_events    │
        │  users · user_auth_aliases · *_history · *_approvers       │
        └────────────────────────────────────────────────────────────┘
             │                                            ▲
             ▼                                            │
   ┌─────────────────────┐                      ┌──────────────────┐
   │  28 Edge Functions  │◀── cron (32 active)──│  FB Ads ETL      │
   │  notify-tg / webhook│                      │  GH Actions */15 │
   │  tg-webhook / etc.  │──── DM ───▶ @dreamcar_team_bot (TG)     │
   └─────────────────────┘                      └──────────────────┘
```

**Дані flow:** FB Ads → ETL (`dreamcarua/dreamcar-dashboard`, cron `*/15`) → `dashboard_ads_data`. SendPulse платежі → `webhook-dashboard-sendpulse` edge fn → `dashboard_deals`. Realtime UI через Supabase Realtime (LIVE badge). 7 materialized views (MV refresh кожні 5–60 хв, offset-розкидані).

**TG notify** — універсальна `notify-tg` v27 для 3 entities (`publication`, `retention_message`, `team_task`), DM ВСІМ stakeholders (approvers + responsibles + author, deduped) + group `-1003933841573`.

---

## Що було зроблено сьогодні (06–07.06.2026 audit)

**SMM/Retention/Tasks (вечір 06.06):**
- Universal TG notify v27/v10 — 3 entities, DM всім stakeholders.
- Modal overlap fix (z-index 10000, padding-top 68px) на всіх системах через global-header.js.
- Compact tables у Dashboard + правий align числових заголовків.
- Повернуто кнопку 💾 Зберегти у SMM modal (legacy duplicate видалено).
- Upsell A/B/C перекладено на українську + funnel logic переписана.
- P0: HQ git merge markers у `<head>` (SyntaxError → весь HQ мертвий) — виправлено.
- P0: `retention-scheduler` `verify_jwt: true → false` (cron 401 кожні 5 хв).

**Production Readiness Audit (07.06, 3 ітерації × 4 агенти):**
- 🛡 6 RLS policy fixes (team_tasks UPDATE / checkout_events / retention_message_history / dashboard_* SELECT для member-ролей).
- 🛡 8 SECURITY DEFINER функцій `SET search_path` додано (hijack risk).
- 🛡 `ALLOW_DEMO_FALLBACK: false` у `hq/config.js`.
- 🛡 GitHub branch protection на main для 3 репо.
- 🚀 Cron offset для `*/5` (4 jobs) і `*/15` (3 MV-refreshes) — раніше всі стартували одночасно.
- 🚀 `mv_dashboard_globals` unique index + `REFRESH CONCURRENTLY`.
- 🚀 DROP 3 unused indexes (880KB+).
- 🔧 `cron-reminders` `*/60` → `*/15` (реальні T+10 нагадування).
- 🔧 `publication_approved_to_task` — assignee=responsible (раніше автор).
- 🔧 `track-checkout` v2 `verify_jwt: true → false`.
- 🔧 `tg_processed_updates` idempotency table + cleanup cron.

---

## Production Health Snapshot

| Метрика | Значення |
|---|---|
| **Edge Functions** | **28 active** (всі status=ACTIVE) — notify-tg, tg-webhook, autopost-tg-enqueue, retention-scheduler, webhook-dashboard-sendpulse, track-checkout, verify-publication-ig, тощо |
| **Cron Jobs** | **32 active / 32 total** (100% активних, всі offset-розкидані) |
| **Database Size** | **372 MB** (dreamcar-hq) |
| **Materialized Views** | **7 / 7 populated** (mv_dashboard_globals · cohort_retention · projects_stats · utm_agg · paid_signatures · upsell_daily · upsell_funnel) |
| **401 error rate (24h)** | **14.5%** (23 / 159 у `net._http_response`) — більшість — legacy retention-scheduler виклики до v2 deploy, очікується падіння до <5% за 24h |
| **Supabase region** | eu-central-1 |
| **Postgres version** | 17.6.1.121 (GA) |

---

## Known Issues (P0 / P1 що залишились)

| ID | Severity | Issue | Owner |
|---|---|---|---|
| **A1** | **P0** | `verify-publication-ig` падає з `IG_BUSINESS_ACCOUNT_ID` missing — manual confirmation flow тимчасово enabled, але trigger пише warning у логи. Потрібно або підключити IG Graph API, або повністю прибрати T+3min верифікацію. | Vadym/Артем |
| **A2** | **P0** | 3 publications у статусах `review/approved/published` БЕЗ платформ у `publication_platforms` — `trg_publications_check_platforms` пише warning, але не блокує. Треба або auto-backfill, або enforce platforms required. | SMM/Артем |
| **A3** | **P1** | 401 rate 14.5% за 24h — навіть якщо більшість legacy, потрібен моніторинг + alert у TG (рекомендую `webhook-health-alert` розширити на edge fn 401 patterns). | Vadym |
| **A4** | **P1** | Email канал у Retention — заглушка (SendPulse READ-ONLY rule). Виглядає робочим у UI, але `sent`-статус ставиться з error message. Користувачі плутаються. | Vadym/SMM |
| **A5** | **P1** | `dispatch-workflow` v2 з 24.04 не оновлювалась — compress pipeline залежить, треба audit що GH Actions runner ще приймає cron. | Артем |
| **A6** | **P2** | `cleanup-storage-orphans` / `detect-silent-uploads` v1 з квітня — без monitoring, потрібен перевірка чи cron ще шле туди трафік. | Артем |

---

## Mobile Responsive — Gap

Виявлено в audit iter1 UI/UX:
- 4 системи (SMM/Retention/Tasks/Projects) мають **тільки 900px breakpoint** — нижче layout ламається (sidebar overlap, topbar wrap). **Потрібно: 768px + 480px**.
- **A11y baseline = 0** — нема `aria-label` на icon-only кнопках, нема focus-visible outlines, нема skip-to-content links. WCAG 2.1 AA не пройде.
- **Cross-system design inconsistency** — primary red у SMM `#cc0000`, у Dashboard `#E30613`, у Retention `#d11919`. Глобальні brand-токени з brand.dreamcar.ua/assets/tokens.css не імпортуються консистентно.
- Modal overlay z-index стандартизовано (10000), padding-top 68px — OK, але dropdown z-index ще варіюється (5000–9999).

---

## Documentation Status

- ✅ `onboarding/CHANGELOG.md` — up-to-date (07.06 audit зафіксовано)
- ✅ `onboarding/SECRETS.md` — повний rotation procedure + access matrix
- ✅ `onboarding/GDPR_PRIVACY.md` — right-to-be-forgotten + breach response
- ✅ `onboarding/CRON_JOBS.md` — 32 jobs з offsets + monitoring queries
- ✅ `onboarding/DASHBOARD_DATA_FLOW.md` — 4 source → MV → RPC → UI
- ✅ `onboarding/DASHBOARD_PARITY_AUDIT_2026-06-03.md`
- ❌ `README.md` (root) — **MISSING** — нема quick start для нового developer
- ❌ `ARCHITECTURE.md` — **MISSING** — system-level overview не задокументовано
- ❌ `TROUBLESHOOTING.md` — **MISSING** — згадано у CRON_JOBS.md як TODO
- ❌ `API.md` — **MISSING** — RPC + Edge fn endpoints не задокументовано
- ❌ `GLOSSARY.md` — **MISSING** — терміни (рубрика / запуск / approver / responsible / next-action) не централізовано
- ❌ `INCIDENTS.md` — **MISSING** — згадано у SECRETS.md / GDPR як TODO

---

## Onboarding Plan для нової команди

**Day 1 — Context (read-only):**
1. `onboarding/SECRETS.md` — де живуть токени, rotation policy.
2. `onboarding/GDPR_PRIVACY.md` — обробка PII + right-to-be-forgotten.
3. `onboarding/CRON_JOBS.md` — 32 active jobs, monitoring queries.
4. `onboarding/CHANGELOG.md` — останні 7 днів змін.
5. Прочитати цей HANDOFF_REPORT.md повністю.

**Day 2 — Setup local dev:**
1. Supabase CLI install + `supabase link --project-ref wotghlaehnvxyeacznvv`.
2. GitHub access на `dreamcarua/dreamcar-team`, `dreamcar-dashboard`, `brand-book`.
3. TG bot access — попросити Vadym додати у group `-1003933841573` (test env).
4. Запустити `/onboarding/dashboard.html` локально через `python -m http.server`.

**Day 3 — SMM creation flow end-to-end:**
1. Створити test publication у `hq/` → review → approve → published.
2. Перевірити DM у `@dreamcar_team_bot`.
3. Перевірити autopost у test TG channel `-1003933841573`.
4. Soft-delete → корзина → restore.

**Day 4 — Tasks + Retention:**
1. Створити task з deadline → перевірити T-10/T+10 нагадування.
2. Створити retention message → approve → check `retention-scheduler-5min` log.

**Day 5 — Dashboard + ETL:**
1. Прочитати `DASHBOARD_DATA_FLOW.md`.
2. Запустити FB Ads ETL manual через GH Actions workflow_dispatch.
3. Перевірити LIVE badge + MV refresh у логах.

---

## Contacts

| Role | Name | Contact |
|---|---|---|
| CEO | Vadym Gryshyn | vg@abrisart.com · TG `@dreamcar_vg` |
| Co-founder (operations / finance) | Phillip | — |
| Co-founder / developer | Артем | smth.mario@gmail.com |
| COO | Давид (David Gennadievich) | role=coo, users.id=`aaaaaaa2` |
| SMM lead | Олександр | — |
| Operational | Саша (defo21) · Віра · Олеся | — |
| Bot | `@dreamcar_team_bot` | Group chat `-1003933841573` |

---

## Next 30 Days — Roadmap Recommendations

- [ ] **P0:** Fix `verify-publication-ig` — або підключити IG Graph API (потребує IG_BUSINESS_ACCOUNT_ID), або повністю прибрати auto-verify trigger.
- [ ] **P0:** Backfill platforms для 3 publications + enforce NOT EMPTY check у `trg_publications_check_platforms` (зараз warning, треба зробити blocking для нових pub).
- [ ] **P1:** A11y sprint — aria-labels на ВСІХ icon-only кнопках, focus-visible outlines, WCAG 2.1 AA pass.
- [ ] **P1:** Mobile responsive — додати 768px і 480px breakpoints у SMM/Retention/Tasks/Projects.
- [ ] **P1:** Cross-system design tokens unification — імпорт `brand.dreamcar.ua/assets/tokens.css` як single source of truth для всіх 5 систем.
- [ ] **P1:** Створити `README.md` (root) + `ARCHITECTURE.md` + `TROUBLESHOOTING.md`.
- [ ] **P2:** `API.md` — задокументувати всі RPC + Edge fn endpoints з прикладами.
- [ ] **P2:** `GLOSSARY.md` — рубрика / запуск / approver / responsible / next-action / work_status.
- [ ] **P2:** `INCIDENTS.md` — створити порожній skeleton, заповнювати при кожному incident.
- [ ] **P2:** Email канал у Retention — або реалізувати через SendPulse READ-WRITE (потребує перегляду READ-ONLY rule), або disable у UI з clear messaging.
- [ ] **P2:** Розширити `webhook-health-alert` на загальний edge fn 401/5xx pattern monitoring.

---

> **Це фінальний документ handoff.** Для будь-яких питань — Vadym Gryshyn (vg@abrisart.com). Оновлювати при кожній значній зміні архітектури.
