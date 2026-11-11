#!/bin/bash
# Compress Creative Loop — один слот черги стиснення (11.11.2026).
#
# Раніше: один запуск workflow = одне відео, запуски строго по черзі, наступний — до 10 хв.
# Тепер: кожен слот (matrix у compress-creative.yml) бере задачі одна за одною, поки черга
# не спорожніє або не вийде бюджет часу. Слоти працюють паралельно на окремих раннерах;
# одне відео двічі не беруть — claim_compress_jobs блокує рядок (FOR UPDATE SKIP LOCKED).
#
# Watchdog: задача довша за JOB_TIMEOUT_S обривається (ffmpeg теж), задача повертається
# в чергу через fail_compress_job (до 3 спроб) і не блокує решту.
#
# ENV: JOB_TIMEOUT_S (900 = 15 хв), LOOP_BUDGET_S (2100 = 35 хв: після нього нових задач не беремо).
set -uo pipefail

JOB_TIMEOUT_S="${JOB_TIMEOUT_S:-900}"
LOOP_BUDGET_S="${LOOP_BUDGET_S:-2100}"
WORKER="$(dirname "$0")/compress-creative-worker.sh"
BASE_WORKER_ID="${WORKER_ID:-gh}"
export CW_JOB_FILE=/tmp/cw-job-id

: "${SUPABASE_URL:?HQ_DB_URL required}"
: "${SERVICE_KEY:?HQ_DB_SERVICE_KEY required}"

START=$(date +%s)
N=0
FINAL_RC=0
while [ $(( $(date +%s) - START )) -lt "$LOOP_BUDGET_S" ]; do
  N=$((N + 1))
  rm -f "$CW_JOB_FILE"; rm -rf /tmp/cw
  echo "::group::Задача #$N"
  T0=$(date +%s)
  WORKER_ID="${BASE_WORKER_ID}-$N" timeout -k 30 "$JOB_TIMEOUT_S" bash "$WORKER"
  RC=$?
  echo "::endgroup::"
  JOB_ID=$(cat "$CW_JOB_FILE" 2>/dev/null || true)
  if [ -z "$JOB_ID" ]; then
    if [ "$RC" -ne 0 ]; then
      echo "::error::Воркер завершився з кодом $RC, не взявши задачу (claim / API / налаштування)"
      FINAL_RC=1
    else
      echo "Черга порожня — слот завершує роботу (оброблено задач: $((N - 1)))"
    fi
    break
  fi
  echo "Задача $JOB_ID: код $RC за $(( $(date +%s) - T0 )) с"
  if [ "$RC" -eq 124 ] || [ "$RC" -eq 137 ]; then
    # Задача могла вже стати «Готово» (complete_compress_job), а таймаут прийшовся на постер/autopost —
    # тоді не відкочуємо її назад у чергу.
    ST=$(curl -sS --max-time 20 "$SUPABASE_URL/rest/v1/creatives?id=eq.$JOB_ID&select=compressed_status" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | jq -r '.[0].compressed_status // ""' 2>/dev/null || true)
    if [ "$ST" != "processing" ]; then
      echo "::warning::Watchdog: задача $JOB_ID уже в статусі '${ST:-?}' — не чіпаємо"
      continue
    fi
    echo "::error::Watchdog: задача $JOB_ID довша за $((JOB_TIMEOUT_S / 60)) хв — обриваємо і ставимо на повтор"
    curl -sS --max-time 20 -X POST "$SUPABASE_URL/rest/v1/rpc/fail_compress_job" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg id "$JOB_ID" --arg err "watchdog: обробка довша за $((JOB_TIMEOUT_S / 60)) хв" '{cre_id:$id, err:$err}')" || true
  fi
done
rm -rf /tmp/cw "$CW_JOB_FILE"
exit $FINAL_RC
