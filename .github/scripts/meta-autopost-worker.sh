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
  sleep 5
  curl -sS -X POST "https://graph.facebook.com/v20.0/$META_IG_USER_ID/media_publish" \
    -d "creation_id=$cid" -d "access_token=$META_FB_PAGE_TOKEN"
}

# Phase 2: IG Carousel (2-10 photo/video items)
post_ig_carousel() {
  local caption="$1"; shift
  local urls=("$@")
  echo "→ IG sendCarousel ${#urls[@]} items"
  local children=()
  for u in "${urls[@]}"; do
    local is_video="false"
    [[ "$u" =~ \.(mp4|mov)$ ]] && is_video="true"
    local field_url="image_url"
    [ "$is_video" = "true" ] && field_url="video_url"
    local r
    r=$(curl -sS -X POST "https://graph.facebook.com/v20.0/$META_IG_USER_ID/media" \
      -d "is_carousel_item=true" \
      -d "$field_url=$u" \
      $([ "$is_video" = "true" ] && echo "-d media_type=VIDEO") \
      -d "access_token=$META_FB_PAGE_TOKEN")
    local cid
    cid=$(echo "$r" | jq -r '.id // empty')
    [ -z "$cid" ] && { echo "::warning::Carousel child failed: $r"; continue; }
    children+=("$cid")
  done
  [ ${#children[@]} -lt 2 ] && { echo "::error::Carousel <2 children — abort"; return 1; }
  # Чекаємо обробку всіх (video особливо)
  sleep 8
  local children_csv
  children_csv=$(IFS=,; echo "${children[*]}")
  local parent
  parent=$(curl -sS -X POST "https://graph.facebook.com/v20.0/$META_IG_USER_ID/media" \
    -d "media_type=CAROUSEL" \
    -d "children=$children_csv" \
    --data-urlencode "caption=$caption" \
    -d "access_token=$META_FB_PAGE_TOKEN")
  local pid
  pid=$(echo "$parent" | jq -r '.id // empty')
  [ -z "$pid" ] && { echo "::error::Carousel parent failed: $parent"; return 1; }
  sleep 5
  curl -sS -X POST "https://graph.facebook.com/v20.0/$META_IG_USER_ID/media_publish" \
    -d "creation_id=$pid" -d "access_token=$META_FB_PAGE_TOKEN"
}

# IG Reels (vertical video)
post_ig_reel() {
  local video_url="$1"; local caption="$2"
  echo "→ IG sendReel: $video_url"
  local res
  res=$(curl -sS -X POST "https://graph.facebook.com/v20.0/$META_IG_USER_ID/media" \
    -d "media_type=REELS" \
    -d "video_url=$video_url" \
    --data-urlencode "caption=$caption" \
    -d "share_to_feed=true" \
    -d "access_token=$META_FB_PAGE_TOKEN")
  local cid
  cid=$(echo "$res" | jq -r '.id // empty')
  [ -z "$cid" ] && { echo "::error::IG Reel container failed: $res"; return 1; }
  # Reels потребує більше часу на обробку
  sleep 15
  curl -sS -X POST "https://graph.facebook.com/v20.0/$META_IG_USER_ID/media_publish" \
    -d "creation_id=$cid" -d "access_token=$META_FB_PAGE_TOKEN"
}

# FB Album (multiple photos в одному пості)
post_fb_album() {
  local caption="$1"; shift
  local urls=("$@")
  echo "→ FB sendAlbum ${#urls[@]} photos"
  # Upload кожне фото як unpublished
  local attached=()
  for u in "${urls[@]}"; do
    local r
    r=$(curl -sS -X POST "https://graph.facebook.com/v20.0/$META_FB_PAGE_ID/photos" \
      -d "url=$u" -d "published=false" -d "access_token=$META_FB_PAGE_TOKEN")
    local pid
    pid=$(echo "$r" | jq -r '.id // empty')
    [ -n "$pid" ] && attached+=("media_fbid=$pid")
  done
  [ ${#attached[@]} -lt 2 ] && { echo "::error::Album <2 photos — abort"; return 1; }
  # Збираємо у feed-post
  local form_args=()
  for i in "${!attached[@]}"; do
    form_args+=("-d" "attached_media[$i]={\"${attached[$i]}\"}")
  done
  curl -sS -X POST "https://graph.facebook.com/v20.0/$META_FB_PAGE_ID/feed" \
    --data-urlencode "message=$caption" \
    "${form_args[@]}" \
    -d "access_token=$META_FB_PAGE_TOKEN"
}

# Threads Carousel (2-10 items)
post_threads_carousel() {
  local caption="$1"; shift
  local urls=("$@")
  echo "→ Threads sendCarousel ${#urls[@]} items"
  : "${META_THREADS_USER_ID:?}"; : "${META_THREADS_TOKEN:?}"
  local children=()
  for u in "${urls[@]}"; do
    local is_video="false"
    [[ "$u" =~ \.(mp4|mov)$ ]] && is_video="true"
    local mt="IMAGE"
    [ "$is_video" = "true" ] && mt="VIDEO"
    local field="image_url"
    [ "$is_video" = "true" ] && field="video_url"
    local r
    r=$(curl -sS -X POST "https://graph.threads.net/v1.0/$META_THREADS_USER_ID/threads" \
      -d "is_carousel_item=true" \
      -d "media_type=$mt" \
      -d "$field=$u" \
      -d "access_token=$META_THREADS_TOKEN")
    local cid
    cid=$(echo "$r" | jq -r '.id // empty')
    [ -n "$cid" ] && children+=("$cid")
  done
  [ ${#children[@]} -lt 2 ] && return 1
  sleep 5
  local children_csv
  children_csv=$(IFS=,; echo "${children[*]}")
  local parent
  parent=$(curl -sS -X POST "https://graph.threads.net/v1.0/$META_THREADS_USER_ID/threads" \
    -d "media_type=CAROUSEL" \
    -d "children=$children_csv" \
    --data-urlencode "text=$caption" \
    -d "access_token=$META_THREADS_TOKEN")
  local pid
  pid=$(echo "$parent" | jq -r '.id // empty')
  [ -z "$pid" ] && return 1
  sleep 3
  curl -sS -X POST "https://graph.threads.net/v1.0/$META_THREADS_USER_ID/threads_publish" \
    -d "creation_id=$pid" -d "access_token=$META_THREADS_TOKEN"
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

  # ВСІ creatives (для media group / carousel)
  ALL_CREATIVES=$(curl -sS "$SUPABASE_URL/rest/v1/creative_publications?publication_id=eq.$PUB_ID&order=sort_order.asc&select=creatives(type,thumbnail_url,compressed_url)" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | jq -c '[.[] | .creatives]')
  CRE_COUNT=$(echo "$ALL_CREATIVES" | jq 'length')
  CRE_URLS=()
  TYPES=()
  while IFS= read -r CR; do
    URL=$(echo "$CR" | jq -r '.compressed_url // .thumbnail_url // ""')
    TYPE=$(echo "$CR" | jq -r '.type // ""')
    [ -n "$URL" ] && CRE_URLS+=("$URL") && TYPES+=("$TYPE")
  done < <(echo "$ALL_CREATIVES" | jq -c '.[]')
  FIRST_TYPE="${TYPES[0]:-}"
  FIRST_URL="${CRE_URLS[0]:-}"
  echo "Platform=$PLATFORM | $CRE_COUNT creatives | first=$FIRST_TYPE"

  set +e
  HTTP_OK=0
  if [ "$PLATFORM" = "ig" ]; then
    if [ ${#CRE_URLS[@]} -ge 2 ]; then
      post_ig_carousel "$CAPTION" "${CRE_URLS[@]}" && HTTP_OK=1
    elif [ "$FIRST_TYPE" = "video" ] && [ -n "$FIRST_URL" ]; then
      post_ig_reel "$FIRST_URL" "$CAPTION" && HTTP_OK=1
    elif [ "$FIRST_TYPE" = "photo" ] && [ -n "$FIRST_URL" ]; then
      post_ig_photo "$FIRST_URL" "$CAPTION" && HTTP_OK=1
    else
      echo "::warning::IG потребує photo/video creative — пропускаю"
    fi
  elif [ "$PLATFORM" = "fb" ]; then
    if [ ${#CRE_URLS[@]} -ge 2 ] && [ "$FIRST_TYPE" = "photo" ]; then
      post_fb_album "$CAPTION" "${CRE_URLS[@]}" && HTTP_OK=1
    elif [ "$FIRST_TYPE" = "photo" ] && [ -n "$FIRST_URL" ]; then
      post_fb_photo "$FIRST_URL" "$CAPTION" && HTTP_OK=1
    else
      post_fb_text "$CAPTION" && HTTP_OK=1
    fi
  elif [ "$PLATFORM" = "threads" ]; then
    if [ ${#CRE_URLS[@]} -ge 2 ]; then
      post_threads_carousel "$CAPTION" "${CRE_URLS[@]}" && HTTP_OK=1
    else
      post_threads_text "$CAPTION" && HTTP_OK=1
    fi
  fi
  set -e

  if [ "$HTTP_OK" = "1" ]; then
    # Atomic JSONB merge через RPC (зберігає інші платформи)
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/mark_platform_autopost" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"p_pub_id\":\"$PUB_ID\",\"p_platform\":\"$PLATFORM\",\"p_status\":\"posted\"}"
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_autopost_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"job_id\":\"$JOB_ID\",\"pub_id\":\"$PUB_ID\",\"chat_id\":\"$PLATFORM\",\"msg_id\":0}"
    echo "✓ Posted to $PLATFORM"
  else
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/mark_platform_autopost" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"p_pub_id\":\"$PUB_ID\",\"p_platform\":\"$PLATFORM\",\"p_status\":\"failed\"}"
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_autopost_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"job_id\":\"$JOB_ID\",\"pub_id\":\"$PUB_ID\",\"err_msg\":\"$PLATFORM api error — check workflow logs\"}"
    echo "✗ Failed $PLATFORM"
  fi
done

echo ""
echo "=== Meta Worker done ==="
