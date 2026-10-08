#!/usr/bin/env python3
"""observe-report.py — RISK-0042 P3 observe: what WOULD enforce reject on Render?

CLM-0448 · ADR-060 §2.7. Reads the Render logs of the receivers (negotiations,
matching, marketplace) and the issuer (identity) over a window and aggregates:

  user_assertion_outcome     per route: valid / invalid (+ reason)
  user_assertion_ownership   per route + check: would_reject (observe only)
  user_assertion_issued      issuer side: how many assertions identity minted
  incoming request           per route: total traffic (to tell "no failures"
                             from "no traffic")

Health, readiness and metrics routes are excluded from the traffic table.
Output: JSON (no assertion, no public id, no key) + a readable summary.
The verdict is a table, not a pass/fail: observe never rejects, so the
question is which operations would fail under enforce, and why.

Usage:
  RENDER_API_KEY=... python3 scripts/ops/risk-0042/observe-report.py \
      --start 2026-10-03T10:00:00Z --end 2026-10-04T10:00:00Z --out report.json
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
# Workspace from RENDER_OWNER_ID only (CLM-0502): read-only report
sys.path.insert(0, next(str(_p / "scripts" / "ops") for _p in __import__("pathlib").Path(__file__).resolve().parents if (_p / "infra" / "render" / "deploy-target.json").is_file()))
from render_target import explicit_owner  # noqa: E402

API = "https://api.render.com/v1"
OWNER = explicit_owner("observe-report.py")
SERVICES = ("wasla-negotiations", "wasla-matching", "wasla-marketplace", "wasla-identity")
NOISE = ("/health", "/ready", "/metrics", "/livez", "/readyz")


def get(path: str, params: dict) -> dict:
    key = os.environ.get("RENDER_API_KEY", "")
    if not key:
        sys.exit("RENDER_API_KEY is not set")
    url = API + path + "?" + urllib.parse.urlencode(params)
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(4 * (attempt + 1))
                continue
            raise
        except (TimeoutError, urllib.error.URLError):
            if attempt < 5:
                time.sleep(4 * (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def service_ids() -> dict[str, str]:
    rows = get("/services", {"ownerId": OWNER, "limit": "100"})
    return {r["service"]["name"]: r["service"]["id"] for r in rows if r["service"]["name"] in SERVICES}


def logs(resource: str, start: dt.datetime, end: dt.datetime, text: str) -> list[dict]:
    """Walks the window in <= 6 h slices (wide windows answer 503)."""
    out: list[dict] = []
    cur = start
    while cur < end:
        nxt = min(cur + dt.timedelta(hours=6), end)
        p = {"ownerId": OWNER, "resource": resource, "limit": "100", "direction": "forward", "text": text,
             "startTime": cur.strftime("%Y-%m-%dT%H:%M:%SZ"), "endTime": nxt.strftime("%Y-%m-%dT%H:%M:%SZ")}
        for _ in range(200):
            d = get("/logs", p)
            out += d.get("logs", [])
            if not d.get("hasMore"):
                break
            p["startTime"], p["endTime"] = d["nextStartTime"], d["nextEndTime"]
        cur = nxt
    return out


def parse(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        try:
            m = json.loads(r["message"])
        except (ValueError, KeyError):
            continue
        if isinstance(m, dict):
            out.append(m)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    start = dt.datetime.fromisoformat(a.start.replace("Z", "+00:00"))
    end = dt.datetime.fromisoformat(a.end.replace("Z", "+00:00"))
    ids = service_ids()
    report: dict = {"window": {"start": a.start, "end": a.end}, "services": {}}
    for name in SERVICES:
        sid = ids.get(name)
        if sid is None:
            report["services"][name] = {"error": "service not found"}
            continue
        traffic = collections.Counter()
        for m in parse(logs(sid, start, end, "incoming request")):
            req = m.get("req") or {}
            route = f"{req.get('method', '?')} {str(req.get('url', '?')).split('?')[0]}"
            if not route.endswith(NOISE):
                traffic[route] += 1
        outcomes = collections.Counter()
        ownership = collections.Counter()
        issued = collections.Counter()
        for m in parse(logs(sid, start, end, "user_assertion")):
            ev = m.get("event")
            if ev == "user_assertion_outcome":
                outcomes[(m.get("route"), m.get("mode"), m.get("outcome"), m.get("reason") or "-", m.get("caller") or "-")] += 1
            elif ev == "user_assertion_ownership":
                ownership[(m.get("route"), m.get("mode"), m.get("check"), m.get("caller") or "-")] += 1
            elif ev == "user_assertion_issued":
                issued[(m.get("act") or "-", m.get("via") or "-")] += 1
        report["services"][name] = {
            "traffic_non_health": dict(traffic.most_common()),
            "assertion_outcomes": [
                {"route": k[0], "mode": k[1], "outcome": k[2], "reason": k[3], "caller": k[4], "count": v}
                for k, v in sorted(outcomes.items(), key=lambda kv: -kv[1])
            ],
            "ownership_would_reject": [
                {"route": k[0], "mode": k[1], "check": k[2], "caller": k[3], "count": v}
                for k, v in sorted(ownership.items(), key=lambda kv: -kv[1])
            ],
            "issued": [{"act": k[0], "via": k[1], "count": v} for k, v in issued.items()],
        }
    would_fail = []
    for name, s in report["services"].items():
        for o in s.get("assertion_outcomes", []):
            if o["outcome"] == "invalid":
                would_fail.append({"service": name, "route": o["route"], "why": f"assertion {o['reason']}", "caller": o["caller"], "count": o["count"]})
        for o in s.get("ownership_would_reject", []):
            would_fail.append({"service": name, "route": o["route"], "why": f"ownership {o['check']}", "caller": o["caller"], "count": o["count"]})
    report["would_fail_under_enforce"] = would_fail
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    for name, s in report["services"].items():
        t = sum(s.get("traffic_non_health", {}).values())
        v = sum(o["count"] for o in s.get("assertion_outcomes", []) if o["outcome"] == "valid")
        i = sum(o["count"] for o in s.get("assertion_outcomes", []) if o["outcome"] == "invalid")
        w = sum(o["count"] for o in s.get("ownership_would_reject", []))
        n = sum(o["count"] for o in s.get("issued", []))
        print(f"{name:20s} traffic={t:5d} valid={v:4d} invalid={i:4d} ownership_would_reject={w:4d} issued={n:4d}")
    for w in would_fail:
        print(f"WOULD FAIL  {w['service']:20s} {w['route']:45s} {w['why']:32s} caller={w['caller']} x{w['count']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
