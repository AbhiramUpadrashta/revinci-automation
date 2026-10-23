#!/usr/bin/env bash
# =============================================================================
# new manoj usecase workshop
# Outcome ingestion for A-1 Consumption Agent, outcome "task_completed"
#
#   August 2026    -> 1,400 tasks  (under 1,500 included  -> bill $8,000)
#   September 2026 -> 1,700 tasks  (200 over              -> $8,000 + 200 x $7 = $9,400)
#
#   Overage check: $8,000 / 1,500 = $5.3333 per task, x 1.3125 (31.25%) = $7.00
#
# Usage:
#   ./new_manoj_usecase_workshop.sh jul        # July: 1,100 tasks (x $7 = $7,700, under $8,000)
#   ./new_manoj_usecase_workshop.sh aug        # August only
#   ./new_manoj_usecase_workshop.sh sep        # September only (over commitment)
#   ./new_manoj_usecase_workshop.sh both       # both months
#   ./new_manoj_usecase_workshop.sh test       # ONE call dated 23 Oct, shows full response
#   ./new_manoj_usecase_workshop.sh dryrun     # print a sample payload, send nothing
#
# Override any setting on the command line, e.g.
#   PLAN_NUMBER=IT-PLAN002259 CUSTOMER_ID=x@y.com ./new_manoj_usecase_workshop.sh aug
# =============================================================================

API_URL="${API_URL:-https://api-dev.revinci.ai/usage-ingestion/api/v1/usage/ingest}"
API_KEY="${API_KEY:-rvc_dev_N1wl1Tvj1ARReNJlo5qZGoaAfqW8tfWRjsqY8UomcUsjHZQA}"
TENANT_ID="${TENANT_ID:-tessla}"
PLAN_NUMBER="${PLAN_NUMBER:-PLAN002259}"
OUTCOME_ID="${OUTCOME_ID:-task_completed}"
OUTCOME_VALUE="${OUTCOME_VALUE:-7.00}"
CUSTOMER_ID="${CUSTOMER_ID:-test_user_1@test.com}"
EXTERNAL_ACCOUNT_ID="${EXTERNAL_ACCOUNT_ID:-COMP-1}"
PROVIDER="${PROVIDER:-ANTHROPIC}"
MODEL="${MODEL:-Perplexity}"
EVENT_TYPE="${EVENT_TYPE:-LLM_INFERENCE_CALL}"
SOURCE_PLATFORM_TOP="${SOURCE_PLATFORM_TOP:-SDK_PUSH}"
AGENT_NAME="${AGENT_NAME:-a1-consumption-agent}"
PARALLEL="${PARALLEL:-10}"

JUL_TASKS="${JUL_TASKS:-1100}"   # 1,100 x $7 = $7,700 -> stays under $8,000
AUG_TASKS="${AUG_TASKS:-1400}"
SEP_TASKS="${SEP_TASKS:-1700}"
INCLUDED=1500; COMMITMENT=8000; OVERAGE=7

JUL_START=1782864000   # 2026-07-01 00:00 UTC
AUG_START=1785542400   # 2026-08-01 00:00 UTC (epoch seconds)
SEP_START=1788220800   # 2026-09-01 00:00 UTC
TEST_TS_MS=1792713600000  # 2026-10-23 00:00 UTC (test call, outside Aug/Sep)

RUN_ID="$(date +%Y%m%d%H%M%S)"
LOG_DIR="$(cd "$(dirname "$0")" && pwd)/logs"
mkdir -p "$LOG_DIR"

payload() {  # $1 = tag, $2 = eventTimestamp (ms) -- same shape as the working stress script
  cat <<JSON
{"provider":"$PROVIDER","planNumber":"$PLAN_NUMBER","customerId":"$CUSTOMER_ID","externalAccountId":"$EXTERNAL_ACCOUNT_ID","eventType":"$EVENT_TYPE","sourcePlatform":"$SOURCE_PLATFORM_TOP","apiResponse":{"id":"msg_$1","model":"$MODEL","usage":{"input_tokens":150,"output_tokens":200,"cache_read_input_tokens":0,"total_cost":0.250000,"external_api_cost":0.055000,"network_cost":0.010000}},"metadata":{"conversation_turn":"1","total_turns":"1","outcome_id":"$OUTCOME_ID","outcome_value":"$OUTCOME_VALUE","session_id":"task_completed_$1","agent_name":"$AGENT_NAME","department":"workshop","channel":"web_chat","source_platform":"revinci_demo","processing_attempts":"0","processed_at":"0"},"eventTimestamp":$2}
JSON
}

send() {  # $1 = tag, $2 = ts_ms ; prints "HTTP_CODE<TAB>body"
  local body resp code
  body="$(payload "$1" "$2")"
  resp="$(curl -sS -m 30 -w $'\n%{http_code}' -X POST "$API_URL" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Tenant-Id: $TENANT_ID" \
          -d "$body" 2>&1)"
  code="${resp##*$'\n'}"
  printf '%s\t%s\n' "$code" "$(printf '%s' "${resp%$'\n'*}" | tr '\n' ' ' | cut -c1-300)"
}
export -f payload send
export API_URL API_KEY TENANT_ID PLAN_NUMBER OUTCOME_ID OUTCOME_VALUE CUSTOMER_ID EXTERNAL_ACCOUNT_ID PROVIDER MODEL EVENT_TYPE SOURCE_PLATFORM_TOP AGENT_NAME

run_month() {  # $1 = name, $2 = tasks, $3 = month start epoch, $4 = days in month
  local name=$1 tasks=$2 start=$3 days=$4
  local over=$(( tasks > INCLUDED ? tasks - INCLUDED : 0 ))
  local bill=$(( COMMITMENT + over * OVERAGE ))
  local log="$LOG_DIR/${name}_${RUN_ID}.log"

  echo "=================================================================="
  echo " $name 2026 : $tasks tasks  | plan $PLAN_NUMBER | outcome $OUTCOME_ID"
  echo " Included $INCLUDED, overage tasks $over"
  echo " Expected bill: \$$COMMITMENT + $over x \$$OVERAGE = \$$bill"
  echo "=================================================================="

  # Build the job list: "tag ts_ms", spread evenly across the month
  local jobs="$LOG_DIR/${name}_${RUN_ID}.jobs"; : > "$jobs"
  local base=$(( tasks / days )) rem=$(( tasks % days )) n=0 d i per
  for (( d=0; d<days; d++ )); do
    per=$(( base + (d < rem ? 1 : 0) ))
    for (( i=0; i<per; i++ )); do
      n=$(( n + 1 ))
      # 09:30 IST each day (04:00 UTC) + 20s per task
      echo "manoj-ws-$(echo "$name" | tr 'A-Z' 'a-z')-$RUN_ID-$(printf %05d $n) $(( (start + d*86400 + 14400 + i*20) * 1000 ))" >> "$jobs"
    done
  done

  # First call alone: stop early if the payload is rejected
  read -r tag ts < "$jobs"
  local first; first="$(send "$tag" "$ts")"
  echo " First call -> HTTP ${first%%$'\t'*}"
  echo " Response   -> ${first#*$'\t'}"
  echo "$first" > "$log"
  case "${first%%$'\t'*}" in
    2??) ;;
    *) echo " STOPPED: first call failed. Fix the setting above and rerun."; exit 1 ;;
  esac

  echo " Sending remaining $(( tasks - 1 )) calls, $PARALLEL at a time..."
  tail -n +2 "$jobs" | xargs -P "$PARALLEL" -L 1 bash -c 'send "$0" "$1"' >> "$log"

  local ok fail
  ok=$(cut -f1 "$log" | grep -c '^2..$')
  fail=$(( tasks - ok ))
  echo " $name result: $ok ingested OK, $fail failed  (log: $log)"
  if [ "$fail" -gt 0 ]; then
    echo " Failure codes:"; cut -f1 "$log" | grep -v '^2..$' | sort | uniq -c
    echo " Sample errors:"; grep -v $'^2..\t' "$log" | head -3
  fi
  echo
}

case "${1:-}" in
  jul)    run_month JUL "$JUL_TASKS" "$JUL_START" 31 ;;
  aug)    run_month AUG "$AUG_TASKS" "$AUG_START" 31 ;;
  sep)    run_month SEP "$SEP_TASKS" "$SEP_START" 30 ;;
  both)   run_month AUG "$AUG_TASKS" "$AUG_START" 31; run_month SEP "$SEP_TASKS" "$SEP_START" 30 ;;
  test)   echo "Test call (dated 23 Oct 2026):"; payload "manoj-ws-test-$RUN_ID" "$TEST_TS_MS"; echo
          r="$(send "manoj-ws-test-$RUN_ID" "$TEST_TS_MS")"
          echo "HTTP ${r%%$'\t'*}"; echo "Response: ${r#*$'\t'}" ;;
  dryrun) payload "manoj-ws-sample" "$(( (AUG_START + 14400) * 1000 ))" ;;
  *)      echo "Usage: $0 {jul|aug|sep|both|test|dryrun}"; exit 1 ;;
esac
