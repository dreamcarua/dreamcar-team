#!/bin/bash
# One-shot: генерує важке Full HD тест-відео + завантажує у Supabase Storage,
# оновлює креатив, ставить публікацію у чергу автопостингу.
# Запускається з workflow setup-heavy-video.yml
set -e

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "::error::Missing HQ_DB_URL / HQ_DB_SERVICE_KEY"
  exit 1
fi

CRE_ID="ddddddd2-dddd-dddd-dddd-dddddddddddd"
BUCKET="creatives"
OBJECT_PATH="qa/heavy-fhd-47mb.mp4"
PUBLIC_URL="${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${OBJECT_PATH}"

echo "=== Generating heavy FHD test video (target ~47MB, must fit Supabase Free 50MB cap) ==="
# CRF 14 + duration 30s + Full HD = ~47MB (boundary case: ≥45MB triggers Path B CRF 18)
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=30" \
  -f lavfi -i "sine=frequency=440:duration=30" \
  -c:v libx264 -preset medium -crf 14 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -movflags +faststart /tmp/heavy.mp4

SIZE=$(stat -c%s /tmp/heavy.mp4)
MB=$(awk "BEGIN{printf \"%.1f\", $SIZE/1024/1024}")
echo "Generated: $SIZE bytes (${MB} MB)"

# Safety: якщо випадково >49MB → пере-стиснути жорсткіше
if [ "$SIZE" -gt $((49 * 1024 * 1024)) ]; then
  echo "::warning::Generated too big (${MB} MB), recompressing with CRF 18"
  ffmpeg -y -v error -i /tmp/heavy.mp4 \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
    -c:a copy -movflags +faststart /tmp/heavy2.mp4
  mv /tmp/heavy2.mp4 /tmp/heavy.mp4
  SIZE=$(stat -c%s /tmp/heavy.mp4)
  MB=$(awk "BEGIN{printf \"%.1f\", $SIZE/1024/1024}")
  echo "After recompress: $SIZE bytes (${MB} MB)"
fi

echo ""
echo "=== Uploading to Supabase Storage: ${BUCKET}/${OBJECT_PATH} ==="
UPLOAD_RESP=$(curl -sS -X PUT \
  "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${OBJECT_PATH}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Content-Type: video/mp4" \
  -H "x-upsert: true" \
  --data-binary @/tmp/heavy.mp4)
echo "Upload response: $UPLOAD_RESP"

# Fail loudly if upload didn't succeed
if echo "$UPLOAD_RESP" | grep -qi "statusCode.*4\|error"; then
  echo "::error::Upload failed: $UPLOAD_RESP"
  exit 1
fi

echo ""
echo "=== Executing SQL via PostgREST (auto-update creative + enqueue) ==="

# 1. Update creative
curl -sS -X PATCH \
  "${SUPABASE_URL}/rest/v1/creatives?id=eq.${CRE_ID}" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "{\"thumbnail_url\":\"${PUBLIC_URL}\",\"size_bytes\":${SIZE},\"duration_sec\":30,\"width_px\":1920,\"height_px\":1080,\"name\":\"heavy-fhd-47mb.mp4\"}"
echo "✓ Creative updated"

# 2. Clean up old #144-heavy pubs (queue + pub)
OLD_PUBS=$(curl -sS \
  "${SUPABASE_URL}/rest/v1/publications?title=like.*144-heavy*&select=id" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" | jq -r '.[].id')

for PID in $OLD_PUBS; do
  curl -sS -X DELETE \
    "${SUPABASE_URL}/rest/v1/tg_autopost_queue?publication_id=eq.${PID}" \
    -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}" > /dev/null
done
echo "✓ Old queue rows cleaned"

# 3. Create fresh #144-heavy pub
PUB_RESP=$(curl -sS -X POST \
  "${SUPABASE_URL}/rest/v1/publications" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"desk_id\":\"11111111-1111-1111-1111-111111111111\",
    \"title\":\"[АВТОТЕСТ #144-heavy] Важке FHD ~47MB — Path B CRF 18 visually lossless\",
    \"publish_at\":\"$(date -u -d '+1 minute' '+%Y-%m-%dT%H:%M:%S.000Z')\",
    \"content_type\":\"post\",
    \"status\":\"approved\",
    \"text_body\":\"Тест #4 — важке Full HD 47MB. Має триггернути Path B (CRF 18 preset slower). Якість має бути visually lossless. testsrc2 pattern з кольоровими градієнтами — добре видно артефакти якщо є.\",
    \"created_by\":\"aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa\"
  }")
NEW_PUB_ID=$(echo "$PUB_RESP" | jq -r '.[0].id')
echo "✓ New pub: $NEW_PUB_ID"

# 4. Add platform + creative
curl -sS -X POST \
  "${SUPABASE_URL}/rest/v1/publication_platforms" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "{\"publication_id\":\"${NEW_PUB_ID}\",\"platform\":\"tg\"}"

curl -sS -X POST \
  "${SUPABASE_URL}/rest/v1/creative_publications" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "{\"publication_id\":\"${NEW_PUB_ID}\",\"creative_id\":\"${CRE_ID}\",\"sort_order\":0}"
echo "✓ Platform + creative linked"

# 5. Enqueue
ENQ_RESP=$(curl -sS -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/enqueue_pending_autoposts" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{}")
echo "✓ Enqueue: $ENQ_RESP"

echo ""
echo "=== DONE ==="
echo "Public URL: ${PUBLIC_URL}"
echo "New pub: $NEW_PUB_ID"
echo "Worker has 5 min for cron OR trigger tg-autopost.yml manually."
