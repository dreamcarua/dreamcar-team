#!/bin/bash
# Compress Creative Worker — TARGET-BITRATE 2-pass H.264 high, max quality ≤49.5MB.
#
# ENV optional:
#   ENABLE_HEVC=1   — додатково створює H.265 варіант, зберігає у compressed_url_hevc
#
# Strategy:
#   1. ffprobe → duration + native resolution
#   2. Budget = 49.5MB → video_kbps = (budget*8/duration) - audio - mux
#   3. Adaptive resolution by bitrate budget (1080p/720p/480p/360p) — ASPECT PRESERVED
#   4. Two-pass H.264 high profile slower + advanced (bframes=8, refs=6, aq-mode=2)
#   5. Audio AAC 96-128 kbps
#   6. Якщо overshoot — retry once з 92% budget
#   7. Якщо ENABLE_HEVC — також H.265 main10 при тому ж budget (краща якість)
#
# Error handling:
#   • set -e + trap → будь-яка помилка викликає fail_compress_job ОДРАЗУ.
#   • Без цього row застрягав у 'processing' назавжди.
set -euo pipefail

TARGET_BUDGET_BYTES=$((49500000))
MUX_OVERHEAD_KBPS=50
MIN_AUDIO_KBPS=96
MAX_AUDIO_KBPS=128
ENABLE_HEVC="${ENABLE_HEVC:-0}"

: "${SUPABASE_URL:?HQ_DB_URL required}"
: "${SERVICE_KEY:?HQ_DB_SERVICE_KEY required}"
: "${R2_ACCOUNT_ID:?required}"
: "${R2_ACCESS_KEY_ID:?required}"
: "${R2_SECRET_ACCESS_KEY:?required}"
: "${R2_BUCKET:=dreamcar-creatives}"
: "${R2_PUBLIC_BASE:?required}"

CRE_ID=""  # буде встановлено після claim

# ── Error trap: при будь-якій помилці фіксуємо у DB
on_error() {
  local exit_code=$?
  local line_no=$1
  if [ -n "$CRE_ID" ]; then
    echo "::error::Worker died on line $line_no (exit=$exit_code). Marking creative $CRE_ID as failed."
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_compress_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg id "$CRE_ID" --arg err "Worker error line $line_no exit $exit_code" '{cre_id:$id, err:$err}')" || true
  else
    echo "::error::Worker died on line $line_no (exit=$exit_code) BEFORE claiming any job."
  fi
  rm -rf /tmp/cw || true
  exit $exit_code
}
trap 'on_error $LINENO' ERR

# ── Claim
echo "Claiming compress jobs as ${WORKER_ID:-unknown}..."
CLAIMED=$(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/claim_compress_jobs" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"worker_name\":\"${WORKER_ID:-gh}\",\"max_jobs\":1}")

CLAIMED_TYPE=$(echo "$CLAIMED" | jq -r 'type')
if [ "$CLAIMED_TYPE" != "array" ]; then
  echo "::error::claim_compress_jobs returned non-array: $CLAIMED"
  exit 1
fi
JOB_COUNT=$(echo "$CLAIMED" | jq 'length')
echo "Got $JOB_COUNT jobs"
if [ "$JOB_COUNT" = "0" ]; then
  echo "Nothing to compress."
  exit 0
fi

# AWS Sig V4 для R2 PUT
sign_r2_put() {
  python3 - "$1" "$2" "$3" <<'PYEOF'
import sys, os, hmac, hashlib, datetime, urllib.parse
object_key = sys.argv[1]; content_type = sys.argv[2]; expires_in = int(sys.argv[3])
account_id = os.environ["R2_ACCOUNT_ID"]; access_key = os.environ["R2_ACCESS_KEY_ID"]
secret_key = os.environ["R2_SECRET_ACCESS_KEY"]; bucket = os.environ.get("R2_BUCKET", "dreamcar-creatives")
host = f"{account_id}.r2.cloudflarestorage.com"; region = "auto"; service = "s3"
now = datetime.datetime.utcnow(); amz = now.strftime("%Y%m%dT%H%M%SZ"); ds = now.strftime("%Y%m%d")
scope = f"{ds}/{region}/{service}/aws4_request"; credential = f"{access_key}/{scope}"
params = [("X-Amz-Algorithm", "AWS4-HMAC-SHA256"), ("X-Amz-Credential", credential),
          ("X-Amz-Date", amz), ("X-Amz-Expires", str(expires_in)), ("X-Amz-SignedHeaders", "host")]
params.sort()
canonical_query = "&".join(f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}" for k, v in params)
canonical_uri = "/" + bucket + "/" + "/".join(urllib.parse.quote(p, safe='') for p in object_key.split("/"))
canonical_headers = f"host:{host}\n"; signed_headers = "host"; payload_hash = "UNSIGNED-PAYLOAD"
canonical_request = "\n".join(["PUT", canonical_uri, canonical_query, canonical_headers, signed_headers, payload_hash])
string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canonical_request.encode()).hexdigest()])
def sign(key, msg): return hmac.new(key, msg.encode(), hashlib.sha256).digest()
k_date = sign(("AWS4" + secret_key).encode(), ds); k_region = sign(k_date, region)
k_service = sign(k_region, service); k_signing = sign(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
print(f"https://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}")
PYEOF
}

upload_to_r2() {
  local file="$1"
  local object_key="$2"
  local mime="$3"
  local upload_url
  upload_url=$(R2_ACCOUNT_ID="$R2_ACCOUNT_ID" R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" R2_BUCKET="$R2_BUCKET" sign_r2_put "$object_key" "$mime" 1800)
  local http
  http=$(curl -sS -o /tmp/cw/r2-resp.txt -w "%{http_code}" -X PUT \
    --connect-timeout 60 --max-time 1800 \
    -H "Content-Type: $mime" \
    --data-binary @"$file" \
    "$upload_url")
  if [ "$http" != "200" ] && [ "$http" != "201" ]; then
    echo "::error::R2 PUT $object_key failed HTTP=$http: $(cat /tmp/cw/r2-resp.txt | head -c 500)"
    return 1
  fi
  echo "${R2_PUBLIC_BASE%/}/$object_key"
}

JOB=$(echo "$CLAIMED" | jq -c '.[0]')
CRE_ID=$(echo "$JOB"  | jq -r '.id')
CRE_NAME=$(echo "$JOB" | jq -r '.name // "video.mp4"')
CRE_URL=$(echo "$JOB"  | jq -r '.thumbnail_url')
CRE_SIZE=$(echo "$JOB" | jq -r '.size_bytes // 0')
CRE_ATTEMPTS=$(echo "$JOB" | jq -r '.attempts // 0')

echo ""
echo "=== Compressing $CRE_ID ($CRE_NAME, $CRE_SIZE bytes, attempt $CRE_ATTEMPTS) ==="
echo "Source URL: $CRE_URL"

mkdir -p /tmp/cw

INPUT=/tmp/cw/in.mp4
OUTPUT=/tmp/cw/out.mp4
OUTPUT_HEVC=/tmp/cw/out_hevc.mp4
PASS_LOG=/tmp/cw/pass_log
PASS_LOG_HEVC=/tmp/cw/pass_log_hevc

curl -fSL --connect-timeout 60 --max-time 1800 -o "$INPUT" "$CRE_URL"
IN_SIZE=$(stat -c%s "$INPUT")
IN_MB=$(awk "BEGIN{printf \"%.1f\", $IN_SIZE/1024/1024}")
echo "Downloaded: $IN_SIZE bytes (${IN_MB} MB)"

# ── Probe
PROBE=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,duration \
  -show_entries format=duration \
  -of json "$INPUT")
SRC_W=$(echo "$PROBE" | jq -r '.streams[0].width')
SRC_H=$(echo "$PROBE" | jq -r '.streams[0].height')
DURATION=$(echo "$PROBE" | jq -r '.format.duration // .streams[0].duration' | awk '{printf "%.2f", $1}')
SRC_FPS_RAW=$(echo "$PROBE" | jq -r '.streams[0].r_frame_rate')
SRC_FPS=$(echo "$SRC_FPS_RAW" | awk -F'/' '{ if ($2 > 0) printf "%.2f", $1/$2; else printf "%.2f", $1 }')

echo "Source: ${SRC_W}×${SRC_H} @ ${SRC_FPS}fps, ${DURATION}s"

# ── Budget calc
TOTAL_KBPS=$(awk "BEGIN{printf \"%.0f\", ($TARGET_BUDGET_BYTES * 8 / 1024) / $DURATION}")
echo "Total bitrate budget: ${TOTAL_KBPS} kbps"

AUDIO_KBPS=$MIN_AUDIO_KBPS
if [ "$TOTAL_KBPS" -ge 1500 ]; then AUDIO_KBPS=$MAX_AUDIO_KBPS; fi

VIDEO_KBPS=$((TOTAL_KBPS - AUDIO_KBPS - MUX_OVERHEAD_KBPS))
if [ "$VIDEO_KBPS" -lt 300 ]; then VIDEO_KBPS=300; fi
echo "Audio: ${AUDIO_KBPS}k | Video budget: ${VIDEO_KBPS}k"

# Adaptive resolution
if [ "$VIDEO_KBPS" -ge 4500 ]; then MAX_LONG=1920
elif [ "$VIDEO_KBPS" -ge 2200 ]; then MAX_LONG=1280
elif [ "$VIDEO_KBPS" -ge 1000 ]; then MAX_LONG=854
else MAX_LONG=640
fi

if [ "$SRC_W" -ge "$SRC_H" ]; then SRC_LONG=$SRC_W; else SRC_LONG=$SRC_H; fi
if [ "$SRC_LONG" -lt "$MAX_LONG" ]; then MAX_LONG=$SRC_LONG; fi

SCALE_FILTER="scale='if(gt(iw,ih),min(${MAX_LONG},iw),-2)':'if(gt(ih,iw),min(${MAX_LONG},ih),-2)':flags=lanczos,setsar=1"
echo "Target longest side: ${MAX_LONG}px (orig=${SRC_LONG}), aspect preserved"

# ───────────────────────────────────────────────────────
# H.264 pass (default, always)
# ───────────────────────────────────────────────────────
X264_OPTS="-c:v libx264 -profile:v high -level 4.1 -preset slower -tune film"
X264_PARAMS="bframes=8:b-adapt=2:ref=6:no-fast-pskip=1:aq-mode=2:aq-strength=0.9:psy-rd=1.0,0.15:rc-lookahead=60:trellis=2:me=umh:subme=8:mixed-refs=1:8x8dct=1:weightb=1"

echo ""
echo "[H.264 Pass 1/2] Analyzing @ ${VIDEO_KBPS}k..."
ffmpeg -y -v error -stats -i "$INPUT" \
  $X264_OPTS \
  -x264-params "$X264_PARAMS" \
  -b:v "${VIDEO_KBPS}k" -maxrate "$((VIDEO_KBPS * 110 / 100))k" -bufsize "$((VIDEO_KBPS * 2))k" \
  -vf "$SCALE_FILTER" \
  -pass 1 -passlogfile "$PASS_LOG" \
  -an -f null /dev/null

echo "[H.264 Pass 2/2] Encoding @ ${VIDEO_KBPS}k + ${AUDIO_KBPS}k AAC..."
ffmpeg -y -v error -stats -i "$INPUT" \
  $X264_OPTS \
  -x264-params "$X264_PARAMS" \
  -b:v "${VIDEO_KBPS}k" -maxrate "$((VIDEO_KBPS * 110 / 100))k" -bufsize "$((VIDEO_KBPS * 2))k" \
  -vf "$SCALE_FILTER" \
  -pass 2 -passlogfile "$PASS_LOG" \
  -c:a aac -b:a "${AUDIO_KBPS}k" -ac 2 -ar 48000 \
  -movflags +faststart -pix_fmt yuv420p \
  "$OUTPUT"

OUT_SIZE=$(stat -c%s "$OUTPUT")

# Retry if overshoot
if [ "$OUT_SIZE" -gt "$TARGET_BUDGET_BYTES" ]; then
  RETRY_KBPS=$((VIDEO_KBPS * 92 / 100))
  echo "::warning::H.264 overshoot. Retry @ ${RETRY_KBPS}k..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    $X264_OPTS -x264-params "$X264_PARAMS" \
    -b:v "${RETRY_KBPS}k" -maxrate "$((RETRY_KBPS * 110 / 100))k" -bufsize "$((RETRY_KBPS * 2))k" \
    -vf "$SCALE_FILTER" \
    -pass 1 -passlogfile "$PASS_LOG" -an -f null /dev/null
  ffmpeg -y -v error -stats -i "$INPUT" \
    $X264_OPTS -x264-params "$X264_PARAMS" \
    -b:v "${RETRY_KBPS}k" -maxrate "$((RETRY_KBPS * 110 / 100))k" -bufsize "$((RETRY_KBPS * 2))k" \
    -vf "$SCALE_FILTER" \
    -pass 2 -passlogfile "$PASS_LOG" \
    -c:a aac -b:a "${AUDIO_KBPS}k" -ac 2 -ar 48000 \
    -movflags +faststart -pix_fmt yuv420p \
    "$OUTPUT"
  OUT_SIZE=$(stat -c%s "$OUTPUT")
  VIDEO_KBPS=$RETRY_KBPS
fi

OUT_MB=$(awk "BEGIN{printf \"%.1f\", $OUT_SIZE/1024/1024}")
RATIO=$(awk "BEGIN{printf \"%.0f\", ($OUT_SIZE*100)/$IN_SIZE}")
OUT_PROBE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "$OUTPUT")
OUT_W=$(echo "$OUT_PROBE" | jq -r '.streams[0].width')
OUT_H=$(echo "$OUT_PROBE" | jq -r '.streams[0].height')
echo ""
echo "=== H.264 Final: ${OUT_MB} MB (${RATIO}% of original), ${OUT_W}×${OUT_H} ==="

# Upload H.264 to R2
OBJECT_KEY="video-compressed/${CRE_ID}.mp4"
PUBLIC_URL=$(upload_to_r2 "$OUTPUT" "$OBJECT_KEY" "video/mp4")
echo "H.264 uploaded: $PUBLIC_URL"

# Update DB
curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_compress_job" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg id "$CRE_ID" --arg url "$PUBLIC_URL" --argjson sz "$OUT_SIZE" '{cre_id:$id, out_url:$url, out_size_bytes:$sz}')"

echo "✓ H.264 DONE: $CRE_ID → $PUBLIC_URL ($OUT_MB MB, ${OUT_W}×${OUT_H})"

# ───────────────────────────────────────────────────────
# OPTIONAL: H.265 (HEVC) second pass для кращої якості
# ───────────────────────────────────────────────────────
if [ "$ENABLE_HEVC" = "1" ]; then
  # HEVC значно ефективніший — той же 49.5MB бюджет дає кращу якість
  # АБО ми можемо взяти ширший resolution (1920 завжди)
  HEVC_MAX_LONG=1920
  if [ "$SRC_LONG" -lt "$HEVC_MAX_LONG" ]; then HEVC_MAX_LONG=$SRC_LONG; fi
  HEVC_SCALE="scale='if(gt(iw,ih),min(${HEVC_MAX_LONG},iw),-2)':'if(gt(ih,iw),min(${HEVC_MAX_LONG},ih),-2)':flags=lanczos,setsar=1"
  HEVC_KBPS=$((VIDEO_KBPS - 100))  # запас на overhead
  if [ "$HEVC_KBPS" -lt 300 ]; then HEVC_KBPS=300; fi

  echo ""
  echo "[HEVC Pass 1/2] x265 main, slow preset, ${HEVC_KBPS}k..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    -c:v libx265 -preset slow -profile:v main \
    -x265-params "log-level=error:keyint=120:bframes=8:rc-lookahead=60:aq-mode=3:psy-rd=2.0:psy-rdoq=1.0:pass=1:stats=$PASS_LOG_HEVC" \
    -b:v "${HEVC_KBPS}k" -maxrate "$((HEVC_KBPS * 110 / 100))k" -bufsize "$((HEVC_KBPS * 2))k" \
    -vf "$HEVC_SCALE" \
    -an -f null /dev/null

  echo "[HEVC Pass 2/2] Encoding..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    -c:v libx265 -preset slow -profile:v main -tag:v hvc1 \
    -x265-params "log-level=error:keyint=120:bframes=8:rc-lookahead=60:aq-mode=3:psy-rd=2.0:psy-rdoq=1.0:pass=2:stats=$PASS_LOG_HEVC" \
    -b:v "${HEVC_KBPS}k" -maxrate "$((HEVC_KBPS * 110 / 100))k" -bufsize "$((HEVC_KBPS * 2))k" \
    -vf "$HEVC_SCALE" \
    -c:a aac -b:a "${AUDIO_KBPS}k" -ac 2 -ar 48000 \
    -movflags +faststart -pix_fmt yuv420p \
    "$OUTPUT_HEVC"

  HEVC_SIZE=$(stat -c%s "$OUTPUT_HEVC")
  HEVC_MB=$(awk "BEGIN{printf \"%.1f\", $HEVC_SIZE/1024/1024}")
  echo "HEVC Final: ${HEVC_MB} MB"

  if [ "$HEVC_SIZE" -le "$TARGET_BUDGET_BYTES" ]; then
    HEVC_OBJECT_KEY="video-compressed-hevc/${CRE_ID}.mp4"
    HEVC_URL=$(upload_to_r2 "$OUTPUT_HEVC" "$HEVC_OBJECT_KEY" "video/mp4")
    # PATCH creatives.compressed_url_hevc — colunна може ще не існувати, тому tolerate помилку
    curl -sS -X PATCH "$SUPABASE_URL/rest/v1/creatives?id=eq.$CRE_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=minimal" \
      -d "$(jq -nc --arg url "$HEVC_URL" --argjson sz "$HEVC_SIZE" '{compressed_url_hevc:$url, compressed_hevc_size_bytes:$sz}')" \
      || echo "::warning::compressed_url_hevc column missing — apply migration 018"
    echo "✓ HEVC DONE: → $HEVC_URL ($HEVC_MB MB)"
  else
    echo "::warning::HEVC overshot $HEVC_SIZE > $TARGET_BUDGET_BYTES — skipping"
  fi
fi

# Clean up trap (ми вже все обробили)
trap - ERR
rm -rf /tmp/cw

echo ""
echo "=== Worker done ==="
