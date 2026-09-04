# DreamCar Team Hub — open tasks

Updated: 03.09.2026
Tracker: `team_tasks` у Supabase (сторінка `team.dreamcar.ua/tasks/`). Цей файл тримає лише те, чого в трекері немає: знахідки агента, техборг репо, передане-і-чекає, заблоковане.

🔴 ламає прод · 🟡 незавершений хвіст · ⚪ у черзі · ⏸ чекає рішення людини

## 🔴 Ламає продакшн

- _(нічого; останні 20 ранів воркфлоу — зелені, станом на 03.09.2026 22:15 CEST)_

## 🟡 Хвости — почато, не завершено

- **Злити гілку `memory-v8`** — памʼять агента (`AGENTS.md`, `CLAUDE.md`, `docs/*`, `reports/`, `report-to-telegram.yml`) лежить у гілці, бо репо публічне і в нього кілька разів на день комітять боти. Наступний крок: Вадим дивиться diff і зливає в `main`. Доки не злито — воркфлоу звітів не спрацює, бо тригериться на push у `main`.
- **Meta-автопост так і не увімкнено** — `SETUP_TODAY.md` (28.05.2026), крок 4: «Додати **7 secrets** у GitHub Actions `dreamcarua/dreamcar-team`: `META_APP_ID`, `META_APP_SECRET`, `META_FB_PAGE_TOKEN`, `META_FB_PAGE_ID`, `META_IG_USER_ID`, `META_THREADS_USER_ID`, `META_THREADS_TOKEN`». Станом на 03.09.2026 жодного з них у репо немає; `meta-autopost` і `meta-token-refresh` щоразу тихо виходять. Наступний крок: Вадим проходить `docs/META_AUTOPOST_SETUP.md` і ставить 7 секретів; далі перевірка — `gh workflow run meta-autopost.yml` і публікація з платформою `ig`.
- **`GH_PAT_SECRETS` відсутній** — без нього `meta-token-refresh` не зможе переписати оновлені Meta-токени назад у GitHub secrets (крок `Persist → GH secrets` падає з `::error::`). Наступний крок: Вадим створює PAT зі scope на secrets і ставить `gh secret set GH_PAT_SECRETS -R dreamcarua/dreamcar-team --body "<pat>"`.
- **`tg-stats-mtproto` без секретів MTProto** — воркфлоу ходить щогодини й використовує `TG_API_ID`, `TG_API_HASH`, `TG_SESSION_STRING`, яких у репо немає. Наступний крок: або поставити три секрети (сесію генерує `etl/generate_session.py`), або вимкнути крон, щоб не палити хвилини.
- **Ретеншн-бродкаст на повну базу (14 043)** — `onboarding/BACKLOG_2026-08.md`, Горизонт 0.1: «дати відмашку, токен публічного бота, змапити сегментацію SendPulse (tariff/user_status → зараз фільтри дають 0)». Наступний крок: Вадим дає відмашку; агент перевіряє, що `PUBLIC_BOT_TOKEN` доїхав у Edge env (`sync-public-bot-token.yml`).
- **Одноразові воркфлоу не прибрані** — `fix-tg-webhook.yml`, `backfill-video-dims.yml`, `setup-heavy-video.yml` самі себе позначають «після успіху файл можна видалити». Наступний крок: перевірити в `gh run list`, що кожен уже відпрацював успішно, і видалити файли одним комітом.

## ⚪ Черга

- **Ревізія `SECURITY DEFINER`** — `AUDIT_BACKLOG.md`, P1.2: «53 fn executable for anon, 63 для authenticated… Estimated effort: 4-6 годин ручної ревізії». `onboarding/BACKLOG_2026-08.md` уточнює: «199 функцій, борг зростає». Наступний крок: згенерувати `SELECT proname, prosecdef, proacl` і рознести на «треба anon / треба authenticated / нікому».
- **2 `SECURITY DEFINER` views** — `AUDIT_BACKLOG.md`, P1.1: `public.projects` і `public.v_dashboard_webhook_health`. «Suggested fix: ALTER VIEW … SET (security_invoker = true)». Наступний крок: перед зміною перевірити RLS на `launches` і `dashboard_webhooks`, інакше дашборд покаже порожньо; потрібен smoke-тест.
- **12 orphan JS у `hq/` (2512 рядків)** — `AUDIT_BACKLOG.md`, Phase 5: перелік із `app-projects.js` (481) до `app-hq-flatpickr.js` (84), «Перевірити кожен перед DROP (може бути beta-feature на pause)». Наступний крок: `git log` по кожному файлу, видаляти лише ті, що не вантажаться через `app-tg-login.js`.
- **Materialized views у public API** — `AUDIT_BACKLOG.md`, P2.1: `mv_dashboard_projects_stats`, `mv_upsell_daily`. Наступний крок: перенести у приватну схему `_internal` + RPC `SECURITY INVOKER`.
- **Meta-автопост Phase 2** — єдиний `TODO` у коді: `.github/scripts/meta-autopost-worker.sh:5` — «Phase 2 (TODO): carousels, videos, Reels, stories». Наступний крок: після увімкнення Phase 1 (див. вище) додати підтримку каруселей і відео.
- **`verify-publication-ig` із заглушкою** — `onboarding/BACKLOG_2026-08.md`, техборг: «підключити `IG_BUSINESS_ACCOUNT_ID` або прибрати manual-заглушку». Наступний крок: рішення — автоверифікація чи ручна; зайве прибрати.
- **28 tombstone Edge Functions** — той самий техборг. Наступний крок: звірити список задеплоєних функцій із каталогами в репо, зайві зняти через `delete-edge-function.yml`.
- **`INCIDENTS.md` не прижився** — «2 записи з червня — або автозапис з аномалій, або прибрати». Наступний крок: рішення Вадима; поки що інциденти фактично осідають у `onboarding/CHANGELOG.md` і в цьому `docs/traps.md`.
- **Застарілі доки репо** — `README.md` і `onboarding/ARCHITECTURE.md` називають CDN «Cloudflare Pages» (насправді GitHub Pages з кореня `main`), `SETUP_TODAY.md` рахує «5 GH workflows / 14 Edge Functions» (реально 20 і ≈65), `onboarding/CRON_JOBS.md` датований 07.06.2026. Наступний крок: переписати три числа й один абзац про CDN, звіривши з `gh api .../pages` і `cron.job`.
- **Chat id у публічному репо** — `onboarding/SECRETS.md` містить дефолтне значення `DCSMM_GROUP_CHAT_ID` прямим числом, а `.github/workflows/kasa-stale-watchdog.yml` — вшитий `anon`-ключ Supabase. Anon-ключ публічний за дизайном, chat id — ні. Наступний крок: прибрати число з доку (лишити назву змінної), значення тримати в Edge secrets.
- **Назви GitHub-секретів у `onboarding/SECRETS.md` неправильні** — там `SUPABASE_PROJECT_ID` і `DREAMCAR_TG_BOT_TOKEN`, у репо `SUPABASE_PROJECT_REF` і `TG_BOT_TOKEN`. Наступний крок: виправити таблицю за `gh secret list` (див. `docs/traps.md`).

## ⏸ Чекає рішення

| Задача | Чому чекає | Чиє рішення | Від якої дати |
|---|---|---|---|
| Мерж `memory-v8` у `main` | публічний репо, треба переглянути diff | Вадим | 03.09.2026 |
| 7 секретів `META_*` + `GH_PAT_SECRETS` | доступ до Meta App і до GitHub PAT є лише у власника | Вадим | 28.05.2026 (з `SETUP_TODAY.md`) |
| Відмашка на розсилку по базі 30–40 тис. | незворотно, б'є по 70–85% виручки | Вадим | 09.08.2026 (з `BACKLOG_2026-08.md`) |
| Хто саме співзасновник — Артем чи Phillip | доки репо суперечать одна одній і вхідному контексту | Вадим | 03.09.2026, деталі в `docs/open-questions.md` |
| `TG_CHAT_ID` — DM Вадима чи група команди | від цього залежить, куди падають усі звіти агента | Вадим | 03.09.2026, деталі в `docs/open-questions.md` |

<!--
Правила (див. AGENTS.md → Entry/Exit):
- Задача записується в момент отримання, дослівно, з іменем автора.
- Кожен рядок — наступна конкретна дія, а не назва проблеми.
- Рядок видаляється, коли підтвердив його автор, а не коли роботу зроблено. Видаляється, а не закреслюється.
- Розділи за терміновістю, не за темою.
- Понад ~80 рядків — сигнал, що незавершене накопичується, а не привід ділити файл.
-->

## Зібрано з HARVEST старих чатів 04.09.2026

- 🟡 **Threads-автопост** — наш бік готовий (застосунок створено, `threads-oauth` у репо, redirect URI виданий). Чекає від Вадима: App ID + App Secret і прийнятий інвайт Threads Tester. Далі: секрети в `app_secrets` → OAuth-лінк → `threads-autopost` (container → publish, текст ≤500) → тижневий cron refresh → інтеграція в ланцюг approve. [waiting for Vadym, 11.08]
- 🟡 **Сторінка `/autosvit/` не показує нові поля** — рендерить sec/frame/vo, але оверлей (`txt`), подача (`how`) і альт-гачки (`video_meta`) ймовірно НЕ відображаються, хоча в картках писалось «повний сценарій на сторінці». Крок: допиляти рендер таблиці сценарію. Вадим про це не знає. [11.08]
- ✅ **Сміттєві `verify_pub_*` крони прибрано 04.09.2026** — їх виявилось 61 (з 75; 14 живих на публікації 05-07.09 не чіпали). Бекап: `public._cron_job_backup_verify_pub_20260904`. Усього джоб у `cron.job`: 161 → 100.
- ⏸ **PR #2 `fix/verify-pub-cron-leak` чекає мерджу власника** — без нього сміття почне накопичуватись знову: `cleanupCronJob()` не викликався на шляху «питання поставлене, чекаємо кнопку». Правило репо: код іде через гілку + мердж власника. [Claude 04.09]
- ⚪ **Джерела `hagerty_media` / `autopian`** дають майже нульовий вихід тріажу — якщо тиждень так, знизити priority. [11.08]
- ⚪ **Comment → DM автоматизація в IG** — «напиши слово в коментарях → авто-DM» на наявній інфрі (scope є), з апрувом як у коментарів. Найбільший невикористаний важіль. [04.09]
- ⚪ **Дзеркалення мови в авто-відповідях** — на російський коментар бот відповів українською; правиться в конфіг-рядку SYS. [04.09]
- ⚪ **Щоденна авто-ескалація Давиду** по публікаціях, що висять на погодженні 48+ год — задача Вадима від 30.06, не почата (потрібен pg_cron job).
- ⚪ **RLS на 5 backup-таблицях** — Supabase security alert, low priority. [30.06]
- ⏸ **#49 Олександр (SMM)** — «посилання на кліп + прибрати повідомлення з групи TG+TT». Чекало його відповіді в SMM-чаті.
- ⏸ **#32 Онбординг: кнопки не реагують** — чекає репро.
