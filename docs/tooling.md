# DreamCar Team Hub — tooling, access, reporting

Читай перед використанням будь-якого інструмента, MCP, воркфлоу, бота, бази чи акаунта цього проєкту.
**Значень секретів тут немає і бути не може** — тільки назви й місце, де вони лежать. Репозиторій публічний.

## Tools and connectors

| Tool / MCP / connector | Для чого | Як зайти | Особливості |
|---|---|---|---|
| GitHub MCP / `gh` CLI | читати й писати цей репо з будь-якого чату | `gh` авторизований на Mac Вадима (scope `workflow`, `admin`); GitHub MCP авторизований у Cowork | пуш через `push_files` — один коміт на одну логічну зміну; у `main` не пушимо (див. AGENTS.md → Overrides) |
| Desktop Commander (Mac Вадима) | shell, `gh`, клон репо, локальні файли | папка має бути підключена в Cowork | кожен виклик — новий shell, `cd` не зберігається; `rm` без дозволу — ні |
| Supabase MCP / Management API | SQL, edge functions, логи | проєкт `wotghlaehnvxyeacznvv` | міграції — файлом у `hq/db/migrations/` + воркфлоу `apply-migration`, а не сирим DDL з чату |
| Telegram Bot API | `@dreamcar_team_bot` | токен у GH secret `TG_BOT_TOKEN` і в Supabase Edge secrets | бекенд бота — не тут, а в edge function `tg-webhook` |
| Meta Graph API v20 | IG / FB / Threads автопост, дайджест реклами | токени у GH secrets `META_*` | станом на 03.09.2026 `META_*` у репо **не заведені** — усі Meta-воркфлоу тихо виходять |
| Cloudflare API | purge кешу після деплою | `CF_API_TOKEN`, `CF_ZONE_ID` у GH secrets | сам сайт роздає GitHub Pages, Cloudflare — DNS + кеш перед ним |
| Anthropic API | AI-дайджести, розбір задач із TG | `ANTHROPIC_API_KEY` у GH secrets і в Edge secrets | модель береться з `vars.ANTHROPIC_MODEL`, дефолт — Haiku |

## Identifiers (not secrets)

| Що | Значення | Де використовується |
|---|---|---|
| Supabase project ref | `wotghlaehnvxyeacznvv` | усі виклики MCP, URL edge-функцій `https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/<fn>` |
| Домен сайту | `team.dreamcar.ua` | GitHub Pages, `CNAME` у корені, source = гілка `main`, шлях `/` |
| Бот команди | `@dreamcar_team_bot` | нотифікації, погодження, DM-дайджести, cowork-notify, kasa-watchdog |
| Публічний бот учасників | токен у GH secret `PUBLIC_BOT_TOKEN` | нативна DM-розсилка на базу (≈14 тис. підписників у `bot_subscribers`) |
| Репозиторій | `dreamcarua/dreamcar-team`, публічний, default branch `main` | — |

## Secrets — де лежать, ніколи не значення

**Джерело правди для назв — тільки два рядки, і нічого більше:**

```
grep -h 'secrets\.' .github/workflows/*.yml | sort -u
gh secret list -R dreamcarua/dreamcar-team
```

Станом на 03.09.2026 у репо заведено 20 секретів (GitHub → Settings → Secrets → Actions):

| Секрет | Для чого | Хто ротує |
|---|---|---|
| `TG_BOT_TOKEN` | `@dreamcar_team_bot` — усі TG-повідомлення з Actions | Вадим (BotFather) |
| `TG_CHAT_ID` | куди боту слати DM/повідомлення з Actions | Вадим |
| `TG_WEBHOOK_SECRET` | перевірка заголовка `X-Telegram-Bot-Api-Secret-Token` у `tg-webhook` | Вадим |
| `PUBLIC_BOT_TOKEN` | бот учасників для нативної DM-розсилки | Вадим |
| `SUPABASE_ACCESS_TOKEN` | деплой edge-функцій, `apply-migration`, `supabase secrets set` | Вадим |
| `SUPABASE_PROJECT_REF` | ref проєкту (дублює константу-фолбек у воркфлоу) | Вадим |
| `HQ_DB_URL`, `HQ_DB_SERVICE_KEY` | PostgREST-доступ воркерів до бази (service role) | Вадим |
| `HQ_CRON_SECRET`, `HQ_WEBHOOK_SECRET` | cross-fn і cron→edge автентифікація | Вадим; ротація через `rotate-hq-secrets.yml` |
| `ANTHROPIC_API_KEY` | AI-дайджести | Вадим |
| `CF_API_TOKEN`, `CF_ZONE_ID` | purge кешу Cloudflare | Вадим |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_PUBLIC_BASE` | сховище стиснутих відео-креативів | Вадим |
| `SENDPULSE_API_ID`, `SENDPULSE_API_SECRET` | READ-ONLY синк підписників | Вадим |

Згадуються у воркфлоу, але **у репо відсутні** (тому ці воркфлоу тихо виходять або впадуть):
`META_APP_ID`, `META_APP_SECRET`, `META_USER_TOKEN`, `META_FB_PAGE_ID`, `META_FB_PAGE_TOKEN`, `META_IG_USER_ID`, `META_THREADS_TOKEN`, `META_THREADS_USER_ID`, `GH_PAT_SECRETS`, `TG_API_ID`, `TG_API_HASH`, `TG_SESSION_STRING`.

Secrets Supabase Edge (окремий набір, не той самий, що GitHub): Dashboard → Project → Settings → Functions → Secrets. Перелік і призначення — `onboarding/SECRETS.md` (обережно: назви GitHub-секретів там застарілі, див. `docs/traps.md`).

Ставити секрет — **завжди з `--body`**, бо інтерактивний `gh secret set` чекає вставки й Enter записує порожній секрет:

```
gh secret set <NAME> -R dreamcarua/dreamcar-team --body "<значення>"
```

## GitHub Actions — 20 воркфлоу: що робить, чим керується, як запустити руками

Ручний запуск скрізь однаковий: `gh workflow run <файл> -R dreamcarua/dreamcar-team [-f key=value]`.
Перевірка: `gh run list --workflow=<файл> --limit 3 -R dreamcarua/dreamcar-team`, лог провалу: `gh run view <id> --log-failed`.

| Воркфлоу | Що робить | Чим керується | Ручний запуск |
|---|---|---|---|
| `cowork-tg-notify.yml` | міст Cowork → Telegram: читає новий `cowork-notify/<ts>.json` `{text,type,link}`, шле в TG через `@dreamcar_team_bot`, потім переносить файл у `cowork-notify/archive/` комітом `[skip ci]` | push у `cowork-notify/*.json` на `main` | немає `workflow_dispatch` — тригериться лише комітом файлу |
| `report-to-telegram.yml` | звіти агента: новий `reports/*.json` → повідомлення в TG (plain text) | push у `reports/*.json` на `main` | комітом файлу звіту |
| `update-survey.yml` | оновлює дані опитування в `survey.html` і комітить, якщо змінились | cron `0 7 * * *` (09:00 CEST) | `gh workflow run update-survey.yml` |
| `ig-digest.yml` | AI-дайджест Instagram-органіки → таблиця `dashboard_ig_ai_daily` + DM Вадиму | cron `0 6 * * *` (09:00 Kyiv) | `gh workflow run ig-digest.yml` |
| `meta-digest.yml` | щоденний дайджест Meta Ads у TG (`scripts/meta_digest.py`) | cron `0 6 * * *` | `gh workflow run meta-digest.yml` |
| `meta-autopost.yml` | постить схвалені креативи в IG/FB/Threads через Graph API (`.github/scripts/meta-autopost-worker.sh`) | cron `*/5 * * * *`; **самопропуск, якщо немає `META_APP_ID`/`META_FB_PAGE_TOKEN`** | `gh workflow run meta-autopost.yml` |
| `meta-token-refresh.yml` | обмінює 60-денні Meta-токени на свіжі й записує їх назад у GH secrets (`GH_PAT_SECRETS`) та в Edge env | cron `0 4 1 * *`; самопропуск, доки Meta не налаштована | `gh workflow run meta-token-refresh.yml` |
| `tg-autopost.yml` | legacy-воркер черги `tg_autopost_queue` | **тільки `workflow_dispatch`** — 28.07.2026 крон вимкнено, автопост іде з Edge (`autopost-tg-enqueue` → `tg-post-send`, pg_cron кожні 2 хв) | `gh workflow run tg-autopost.yml` |
| `tg-stats-mtproto.yml` | тягне views/reactions/forwards постів через MTProto (Bot API таких метрик не дає) | cron `7 * * * *` (було `*/30`, знижено 24.08 заради хвилин) | `gh workflow run tg-stats-mtproto.yml` |
| `compress-creative.yml` | стискає відео-креативи (CRF 18), заливає в R2, оновлює `creatives.compressed_url` + `status='ready'` | cron `*/10 * * * *`; перед важким `apt-get` робить дешевий `peek_compress_jobs` і виходить, якщо черга порожня | `gh workflow run compress-creative.yml` |
| `backfill-video-dims.yml` | одноразовий backfill `width_px/height_px/duration_sec` для вже стиснутих відео | `workflow_dispatch` | `gh workflow run backfill-video-dims.yml -f limit=500` |
| `setup-heavy-video.yml` | заливає тестове важке відео в чергу | `workflow_dispatch` | `gh workflow run setup-heavy-video.yml` |
| `auto-cache-bust.yml` | бампає `?v=` у всіх `index.html` на git SHA і робить purge кешу Cloudflare | push у `hq/**`, `tasks/**`, `projects/**`, `retention/**`, `dashboard/**`, `brand-book/**`, `_headers`; ігнорує власні коміти `auto cache bust v=` і `[skip ci]` | `gh workflow run auto-cache-bust.yml` |
| `deploy-edge-functions.yml` | деплоїть Supabase Edge Functions; спершу синкає `TG_BOT_TOKEN` в Edge env; збирає функцію у staging-каталог разом із `_shared` | push у `hq/supabase/functions/**` або `tasks/supabase/functions/**` | `gh workflow run deploy-edge-functions.yml -f function_name=tg-webhook` (або `all`) |
| `delete-edge-function.yml` | знімає Edge Function через Management API; вимагає повторити slug у полі `confirm` | `workflow_dispatch` | `gh workflow run delete-edge-function.yml -f slug=X -f confirm=X` |
| `apply-migration.yml` | ганяє довільний `.sql` через Supabase Management API; fail-closed на будь-що крім 2xx; є `dry_run` | `workflow_dispatch` | `gh workflow run apply-migration.yml -f file=hq/db/migrations/029_x.sql -f dry_run=true` |
| `rotate-hq-secrets.yml` | заливає нові `HQ_CRON_SECRET` / `HQ_WEBHOOK_SECRET` у Edge env (4 ключі: `HQ_CRON_SECRET`, `DC_CRON_SECRET`, `HQ_WEBHOOK_SECRET`, `HQ_SECRET`) | `workflow_dispatch` | спершу `gh secret set ... --body`, потім `gh workflow run rotate-hq-secrets.yml` |
| `sync-public-bot-token.yml` | кладе `PUBLIC_BOT_TOKEN` у Edge env і перевіряє його через `getMe` | `workflow_dispatch` | `gh workflow run sync-public-bot-token.yml` |
| `sync-sendpulse-creds.yml` | кладе SendPulse API-креди у Edge env і перевіряє oauth | `workflow_dispatch` | `gh workflow run sync-sendpulse-creds.yml` |
| `fix-tg-webhook.yml` | одноразовий ремонт: синкає `TG_WEBHOOK_SECRET` у Edge env і робить `setWebhook` на `tg-webhook` з `drop_pending_updates` | `workflow_dispatch` | `gh workflow run fix-tg-webhook.yml` |
| `kasa-stale-watchdog.yml` | щоденний вартовий Каси: RPC `kasa_stale_accounts` (баланс живий, транзакцій 3+ дні немає → синк банку впав) → DM Вадиму | cron `0 8 * * *` | `gh workflow run kasa-stale-watchdog.yml` |

## `@dreamcar_team_bot` і його бекенд

Бекенд бота — **не в цьому репо як сервер, а як Supabase Edge Functions** у `hq/supabase/functions/`:

- `tg-webhook` — єдина точка входу вебхука Telegram. Команди (`/start`, `/me`, `/today`, `/queue`, `/approve`, `/late`, `/my`), кнопки погодження публікацій (`callback_data` формату `appr:<pub_id>`), гілка `av:` для чернеток «Автосвіту», файли, голосові (Whisper), AI-асистент у DM. Перевіряє заголовок `X-Telegram-Bot-Api-Secret-Token` проти `TG_WEBHOOK_SECRET`.
- `notify-tg` — фанаут DM/групових повідомлень (авторизація заголовком `x-hq-secret`).
- `tg-post-send`, `autopost-tg-enqueue`, `retention-tg-autopost` — автопост у канали.
- `tg-say` — написати команді в TG напряму (є режим видалення власного повідомлення `?delete=<msg_id>`).
- `tg-task-extract`, `tg-daily-task-scan`, `tg-ai-router` — витяг задач із чатів через Claude.
- `tg-login-verify` — вхід у HQ через Telegram Login Widget.

Перевірити стан вебхука: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` — має бути URL `https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-webhook` і `pending_update_count: 0`. Полагодити — воркфлоу `fix-tg-webhook.yml` (не руками, щоб секрет не потрапив у історію shell).

## Міст `cowork-notify` — як ним користуються всі репо DreamCar

Односторонній канал «агент → Telegram Вадиму». Працює так:

1. Агент комітить у `main` файл `cowork-notify/<YYYY-MM-DD-HHMM>-<slug>.json`:
   ```json
   { "text": "текст із <b>HTML</b>", "type": "info|deploy|task|warn|error|question", "link": "https://…" }
   ```
2. `cowork-tg-notify.yml` ловить push, шле повідомлення через `@dreamcar_team_bot` (`parse_mode=HTML`, при помилці парсингу — fallback у plain text) і **переносить файл** у `cowork-notify/archive/` комітом `chore: archive cowork-notify files [skip ci]`.
3. `type` визначає емодзі; `link` рендериться як «🔗 Відкрити».

Інші репозиторії DreamCar шлють свої повідомлення **через цей самий каталог у цьому репо** (комітом сюди), бо міст і токен живуть тут. Для звітів агента є окремий, структурований канал — `reports/` (нижче).

## Supabase

- Project ref `wotghlaehnvxyeacznvv`, Postgres 17, регіон eu-central. Edge-функції: `hq/supabase/functions/**` (≈65 каталогів, серед них великий блок `kasa-*`) і `tasks/supabase/functions/**`; є ще окремий `supabase/functions/notify-tg/`.
- SQL: `hq/db/schema.sql`, `rls.sql`, `triggers.sql`, `seed.sql` і пронумеровані `hq/db/migrations/0NN_*.sql` (останні застосовані — 026 аварійний throttle ETL, 027 відкат, 028 watchdog на Edge).
- Реєстр pg_cron — `onboarding/CRON_JOBS.md` (оновлений 07.06.2026, звіряй із `SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;`).
- Провали крону: `SELECT j.jobname, d.status, d.return_message FROM cron.job_run_details d JOIN cron.job j USING (jobid) WHERE d.status != 'succeeded' AND d.start_time > NOW() - INTERVAL '7 days';`
- Логи edge-функцій — Supabase MCP `get_logs(service="edge-function")` або Dashboard → Logs.

## Meta API

- Graph API v20 для FB Page + IG Business + Threads. Токен користувача живе 60 днів, токен сторінки — безстроковий, але привʼязаний до токена користувача; `meta-token-refresh.yml` раз на місяць обмінює обидва і Threads-токен та записує назад у GH secrets і Edge env.
- Аудиторії, кампанії, ставки й гроші живуть **не тут**, а в `dreamcarua/dreamcar-dashboard` (воркфлоу `meta-scale`, `kill-all-ads`, `delete-ads`, `launch-*`). Тут — лише органічний автопост і дайджести.

## Entry patterns — як тут реально роблять кожну повторювану дію

| Дія | Кроки | Запасний шлях |
|---|---|---|
| Задеплоїти edge-функцію | коміт у `hq/supabase/functions/<name>/` → `deploy-edge-functions.yml` сам деплоїть | `gh workflow run deploy-edge-functions.yml -f function_name=<name>`; крайній випадок — Supabase MCP `deploy_edge_function` |
| Виконати SQL на проді | файл у `hq/db/migrations/0NN_*.sql` → `gh workflow run apply-migration.yml -f file=<шлях> -f dry_run=true`, подивитись SQL, потім без `dry_run` | Supabase MCP `apply_migration` |
| Видалити edge-функцію | `gh workflow run delete-edge-function.yml -f slug=<s> -f confirm=<s>` | Supabase Dashboard (незворотно) |
| Змінити фронтенд | коміт у `hq/`, `tasks/`, `projects/`, `retention/` → GitHub Pages деплоїть з `main`, `auto-cache-bust.yml` бампає `?v=` і чистить кеш Cloudflare | якщо стара версія тримається у браузері — `gh workflow run auto-cache-bust.yml` |
| Написати Вадиму з агента | коміт `cowork-notify/<ts>.json` | звіт у `reports/*.json` (структурований) |
| Прозвітувати про виконану задачу | коміт `reports/YYYY-MM-DD-HHMM-<slug>.json` | див. Reporting нижче |
| Додати або оновити секрет | `gh secret set <NAME> -R dreamcarua/dreamcar-team --body "<val>"`, далі відповідний sync-воркфлоу, якщо секрет потрібен і в Edge | Supabase Dashboard → Functions → Secrets |
| Дізнатись chat id | у потрібному чаті `/start@dreamcar_team_bot`; якщо бот не відповідає id — `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"` | id бота ≠ id чату; id групи від'ємний |
| Подивитись, чи щось зламалось | `gh run list -R dreamcarua/dreamcar-team --limit 20`; далі `onboarding/TROUBLESHOOTING.md` (15 розібраних інцидентів із SQL і curl) | Supabase logs, `cron.job_run_details` |

## Reporting

Механізм: коміт JSON-файлу `reports/YYYY-MM-DD-HHMM-<slug>.json` у `main` → `.github/workflows/report-to-telegram.yml` шле його в Telegram через `@dreamcar_team_bot`. Секрети — `TG_BOT_TOKEN` і `TG_CHAT_ID` (обидва вже є в репо). Формат — `reports/README.md`, простий текст без розмітки (воркфлоу нічого не екранує).
Коли: на Exit кожної задачі, що змінила стан проєкту. Не для питань, читання, оцінок.
Перевірка доставки: `gh run list --workflow=report-to-telegram.yml --limit 1 -R dreamcarua/dreamcar-team` → `success`.
Отримувач — чат, id якого лежить у `TG_CHAT_ID`. Щоб перенести звіти в групу: надіслати `/start@dreamcar_team_bot` у тій групі й перезаписати `TG_CHAT_ID` від'ємним id групи.
Канал живий із 03.09.2026: перший звіт `reports/2026-09-03-2215-memory-installed.json` доставлено (ран 33802356745, `success`, 11 с).
Увага: воркфлоу тригериться на `push` у гілку `main`. Доки гілка `memory-v8` не злита, новий звіт із гілки не піде — клади його в `main` після мержу.

## Access limits — чого агент свідомо не робить

| Дія | Хто робить | Чому не агент |
|---|---|---|
| Змінювати видимість репозиторію | Вадим | миттєво перемикає Actions із безкоштовних на платні і водночас відкриває/закриває всі файли |
| Розсилка на базу учасників (30–40 тис.) | Вадим дає відмашку | незворотно, б'є по 70–85% виручки |
| Будь-які гроші й рекламний бюджет | Вадим | завжди |
| Ротація ключа у зовнішньому сервісі (BotFather, Meta, SendPulse, Supabase) | Вадим | агент не бачить наслідків для інших систем |
| `delete-edge-function`, `cron.unschedule` | Вадим або з явним OK | незворотно, тихо ламає процес, який ніхто не помітить кілька днів |
