#!/bin/bash
# One-shot: генерує важке Full HD тест-відео + завантажує у Supabase Storage,
# оновлює креатив, ставить публікацію у чергу автопостингу.
# Запускається з workflow setup-heavy-video-test.yml
set -e

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "::error::Missing HQ_DB_URL / HQ_DB_SERVICE_KEY"
  exit 1
fi

CRE_ID="ddddddd2-dddd-dddd-dddd-dddddddddddd"
BUCKET="creatives"
OBJECT_PATH="qa/heavy-fhd-68mb.mp4"
PUBLIC_URL="${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${OBJECT_PATH}"

echo "=== Generating heavy FHD test video (target ~60MB) ==="
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=40" \
  -f lavfi -i "sine=frequency=440:duration=40" \
  -c:v libx264 -preset medium -crf 12 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -movflags +faststart /tmp/heavy.mp4

SIZE=$(stat -c%s /tmp/heavy.mp4)
MB=$(awk "BEGIN{printf \"%.1f\", $SIZE/1024/1024}")
echo "Generated: $SIZE bytes (${MB} MB)"

echo ""
echo "=== Uploading to Supabase Storage: ${BUCKET}/${OBJECT_PATH} ==="
# Use upsert=true so we can re-run
UPLOAD_RESP=$(curl -sS -X PUT \
  "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${OBJECT_PATH}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Content-Type: video/mp4" \
  -H "x-upsert: true" \
  --data-binary @/tmp/heavy.mp4)
echo "Upload response: $UPLOAD_RESP"

echo ""
echo "=== Updating creative + creating fresh pub + enqueue ==="
SQL="-- Update creative
update creatives set
  thumbnail_url='${PUBLIC_URL}',
  size_bytes=${SIZE},
  duration_sec=40,
  width_px=1920, height_px=1080,
  name='heavy-fhd-68mb.mp4'
where id='${CRE_ID}';

-- Reset existing test pub publish_at + clear queue
update publications
   set publish_at = now() + interval '1 minute',
       autopost_status=null, autopost_error=null,
       autopost_attempts=0, tg_message_id=null
 where title like '%#144-video%';

delete from tg_autopost_queue
 where publication_id in (select id from publications where title like '%#144-video%');

-- New pub for heavy test
insert into publications (id, desk_id, title, publish_at, content_type, status, text_body, created_by)
values (gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  '[АВТОТЕСТ #144-heavy] Важке FHD відео (~60MB) — visually lossless',
  now() + interval '1 minute',
  'post', 'approved',
  'Тест #4 — важке Full HD ~60MB. Має триггернути CRF 18 path. Очікую візуально lossless.',
  'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into publication_platforms (publication_id, platform)
  select id, 'tg' from publications where title like '%#144-heavy%';

insert into creative_publications (publication_id, creative_id, sort_order)
  select id, '${CRE_ID}'::uuid, 0 from publications where title like '%#144-heavy%';

select * from public.enqueue_pending_autoposts();"

# Execute via PostgREST sql RPC if available, else via direct exec_sql function
echo "$SQL" > /tmp/setup.sql
echo "--- SQL ---"
cat /tmp/setup.sql
echo "--- END SQL ---"
echo ""
echo "NOTE: SQL printed above must be executed manually in Supabase SQL Editor."
echo "Public URL: ${PUBLIC_URL}"
