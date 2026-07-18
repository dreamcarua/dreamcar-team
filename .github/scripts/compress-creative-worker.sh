#!/bin/bash
# Compress Creative Worker — TARGET-BITRATE 2-pass H.264 high, MAX quality ≤49.5MB.
#
# v4 — CPU optimization (#526, 20.06.2026):
#   • preset veryslow → slow (3× швидше, QP loss <1%; SMM/IG/TG users не побачать різниці)
#   • subme=10 → 8 (motion search refinement)
#   • merange=32 → 24
#   • rc-lookahead=80 → 60
#   Імпульс: 4 failed creatives від 10-12.06 на старому worker зависали >25min.
#   Тепер encoding ~10-12min для 60s 1080p iPhone → ВЛІЗАЄ у 30min runner timeout з запасом.
#
# v3 — HEIC error visibility fix:
#   • convert обгорнуто у if-block — не фаєрить ERR trap, видно реальну помилку
#   • heif-convert верифікує розмір вихідного JPG (>1KB)
#   • Логування convert stderr навіть на success
#
# v2 — MAX quality tuning:
#   • preset veryslow (was slower) — найповільніший аналіз, краще стиснення
#   • bframes=12, ref=8, subme=10, aq-mode=3, merange=32, qcomp=0.7
#   • Target 99% budget (was 91% effective fill) — використовуємо всі біти
#   • Buffer 110% maxrate замість 110% — менш консервативно
#
# ENV optional:
#   ENABLE_HEVC=1         — додатково створює H.265 варіант
#   DISPATCH_AUTOPOST=1   — після complete викликає dispatch-workflow
set -euo pipefail

TARGET_BUDGET_BYTES=$((49500000))  # 49.5 MB hard ceiling
TARGET_FILL_PCT=99                  # x264 target = 99% of budget (raise from default 91% undershoot)
MUX_OVERHEAD_KBPS=40                # mp4 container/index overhead (зменшено з 50)
MIN_AUDIO_KBPS=96
MAX_AUDIO_KBPS=128
ENABLE_HEVC="${ENABLE_HEVC:-0}"
DISPATCH_AUTOPOST="${DISPATCH_AUTOPOST:-1}"

: "${SUPABASE_URL:?HQ_DB_URL required}"
: "${SERVICE_KEY:?HQ_DB_SERVICE_KEY required}"
: "${R2_ACCOUNT_ID:?required}"
: "${R2_ACCESS_KEY_ID:?required}"
: "${R2_SECRET_ACCESS_KEY:?required}"
: "${R2_BUCKET:=dreamcar-creatives}"
: "${R2_PUBLIC_BASE:?required}"

CRE_ID=""

on_error() {
  local exit_code=$?
  local line_no=$1
  if [ -n "$CRE_ID" ]; then
    echo "::error::Worker died on line $line_no (exit=$exit_code). Marking creative $CRE_ID as failed."
    # Якщо є im-err.txt — додамо у error message для debug
    local extra_err=""
    if [ -f /tmp/cw/im-err.txt ]; then
      extra_err=" | im-err: $(head -c 150 /tmp/cw/im-err.txt | tr '\n' ' ')"
    fi
    if [ -f /tmp/cw/heif-err.txt ]; then
      extra_err="$extra_err | heif-err: $(head -c 150 /tmp/cw/heif-err.txt | tr '\n' ' ')"
    fi
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_compress_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg id "$CRE_ID" --arg err "Worker line $line_no exit $exit_code$extra_err" '{cre_id:$id, err:$err}')" || true
  else
    echo "::error::Worker died on line $line_no (exit=$exit_code) BEFORE claiming any job."
  fi
  rm -rf /tmp/cw || true
  exit $exit_code
}
trap 'on_error $LINENO' ERR

echo "Claiming compress jobs as ${WORKER_ID:-unknown}..."
# Worker обробляє 1 креатив за run (видно нижче — JOB=.[0]). max_jobs=1 щоб не залишати претензії у processing.
# Для pile-up — рішення на стороні pg_cron compress-safety-net (jobid 16, */5min).
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

# #388 (14.06.2026): JPEG poster для video creative.
# Без цього SMM UI не може показати preview .MOV/.MP4 у браузері (особливо HEVC HLG).
# Генеруємо poster (середній кадр), uploadимo у R2, PATCH-имо thumbnail_url у DB.
# Викликається з гілок: HDR pass-through, HDR HEVC encode, SDR H.264 encode.
generate_video_poster_and_patch() {
  local input="$1"
  local cre_id="$2"
  local poster=/tmp/cw/poster.jpg

  # Середина відео для кращого preview (не чорний 1-й кадр)
  local dur seek
  dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$input" 2>/dev/null | awk '{printf "%.0f", $1/2}')
  seek=${dur:-2}

  # Конвертація HDR → JPEG sRGB (бо JPEG не підтримує HLG)
  # Це потрібно ТІЛЬКИ для thumbnail (preview), оригінал video не чіпаємо.
  ffmpeg -y -v error -ss "$seek" -i "$input" -vframes 1 \
    -vf "scale='min(720,iw)':-2,format=yuv420p" \
    -q:v 3 "$poster" 2>/dev/null || \
  ffmpeg -y -v error -i "$input" -vframes 1 \
    -vf "scale='min(720,iw)':-2,format=yuv420p" \
    -q:v 3 "$poster" 2>/dev/null

  if [ ! -s "$poster" ]; then
    echo "::warning::Poster generation failed for $cre_id"
    return 1
  fi

  local poster_key poster_url
  poster_key="video-poster/${cre_id}.jpg"
  poster_url=$(upload_to_r2 "$poster" "$poster_key" "image/jpeg")
  echo "Poster uploaded: $poster_url"

  # #aspect (18.07.2026): реальні розміри відео у DB → TG отримує точні width/height
  # (раніше creatives.width_px/height_px лишались порожні, і відео плющило у квадрат).
  # rotation-aware: portrait-відео, зняте як landscape+rotate, коректно свопимо W↔H.
  local vw vh vrot vdur
  vw=$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of default=nw=1:nk=1 "$input" 2>/dev/null | head -1)
  vh=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 "$input" 2>/dev/null | head -1)
  vrot=$(ffprobe -v error -select_streams v:0 -show_entries stream_side_data=rotation -of default=nw=1:nk=1 "$input" 2>/dev/null | head -1)
  vdur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$input" 2>/dev/null | awk '{printf "%.0f", $1}')
  case "$vrot" in 90|-90|270|-270) local _t="$vw"; vw="$vh"; vh="$_t";; esac
  [ -z "$vw" ] && vw=null; [ -z "$vh" ] && vh=null; [ -z "$vdur" ] && vdur=null

  # #389 (14.06.2026): PATCH poster_url, НЕ thumbnail_url.
  # thumbnail_url = оригінальний URL для compress worker download.
  # poster_url = JPEG preview для SMM UI. + width_px/height_px/duration_sec для TG sendVideo.
  curl -sS -X PATCH "$SUPABASE_URL/rest/v1/creatives?id=eq.$cre_id" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d "$(jq -nc --arg url "$poster_url" --argjson w "$vw" --argjson h "$vh" --argjson d "$vdur" '{poster_url:$url, width_px:$w, height_px:$h, duration_sec:$d}')" \
    && echo "✓ poster_url + dims PATCH-ed (${vw}x${vh}, ${vdur}s, rot=${vrot:-0})" \
    || echo "::warning::poster_url PATCH failed"

  rm -f "$poster"
}

JOB=$(echo "$CLAIMED" | jq -c '.[0]')
CRE_ID=$(echo "$JOB"  | jq -r '.id')
CRE_NAME=$(echo "$JOB" | jq -r '.name // "creative"')
CRE_URL=$(echo "$JOB"  | jq -r '.thumbnail_url')
CRE_SIZE=$(echo "$JOB" | jq -r '.size_bytes // 0')
CRE_ATTEMPTS=$(echo "$JOB" | jq -r '.attempts // 0')
CRE_TYPE=$(echo "$JOB" | jq -r '.type // "video"')

echo ""
echo "=== Compressing $CRE_ID ($CRE_TYPE, $CRE_NAME, $CRE_SIZE bytes, attempt $CRE_ATTEMPTS) ==="
echo "Source URL: $CRE_URL"

mkdir -p /tmp/cw

# ============================================================
# PHOTO branch: ImageMagick resize до 2560×2560 max + JPEG q90
# ============================================================
if [ "$CRE_TYPE" = "photo" ]; then
  if ! command -v convert >/dev/null 2>&1; then
    echo "Installing ImageMagick + libheif + libheif-tools (HEIC support)..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq imagemagick libheif1 libheif-examples
  fi
  # FIX (#283 — IMG_8525.HEIC failed 13.05): ImageMagick policy.xml блокує HEIC за замовч.
  # У GH Actions Ubuntu runner: розблокувати coder rights для HEIC/HEIF
  IM_POLICY=$(find /etc -name 'policy.xml' -path '*ImageMagick*' 2>/dev/null | head -1)
  if [ -n "$IM_POLICY" ]; then
    echo "Unlocking ImageMagick policy для HEIC: $IM_POLICY"
    sudo sed -i 's|<policy domain="coder" rights="none" pattern="HEIC"|<policy domain="coder" rights="read\|write" pattern="HEIC"|g' "$IM_POLICY" || true
    sudo sed -i 's|<policy domain="coder" rights="none" pattern="HEIF"|<policy domain="coder" rights="read\|write" pattern="HEIF"|g' "$IM_POLICY" || true
    sudo sed -i 's|<policy domain="coder" rights="none" pattern="PDF"|<policy domain="coder" rights="read\|write" pattern="PDF"|g' "$IM_POLICY" || true
  fi
  PHOTO_IN=/tmp/cw/photo_in
  PHOTO_OUT=/tmp/cw/photo_out.jpg
  curl -fSL --connect-timeout 60 --max-time 600 -o "$PHOTO_IN" "$CRE_URL"
  PHOTO_IN_SIZE=$(stat -c%s "$PHOTO_IN" 2>/dev/null || echo 0)
  echo "Photo downloaded: $PHOTO_IN_SIZE bytes"

  # Detect file type from binary signature
  FILE_TYPE=$(file -b --mime-type "$PHOTO_IN" 2>/dev/null || echo "unknown")
  echo "Detected MIME type: $FILE_TYPE"
  # HEIC: спершу конвертуємо через heif-convert якщо є; інакше прямо ImageMagick з libheif
  case "$FILE_TYPE" in
    image/heic|image/heif|image/avif)
      echo "HEIC/HEIF input detected — try heif-convert first (more reliable than ImageMagick)"
      if command -v heif-convert >/dev/null 2>&1; then
        PHOTO_HEIC_JPG=/tmp/cw/photo_heic.jpg
        # Не використовуємо && || щоб уникнути set -e issues
        set +e
        heif-convert -q 95 "$PHOTO_IN" "$PHOTO_HEIC_JPG" 2>/tmp/cw/heif-err.txt
        HEIF_EXIT=$?
        set -e
        if [ $HEIF_EXIT -eq 0 ] && [ -f "$PHOTO_HEIC_JPG" ]; then
          HEIF_OUT_SIZE=$(stat -c%s "$PHOTO_HEIC_JPG" 2>/dev/null || echo 0)
          if [ "$HEIF_OUT_SIZE" -gt 1024 ]; then
            mv "$PHOTO_HEIC_JPG" "$PHOTO_IN"
            echo "heif-convert OK: $HEIF_OUT_SIZE bytes"
          else
            echo "::warning::heif-convert produced too-small file ($HEIF_OUT_SIZE bytes) — fall back to ImageMagick"
          fi
        else
          echo "::warning::heif-convert exit=$HEIF_EXIT: $(cat /tmp/cw/heif-err.txt 2>/dev/null | head -c 300)"
          echo "Will fall through to ImageMagick with libheif backend"
        fi
      else
        echo "::warning::heif-convert not installed — using ImageMagick with libheif"
      fi
      ;;
  esac

  # Resize. Wrap у if-block щоб уникнути ERR trap і побачити справжню помилку.
  set +e
  convert "$PHOTO_IN" \
    -auto-orient \
    -resize '2560x2560>' \
    -strip \
    -interlace Plane \
    -sampling-factor 4:2:0 \
    -quality 90 \
    -define jpeg:fancy-upsampling=false \
    "$PHOTO_OUT" 2>/tmp/cw/im-err.txt
  IM_EXIT=$?
  set -e
  if [ $IM_EXIT -ne 0 ]; then
    ERR_MSG=$(head -c 300 /tmp/cw/im-err.txt | tr '\n' ' ')
    echo "::error::ImageMagick failed (exit=$IM_EXIT): $ERR_MSG"
    # Last-resort: спробувати без додаткових опцій
    set +e
    convert "$PHOTO_IN" -auto-orient -strip -quality 90 "$PHOTO_OUT" 2>/tmp/cw/im-err2.txt
    IM_EXIT2=$?
    set -e
    if [ $IM_EXIT2 -ne 0 ]; then
      ERR_MSG2=$(head -c 300 /tmp/cw/im-err2.txt | tr '\n' ' ')
      echo "::error::Last-resort convert also failed (exit=$IM_EXIT2): $ERR_MSG2"
      curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_compress_job" \
        -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg id "$CRE_ID" --arg err "IM failed: $ERR_MSG2" '{cre_id:$id, err:$err}')"
      exit 1
    fi
    echo "Last-resort convert succeeded"
  fi

  PHOTO_OUT_SIZE=$(stat -c%s "$PHOTO_OUT")
  PHOTO_OUT_MB=$(awk "BEGIN{printf \"%.2f\", $PHOTO_OUT_SIZE/1024/1024}")
  echo "Photo compressed: $PHOTO_OUT_SIZE bytes (${PHOTO_OUT_MB} MB)"

  # Якщо все ще > 9.5MB (TG sendPhoto ліміт 10MB), знизити quality поетапно
  if [ "$PHOTO_OUT_SIZE" -gt 9500000 ]; then
    for Q in 85 78 70 60; do
      convert "$PHOTO_IN" -auto-orient -resize '2048x2048>' -strip -quality $Q "$PHOTO_OUT" 2>/dev/null
      PHOTO_OUT_SIZE=$(stat -c%s "$PHOTO_OUT")
      echo "Retry q=$Q → $PHOTO_OUT_SIZE bytes"
      [ "$PHOTO_OUT_SIZE" -le 9500000 ] && break
    done
  fi

  PHOTO_OBJECT_KEY="photo-compressed/${CRE_ID}.jpg"
  PHOTO_PUBLIC_URL=$(upload_to_r2 "$PHOTO_OUT" "$PHOTO_OBJECT_KEY" "image/jpeg")
  if [ -z "$PHOTO_PUBLIC_URL" ]; then
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_compress_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"cre_id\":\"$CRE_ID\",\"err\":\"r2 upload failed\"}"
    exit 1
  fi

  echo "Uploaded to R2: $PHOTO_PUBLIC_URL"
  curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_compress_job" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"cre_id\":\"$CRE_ID\",\"out_url\":\"$PHOTO_PUBLIC_URL\",\"out_size_bytes\":$PHOTO_OUT_SIZE}"

  echo "=== Done photo $CRE_ID: $PHOTO_IN_SIZE → $PHOTO_OUT_SIZE bytes ==="
  rm -f /tmp/cw/*
  exit 0
fi
# Якщо тип не video — нічого з ним не робимо
if [ "$CRE_TYPE" != "video" ]; then
  echo "::warning::Unknown type '$CRE_TYPE' for $CRE_ID — skipping"
  curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_compress_job" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"cre_id\":\"$CRE_ID\",\"err\":\"unsupported type: $CRE_TYPE\"}"
  exit 0
fi

INPUT=/tmp/cw/in.mp4
OUTPUT=/tmp/cw/out.mp4
OUTPUT_HEVC=/tmp/cw/out_hevc.mp4
PASS_LOG=/tmp/cw/pass_log
PASS_LOG_HEVC=/tmp/cw/pass_log_hevc

curl -fSL --connect-timeout 60 --max-time 1800 -o "$INPUT" "$CRE_URL"
IN_SIZE=$(stat -c%s "$INPUT")
IN_MB=$(awk "BEGIN{printf \"%.1f\", $IN_SIZE/1024/1024}")
echo "Downloaded: $IN_SIZE bytes (${IN_MB} MB)"

PROBE=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,duration,color_space,color_transfer,color_primaries,pix_fmt:stream_tags=rotate:stream_side_data=rotation \
  -show_entries format=duration \
  -of json "$INPUT")
SRC_W=$(echo "$PROBE" | jq -r '.streams[0].width')
SRC_H=$(echo "$PROBE" | jq -r '.streams[0].height')
DURATION=$(echo "$PROBE" | jq -r '.format.duration // .streams[0].duration' | awk '{printf "%.2f", $1}')
SRC_FPS_RAW=$(echo "$PROBE" | jq -r '.streams[0].r_frame_rate')
SRC_FPS=$(echo "$SRC_FPS_RAW" | awk -F'/' '{ if ($2 > 0) printf "%.2f", $1/$2; else printf "%.2f", $1 }')

# #260 (10.06.2026): iPhone aspect ratio fix — rotation metadata detection
# iPhone знімає video у landscape pixels + rotation matrix у side_data.
# Без proper handling: scale filter застосовується до raw pixels → у виході
# залишається landscape з втраченою rotation tag → TG показує перевернутий aspect.
SRC_ROTATION=$(echo "$PROBE" | jq -r '
  (.streams[0].side_data_list[]? | select(.rotation) | .rotation) //
  (.streams[0].tags.rotate? // 0) // 0
' | head -1)
# Normalize: ffprobe displaymatrix повертає -90 для 90° clockwise, +90 для counterclockwise
SRC_ROT_ABS=$(awk "BEGIN{r=$SRC_ROTATION; if(r<0)r=-r; print int(r)%360}")
echo "Source: ${SRC_W}×${SRC_H} @ ${SRC_FPS}fps, ${DURATION}s, rotation=${SRC_ROTATION}° (abs=${SRC_ROT_ABS}°)"

# Якщо rotation 90 або 270 — logical W/H перевернуто
# Для scale calculation ми хочемо logical dimensions (як TG їх побачить після autorotate)
LOGICAL_W=$SRC_W
LOGICAL_H=$SRC_H
if [ "$SRC_ROT_ABS" = "90" ] || [ "$SRC_ROT_ABS" = "270" ]; then
  LOGICAL_W=$SRC_H
  LOGICAL_H=$SRC_W
  echo "::warning::Rotation detected — logical dimensions ${LOGICAL_W}×${LOGICAL_H} (swapped from container ${SRC_W}×${SRC_H})"
fi

# #385 (14.06.2026): HDR pass-through. НЕ перекодовуємо HDR взагалі.
#
# Історія катастроф з HDR→SDR conversion:
#   #256 — Hable: washed
#   #291 — Mobius + eq saturation boost: неприродно
#   #301 — повний rollback: SDR клієнти бачать перенасичено
#   #385 — bench Mobius БЕЗ eq: Вадим: «всі зразки виглядають погано»
#
# Висновок: математично неможливо HDR→SDR конверсія, яка би зберегла оригінал.
# Telegram приймає HEVC Main10 HLG/PQ напряму:
#   • HDR-клієнти (iPhone Pro, MacBook, recent Android) → бачать точний оригінал
#   • SDR-клієнти → TG сам робить downconvert (їхня логіка під клієнтську панель)
# У будь-якому випадку це краще ніж наш ffmpeg.
#
# Тому: HDR detected → pass source through без ffmpeg encode.
# SDR detected → нормальне H.264 перекодування для бітрейту/розміру.
SRC_TRANSFER=$(echo "$PROBE" | jq -r '.streams[0].color_transfer // ""')
SRC_PRIMARIES=$(echo "$PROBE" | jq -r '.streams[0].color_primaries // ""')
SRC_PIXFMT=$(echo "$PROBE" | jq -r '.streams[0].pix_fmt // ""')
IS_HDR="no"
case "$SRC_TRANSFER" in
  arib-std-b67|smpte2084) IS_HDR="yes" ;;
esac
case "$SRC_PRIMARIES" in
  bt2020) IS_HDR="yes" ;;
esac
echo "Color: transfer=${SRC_TRANSFER} primaries=${SRC_PRIMARIES} pix=${SRC_PIXFMT} HDR=${IS_HDR}"

# HDR pass-through: source у межах TG ліміту (50MB) → upload as-is і exit
if [ "$IS_HDR" = "yes" ] && [ "$IN_SIZE" -le $((49 * 1024 * 1024)) ]; then
  echo "=== HDR source detected — pass-through (no encode) ==="
  echo "TG handles HDR rendering: HDR clients see original, SDR clients get TG downconvert"
  OBJECT_KEY="video-compressed/${CRE_ID}.mp4"
  PUBLIC_URL=$(upload_to_r2 "$INPUT" "$OBJECT_KEY" "video/mp4")
  echo "HDR pass-through uploaded: $PUBLIC_URL"
  curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_compress_job" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg id "$CRE_ID" --arg url "$PUBLIC_URL" --argjson sz "$IN_SIZE" '{cre_id:$id, out_url:$url, out_size_bytes:$sz}')"
  echo "✓ HDR pass-through DONE: $CRE_ID → $PUBLIC_URL (${IN_MB} MB, original codec preserved)"
  generate_video_poster_and_patch "$INPUT" "$CRE_ID"
  exit 0
fi

# #388 (14.06.2026): HDR >49MB → HEVC 2-pass encode з ЗБЕРЕЖЕННЯМ HDR metadata.
#
# Стискання БЕЗ color processing: тільки scale + bitrate. Pixel data залишається у
# yuv420p10le HLG BT.2020, output tag-ується відповідно. TG приймає HEVC файли і
# на HDR-клієнтах рендерить як оригінал.
#
# Чому НЕ H.264:
#   • H.264 8-bit yuv420p втрачає 10-bit precision HLG
#   • H.264 + HDR metadata = нестандарт, не всі плеєри/TG-клієнти зрозуміють
#   • libx264 default colormatrix = bt709 → TG думає що це SDR → washed
#   • HEVC Main10 нативно підтримує HLG bt2020 через -x265-params:
#     colorprim=bt2020 transfer=arib-std-b67 colormatrix=bt2020nc hdr10-opt=1
#
if [ "$IS_HDR" = "yes" ]; then
  echo "=== HDR >49MB — HEVC 2-pass encode зі збереженням HDR metadata ==="

  # Бюджет (50 MB ceiling, 99% fill)
  EFFECTIVE_BUDGET=$((TARGET_BUDGET_BYTES * TARGET_FILL_PCT / 100))
  TOTAL_KBPS=$(awk "BEGIN{printf \"%.0f\", ($EFFECTIVE_BUDGET * 8 / 1024) / $DURATION}")
  AUDIO_KBPS=$MIN_AUDIO_KBPS
  if [ "$TOTAL_KBPS" -ge 1500 ]; then AUDIO_KBPS=$MAX_AUDIO_KBPS; fi
  VIDEO_KBPS=$((TOTAL_KBPS - AUDIO_KBPS - MUX_OVERHEAD_KBPS))
  if [ "$VIDEO_KBPS" -lt 500 ]; then VIDEO_KBPS=500; fi
  echo "HDR encode budget: video=${VIDEO_KBPS}k audio=${AUDIO_KBPS}k"

  # Resolution: для HDR залишаємо повний 1920 longest side (HDR заслуговує якості)
  if [ "$LOGICAL_W" -ge "$LOGICAL_H" ]; then SRC_LONG=$LOGICAL_W; else SRC_LONG=$LOGICAL_H; fi
  HDR_MAX_LONG=1920
  if [ "$SRC_LONG" -lt "$HDR_MAX_LONG" ]; then HDR_MAX_LONG=$SRC_LONG; fi
  HDR_SCALE="scale='if(gt(iw,ih),min(${HDR_MAX_LONG},iw),-2)':'if(gt(ih,iw),min(${HDR_MAX_LONG},ih),-2)':flags=lanczos,setsar=1"

  # x265 з HLG bt2020 metadata збереженням
  # #526: rc-lookahead=40 (було 60) — мінус ~15% CPU
  HDR_X265_PARAMS="log-level=error:keyint=120:bframes=6:rc-lookahead=40:aq-mode=3:psy-rd=2.0:psy-rdoq=1.0:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:range=limited:hdr10-opt=1"

  echo "[HDR HEVC Pass 1/2] @ ${VIDEO_KBPS}k..."
  # #526: x265 preset slow → medium (HDR pass-through 100% покриває маленькі файли,
  # HEVC шлях triggers лише для HDR >49MB — це рідкісний випадок, можна швидше)
  ffmpeg -y -v error -stats -i "$INPUT" \
    -c:v libx265 -preset medium -profile:v main10 -pix_fmt yuv420p10le \
    -x265-params "${HDR_X265_PARAMS}:pass=1:stats=${PASS_LOG_HEVC}" \
    -b:v "${VIDEO_KBPS}k" -maxrate "$((VIDEO_KBPS * 110 / 100))k" -bufsize "$((VIDEO_KBPS * 2))k" \
    -vf "$HDR_SCALE" \
    -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc \
    -an -f null /dev/null

  echo "[HDR HEVC Pass 2/2] Encoding..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    -c:v libx265 -preset medium -profile:v main10 -pix_fmt yuv420p10le -tag:v hvc1 \
    -x265-params "${HDR_X265_PARAMS}:pass=2:stats=${PASS_LOG_HEVC}" \
    -b:v "${VIDEO_KBPS}k" -maxrate "$((VIDEO_KBPS * 110 / 100))k" -bufsize "$((VIDEO_KBPS * 2))k" \
    -vf "$HDR_SCALE" \
    -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc \
    -c:a aac -b:a "${AUDIO_KBPS}k" -ac 2 -ar 48000 \
    -movflags +faststart \
    "$OUTPUT"

  HDR_OUT_SIZE=$(stat -c%s "$OUTPUT")
  HDR_OUT_MB=$(awk "BEGIN{printf \"%.1f\", $HDR_OUT_SIZE/1024/1024}")
  echo "HDR HEVC Final: ${HDR_OUT_MB} MB (color tags preserved: bt2020/HLG)"

  if [ "$HDR_OUT_SIZE" -gt "$TARGET_BUDGET_BYTES" ]; then
    echo "::error::HDR HEVC overshoot ${HDR_OUT_SIZE} > ${TARGET_BUDGET_BYTES}. Скоротіть тривалість відео."
    curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fail_compress_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg id "$CRE_ID" --arg err "HDR HEVC encode overshoot ${HDR_OUT_MB}MB > 49.5MB — скоротіть відео" '{cre_id:$id, err_msg:$err}')"
    exit 1
  fi

  OBJECT_KEY="video-compressed/${CRE_ID}.mp4"
  PUBLIC_URL=$(upload_to_r2 "$OUTPUT" "$OBJECT_KEY" "video/mp4")
  echo "HDR HEVC uploaded: $PUBLIC_URL"
  curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_compress_job" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg id "$CRE_ID" --arg url "$PUBLIC_URL" --argjson sz "$HDR_OUT_SIZE" '{cre_id:$id, out_url:$url, out_size_bytes:$sz}')"
  echo "✓ HDR HEVC DONE: $CRE_ID → $PUBLIC_URL (${HDR_OUT_MB} MB, HDR color tags preserved)"
  generate_video_poster_and_patch "$INPUT" "$CRE_ID"
  exit 0
fi

HDR_PREFIX=""

# v2: Target = 99% of budget, не 91% undershoot
EFFECTIVE_BUDGET=$((TARGET_BUDGET_BYTES * TARGET_FILL_PCT / 100))
TOTAL_KBPS=$(awk "BEGIN{printf \"%.0f\", ($EFFECTIVE_BUDGET * 8 / 1024) / $DURATION}")
echo "Total bitrate budget (99% fill): ${TOTAL_KBPS} kbps"

AUDIO_KBPS=$MIN_AUDIO_KBPS
if [ "$TOTAL_KBPS" -ge 1500 ]; then AUDIO_KBPS=$MAX_AUDIO_KBPS; fi

VIDEO_KBPS=$((TOTAL_KBPS - AUDIO_KBPS - MUX_OVERHEAD_KBPS))
if [ "$VIDEO_KBPS" -lt 300 ]; then VIDEO_KBPS=300; fi
echo "Audio: ${AUDIO_KBPS}k | Video budget: ${VIDEO_KBPS}k"

# #389 (14.06.2026): Bench videocompress.ai vs наш — порівняння IMG_8011 (164s, 207MB).
# Їхній output: 1080×1920 @ 30fps, 2.2 Mbps, libx264 — ВЖЕ те ж саме ffmpeg.
# Наш output: 480×854 @ 60fps, 2.1 Mbps — мізерна резолюція!
#
# Корінь: старий ladder вимагав 2200kbps для 1280p та 4500kbps для 1920p.
# При 2.1 Mbps бюджеті падали у 854p → втрата деталей.
#
# Новий принцип: пріоритезуємо РЕЗОЛЮЦІЮ над bitrate-per-pixel. iPhone Reels 1080×1920
# native — при 2 Mbps + 30fps якість H.264 високого профілю достатня.
if [ "$VIDEO_KBPS" -ge 2000 ]; then MAX_LONG=1920    # Full 1080p (or up to 1920 long side)
elif [ "$VIDEO_KBPS" -ge 1000 ]; then MAX_LONG=1280   # 720p
elif [ "$VIDEO_KBPS" -ge 500 ]; then MAX_LONG=854     # 480p
else MAX_LONG=640                                       # 360p
fi

# #260: Використовуємо LOGICAL dimensions (після rotation) для рішень про size
if [ "$LOGICAL_W" -ge "$LOGICAL_H" ]; then SRC_LONG=$LOGICAL_W; else SRC_LONG=$LOGICAL_H; fi
if [ "$SRC_LONG" -lt "$MAX_LONG" ]; then MAX_LONG=$SRC_LONG; fi

# #389: fps cap. iPhone може знімати 60 fps, але 30 fps вистачає для SMM/TG.
# При 60 fps + 2 Mbps бюджет розмазується → кожен кадр отримує ½ біт.
# При 30 fps + 2 Mbps → у 2× більше біт на кадр → деталі краще.
# Залишаємо 60 fps тільки якщо бюджет ≥ 4 Mbps.
SRC_FPS_INT=$(echo "$SRC_FPS" | awk '{printf "%d", $1+0.5}')
FPS_FILTER=""
if [ "$SRC_FPS_INT" -gt 30 ] && [ "$VIDEO_KBPS" -lt 4000 ]; then
  echo "FPS cap: ${SRC_FPS_INT}fps → 30fps (budget < 4Mbps, more bits per frame)"
  FPS_FILTER=",fps=30"
fi

# scale filter використовує iw/ih (post-rotation pixels) — ffmpeg autorotate розгортає
# raw landscape pixels у logical portrait ПЕРЕД filter graph (з v5.x), тому iw/ih = LOGICAL
SCALE_FILTER="${HDR_PREFIX}scale='if(gt(iw,ih),min(${MAX_LONG},iw),-2)':'if(gt(ih,iw),min(${MAX_LONG},ih),-2)':flags=lanczos,setsar=1${FPS_FILTER}"
echo "Target longest side: ${MAX_LONG}px (orig logical=${SRC_LONG}), aspect preserved${FPS_FILTER:+, $FPS_FILTER}"
[ -n "$HDR_PREFIX" ] && echo "HDR→SDR tone mapping ENABLED"

# #526 (20.06.2026): preset veryslow → slow. veryslow дає ~1.5% краще стиснення
# але у 3-4× повільніше. На фоні розміру H.264 у TG/IG це непомітно. Тішучи runners,
# забезпечуємо що 1-min кліп завжди влізає у 30-min timeout навіть на slowest runner.
X264_OPTS="-c:v libx264 -profile:v high -level 4.1 -preset slow -tune film"
# #526: subme=8 (було 10), merange=24 (було 32), rc-lookahead=60 (було 80).
#       Bframes=8 (було 12) — кращий tradeoff swap для preset=slow.
#       Сумарно: ~50% швидше encoding на тому ж VIDEO_KBPS бюджеті.
X264_PARAMS="bframes=8:b-adapt=2:ref=6:no-fast-pskip=1:aq-mode=3:aq-strength=1.0:psy-rd=1.0,0.15:rc-lookahead=60:trellis=2:me=hex:subme=8:mixed-refs=1:8x8dct=1:weightb=1:weightp=2:merange=24:qcomp=0.7:deblock=-1,-1"

echo ""
echo "[H.264 Pass 1/2] slow analyzing @ ${VIDEO_KBPS}k..."
ffmpeg -y -v error -stats -i "$INPUT" \
  $X264_OPTS \
  -x264-params "$X264_PARAMS" \
  -b:v "${VIDEO_KBPS}k" -maxrate "$((VIDEO_KBPS * 115 / 100))k" -bufsize "$((VIDEO_KBPS * 25 / 10))k" \
  -vf "$SCALE_FILTER" \
  -pass 1 -passlogfile "$PASS_LOG" \
  -an -f null /dev/null

echo "[H.264 Pass 2/2] Encoding @ ${VIDEO_KBPS}k + ${AUDIO_KBPS}k AAC..."
ffmpeg -y -v error -stats -i "$INPUT" \
  $X264_OPTS \
  -x264-params "$X264_PARAMS" \
  -b:v "${VIDEO_KBPS}k" -maxrate "$((VIDEO_KBPS * 115 / 100))k" -bufsize "$((VIDEO_KBPS * 25 / 10))k" \
  -vf "$SCALE_FILTER" \
  -pass 2 -passlogfile "$PASS_LOG" \
  -c:a aac -b:a "${AUDIO_KBPS}k" -ac 2 -ar 48000 \
  -movflags +faststart -pix_fmt yuv420p \
  "$OUTPUT"
  # #292: видалив -metadata:s:v:0 rotate=0
  # ffmpeg 6.x autorotate=on автоматично обертає фрейми ПЕРЕД scale,
  # тому output вже physical-rotated. Force-strip rotation tag не потрібен
  # і призводив до mismatch між container metadata і реальним output → quadratic TG preview.

OUT_SIZE=$(stat -c%s "$OUTPUT")

if [ "$OUT_SIZE" -gt "$TARGET_BUDGET_BYTES" ]; then
  RETRY_KBPS=$((VIDEO_KBPS * 93 / 100))
  echo "::warning::H.264 overshoot ($OUT_SIZE > $TARGET_BUDGET_BYTES). Retry @ ${RETRY_KBPS}k..."
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

OBJECT_KEY="video-compressed/${CRE_ID}.mp4"
PUBLIC_URL=$(upload_to_r2 "$OUTPUT" "$OBJECT_KEY" "video/mp4")
echo "H.264 uploaded: $PUBLIC_URL"

curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/complete_compress_job" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg id "$CRE_ID" --arg url "$PUBLIC_URL" --argjson sz "$OUT_SIZE" '{cre_id:$id, out_url:$url, out_size_bytes:$sz}')"

echo "✓ H.264 DONE: $CRE_ID → $PUBLIC_URL ($OUT_MB MB, ${OUT_W}×${OUT_H})"
generate_video_poster_and_patch "$INPUT" "$CRE_ID"

if [ "$ENABLE_HEVC" = "1" ]; then
  HEVC_MAX_LONG=1920
  if [ "$SRC_LONG" -lt "$HEVC_MAX_LONG" ]; then HEVC_MAX_LONG=$SRC_LONG; fi
  HEVC_SCALE="scale='if(gt(iw,ih),min(${HEVC_MAX_LONG},iw),-2)':'if(gt(ih,iw),min(${HEVC_MAX_LONG},ih),-2)':flags=lanczos,setsar=1"
  HEVC_KBPS=$((VIDEO_KBPS - 100))
  if [ "$HEVC_KBPS" -lt 300 ]; then HEVC_KBPS=300; fi

  echo ""
  echo "[HEVC Pass 1/2] x265 main, medium preset, ${HEVC_KBPS}k..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    -c:v libx265 -preset medium -profile:v main \
    -x265-params "log-level=error:keyint=120:bframes=6:rc-lookahead=40:aq-mode=3:psy-rd=2.0:psy-rdoq=1.0:pass=1:stats=$PASS_LOG_HEVC" \
    -b:v "${HEVC_KBPS}k" -maxrate "$((HEVC_KBPS * 110 / 100))k" -bufsize "$((HEVC_KBPS * 2))k" \
    -vf "$HEVC_SCALE" \
    -an -f null /dev/null

  echo "[HEVC Pass 2/2] Encoding..."
  ffmpeg -y -v error -stats -i "$INPUT" \
    -c:v libx265 -preset medium -profile:v main -tag:v hvc1 \
    -x265-params "log-level=error:keyint=120:bframes=6:rc-lookahead=40:aq-mode=3:psy-rd=2.0:psy-rdoq=1.0:pass=2:stats=$PASS_LOG_HEVC" \
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

if [ "$DISPATCH_AUTOPOST" = "1" ]; then
  echo ""
  echo "Triggering autopost workflow via dispatch-workflow Edge Function..."
  DISPATCH_HTTP=$(curl -sS -o /tmp/cw/dispatch-resp.txt -w "%{http_code}" -X POST \
    "$SUPABASE_URL/functions/v1/dispatch-workflow" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"workflow":"autopost"}' || echo "000")
  if [ "$DISPATCH_HTTP" = "200" ]; then
    echo "✓ Autopost workflow dispatched"
  else
    echo "::warning::Dispatch autopost failed HTTP=$DISPATCH_HTTP: $(cat /tmp/cw/dispatch-resp.txt 2>/dev/null | head -c 300)"
    echo "::warning::Cron */5min все одно підхопить через ≤5 хв"
  fi
fi

trap - ERR
rm -rf /tmp/cw

echo ""
echo "=== Worker done ==="
