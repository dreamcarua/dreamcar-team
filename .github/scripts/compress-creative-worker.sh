#!/bin/bash
# Compress Creative Worker — cascade ffmpeg compress until ≤49MB.
# Викликається з .github/workflows/compress-creative.yml
#
# Cascade:
#   Pass 1: CRF 18 preset slower @ original res (≤1920) — visually lossless
#   Pass 2: CRF 22 preset medium @ 1280×720 — if Pass 1 >49MB
#   Pass 3: CRF 26 preset medium @ 960×540 — if Pass 2 >49MB
#
# 49MB цільовий поріг — TG Bot API sendVideo ліміт 50MB.
set -e

NL=$'\n'
TARGET_MAX=$((49 * 1024 * 1024))

# Required env
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
  echo "::error::claim_compress_jobs returned non-array ($CLAIMED_TYPE): $CLAIMED"
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

object_key = sys.argv[1]
content_type = sys.argv[2]
expires_in = int(sys.argv[3])

account_id = os.environ["R2_ACCOUNT_ID"]
access_key = os.environ["R2_ACCESS_KEY_ID"]
secret_key = os.environ["R2_SECRET_ACCESS_KEY"]
bucket = os.environ.get("R2_BUCKET", "dreamcar-creatives")

host = f"{account_id}.r2.cloudflarestorage.com"
region = "auto"
service = "s3"
now = datetime.datetime.utcnow()
amz = now.strftime("%Y%m%dT%H%M%SZ")
ds = now.strftime("%Y%m%d")
scope = f"{ds}/{region}/{service}/aws4_request"
credential = f"{access_key}/{scope}"

params = [
    ("X-Amz-Algorithm", "AWS4-HMAC-SHA256"),
    ("X-Amz-Credential", credential),
    ("X-Amz-Date", amz),
    ("X-Amz-Expires", str(expires_in)),
    ("X-Amz-SignedHeaders", "host"),
]
params.sort()
canonical_query = "&".join(
    f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}" for k, v in params
)
canonical_uri = "/" + bucket + "/" + "/".join(urllib.parse.quote(p, safe='') for p in object_key.split("/"))
canonical_headers = f"host:{host}\n"
signed_headers = "host"
payload_hash = "UNSIGNED-PAYLOAD"
canonical_request = "\n".join([
    "PUT", canonical_uri, canonical_query,
    canonical_headers, signed_headers, payload_hash
])
string_to_sign = "\n".join([
    "AWS4-HMAC-SHA256", amz, scope,
    hashlib.sha256(canonical_request.encode()).hexdigest()
])

def sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()

k_date = sign(("AWS4" + secret_key).encode(), ds)
k_region = sign(k_date, region)
k_service = sign(k_region, service)
k_signing = sign(k_service, "aws4_request")
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

curl -fSL --connect-timeout 60 --max-time 1800 -o "$INPUT" "$CRE_URL"
IN_SIZE=$(stat -c%s "$INPUT")
IN_MB=$(awk "BEGIN{printf \"%.1f\", $IN_SIZE/1024/1024}")
echo "Downloaded: $IN_SIZE bytes (${IN_MB} MB)"

PASS_USED=""

# ── Pass 1: CRF 18 preset slower @ original res ≤1920
echo ""
echo "[Pass 1] CRF 18 preset slower @ ≤1920p (visually lossless)..."
ffmpeg -y -v error -stats -i "$INPUT" \
  -c:v libx264 -preset slower -crf 18 \
  -vf "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(ih,iw),min(1920,ih),-2)'" \
  -c:a aac -b:a 192k \
  -movflags +faststart -pix_fmt yuv420p \
  "$OUTPUT"
OUT_SIZE=$(stat -c%s "$OUTPUT")
OUT_MB=$(awk "BEGIN{printf \"%.1f\", $OUT_SIZE/1024/1024}")
echo "Pass 1 result: $OUT_SIZE bytes (${OUT_MB} MB)"
PASS_USED="1: CRF18 / FullHD"

# ── Pass 2: CRF 22 @ 1280×720 (preset medium) — якщо Pass 1 >49MB
if [ "$OUT_SIZE" -gt "$TARGET_MAX" ]; then
  echo ""
  echo "[Pass 2] >49MB → CRF 22 preset medium @ 1280×720..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    -c:v libx264 -preset medium -crf 22 \
    -vf "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(ih,iw),min(1280,ih),-2)'" \
    -c:a aac -b:a 128k \
    -movflags +faststart -pix_fmt yuv420p \
    "$OUTPUT"
  OUT_SIZE=$(stat -c%s "$OUTPUT")
  OUT_MB=$(awk "BEGIN{printf \"%.1f\", $OUT_SIZE/1024/1024}")
  echo "Pass 2 result: $OUT_SIZE bytes (${OUT_MB} MB)"
  PASS_USED="2: CRF22 / 720p"
fi

# ── Pass 3: CRF 26 @ 960×540 — якщо Pass 2 >49MB
if [ "$OUT_SIZE" -gt "$TARGET_MAX" ]; then
  echo ""
  echo "[Pass 3] >49MB → CRF 26 preset medium @ 960×540..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    -c:v libx264 -preset medium -crf 26 \
    -vf "scale='if(gt(iw,ih),min(960,iw),-2)':'if(gt(ih,iw),min(960,ih),-2)'" \
    -c:a aac -b:a 96k \
    -movflags +faststart -pix_fmt yuv420p \
    "$OUTPUT"
  OUT_SIZE=$(stat -c%s "$OUTPUT")
  OUT_MB=$(awk "BEGIN{printf \"%.1f\", $OUT_SIZE/1024/1024}")
  echo "Pass 3 result: $OUT_SIZE bytes (${OUT_MB} MB)"
  PASS_USED="3: CRF26 / 540p"
fi

RATIO=$(awk "BEGIN{printf \"%.0f\", ($OUT_SIZE*100)/$IN_SIZE}")
echo ""
echo "=== Final: ${OUT_MB} MB (${RATIO}% of original) — pass [$PASS_USED] ==="

# Upload compressed → R2
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
echo "✓ DONE: $CRE_ID → $PUBLIC_URL ($OUT_MB MB, pass $PASS_USED)"
