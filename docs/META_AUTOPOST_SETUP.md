# Meta Autopost Setup Guide (Instagram + Facebook + Threads)

> Покроковий гайд налаштування Meta App для автопостингу. Час: ~45-60 хв.

## 0. Передумови (одноразово)
- DreamCar Facebook Page (existing)
- DreamCar Instagram → переключити на **Business/Creator** (Settings → Account → Switch to Professional)
- IG → Connect to Facebook Page
- DreamCar Threads створений через IG (threads.net → Login через IG)
- Всі звʼязати через Meta Business Manager

## 1. Створення Meta App
1. https://developers.facebook.com/apps/ → **Create App**
2. Use case: **Other** · App type: **Business**
3. Name: `DreamCar Team Hub Autopost` · Email: vg@dreamcar.ua
4. Settings → Basic → запамʼятай **App ID + App Secret**

## 2. Додай продукти
App Dashboard → Add Products:
- **Instagram Graph API**
- **Pages**
- **Threads API** (якщо немає — Settings → Advanced → Manage Threads)

## 3. Permissions (Development mode, без App Review)
- pages_show_list, pages_read_engagement, pages_manage_posts
- instagram_basic, instagram_content_publish
- business_management
- threads_basic, threads_content_publish

## 4. Token generation

### 4.1 Short-lived User Token
https://developers.facebook.com/tools/explorer/ → Get Token → User Access Token з усіма permissions вище → Generate.

### 4.2 Long-lived User Token (60 днів)
```bash
curl -G \
  -d "grant_type=fb_exchange_token" \
  -d "client_id=$META_APP_ID" \
  -d "client_secret=$META_APP_SECRET" \
  -d "fb_exchange_token=$SHORT_TOKEN" \
  https://graph.facebook.com/v20.0/oauth/access_token
```

### 4.3 Page Access Token (без терміну дії)
```bash
curl "https://graph.facebook.com/v20.0/me/accounts?access_token=$LONG_USER_TOKEN"
```
Візьми access_token DreamCar сторінки — **цей не expires**.

### 4.4 IG User ID
```bash
curl "https://graph.facebook.com/v20.0/$PAGE_ID?fields=instagram_business_account&access_token=$PAGE_TOKEN"
```

### 4.5 Threads Token
Окремий OAuth: https://threads.net/oauth/authorize?client_id=$APP_ID&redirect_uri=...&scope=threads_basic,threads_content_publish

## 5. Збережи секрети

### GitHub Actions (dreamcarua/dreamcar-team → Settings → Secrets):
```
META_APP_ID
META_APP_SECRET
META_FB_PAGE_TOKEN      ← без терміну
META_FB_PAGE_ID
META_IG_USER_ID         ← 17841...
META_THREADS_USER_ID
META_THREADS_TOKEN      ← 60 днів
```

### Supabase Edge Function Secrets:
Ті ж самі.

## 6. Перевірочні cURL команди

### Test IG photo:
```bash
RES=$(curl -X POST "https://graph.facebook.com/v20.0/$IG_USER_ID/media" \
  -d "image_url=https://...photo.jpg" \
  -d "caption=Test #dreamcar" \
  -d "access_token=$PAGE_TOKEN")
CID=$(echo $RES | jq -r '.id')
curl -X POST "https://graph.facebook.com/v20.0/$IG_USER_ID/media_publish" \
  -d "creation_id=$CID" -d "access_token=$PAGE_TOKEN"
```

### Test FB post:
```bash
curl -X POST "https://graph.facebook.com/v20.0/$FB_PAGE_ID/feed" \
  -d "message=Test" -d "access_token=$PAGE_TOKEN"
```

### Test Threads:
```bash
RES=$(curl -X POST "https://graph.threads.net/v1.0/$THREADS_USER_ID/threads" \
  -d "media_type=TEXT" -d "text=Test thread" -d "access_token=$THREADS_TOKEN")
CID=$(echo $RES | jq -r '.id')
curl -X POST "https://graph.threads.net/v1.0/$THREADS_USER_ID/threads_publish" \
  -d "creation_id=$CID" -d "access_token=$THREADS_TOKEN"
```

## 7. Auto-refresh tokens ✅ ГОТОВО

Реалізовано як workflow **`.github/workflows/meta-token-refresh.yml`** (cron `0 4 1 * *` — 1-го числа щомісяця, задовго до 60-денної експірації). Обмінює user-token, Threads-token, пере-деривує page-token і **записує назад у GH secrets + Supabase Edge env**.

Edge Function тут не годиться: вона не може переписати власні секрети. Workflow самопропускається, доки Meta-секрети не встановлені.

Потрібні секрети для роботи: `META_APP_ID`, `META_APP_SECRET`, `META_USER_TOKEN` (60-денний long-lived user token з кроку 4.2), опційно `META_FB_PAGE_ID`, `META_THREADS_TOKEN`, а також `GH_PAT_SECRETS` (PAT зі scope `secrets`, щоб переписувати secrets) і `SUPABASE_ACCESS_TOKEN`.

## 8. Що далі (Phase 2 — я роблю)

Як тільки секрети будуть у GH Actions + Supabase:
1. `meta-autopost-worker.sh` (GH Action) — publish по queue WHERE platform IN ('ig','fb','threads') ✅ готово (dark без секретів)
2. Розширення `tg-autopost-worker.sh` — фільтр WHERE platform = 'tg' ✅
3. HQ frontend — per-platform status badges (queued / processing / posted / failed) — ⬜ TODO
4. `meta-token-refresh` ✅ готово (workflow, див. §7)

> ⚠️ **Статом на 10.08.2026 весь Meta-автопост DARK:** секрети `META_*` не встановлені, воркер щоразу soft-skip. Щоб активувати — пройди кроки 1-5 (одноразово, ~45-60 хв) і заповни секрети.

Перший live тест — тестовий пост у DreamCar IG/Threads/FB.

## ⚠️ Важливо
- **НЕ комітити** tokens. Тільки у GH Actions / Supabase Secrets.
- IG/FB у Development mode → пишуть тільки для admin App (тебе) + tester-юзери. Команда → треба App Review (Live mode).
- Rate limits: IG **25 calls/hour/user**, FB 200 calls/hour, Threads **250 posts/24h**.
- App Review for Live mode — submit з відеодемо як ти постиш через app. Зазвичай 1-3 дні на review.
