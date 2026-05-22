#!/bin/bash
# Compress Creative Worker — TARGET-BITRATE 2-pass H.264 high, max quality ≤49.5MB.
# Викликається з .github/workflows/compress-creative.yml
#
# Стратегія:
#   1. ffprobe → duration + native resolution
#   2. Budget = 49.5MB → video_kbps = (budget*8/duration) - audio - mux
#   3. Adaptive resolution based on bitrate budget (1080p/720p/480p/360p) — ASPECT PRESERVED
#   4. Two-pass H.264 high profile slower + advanced (bframes=8, refs=6, aq-mode=2)
#   5. Audio AAC 96-128 kbps
#   6. Якщо overshoot — retry once з 92% budget
#
# H.264 (не HEVC/AV1) — TG inline preview працює тільки на H.264.
set -e

TARGET_BUDGET_BYTES=$((49500000))  # 49.5 MB — нижче 50MB Bot API hard cap з запасом
MUX_OVERHEAD_KBPS=50               # mp4 container/index overhead
MIN_AUDIO_KBPS=96
MAX_AUDIO_KBPS=128

: "${SUPABASE_URL:?HQ_DB_URL required}"
: "${SERVICE_KEY:?HQ_DB_SERVICE_KEY required}"
: "${R2_ACCOUNT_ID:?required}"
: "${R2_ACCESS_KEY_ID:?required}"
: "${R2_SECRET_ACCESS_KEY:?required}"
: "${R2_BUCKET:=dreamcar-creatives}"
: "${R2_PUBLIC_BASE:?required}"

echo "Claiming compress jobs as $WORKER_ID..."
CLAIMED=$(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/claim_compress_jobs" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"worker_name\":\"$WORKER_ID\",\"max_jobs\":1}")

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

JOB=$(echo "$CLAIMED" | jq -c '.[0]')
CRE_ID=$(echo "$JOB"  | jq -r '.id')
CRE_NAME=$(echo "$JOB" | jq -r '.name // "video.mp4"')
CRE_URL=$(echo "$JOB"  | jq -r '.thumbnail_url')
CRE_SIZE=$(echo "$JOB" | jq -r '.size_bytes // 0')

echo ""
echo "=== Compressing $CRE_ID ($CRE_NAME, $CRE_SIZE bytes) ==="
echo "Source URL: $CRE_URL"

mkdir -p /tmp/cw
trap 'rm -rf /tmp/cw' EXIT

INPUT=/tmp/cw/in.mp4
OUTPUT=/tmp/cw/out.mp4
PASS_LOG=/tmp/cw/pass_log

curl -fSL --connect-timeout 60 --max-time 1800 -o "$INPUT" "$CRE_URL"
IN_SIZE=$(stat -c%s "$INPUT")
IN_MB=$(awk "BEGIN{printf \"%.1f\", $IN_SIZE/1024/1024}")
echo "Downloaded: $IN_SIZE bytes (${IN_MB} MB)"

# ── Probe оригіналу
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

# ── Розрахунок бюджету бітрейту
TOTAL_KBPS=$(awk "BEGIN{printf \"%.0f\", ($TARGET_BUDGET_BYTES * 8 / 1024) / $DURATION}")
echo "Total bitrate budget: ${TOTAL_KBPS} kbps"

# Audio bitrate adaptive: 128k якщо багато budget, інакше 96k
AUDIO_KBPS=$MIN_AUDIO_KBPS
if [ "$TOTAL_KBPS" -ge 1500 ]; then AUDIO_KBPS=$MAX_AUDIO_KBPS; fi

VIDEO_KBPS=$((TOTAL_KBPS - AUDIO_KBPS - MUX_OVERHEAD_KBPS))
if [ "$VIDEO_KBPS" -lt 300 ]; then VIDEO_KBPS=300; fi
echo "Audio: ${AUDIO_KBPS}k | Video budget: ${VIDEO_KBPS}k"

# ── Adaptive resolution (longest side), ASPECT-PRESERVED
# Choose target longest side based on video_kbps:
#   ≥4500: 1920 (original FullHD)
#   ≥2200: 1280
#   ≥1000: 854 (efectively close to 480p при 16:9)
#   else:  640
if [ "$VIDEO_KBPS" -ge 4500 ]; then
  MAX_LONG=1920
elif [ "$VIDEO_KBPS" -ge 2200 ]; then
  MAX_LONG=1280
elif [ "$VIDEO_KBPS" -ge 1000 ]; then
  MAX_LONG=854
else
  MAX_LONG=640
fi

# Якщо source менший — НЕ upscale (це псує якість)
if [ "$SRC_W" -ge "$SRC_H" ]; then SRC_LONG=$SRC_W; else SRC_LONG=$SRC_H; fi
if [ "$SRC_LONG" -lt "$MAX_LONG" ]; then MAX_LONG=$SRC_LONG; fi

# scale filter: max longest side, aspect preserved (force_original_aspect_ratio=decrease)
SCALE_FILTER="scale='if(gt(iw,ih),min(${MAX_LONG},iw),-2)':'if(gt(ih,iw),min(${MAX_LONG},ih),-2)':flags=lanczos,setsar=1"
echo "Target longest side: ${MAX_LONG}px (orig=${SRC_LONG}), aspect preserved"

# ── Advanced x264 options — high profile, max efficiency
X264_OPTS="-c:v libx264 -profile:v high -level 4.1 -preset slower -tune film"
# bf 8 b-frames, refs 6, b-adapt 2, no fast pskip, psy-rd, aq-mode 2 (variance), aq-strength 0.9
X264_PARAMS="bframes=8:b-adapt=2:ref=6:no-fast-pskip=1:aq-mode=2:aq-strength=0.9:psy-rd=1.0,0.15:rc-lookahead=60:trellis=2:me=umh:subme=8:mixed-refs=1:8x8dct=1:weightb=1"

# ── PASS 1 (analysis)
echo ""
echo "[Pass 1/2] Analyzing for ${VIDEO_KBPS}k target..."
ffmpeg -y -v error -stats -i "$INPUT" \
  $X264_OPTS \
  -x264-params "$X264_PARAMS" \
  -b:v "${VIDEO_KBPS}k" -maxrate "$((VIDEO_KBPS * 110 / 100))k" -bufsize "$((VIDEO_KBPS * 2))k" \
  -vf "$SCALE_FILTER" \
  -pass 1 -passlogfile "$PASS_LOG" \
  -an -f null /dev/null

# ── PASS 2 (encode)
echo ""
echo "[Pass 2/2] Encoding @ ${VIDEO_KBPS}k video + ${AUDIO_KBPS}k AAC..."
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
OUT_MB=$(awk "BEGIN{printf \"%.1f\", $OUT_SIZE/1024/1024}")
echo ""
echo "Encoded: $OUT_SIZE bytes (${OUT_MB} MB)"

# ── Перевірка overshoot — retry once з 92% budget
if [ "$OUT_SIZE" -gt "$TARGET_BUDGET_BYTES" ]; then
  RETRY_KBPS=$((VIDEO_KBPS * 92 / 100))
  echo "::warning::Overshoot ($OUT_SIZE > $TARGET_BUDGET_BYTES). Retry with ${RETRY_KBPS}k video..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    $X264_OPTS \
    -x264-params "$X264_PARAMS" \
    -b:v "${RETRY_KBPS}k" -maxrate "$((RETRY_KBPS * 110 / 100))k" -bufsize "$((RETRY_KBPS * 2))k" \
    -vf "$SCALE_FILTER" \
    -pass 1 -passlogfile "$PASS_LOG" \
    -an -f null /dev/null
  ffmpeg -y -v error -stats -i "$INPUT" \
    $X264_OPTS \
    -x264-params "$X264_PARAMS" \
    -b:v "${RETRY_KBPS}k" -maxrate "$((RETRY_KBPS * 110 / 100))k" -bufsize "$((RETRY_KBPS * 2))k" \
    -vf "$SCALE_FILTER" \
    -pass 2 -passlogfile "$PASS_LOG" \
    -c:a aac -b:a "${AUDIO_KBPS}k" -ac 2 -ar 48000 \
    -movflags +faststart -pix_fmt yuv420p \
    "$OUTPUT"
  OUT_SIZE=$(stat -c%s "$OUTPUT")
  OUT_MB=$(awk "BEGIN{printf \"%.1f\", $OUT_SIZE/1024/1024}")
  echo "Retry result: $OUT_SIZE bytes (${OUT_MB} MB)"
  VIDEO_KBPS=$RETRY_KBPS
fi

RATIO=$(awk "BEGIN{printf \"%.0f\", ($OUT_SIZE*100)/$IN_SIZE}")
# Get output dimensions for logging
OUT_PROBE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "$OUTPUT")
OUT_W=$(echo "$OUT_PROBE" | jq -r '.streams[0].width')
OUT_H=$(echo "$OUT_PROBE" | jq -r '.streams[0].height')
echo ""
echo "=== Final: ${OUT_MB} MB (${RATIO}% of original) ==="
echo "    Resolution: ${OUT_W}×${OUT_H} (orig ${SRC_W}×${SRC_H}, aspect preserved)"
echo "    Bitrate:    ${VIDEO_KBPS}k video + ${AUDIO_KBPS}k AAC"

# ── R2 upload
OBJECT_KEY="video-compressed/${CRE_ID}.mp4"
UPLOAD_URL=$(R2_ACCOUNT_ID="$R2_ACCOUNT_ID" R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" R2_BUCKET="$R2_BUCKET" sign_r2_put "$OBJECT_KEY" "video/mp4" 1800)
PUBLIC_URL="${R2_PUBLIC_BASE%/}/$OBJECT_KEY"

echo "Uploading to R2..."
HTTP_PUT=$(curl -sS -o /tmp/cw/r2-resp.txt -w "%{http_code}" -X PUT \
  --connect-timeout 60 --max-time 1800 \
  -H "Content-Type: video/mp4" \
  --data-binary @"$OUTPUT" \
  "$UPLOAD_URL")

if [ "$HTTP_PUT" != "200" ] && [ "$HTTP_PUT" != "201" ]; then
  ERR=$(cat /tmp/cw/r2-resp.txt | head -c 500)
  echo "::error::R2 PUT failed HTTP=$HTTP_PUT: $ERR"
  curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_compress_job" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg id "$CRE_ID" --arg err "R2 PUT $HTTP_PUT: $ERR" '{cre_id:$id, err:$err}')"
  exit 1
fi
echo "R2 PUT OK ($HTTP_PUT)"

echo "Updating DB row..."
curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_compress_job" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg id "$CRE_ID" --arg url "$PUBLIC_URL" --argjson sz "$OUT_SIZE" '{cre_id:$id, out_url:$url, out_size_bytes:$sz}')"

echo ""
echo "✓ DONE: $CRE_ID → $PUBLIC_URL"
echo "  ${OUT_MB} MB, ${OUT_W}×${OUT_H}, ${VIDEO_KBPS}k+${AUDIO_KBPS}k AAC"
