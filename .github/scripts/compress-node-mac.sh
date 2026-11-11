#!/bin/bash
# Compress node · Mac Studio (launchd ua.dreamcar.compress-node) · 11.11.2026
#
# Основний вузол стиснення відео HQ. GitHub-воркер (compress-creative.yml) лишається запасним:
# якщо Mac вимкнений або зайнятий, cron */10 і dispatch на upload підхоплять чергу як раніше.
# Одне відео двічі не беруть: claim_compress_jobs = FOR UPDATE SKIP LOCKED.
#
# Чому Mac: GitHub-раннер (2–4 vCPU) стискав 4K-відео 161 с за ~12 хв і ще 1–2 хв ставив ffmpeg,
# а старт запуску залежить від черги GitHub (11.11 о 21:32 запуск не стартував 35 хв).
# M5 Max (18 ядер): те саме відео за 29 с у preset slow. Опитування черги кожні POLL_S секунд.
#
# Секретів у файлі немає. Токен вузла — Keychain «compress-node-token»; у базі лише його sha256
# (app_secrets.compress_node_secret_sha256). Шлюз compress-node пропускає тільки дії воркера.
set -uo pipefail

export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="${COMPRESS_NODE_DIR:-$HOME/.compress-node}"
POLL_S="${POLL_S:-5}"
MIN_FREE_GB="${MIN_FREE_GB:-4}"
GW="${COMPRESS_NODE_GW:-https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/compress-node}"

TOKEN=$(security find-generic-password -s compress-node-token -w 2>/dev/null || true)
if [ -z "$TOKEN" ]; then echo "$(date '+%F %T') no Keychain item compress-node-token — exit"; exit 1; fi

export SUPABASE_URL="$GW" SERVICE_KEY="$TOKEN" R2_SIGN_URL="$GW/r2-sign" DISPATCH_URL="$GW/dispatch-autopost"
export CLAIM_TYPE=video X264_PRESET="${X264_PRESET:-slow}" JOB_TIMEOUT_S="${JOB_TIMEOUT_S:-900}" LOOP_BUDGET_S="${LOOP_BUDGET_S:-3000}"
export WORKER_ID="mac-studio"
mkdir -p "$RUN_DIR"

log() { echo "$(date '+%F %T') $*"; }
log "compress-node started, poll=${POLL_S}s, preset=$X264_PRESET"

while true; do
  N=$(curl -sS --max-time 15 -X POST "$GW/rest/v1/rpc/peek_compress_jobs" \
        -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        -d '{"p_type":"video"}' 2>/dev/null || echo "")
  case "$N" in ''|*[!0-9]*) sleep 30; continue ;; esac
  if [ "$N" -gt 0 ]; then
    FREE_GB=$(df -Pk /tmp | awk 'NR==2{print int($4/1024/1024)}')
    if [ "$FREE_GB" -lt "$MIN_FREE_GB" ]; then
      log "queue=$N, but free disk ${FREE_GB} GB < ${MIN_FREE_GB} — leaving it to GitHub"; sleep 60; continue
    fi
    # Копія скриптів на час прогону: repo-sync може оновити файли посеред роботи bash.
    cp "$SRC_DIR/compress-creative-worker.sh" "$SRC_DIR/compress-creative-loop.sh" "$RUN_DIR/"
    log "queue=$N → run"
    T0=$(date +%s)
    bash "$RUN_DIR/compress-creative-loop.sh"
    log "loop done rc=$? in $(( $(date +%s) - T0 ))s"
  fi
  sleep "$POLL_S"
done
