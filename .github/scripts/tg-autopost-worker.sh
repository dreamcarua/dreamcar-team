#!/bin/bash
# TG Autopost Worker — викликається з .github/workflows/tg-autopost.yml
#
# Flow:
#   1. claim_autopost_jobs (тільки publish_at <= now, attempts < 3)
#   2. compressed_status='ready' → беремо compressed_url (або HEVC якщо PREFER_HEVC=1)
#   3. compressed_status='pending'|'processing' → defer publish_at +3min, attempts=0
#   4. compressed_status='n/a'|'failed' → fallback ffmpeg path
#
# ENV optional:
#   PREFER_HEVC=1  — використовувати compressed_url_hevc якщо є
set -euo pipefail

NL=$'\n'
PREFER_HEVC="${PREFER_HEVC:-0}"

JOB_ID_GLOBAL=""
PUB_ID_GLOBAL=""
on_error() {
  local exit_code=$?
  local line_no=$1
  if [ -n "$JOB_ID_GLOBAL" ]; then
    echo "::error::Worker died on line $line_no (exit=$exit_code). Failing job $JOB_ID_GLOBAL"
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_autopost_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg jid "$JOB_ID_GLOBAL" --arg pid "$PUB_ID_GLOBAL" --arg err "Worker line $line_no exit $exit_code" '{job_id:$jid, pub_id:$pid, err_msg:$err}')" || true
  fi
  exit $exit_code
}
trap 'on_error $LINENO' ERR

if [ -z "$TG_BOT_TOKEN" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "::error::Missing TG_BOT_TOKEN / HQ_DB_URL / HQ_DB_SERVICE_KEY"
  exit 1
fi

echo "Claiming jobs as ${WORKER_ID:-unknown}..."
CLAIMED=$(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/claim_autopost_jobs" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"worker_name\":\"${WORKER_ID:-gh}\",\"max_jobs\":5}")

CLAIMED_TYPE=$(echo "$CLAIMED" | jq -r 'type')
if [ "$CLAIMED_TYPE" != "array" ]; then
  echo "::error::claim_autopost_jobs returned non-array: $CLAIMED"
  exit 1
fi
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
  JOB_ID_GLOBAL="$JOB_ID"
  PUB_ID_GLOBAL="$PUB_ID"

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

  # Запит ВСІХ creatives publication у правильному порядку (для media group)
  CREATIVES_JSON=$(curl -sS "$SUPABASE_URL/rest/v1/creative_publications?publication_id=eq.$PUB_ID&order=sort_order.asc&select=creative_id,creatives(id,type,thumbnail_url,compressed_url,compressed_url_hevc,compressed_status,compressed_size_bytes,compressed_hevc_size_bytes,drive_file_id,name)" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | jq -c '[.[] | .creatives]')
  CRE_COUNT=$(echo "$CREATIVES_JSON" | jq 'length')
  echo "Creatives count: $CRE_COUNT"

  # Перший creative — для legacy single-media branch
  CREATIVE=$(echo "$CREATIVES_JSON" | jq -c '.[0] // null')
  CRE_TYPE=$(echo "$CREATIVE"        | jq -r '.type // ""')
  CRE_URL=$(echo "$CREATIVE"         | jq -r '.thumbnail_url // ""')
  CRE_H264_URL=$(echo "$CREATIVE"    | jq -r '.compressed_url // ""')
  CRE_HEVC_URL=$(echo "$CREATIVE"    | jq -r '.compressed_url_hevc // ""')
  CRE_COMPRESSED_STATUS=$(echo "$CREATIVE" | jq -r '.compressed_status // "n/a"')
  CRE_COMPRESSED_SIZE=$(echo "$CREATIVE"  | jq -r '.compressed_size_bytes // 0')
  CRE_HEVC_SIZE=$(echo "$CREATIVE"   | jq -r '.compressed_hevc_size_bytes // 0')
  echo "First creative: type=$CRE_TYPE | compressed=$CRE_COMPRESSED_STATUS (h264=$CRE_COMPRESSED_SIZE, hevc=$CRE_HEVC_SIZE)"

  # Якщо є відео що ще стискається у будь-якому creative — defer
  ANY_VIDEO_PENDING=$(echo "$CREATIVES_JSON" | jq -r '[.[] | select(.type=="video" and (.compressed_status=="pending" or .compressed_status=="processing"))] | length')
  if [ "$ANY_VIDEO_PENDING" -gt 0 ]; then
    echo "::warning::Some video creative still compressing — defer +3min"
    curl -sS -X PATCH "$SUPABASE_URL/rest/v1/publications?id=eq.$PUB_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" -H "Prefer: return=minimal" \
      -d '{"publish_at": "'"$(date -u -d '+3 minutes' '+%Y-%m-%dT%H:%M:%S.000Z')"'"}'
    curl -sS -X PATCH "$SUPABASE_URL/rest/v1/tg_autopost_queue?id=eq.$JOB_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" -H "Prefer: return=minimal" \
      -d '{"status":"pending","claimed_at":null,"attempts":0,"last_error":"deferred for compress"}'
    JOB_ID_GLOBAL=""; PUB_ID_GLOBAL=""
    continue
  fi

  # ──── MEDIA GROUP (2-10 креативів) ────
  if [ "$CRE_COUNT" -gt 1 ] && [ "$CRE_COUNT" -le 10 ]; then
    echo "→ sendMediaGroup with $CRE_COUNT items"
    MEDIA_JSON="["
    ATTACH_ARGS=()
    IDX=0
    while IFS= read -r CR; do
      [ -z "$CR" ] && continue
      C_TYPE=$(echo "$CR" | jq -r '.type // "photo"')
      C_THUMB=$(echo "$CR" | jq -r '.thumbnail_url // ""')
      C_H264=$(echo "$CR" | jq -r '.compressed_url // ""')
      C_HEVC=$(echo "$CR" | jq -r '.compressed_url_hevc // ""')
      C_STATUS=$(echo "$CR" | jq -r '.compressed_status // "n/a"')
      # Вибір URL: video — compressed; photo — thumbnail_url
      ITEM_URL=""
      if [ "$C_TYPE" = "video" ]; then
        if [ "$PREFER_HEVC" = "1" ] && [ -n "$C_HEVC" ]; then ITEM_URL="$C_HEVC"
        elif [ "$C_STATUS" = "ready" ] && [ -n "$C_H264" ]; then ITEM_URL="$C_H264"
        else ITEM_URL="$C_THUMB"; fi
      else
        ITEM_URL="$C_THUMB"
      fi
      [ -z "$ITEM_URL" ] && { echo "Skip item $IDX: no URL"; IDX=$((IDX+1)); continue; }
      curl -sS -o "/tmp/mg_$IDX.bin" -L "$ITEM_URL"
      ITEM_SIZE=$(stat -c%s "/tmp/mg_$IDX.bin" 2>/dev/null || echo 0)
      echo "  [$IDX] type=$C_TYPE size=$ITEM_SIZE → /tmp/mg_$IDX.bin"
      MEDIA_TYPE="photo"; [ "$C_TYPE" = "video" ] && MEDIA_TYPE="video"
      if [ $IDX -eq 0 ]; then
        MEDIA_JSON="${MEDIA_JSON}{\"type\":\"$MEDIA_TYPE\",\"media\":\"attach://item$IDX\",\"caption\":$(echo "$CAPTION" | jq -Rs .),\"parse_mode\":\"HTML\"}"
      else
        MEDIA_JSON="${MEDIA_JSON},{\"type\":\"$MEDIA_TYPE\",\"media\":\"attach://item$IDX\"}"
      fi
      ATTACH_ARGS+=("-F" "item$IDX=@/tmp/mg_$IDX.bin")
      IDX=$((IDX+1))
    done < <(echo "$CREATIVES_JSON" | jq -c '.[]')
    MEDIA_JSON="${MEDIA_JSON}]"

    HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" \
      "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMediaGroup" \
      -F "chat_id=$CHAT_ID" \
      -F "media=$MEDIA_JSON" \
      "${ATTACH_ARGS[@]}")
    rm -f /tmp/mg_*.bin
    # Перейти до перевірки результату — пропустити single-media блок
    GROUP_SENT="yes"
  fi
  : "${GROUP_SENT:=no}"

  HTTP="${HTTP:-}"

  # Якщо вже надіслали як media group — пропустити single-media гілку
  if [ "$GROUP_SENT" = "yes" ]; then
    :  # HTTP вже встановлено sendMediaGroup
  elif [ -z "$CRE_TYPE" ] || [ "$CRE_TYPE" = "null" ]; then
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
    # Вибір URL: HEVC якщо PREFER_HEVC=1 і є; інакше H.264 compressed_url; інакше fallback raw
    USE_URL=""
    NEED_REENCODE="no"
    CODEC_USED="raw"
    if [ "$PREFER_HEVC" = "1" ] && [ -n "$CRE_HEVC_URL" ]; then
      echo "Using HEVC compressed URL ($CRE_HEVC_SIZE bytes)"
      USE_URL="$CRE_HEVC_URL"
      CODEC_USED="hevc"
    elif [ "$CRE_COMPRESSED_STATUS" = "ready" ] && [ -n "$CRE_H264_URL" ]; then
      echo "Using H.264 compressed URL ($CRE_COMPRESSED_SIZE bytes)"
      USE_URL="$CRE_H264_URL"
      CODEC_USED="h264"
    else
      echo "No compressed version available (status=$CRE_COMPRESSED_STATUS) — fallback to raw + ffmpeg"
      USE_URL="$CRE_URL"
      NEED_REENCODE="yes"
    fi

    curl -sS -o /tmp/input.mp4 -L "$USE_URL"
    IN_SIZE=$(stat -c%s /tmp/input.mp4)
    IN_MB=$(awk "BEGIN{printf \"%.1f\", $IN_SIZE/1024/1024}")
    echo "Downloaded: $IN_SIZE bytes (${IN_MB} MB), codec=$CODEC_USED"

    ffmpeg -y -v error -i /tmp/input.mp4 -ss 00:00:01 -vframes 1 -vf "scale='min(320,iw)':-2" /tmp/thumb.jpg 2>/dev/null || \
      ffmpeg -y -v error -i /tmp/input.mp4 -vframes 1 -vf "scale='min(320,iw)':-2" /tmp/thumb.jpg

    OUT_SIZE=$IN_SIZE
    FINAL_FILE=/tmp/input.mp4

    if [ "$NEED_REENCODE" = "yes" ] && [ "$IN_SIZE" -gt $((45 * 1024 * 1024)) ]; then
      echo "[fallback] CRF 18 preset slower — compressed_url не готовий"
      ffmpeg -y -v error -i /tmp/input.mp4 \
        -c:v libx264 -preset slower -crf 18 \
        -vf "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(ih,iw),min(1920,ih),-2)'" \
        -c:a aac -b:a 192k \
        -movflags +faststart -pix_fmt yuv420p /tmp/out.mp4 2>&1 || true
      if [ -f /tmp/out.mp4 ]; then
        OUT_SIZE=$(stat -c%s /tmp/out.mp4)
        FINAL_FILE=/tmp/out.mp4
        echo "Re-encoded: $OUT_SIZE bytes"
      fi
    fi

    FPROBE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of json "$FINAL_FILE")
    FW=$(echo "$FPROBE" | jq -r '.streams[0].width // 1920')
    FH=$(echo "$FPROBE" | jq -r '.streams[0].height // 1080')
    FD=$(echo "$FPROBE" | jq -r '.streams[0].duration // "0"' | awk '{printf "%.0f", $1}')

    if [ "$OUT_SIZE" -le $((49 * 1024 * 1024)) ]; then
      echo "→ sendVideo (${FW}x${FH}, ${FD}s, $OUT_SIZE bytes, codec=$CODEC_USED)"
      HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" --connect-timeout 60 --max-time 600 \
        "https://api.telegram.org/bot$TG_BOT_TOKEN/sendVideo" \
        -F "chat_id=$CHAT_ID" \
        -F "video=@$FINAL_FILE" \
        -F "thumbnail=@/tmp/thumb.jpg" \
        -F "width=$FW" -F "height=$FH" -F "duration=$FD" \
        -F "supports_streaming=true" \
        -F "caption=$CAPTION" -F "parse_mode=HTML")

      # Якщо HEVC викинуло помилку — спробуємо H.264 fallback
      if [ "$HTTP" != "200" ] && [ "$CODEC_USED" = "hevc" ] && [ -n "$CRE_H264_URL" ]; then
        echo "::warning::HEVC failed (HTTP $HTTP), falling back to H.264..."
        curl -sS -o /tmp/input.mp4 -L "$CRE_H264_URL"
        OUT_SIZE=$(stat -c%s /tmp/input.mp4)
        FINAL_FILE=/tmp/input.mp4
        HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" --connect-timeout 60 --max-time 600 \
          "https://api.telegram.org/bot$TG_BOT_TOKEN/sendVideo" \
          -F "chat_id=$CHAT_ID" \
          -F "video=@$FINAL_FILE" \
          -F "thumbnail=@/tmp/thumb.jpg" \
          -F "width=$FW" -F "height=$FH" -F "duration=$FD" \
          -F "supports_streaming=true" \
          -F "caption=$CAPTION" -F "parse_mode=HTML")
      fi
    else
      echo "::warning::Video >49MB — sendDocument fallback"
      DOC_CAPTION="${CAPTION}${NL}${NL}📎 Файл (відео завелике для inline)"
      HTTP=$(curl -sS -o /tmp/tg-resp.json -w "%{http_code}" --connect-timeout 60 --max-time 900 \
        "https://api.telegram.org/bot$TG_BOT_TOKEN/sendDocument" \
        -F "chat_id=$CHAT_ID" \
        -F "document=@$FINAL_FILE" \
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

  JOB_ID_GLOBAL=""
  PUB_ID_GLOBAL=""
  rm -f /tmp/input.mp4 /tmp/out.mp4 /tmp/thumb.jpg /tmp/photo.bin /tmp/tg-resp.json
done

echo ""
echo "=== Processed $JOB_COUNT jobs ==="
