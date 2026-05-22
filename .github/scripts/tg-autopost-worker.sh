#!/bin/bash
# TG Autopost Worker — викликається з .github/workflows/tg-autopost.yml
#
# ГОЛОВНЕ ПРАВИЛО: БЕЗ втрати якості.
#   IN_SIZE < 45MB  → fast remux -c copy        → sendVideo inline (0% втрати)
#   IN_SIZE ≥ 45MB  → one-shot CRF 18           → visually lossless
#       якщо OUT ≤ 49MB  → sendVideo inline      (visually lossless)
#       якщо OUT > 49MB  → sendDocument(input)   (100% якість, не inline)
set -e

NL=$'\n'

if [ -z "$TG_BOT_TOKEN" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "::error::Missing TG_BOT_TOKEN / HQ_DB_URL / HQ_DB_SERVICE_KEY"
  exit 1
fi

echo "Claiming jobs as $WORKER_ID..."
CLAIMED=$(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/claim_autopost_jobs" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"worker_name\":\"$WORKER_ID\",\"max_jobs\":5}")

JOB_COUNT=$(echo "$CLAIMED" | jq 'length')
echo "Got $JOB_COUNT jobs"

if [ "$JOB_COUNT" = "0" ]; then
  echo "Nothing to process."
  exit 0
fi

for i in $(seq 0 $(($JOB_COUNT - 1))); do
  JOB=$(echo "$CLAIMED" | jq -c ".[$i]")
  JOB_ID=$(echo "$JOB" | jq -r '.id')
  PUB_ID=$(echo "$JOB" | jq -r '.publication_id')
  CHAT_ID=$(echo "$JOB" | jq -r '.target_chat_id')

  echo ""
  echo "=== Job $JOB_ID pub $PUB_ID -> chat $CHAT_ID ==="

  PUB=$(curl -sS "$SUPABASE_URL/rest/v1/publications?id=eq.$PUB_ID&select=id,title,text_body,hashtags" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | jq -c '.[0]')

  if [ "$PUB" = "null" ] || [ -z "$PUB" ]; then
    echo "::error::Pub not found"
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_autopost_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"job_id\":\"$JOB_ID\",\"pub_id\":\"$PUB_ID\",\"err_msg\":\"pub not found\"}"
    continue
  fi

  TITLE=$(echo "$PUB" | jq -r '.title // ""')
  TEXT=$(echo "$PUB" | jq -r '.text_body // ""')
  HASHTAGS=$(echo "$PUB" | jq -r '.hashtags | if . then map(if startswith("#") then . else "#" + . end) | join(" ") else "" end')

  CAPTION="${TITLE}${NL}${NL}${TEXT}"
  if [ -n "$HASHTAGS" ]; then
    CAPTION="${CAPTION}${NL}${NL}${HASHTAGS}"
  fi

  CREATIVE=$(curl -sS "$SUPABASE_URL/rest/v1/creative_publications?publication_id=eq.$PUB_ID&order=sort_order.asc&limit=1&select=creative_id,creatives(id,type,thumbnail_url,drive_file_id,name)" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | jq -c '.[0].creatives')

  CRE_TYPE=$(echo "$CREATIVE" | jq -r '.type // ""')
  CRE_URL=$(echo "$CREATIVE" | jq -r '.thumbnail_url // ""')
  echo "Creative type: $CRE_TYPE"

  HTTP=""

  if [ -z "$CRE_TYPE" ] || [ "$CRE_TYPE" = "null" ]; then
    HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" \
      "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" \
      -d "chat_id=$CHAT_ID" \
      --data-urlencode "text=$CAPTION" \
      -d "parse_mode=HTML" -d "disable_web_page_preview=false")
  elif [ "$CRE_TYPE" = "photo" ]; then
    curl -sS -o /tmp/photo.bin -L "$CRE_URL"
    HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" \
      "https://api.telegram.org/bot$TG_BOT_TOKEN/sendPhoto" \
      -F "chat_id=$CHAT_ID" \
      -F "photo=@/tmp/photo.bin" \
      -F "caption=$CAPTION" \
      -F "parse_mode=HTML")
  elif [ "$CRE_TYPE" = "video" ]; then
    curl -sS -o /tmp/input.mp4 -L "$CRE_URL"
    IN_SIZE=$(stat -c%s /tmp/input.mp4)
    IN_MB=$(awk "BEGIN{printf \"%.1f\", $IN_SIZE/1024/1024}")
    echo "Input video: $IN_SIZE bytes (${IN_MB} MB)"

    # Thumbnail для inline preview (з 1-ї секунди)
    ffmpeg -y -v error -i /tmp/input.mp4 -ss 00:00:01 -vframes 1 -vf "scale='min(320,iw)':-2" /tmp/thumb.jpg 2>/dev/null || \
      ffmpeg -y -v error -i /tmp/input.mp4 -vframes 1 -vf "scale='min(320,iw)':-2" /tmp/thumb.jpg

    OUT_SIZE=99999999
    FINAL_FILE=""
    PATH_USED=""

    # ── Path A: input уже маленький → fast remux (нульова втрата)
    if [ "$IN_SIZE" -le $((45 * 1024 * 1024)) ]; then
      echo "[A] Fast remux (-c copy) — input ≤45MB, 0% втрати"
      ffmpeg -y -v error -i /tmp/input.mp4 -c copy -movflags +faststart /tmp/out.mp4 2>&1 || true
      if [ -f /tmp/out.mp4 ]; then
        OUT_SIZE=$(stat -c%s /tmp/out.mp4)
        FINAL_FILE=/tmp/out.mp4
        PATH_USED="A:remux"
      fi
    fi

    # ── Path B: великий вхід → one-shot CRF 18 (visually lossless)
    if [ -z "$FINAL_FILE" ] || [ "$OUT_SIZE" -gt $((49 * 1024 * 1024)) ]; then
      echo "[B] CRF 18 preset slower — visually lossless для >45MB"
      ffmpeg -y -v error -i /tmp/input.mp4 \
        -c:v libx264 -preset slower -crf 18 \
        -vf "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(ih,iw),min(1920,ih),-2)'" \
        -c:a aac -b:a 192k \
        -movflags +faststart -pix_fmt yuv420p /tmp/out.mp4 2>&1 || true
      if [ -f /tmp/out.mp4 ]; then
        OUT_SIZE=$(stat -c%s /tmp/out.mp4)
        OUT_MB=$(awk "BEGIN{printf \"%.1f\", $OUT_SIZE/1024/1024}")
        echo "CRF 18 → $OUT_SIZE bytes (${OUT_MB} MB)"
        if [ "$OUT_SIZE" -le $((49 * 1024 * 1024)) ]; then
          FINAL_FILE=/tmp/out.mp4
          PATH_USED="B:crf18"
        fi
      fi
    fi

    # ffprobe для streaming hints
    PROBE_FILE="${FINAL_FILE:-/tmp/input.mp4}"
    FPROBE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of json "$PROBE_FILE")
    FW=$(echo "$FPROBE" | jq -r '.streams[0].width // 1920')
    FH=$(echo "$FPROBE" | jq -r '.streams[0].height // 1080')
    FD=$(echo "$FPROBE" | jq -r '.streams[0].duration // "0"' | awk '{printf "%.0f", $1}')

    # ── Decision: inline sendVideo або sendDocument fallback
    if [ -n "$FINAL_FILE" ] && [ "$OUT_SIZE" -le $((49 * 1024 * 1024)) ]; then
      echo "→ sendVideo (path=$PATH_USED, ${FW}x${FH}, ${FD}s)"
      HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" --connect-timeout 60 --max-time 600 \
        "https://api.telegram.org/bot$TG_BOT_TOKEN/sendVideo" \
        -F "chat_id=$CHAT_ID" \
        -F "video=@$FINAL_FILE" \
        -F "thumbnail=@/tmp/thumb.jpg" \
        -F "width=$FW" -F "height=$FH" -F "duration=$FD" \
        -F "supports_streaming=true" \
        -F "caption=$CAPTION" -F "parse_mode=HTML")
    else
      # CRF 18 не дав <49MB → НЕ деградуємо. Шлемо як file з оригіналом — 100% якість.
      echo "::warning::CRF 18 still >49MB — sendDocument with ORIGINAL (100% quality, not inline)"
      DOC_CAPTION="${CAPTION}${NL}${NL}📎 Файл (відео завелике для inline-плеєра, повна якість)"
      HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" --connect-timeout 60 --max-time 900 \
        "https://api.telegram.org/bot$TG_BOT_TOKEN/sendDocument" \
        -F "chat_id=$CHAT_ID" \
        -F "document=@/tmp/input.mp4" \
        -F "thumbnail=@/tmp/thumb.jpg" \
        -F "caption=$DOC_CAPTION" \
        -F "parse_mode=HTML")
    fi
  else
    echo "Unknown creative type, text-only fallback"
    HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" \
      "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" \
      -d "chat_id=$CHAT_ID" \
      --data-urlencode "text=$CAPTION" \
      -d "parse_mode=HTML")
  fi

  echo "TG HTTP=$HTTP"

  if [ "$HTTP" = "200" ]; then
    MSG_ID=$(jq -r '.result.message_id' /tmp/tg-resp.json)
    CHAT_OUT=$(jq -r '.result.chat.id' /tmp/tg-resp.json)
    echo "Sent! message_id=$MSG_ID"
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_autopost_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"job_id\":\"$JOB_ID\",\"pub_id\":\"$PUB_ID\",\"chat_id\":\"$CHAT_OUT\",\"msg_id\":$MSG_ID}"
  else
    ERR=$(jq -r '.description // .error // "Unknown"' /tmp/tg-resp.json | head -c 500)
    echo "::error::Fail: $ERR"
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_autopost_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg jid "$JOB_ID" --arg pid "$PUB_ID" --arg err "HTTP $HTTP: $ERR" '{job_id:$jid, pub_id:$pid, err_msg:$err}')"
  fi

  rm -f /tmp/input.mp4 /tmp/out.mp4 /tmp/thumb.jpg /tmp/photo.bin /tmp/tg-resp.json
done

echo ""
echo "=== Processed $JOB_COUNT jobs ==="
