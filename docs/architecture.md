# DreamCar Team Hub — architecture memory

Не опис коду (код і так видно). Тільки те, чого з коду не видно: хто джерело правди, хто що перезаписує, звідки насправді стартують регулярні процеси, де логи.

## Sources of truth

| Дані | Джерело правди | НЕ редагувати в | Примітка |
|---|---|---|---|
| Публікації, задачі, розсилки, запуски, креативи, Каса | Supabase `wotghlaehnvxyeacznvv` (Postgres 17) | у фронтенді немає власного стану — все через PostgREST/RLS | схема в `hq/db/schema.sql`, зміни — тільки міграцією |
| Код фронтенду, воркфлоу, edge-функцій, SQL-міграцій | цей репозиторій, гілка `main` | Supabase Dashboard (правка функції в UI буде затерта наступним деплоєм) | деплой edge — `deploy-edge-functions.yml` |
| Секрети GitHub Actions | GitHub → Settings → Secrets | `.env`, `onboarding/SECRETS.md` (назви там застарілі) | джерело правди — `gh secret list` |
| Секрети Edge Functions | Supabase → Settings → Functions → Secrets | — | набір **не збігається** з GitHub-набором; синхронізують окремі воркфлоу |
| Розклад регулярних процесів | `cron.job` у Supabase **і** `on: schedule` у воркфлоу | `onboarding/CRON_JOBS.md` (знімок від 07.06.2026) | два незалежні канали, див. нижче |
| Люди, ролі, привʼязка Telegram | таблиця `users` (`auth_id`, `telegram_id`) | — | привʼязка робиться через `@dreamcar_team_bot`, не руками |
| Рекламні гроші, кампанії, ставки, ETL Meta/Google | репозиторій `dreamcarua/dreamcar-dashboard` | тут | тут лише органічний автопост і дайджести |
| Бізнес-факти (запуски, маркетинг, стратегія, люди) | хаб `dreamcarua/dreamcar-memory` | тут | факт живе в одному місці |

## What overwrites what

| Поле / ресурс | Пише | Перезаписує | Примітка |
|---|---|---|---|
| `survey.html` | воркфлоу `update-survey` щодня о 07:00 UTC, комітом у `main` | будь-яку ручну правку файлу | правити треба `update_survey.py`, не HTML |
| `?v=` у всіх `index.html` | `auto-cache-bust` після push у фронтенд-каталоги | ручні версії | воркфлоу ігнорує власні коміти `auto cache bust v=` і `[skip ci]` |
| `cowork-notify/*.json` | агент (коміт) | воркфлоу переносить файл у `archive/` і комітить `[skip ci]` | файл у корені каталогу живе хвилини |
| Edge-функції в Supabase | `deploy-edge-functions.yml` з `main` | будь-яку правку через Dashboard | тому правки в UI не роби |
| `TG_BOT_TOKEN` в Edge env | крок `Sync bot token` у `deploy-edge-functions.yml` | значення, виставлене руками в Dashboard | після ротації токена достатньо оновити GitHub secret і задеплоїти |
| `META_USER_TOKEN`, `META_FB_PAGE_TOKEN`, `META_THREADS_TOKEN` | `meta-token-refresh` раз на місяць — і в GitHub secrets, і в Edge env | ручні значення | потребує `GH_PAT_SECRETS`, якого зараз немає |
| `creatives.compressed_url`, `status`, `width_px/height_px/duration_sec`, `is_hdr` | воркер `compress-creative` | значення, виставлені клієнтським стисненням | клієнт і сервер мають один ліміт 2000px по більшій стороні |
| `publications.status` | `tg-webhook` (кнопки), `tg-post-send` (після успішного посту → `published`) | ручні статуси в UI | SMM більше не позначає «опубліковано» руками |

## Trigger channels — усе, що запускає кожен регулярний процес

Головне правило репо: **у більшості процесів більше одного каналу запуску.** Перш ніж міняти частоту або вимикати — звір усі три колонки.

| Процес | Канал 1 (GitHub Actions) | Канал 2 (Supabase pg_cron / DB-тригер) | Канал 3 (людина / бот) | Який головний |
|---|---|---|---|---|
| Автопост у Telegram | `tg-autopost.yml` — **крон вимкнено 28.07.2026**, лишився `workflow_dispatch` | `autopost-tg-enqueue` (pg_cron ~кожні 2 хв) → `tg-post-send` | кнопка погодження в TG (`tg-webhook`) | Edge/pg_cron |
| Автопост IG/FB/Threads | `meta-autopost.yml` cron `*/5` | — | — | Actions; зараз спить без `META_*` |
| Стиснення креативів | `compress-creative.yml` cron `*/10` | pg_cron `compress-safety-net-5min` (dispatch у Actions) + DB-тригер `trg_dispatch_compress_on_video` | кнопка в HQ (`app-dispatch-hooks.js`) | Actions, але миттєвість дає DB-тригер |
| Ретеншн-розсилки | — | pg_cron `retention-scheduler-5min` (хвилини `2-57/5`) | «Погодити» в `/retention/` | pg_cron |
| Нагадування і дайджести команди | — | pg_cron: `hq-cron-reminders` `*/15`, `team-tasks-cron-30min`, `team-tasks-notify-worker-10min`, `hq-daily-digest`, `hq-daily-personal-digest`, `tg-daily-task-scan-0900kyiv` | `/today`, `/queue`, `/my` у боті | pg_cron |
| Дайджести IG і Meta Ads | `ig-digest.yml` і `meta-digest.yml` cron `0 6 * * *` | — | `workflow_dispatch` | Actions |
| Статистика TG-постів | `tg-stats-mtproto.yml` cron `7 * * * *` | — | — | Actions |
| Вартовий Каси | `kasa-stale-watchdog.yml` cron `0 8 * * *` | RPC `kasa_stale_accounts` у базі | — | Actions |
| Вартовий SMM-контенту | перенесено з Actions у Edge `smm-content-watchdog` (27.08.2026) | pg_cron | — | Edge |
| Оновлення опитування | `update-survey.yml` cron `0 7 * * *` | — | — | Actions |
| Оновлення матвʼю дашборду | — | pg_cron `mv-*` (5/15/60 хв, зі зсувом по хвилинах, щоб не збігались) | ручний `REFRESH MATERIALIZED VIEW CONCURRENTLY` | pg_cron |
| Публікація сайту | GitHub Pages `pages-build-deployment` на кожен push у `main` | — | — | Pages |

## Ownership

| Ресурс | Власник | Хто ще змінює | Що агенту можна |
|---|---|---|---|
| Репозиторій `dreamcar-team` | Вадим | боти (`survey: auto-update`, `cowork-notify-bot`, `auto cache bust`) кілька разів на день | коміт у гілку; `main` — через мерж власником |
| Supabase проєкт | Вадим (owner) | агенти через `SUPABASE_ACCESS_TOKEN` | міграція файлом + `apply-migration`; DROP і `cron.unschedule` — тільки з явним OK |
| `@dreamcar_team_bot` | Вадим (BotFather) | — | слати повідомлення; змінювати вебхук — воркфлоу `fix-tg-webhook` |
| Бот учасників (публічний) | Вадим | — | нічого без відмашки: за ним 30–40 тис. людей |
| Домени `*.dreamcar.ua` | Вадим (Cloudflare) | — | тільки purge кешу через `auto-cache-bust` |
| Квота GitHub Actions | спільна на весь акаунт (~20 паралельних слотів) | інші проєкти Вадима (`abrisart-dashboards`, `sneco`) | не додавати частих кронів без підрахунку хвилин |

## Data boundaries

| Канал | Видимість | Може нести | Не має нести |
|---|---|---|---|
| Репозиторій (весь, включно з `docs/`) | публічний інтернет, `team.dreamcar.ua` | код, назви секретів, документація | значення секретів, chat id, хости, IP, PII учасників і команди |
| DM `@dreamcar_team_bot` | Вадим і привʼязані члени команди | звіти, алерти, погодження | масові тексти на базу |
| `cowork-notify/*.json` → TG | Вадим | короткі нотифікації | великі дампи, персональні дані |
| Публічний бот учасників | 30–40 тис. людей | тільки погоджений Вадимом текст | будь-що без відмашки; слова «розіграш», «лотерея», «квиток», «шанс» |
| `anon` ключ у `*/config.js` | публічний за дизайном | читання під RLS | нічого зайвого — RLS має бути перевірена |

## Logs — де саме сідає кожен тип падіння

| Джерело | Де дивитись | Що там є | Чого там НЕ буде |
|---|---|---|---|
| GitHub Actions | `gh run list -R dreamcarua/dreamcar-team`, `gh run view <id> --log-failed` | увесь stdout кроків, `::error::` | причини всередині Edge — тільки код відповіді |
| Edge Functions | Supabase MCP `get_logs(service="edge-function")` або Dashboard → Logs | stack trace, `ERROR`-рядки | те, що впало ДО виклику функції (крон не стартував) |
| pg_cron | `cron.job_run_details` (`status`, `return_message`, `start_time`) | факт запуску і результат | тіло HTTP-відповіді |
| HTTP із бази | `net._http_response` | статуси й затримки викликів edge із крону | — |
| Telegram | `getWebhookInfo` → `last_error_message`, `pending_update_count` | чому TG не зміг доставити апдейт | те, що бот отримав, але не обробив |
| Сайт | DevTools Console/Network | `SyntaxError`, 404 на `global-header.js`, зависла сесія | серверних помилок немає — це статика |

## Fallback paths

| Дія | Основний шлях | Запасний | Коли знадобився |
|---|---|---|---|
| Деплой edge-функції | push у `hq/supabase/functions/**` | `gh workflow run deploy-edge-functions.yml -f function_name=<fn>`; далі Supabase MCP | коли push зачепив кілька функцій одразу |
| SQL на проді | `apply-migration.yml` | Supabase MCP `apply_migration` | 14.08.2026, коли способу застосувати міграцію взагалі не було |
| Автопост TG | Edge + pg_cron | `gh workflow run tg-autopost.yml` (legacy-воркер черги) | після переносу 28.07.2026 |
| Нотифікація Вадиму | `cowork-notify/*.json` | звіт у `reports/*.json`; крайній випадок — DM боту | 01.09.2026, коли HTML-парсинг валив повідомлення |
| Доставка звіту | `report-to-telegram.yml` | якщо `TG_CHAT_ID` вказує не туди — `/start@dreamcar_team_bot` у потрібному чаті + `gh secret set TG_CHAT_ID --body` | — |
| Стиснення відео | воркер у Actions | клієнтське стиснення в браузері (`app-client-compress.js`) | коли черга стоїть |
