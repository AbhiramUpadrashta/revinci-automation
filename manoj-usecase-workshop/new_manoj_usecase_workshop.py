#!/usr/bin/env python3
"""
new manoj usecase workshop
--------------------------
Ingests outcome usage (outcome_id = task_completed) for the A-1 Consumption
Agent on plan PLAN002259, using the same payload shape as the working
Postman request.

  August 2026    -> 1,400 tasks (under the 1,500 included -> bill $8,000)
  September 2026 -> 1,700 tasks (200 over -> $8,000 + 200 x $7.00 = $9,400)

Overage check: $8,000 / 1,500 = $5.3333 per task; x 1.3125 (31.25%) = $7.00.

One API call = one completed task, so August sends 1,400 calls and
September sends 1,700, spread evenly across the days of each month.

Usage:
  python3 new_manoj_usecase_workshop.py --dry-run         # show sample payloads, send nothing
  python3 new_manoj_usecase_workshop.py --month aug       # send August only
  python3 new_manoj_usecase_workshop.py --month sep       # send September only
  python3 new_manoj_usecase_workshop.py                   # send both
"""

import argparse
import calendar
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

# ----------------------------- CONFIG ---------------------------------------
API_URL = os.getenv("RVC_API_URL",
                    "https://api-dev.revinci.ai/usage-ingestion/api/v1/usage/ingest")
API_KEY = os.getenv("RVC_API_KEY",
                    "rvc_dev_N1wl1Tvj1ARReNJlo5qZGoaAfqW8tfWRjsqY8UomcUsjHZQA")

PLAN_NUMBER         = "PLAN002259"
OUTCOME_ID          = "task_completed"
CUSTOMER_ID         = os.getenv("RVC_CUSTOMER_ID", "hr.manager@revinci.ai")
EXTERNAL_ACCOUNT_ID = os.getenv("RVC_EXTERNAL_ACCOUNT_ID", "RVC-ACCT-TEST-001")
PROVIDER            = "anthropic"
MODEL               = "Ministral 3"
AGENT_NAME          = "a1-consumption-agent"
YEAR                = 2026

SCENARIO = {
    "aug": {"month": 8, "tasks": 1400},
    "sep": {"month": 9, "tasks": 1700},
}

COMMITMENT     = 8000.00
INCLUDED_TASKS = 1500
OVERAGE_PRICE  = 7.00
WORKERS        = 10
# ----------------------------------------------------------------------------


def build_payload(key, n, ts_ms):
    tag = f"manoj-ws-{key}-{n:05d}"
    return {
        "provider": PROVIDER,
        "planNumber": PLAN_NUMBER,
        "customerId": CUSTOMER_ID,
        "externalAccountId": EXTERNAL_ACCOUNT_ID,
        "apiResponse": {
            "id": f"chatcmpl_{tag}",
            "model": MODEL,
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "cache_read_input_tokens": 0,
            },
        },
        "metadata": {
            "session_id": f"session-{tag}",
            "agent_name": AGENT_NAME,
            "department": "workshop",
            "channel": "web_chat",
            "outcome_id": OUTCOME_ID,
            "source_platform": "revinci_demo",
        },
        "eventTimestamp": ts_ms,
    }


def payloads_for(key):
    cfg = SCENARIO[key]
    m, total = cfg["month"], cfg["tasks"]
    days = calendar.monthrange(YEAR, m)[1]
    base, rem = divmod(total, days)
    out, n = [], 0
    for d in range(days):
        per_day = base + (1 if d < rem else 0)
        day_start = datetime(YEAR, m, d + 1, 4, 0, tzinfo=timezone.utc)  # 09:30 IST
        for i in range(per_day):
            n += 1
            ts_ms = int(day_start.timestamp() * 1000) + i * 20_000  # 20s apart
            out.append(build_payload(key, n, ts_ms))
    return out


def post(payload):
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "Authorization": f"Bearer {API_KEY}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except urllib.error.URLError as e:
        return None, str(e.reason)


def main():
    ap = argparse.ArgumentParser(description="new manoj usecase workshop")
    ap.add_argument("--month", choices=["aug", "sep", "both"], default="both")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    months = ["aug", "sep"] if args.month == "both" else [args.month]
    total_failed = 0
    print(f"Plan {PLAN_NUMBER} | outcome {OUTCOME_ID} | customer {CUSTOMER_ID}")
    print(f"Endpoint {API_URL}\n")

    for key in months:
        tasks = SCENARIO[key]["tasks"]
        over = max(0, tasks - INCLUDED_TASKS)
        bill = COMMITMENT + over * OVERAGE_PRICE
        print(f"=== {key.upper()} {YEAR}: {tasks} tasks ===")
        print(f"  Expected bill: ${COMMITMENT:,.0f} + {over} x ${OVERAGE_PRICE:.2f} = ${bill:,.2f}")

        payloads = payloads_for(key)
        assert len(payloads) == tasks

        if args.dry_run:
            print("  First payload:\n" + json.dumps(payloads[0], indent=2))
            print(f"  ...plus {tasks - 1} more like it\n")
            continue

        # Send the first one alone so a bad payload stops the run early.
        status, body = post(payloads[0])
        print(f"  First call -> [{status}] {body[:400]}")
        if status is None or not 200 <= status < 300:
            print("  Stopping: first call failed. Fix the payload/config and rerun.")
            sys.exit(1)

        ok, failed, done = 1, 0, 1
        lock = threading.Lock()
        errors = []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = [pool.submit(post, p) for p in payloads[1:]]
            for f in as_completed(futures):
                status, body = f.result()
                with lock:
                    done += 1
                    if status is not None and 200 <= status < 300:
                        ok += 1
                    else:
                        failed += 1
                        if len(errors) < 5:
                            errors.append(f"[{status}] {body[:200]}")
                    if done % 100 == 0 or done == tasks:
                        print(f"  {done}/{tasks} sent  (ok {ok}, failed {failed})")
        for e in errors:
            print("  ERROR", e)
        print(f"  {key.upper()} done: {ok} ingested, {failed} failed\n")
        total_failed += failed

    sys.exit(1 if total_failed else 0)


if __name__ == "__main__":
    main()
