#!/usr/bin/env bash
# Meta Autopost Worker (Instagram + Facebook + Threads)
# Запускається через GH Action cron. Кожен job → graph.facebook.com / graph.threads.net.
# Phase 1: foundation з простим IG image post + FB feed post + Threads TEXT.
# Phase 2 (TODO): carousels, videos, Reels, stories.

set -e

: "${SUPABASE_URL:?required}"
: "${SERVICE_KEY:?required}"
: "${META_APP_ID:?required}"
: "${META_APP_SECRET:?required}"
: "${META_FB_PAGE_TOKEN:?required (Page Access Token, no expiry)}"
: "${META_FB_PAGE_ID:?required}"
: "${META_IG_USER_ID:?required (Instagram Business Account ID)}"

WORKER_ID="${WORKER_ID:-gh-meta-worker}"
MAX_JOBS="${MAX_JOBS:-3}"

echo "=== Meta Autopost Worker (${WORKER_ID}) ==="

# 1. Claim до 3 jobs для платформ ig/fb/threads
CLAIMED=$(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/claim_autopost_jobs" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"worker_name\":\"$WORKER_ID\",\"max_jobs\":$MAX_JOBS}")

if [ "$(echo "$CLAIMED" | jq 'length')" = "0" ]; then
  echo "Nothing to post."; exit 0
fi

echo "Got jobs: $(echo "$CLAIMED" | jq 'length')"

post_ig_photo() {
  local img_url="$1"; local caption="$2"
  echo "→ IG sendPhoto: $img_url"
  local res
  res=$(curl -sS -X POST "https://graph.facebook.com/v20.0/$META_IG_USER_ID/media" \
    -d "image_url=$img_url" \
    --data-urlencode "caption=$caption" \
    -d "access_token=$META_FB_PAGE_TOKEN")
  local cid
  cid=$(echo "$res" | jq -r '.id // empty')
  [ -z "$cid" ] && { echo "::error::IG container failed: $res"; return 1; }
  # status — IG обробляє container 5-30 сек
  sleep 5
  curl -sS -X POST "https://graph.facebook.com/v20.0/$META_IG_USER_ID/media_publish" \
    -d "creation_id=$cid" -d "access_token=$META_FB_PAGE_TOKEN"
}

post_fb_text() {
  local message="$1"
  echo "→ FB sendFeed"
  curl -sS -X POST "https://graph.facebook.com/v20.0/$META_FB_PAGE_ID/feed" \
    --data-urlencode "message=$message" \
    -d "access_token=$META_FB_PAGE_TOKEN"
}

post_fb_photo() {
  local img_url="$1"; local caption="$2"
  echo "→ FB sendPhoto: $img_url"
  curl -sS -X POST "https://graph.facebook.com/v20.0/$META_FB_PAGE_ID/photos" \
    -d "url=$img_url" \
    --data-urlencode "caption=$caption" \
    -d "access_token=$META_FB_PAGE_TOKEN"
}

post_threads_text() {
  : "${META_THREADS_USER_ID:?}"; : "${META_THREADS_TOKEN:?}"
  local text="$1"
  echo "→ Threads sendTEXT"
  local res
  res=$(curl -sS -X POST "https://graph.threads.net/v1.0/$META_THREADS_USER_ID/threads" \
    -d "media_type=TEXT" --data-urlencode "text=$text" \
    -d "access_token=$META_THREADS_TOKEN")
  local cid
  cid=$(echo "$res" | jq -r '.id // empty')
  [ -z "$cid" ] && { echo "::error::Threads container failed: $res"; return 1; }
  sleep 3
  curl -sS -X POST "https://graph.threads.net/v1.0/$META_THREADS_USER_ID/threads_publish" \
    -d "creation_id=$cid" -d "access_token=$META_THREADS_TOKEN"
}

# 2. Loop по jobs
echo "$CLAIMED" | jq -c '.[]' | while read -r JOB; do
  JOB_ID=$(echo "$JOB" | jq -r '.id')
  PUB_ID=$(echo "$JOB" | jq -r '.publication_id')
  PLATFORM=$(echo "$JOB" | jq -r '.platform // "tg"')

  # Пропускаємо TG (це робить tg-autopost-worker)
  if [ "$PLATFORM" = "tg" ]; then
    echo "Skip job $JOB_ID — TG handled by tg-autopost-worker"
    continue
  fi

  echo ""
  echo "--- Job $JOB_ID | platform=$PLATFORM | pub=$PUB_ID ---"

  # Pull publication details
  PUB=$(curl -sS "$SUPABASE_URL/rest/v1/publications?id=eq.$PUB_ID&select=title,text_body,hashtags" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | jq -c '.[0]')
  TITLE=$(echo "$PUB" | jq -r '.title // ""')
  TEXT=$(echo "$PUB" | jq -r '.text_body // ""')
  HASHTAGS=$(echo "$PUB" | jq -r '.hashtags // []' | jq -r '. | map("#" + .) | join(" ")')
  CAPTION="${TITLE}

${TEXT}

${HASHTAGS}"

  # Перший creative (для photo/video — стиснутий URL)
  FIRST_CREATIVE=$(curl -sS "$SUPABASE_URL/rest/v1/creative_publications?publication_id=eq.$PUB_ID&order=sort_order.asc&limit=1&select=creatives(type,thumbnail_url,compressed_url)" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | jq -c '.[0].creatives')
  CRE_TYPE=$(echo "$FIRST_CREATIVE" | jq -r '.type // ""')
  CRE_URL=$(echo "$FIRST_CREATIVE" | jq -r '.compressed_url // .thumbnail_url // ""')

  set +e
  HTTP_OK=0
  if [ "$PLATFORM" = "ig" ]; then
    if [ "$CRE_TYPE" = "photo" ] && [ -n "$CRE_URL" ]; then
      post_ig_photo "$CRE_URL" "$CAPTION" && HTTP_OK=1
    else
      echo "::warning::IG потребує photo creative — пропускаю"
    fi
  elif [ "$PLATFORM" = "fb" ]; then
    if [ "$CRE_TYPE" = "photo" ] && [ -n "$CRE_URL" ]; then
      post_fb_photo "$CRE_URL" "$CAPTION" && HTTP_OK=1
    else
      post_fb_text "$CAPTION" && HTTP_OK=1
    fi
  elif [ "$PLATFORM" = "threads" ]; then
    post_threads_text "$CAPTION" && HTTP_OK=1
  fi
  set -e

  if [ "$HTTP_OK" = "1" ]; then
    # Mark posted у publications.platform_autopost_status
    curl -sS -X PATCH "$SUPABASE_URL/rest/v1/publications?id=eq.$PUB_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" -H "Prefer: return=minimal" \
      -d "{\"platform_autopost_status\": $(echo "$PUB" | jq --arg p "$PLATFORM" '. + {platform_autopost_status:({} | .[$p]="posted")} | .platform_autopost_status')}"
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_autopost_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"job_id\":\"$JOB_ID\",\"pub_id\":\"$PUB_ID\",\"chat_id\":\"$PLATFORM\",\"msg_id\":0}"
    echo "✓ Posted to $PLATFORM"
  else
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_autopost_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"job_id\":\"$JOB_ID\",\"pub_id\":\"$PUB_ID\",\"err_msg\":\"$PLATFORM api error — check workflow logs\"}"
    echo "✗ Failed $PLATFORM"
  fi
done

echo ""
echo "=== Meta Worker done ==="
