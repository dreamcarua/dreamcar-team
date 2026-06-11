# DreamCar Audit — Backlog of Found Issues

> Items requiring human decision or risky to auto-fix during current session.

## P0 — Critical (data leak / broken functionality)

_(none — Phase 1 found no active P0 leaks)_

## P1 — High (security hole inactive / perf > 2s)

### P1.1 SECURITY DEFINER views (2)

- `public.projects` (view над `launches` з count publications) — definer postgres → bypass RLS на launches.
- `public.v_dashboard_webhook_health` (24h webhook stats) — definer postgres → bypass RLS на dashboard_webhooks. Anon grant вже прибрано (#audit Phase 1), але view все ще DEFINER.
- **Suggested fix:** ALTER VIEW … SET (security_invoker = true). Перед deploy — перевірити що:
  1. RLS на `launches` дозволяє SELECT для всіх потрібних ролей (anon/authenticated).
  2. RLS на `dashboard_webhooks` дозволяє SELECT для authenticated (бо anon вже revoked from view).
- **Risk:** якщо invoker RLS не пропускає → дашборд може показувати порожньо. Потрібен smoke test.

### P1.2 SECURITY DEFINER функції — масивний surface

- 53 fn executable for anon, 63 для authenticated. Деякі необхідні (utility math, getters), деякі надмірні.
- **Suggested approach:** окремий sprint:
  1. Generate report `SELECT proname, prosecdef, proacl` для всіх SECDEF.
  2. Для кожної — чи треба anon/authenticated?
  3. REVOKE EXECUTE FROM PUBLIC, GRANT EXECUTE TO точкові ролі.
- **Estimated effort:** 4-6 годин ручної ревізії.

## P2 — Medium / Cosmetic

### P2.1 Materialized views у public API

- `public.mv_dashboard_projects_stats`, `public.mv_upsell_daily` — selectable за advisor (хоча у grants currently немає anon).
- **Fix:** перенести у приватну схему (`_internal`) + wrap RPC SECURITY INVOKER, або REVOKE від public default.

### P2.2 Leaked password protection (auth.config)

- HaveIBeenPwned check вимкнено.
- Низький пріоритет: DreamCar = closed system, admin створює юзерів через CEO RPC, password-based auth не використовується (TG OAuth).
- **Fix (optional):** через Supabase Dashboard → Auth → Settings.

### P2.3 Decision needed

Перед Phase 2-10 — варто протестувати фронт `dashboard.dreamcar.ua/v_dashboard_webhook_health` consumer (якщо є) щоб переконатись що anon-revoke не зламав читання. Поточна довга сесія не дає 100% впевненості у smoke test.

## Phase 5 — Frontend Bloat (cleanup candidates)

### P2 — 12 orphan JS файлів у `hq/` (2512 рядків dead code)

Не loading через `app-tg-login.js` loader chain, не linked у `index.html`. Зберегти у git history достатньо. Перевірити кожен перед DROP (може бути beta-feature на pause):

| File | Lines | Suggested action |
|---|---|---|
| `app-projects.js` | 481 | Phase 2 migrated to `/projects/` — safe DELETE |
| `app-aleksandr-fixes.js` | 289 | personal patches, ймовірно merged — review git log |
| `app-compress-admin.js` | 277 | check чи admin compress flow ще доступний |
| `app-board-view.js` | 224 | duplicate of board logic in app-views.js? |
| `app-next-action.js` | 207 | next-action feature replaced? |
| `app-work-status-extras.js` | 195 | extras, low risk |
| `app-compress-preview.js` | 192 | merge into compress flow? |
| `app-orphan-drafts-fix.js` | 178 | one-off fix, likely safe |
| `app-bulk-upload.js` | 159 | check if bulk upload still used |
| `app-tg-bind-banner.js` | 114 | TG-bind UX moved? |
| `app-dispatch-hooks.js` | 112 | unused dispatch hooks |
| `app-hq-flatpickr.js` | 84 | replaced by native datetime input |

### P3 — 99 `console.log/debug` у `hq/`

Не урезаємо: цей debug-noise зараз корисний для production debug-ing (видно у browser DevTools при support тікетах). Залишити для нової P3 сесії.

### P3 — 46 alert/confirm calls

Багато з них у catch blocks — legit error UX. Окремий sprint UX migration на toast/modal.

### Notes

- Severity scale per AUDIT_PROMPT_10H.md
- 3 migrations applied у Phase 1 — всі логуються у Supabase migrations table.
- Frontend code НЕ зачеплено у Phase 1 (тільки БД).
