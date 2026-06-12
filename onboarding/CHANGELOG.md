# DreamCar Team Hub — Changelog

> **🔴 ОБОВ'ЯЗКОВЕ ПРАВИЛО:** Кожна нова фіча / зміна архітектури / новий cron / нова Edge Function / нова сторінка — фіксується тут разом з датою. Без винятків.
>
> Формат: `## DD.MM.YYYY` → `### Система` → `- 🆕 / 🔧 / 🛡 / ⚡ / 🚀 опис + посилання`
>
> Емодзі: 🆕 нова фіча · 🔧 fix/refactor · 🛡 security · ⚡ performance · 🚀 deploy · 📖 docs · 🗑 deprecated

---

## 12.06.2026 — #345 BIG нова система СКЛАД (Inventory)

### Inventory (#345 BIG)
- 🆕 **Нова система** `team.dreamcar.ua/inventory/` — облік мерчу та матеріальних цінностей DreamCar (футболки, наклейки, аксесуари, призи у майбутньому).
- 🆕 **DB schema** (migration `inventory_phase1_schema_rls_rpc`):
  - `inventory_items` (id, name, category enum (apparel/print/sticker/accessory/other), notes, photo_url, archived, created_by, timestamps)
  - `inventory_variants` (id, item_id, label, attrs jsonb size/color, sku, low_stock_threshold, archived) + UNIQUE (item_id, label)
  - `inventory_movements` (id, variant_id, type enum intake/release/writeoff/adjust, qty CHECK >0, reason, reference_url, performed_by, performed_at)
  - VIEW `inventory_variant_qty` — SUM по типу (intake +, release/writeoff −) дає поточний залишок
  - 6 FK indexes + low-stock fast filter
- 🆕 **3 RPCs SECURITY DEFINER**:
  - `inventory_move(variant_id, type, qty, reason, ref)` — atomic intake/release/writeoff + спеціальний `adjust_to` (обчислює delta до target qty). Перевірка `current_user_has_role(ceo/coo/lead)` всередині, insufficient-stock guard для release/writeoff. GRANT EXECUTE TO authenticated.
  - `inventory_list_items(include_archived)` — items + nested variants jsonb + total_qty + any_low boolean. authenticated only.
  - `inventory_list_movements(limit)` — журнал з JOIN на users.name для відображення виконавця. authenticated only.
- 🆕 **RLS**:
  - SELECT (всі 3 таблиці): TO authenticated → завжди true (читання всім team).
  - INSERT/UPDATE/DELETE на items+variants: `current_user_has_role(['ceo','coo','lead'])`.
  - `inventory_movements` — write **тільки через RPC** (немає policy на INSERT/UPDATE/DELETE).
- 🆕 **Frontend** (`inventory/index.html` + `inventory/app-inventory.js`):
  - SSO bridge `#sso=base64(json)` + dc-shared-storage cookie + login gate + global header (HARD RULE).
  - 3 views:
    - **📦 Склад** — card-grid товарів з варіантами + кількістю badge (амбер коли low). Per-variant action buttons: `+` intake, `−` release, `±` adjust, `✎` edit variant.
    - **📒 Рух** — таблиця останніх 200 операцій з фільтром по типу та виконавця. Дати у форматі Europe/Kyiv (HARD RULE #330).
    - **📊 Аналітика** — KPI cards (всього на складі, позицій, з низьким залишком, =0), топ-10 видаваних за 30 днів.
  - Sidebar фільтри: Низький залишок · Архів · 5 категорій.
  - Modals (всі через **inline onclick + global window fn** — HARD RULE memory `feedback_inline_onclick_for_critical_buttons`):
    - Прийняти/Видати/Списати/Коригувати (з reason + reference_url)
    - Новий товар + редагування
    - Новий варіант + редагування (розмір/колір/SKU/threshold)
  - Toast feedback + rollback на помилки.
- 🆕 **Seed**: Товар «Футболка DreamCar» з 4 варіантами S/M/L/XL чорна, threshold=3 кожен.
- 🆕 **Інтеграція**:
  - `info.html`: новий tile 📦 СКЛАД (з NEW badge) між RETENTION і ONBOARDING у tools grid; новий info-card блок СКЛАД у grid КОМАНДА І ОНОВЛЕННЯ.
  - `brand.dreamcar.ua/assets/global-header.js`: новий LINK `inventory` (СКЛАД) між RETENTION і ONBOARDING. Active matcher на `/inventory/`.
- 🛡 **Захист**:
  - REVOKE EXECUTE FROM PUBLIC на всіх 3 RPCs.
  - `qty CHECK > 0` на movement.
  - SECURITY DEFINER fn `SET search_path = public, pg_temp` (захист shadow-attack).
- 📖 Commits: `8998b1e` (frontend create) + `b264d4d` (global-header.js у brand-book) + `d80af36` (info.html update).
- 📖 **Vadym Q&A фіксовано**: доступ = CEO/COO + Heads рух / інші read · 1 склад · поки тільки мерч (призи пізніше) · видача знеособлено з вільним текстом причини.

---

## 12.06.2026 — #344 P0 Tasks onboarding кнопки «Знаю» — silent exit fix

### Tasks (#344 P0)
- 🔧 **`tasks/index.html`** line 750: після `createClient()` додав `window.supabase = supabase;`. Раніше клієнт жив тільки у module scope — `app-onboarding.js` чекав на `window.supabase` (line 325 `if (!me || !window.supabase) return;`) → silent exit → кнопки кроків онбордингу візуально клікались, але крок не зберігався у DB. Симптом скаржився Vadym: `/tasks/#onboarding` → клік «✓ Знаю 4 статуси» → нічого не відбувалось.
- 🔧 **`tasks/app-onboarding.js`** `markStep()`:
  - Конкретні `console.warn` (`state.publicUser not ready` / `window.supabase missing`) — без silent exit
  - Перевіряємо `error` від UPDATE на `users.onboarding_steps` — якщо є → `console.error` + `window.toast(error.message)` (якщо toast є) + rollback optimistic-stored (`delete stored[key]`)
  - catch робить те саме для thrown промісів
- 📖 Commit `988c4ee`. Cache bust автомат через GH Action Cloudflare purge.

---

## 11.06.2026 — AUDIT (Phases 1-7 DONE, autonomous session)

### Security (Phase 1+2)
- 🛡 REVOKE anon SELECT з `v_dashboard_webhook_health` (ETL stats leak closed)
- 🛡 SET search_path на 11 функцій (shadow-attack protection)
- 🛡 Public buckets LIST policy → TO authenticated (anon більше не може `.list()` всі URLs)
- 🔧 Видалив dead code на team.dreamcar.ua/index.html (старий Supabase oekoamtgbsklbmqyydzj HTTP 000)

### Performance (Phase 3)
- ⚡ 13 нових FK indexes (DELETE/UPDATE на parent швидші)
- 🗑 1 duplicate index dropped (idx_dashboard_ads_data_date_start)
- ⚡ 4 RLS policies wrap auth.uid() → (SELECT auth.uid()) — InitPlan caching

### Reliability (Phase 4)
- 🔧 r2-sign-upload top-level try/catch (unhandled crash → 500 response)
- ✓ 0× 5xx errors у Edge fn logs за 3h ✓

### Data Integrity (Phase 6)
- ✓ 0 orphan records (9 relations checked)
- ✓ 0 TZ-naked timestamps
- ✓ 0 critical NULL у users/publications/retention_messages

### UX/A11y (Phase 7)
- 🆕 Global :focus-visible CSS у `brand.dreamcar.ua/assets/global-header.js` (червоний outline для keyboard nav)

### Артефакти
- AUDIT_LOG.md, AUDIT_BACKLOG.md, AUDIT_SUMMARY.md у `dreamcar-team/` root

## 10.06.2026 (вечір) — #322+#323+#324+#325 (4 задачі одним пушем)

### SMM (#322 P0)
- 🔧 tg-post-send v14: чіткі коди помилок 401
- 🔧 hq/app-views.js (test button): auto refreshSession + retry один раз якщо 401

### SMM (#323 P0)
- 🔧 AI/Template modal z-index 300 → 2000

### team.dreamcar.ua (#324)
- 🔧 orgchart-full.html: «КАРТА ВЛАДИ» → «ЗОНИ ВІДПОВІДАЛЬНОСТІ», прибрав Артем escalation note, повернув IT-відділ Head of TECH

### SMM (#325)
- 🗑 /hq/#launches видалено з UI (replace → /projects/)

---

(легша історія опущена — повна у git log та попередній CHANGELOG версії перед #345)
