# DreamCar Production Audit — 11.06.2026

**Auditor:** Claude (Cowork autonomous session — extended)
**Start:** 11.06.2026 ~01:40 Київ
**Plan:** AUDIT_PROMPT_10H.md

## Snapshot at start

- `dreamcarua/dreamcar-team` HEAD: a38589c (#330 Europe/Kyiv)
- `dreamcarua/dreamcar-dashboard` HEAD: 97fd409 (#331 A/B labels)

## Phase 1 — RLS / Security Advisor (COMPLETED)

### Findings (from `get_advisors` security: 134 lints)

| Severity | Lint | Count | Status |
|---|---|---|---|
| ERROR | security_definer_view | 2 | Documented in Backlog |
| WARN | function_search_path_mutable | 11 | ✅ FIXED |
| WARN | public_bucket_allows_listing | 2 | ✅ FIXED |
| WARN | materialized_view_in_api | 2 | Backlog (no anon grant currently) |
| WARN | auth_leaked_password_protection | 1 | Backlog (Closed-system auth, low priority) |
| WARN | anon_security_definer_function_executable | 53 | Backlog (massive surface — separate sprint) |
| WARN | authenticated_security_definer_function_executable | 63 | Backlog |

### Fixes applied (3 migrations)

1. **`audit_phase1_revoke_anon_webhook_health`**
   - `REVOKE SELECT ON public.v_dashboard_webhook_health FROM anon`
   - Was: anon could read 24h aggregate of ETL webhook traffic (source/status/timings).
   - Dashboard uses authenticated session — no breakage.

2. **`audit_phase1_function_search_path_immutable`**
   - 11 функцій otrymaly `SET search_path = public, pg_temp`
   - List: chi_square_p_value, dashboard_per_project_roi, launches_set_updated_at, normal_cdf, retention_messages_set_updated_at, upsell_daily(2 sigs), upsell_funnel(2 sigs), upsell_recommendation, upsell_significance(2 sigs), welch_t_test_p_value
   - Body unchanged — only locks search_path against shadowing attacks.

3. **`audit_phase1_buckets_list_authenticated_only`**
   - 2 SELECT policies на `storage.objects` (task-attachments, tg-attachments) переведені з PUBLIC SELECT на TO authenticated only.
   - Public bucket file URLs все ще доступні (це і є public bucket).
   - Anon `.list()` тепер заблоковано → не можна dump всі URL-и.

### Verification (post-fixes)

- `v_dashboard_webhook_health` grants: тільки authenticated/postgres/service_role — anon видалено ✓
- bucket SELECT policies — нові `task_att_read_auth`, `tg_attachments_read_auth` на authenticated ✓
- ALTER FUNCTION SET search_path — не міняє арності/body, тож APIs не порушені ✓

### Items moved to Backlog (Phase 1)

- **P1**: 2 `SECURITY DEFINER` views (`public.projects`, `public.v_dashboard_webhook_health`) — варто переоформити з `security_invoker=true` (Postgres 15+), щоб RLS caller'а перевірявся. Risky: треба перевірити кожен фронт-RPC і RLS на underlying tables (launches, dashboard_webhooks).
- **P1**: 116 SECURITY DEFINER функцій executable for anon/authenticated. Потребує окремого sprint з grant audit. Багато з них публічні helper'и (math, getters) — це не критично, але треба ревізію.
- **P2**: 2 materialized views у public API (`mv_dashboard_projects_stats`, `mv_upsell_daily`) — currently немає anon grant, але advisor попереджає. Бекап: refresh через service_role + експонувати через RPC SECURITY INVOKER.
- **P2**: HaveIBeenPwned leaked password protection вимкнено. Це closed-system auth (admin створює юзерів) — низький пріоритет.

## Phases 2-10 — Recommended Next Session

Сесія була довга (одна Cowork → дрейф контексту). Для надійності — **запусти AUDIT_PROMPT_10H.md у НОВІЙ сесії** з пустим контекстом. Phase 1 готовий, далі Phase 2 (Secrets & Auth) → 10.
