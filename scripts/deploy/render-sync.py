#!/usr/bin/env python3
"""render-sync.py — deploy an exact main commit to every WASLA Render service
and prove, per service, that the live deploy carries that commit.

Why this exists (CLM-0401 · M6-18B · 2026-09-29):
  Every Render service was created from the *public repository URL*, not
  through a connected Git provider. Render's own build log says so on every
  build: "It looks like we don't have access to your repo, but we'll try to
  clone it anyway." Render does not support auto-deploys for services linked
  that way (https://render.com/docs/web-services), so `autoDeploy: yes` on all
  24 services was inert: across every recorded deploy the trigger is `api` or
  `manual` — never `new_commit` — and production drifted 195 commits behind
  main (last live commit 4894f39, 2026-09-21).

What it does:
  1. Lists the owner's services whose name starts with `wasla-`.
  2. Triggers `POST /services/{id}/deploys` with `commitId=<target sha>`.
  3. Polls each deploy to a terminal state.
  4. Re-reads the *latest live* deploy per service and compares its commit to
     the target. The verdict is the comparison, not the trigger response.
  5. Writes a JSON evidence file; exits non-zero if any service is not live
     on the target commit. No partial success is reported as success.

Usage:
  RENDER_API_KEY=... python3 scripts/deploy/render-sync.py <sha> [--only a,b] \
      [--verify-only] [--out path.json]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
OWNER = os.environ.get("RENDER_OWNER_ID", "tea-damm8atbedkc73ca3ahg")
TERMINAL_OK = {"live"}
TERMINAL_BAD = {"build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"}


def call(method: str, path: str, body: dict | None = None) -> object:
    key = os.environ.get("RENDER_API_KEY", "")
    if not key:
        sys.exit("RENDER_API_KEY is not set — refusing to report a verdict without measuring.")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f"{method} {path} -> {e.code}: {e.read()[:300]!r}") from e
    raise RuntimeError("unreachable")


def services() -> list[dict]:
    rows = call("GET", f"/services?ownerId={OWNER}&limit=100")
    out = [r["service"] for r in rows if r["service"]["name"].startswith("wasla-")]
    return sorted(out, key=lambda s: s["name"])


def latest_live(sid: str) -> dict | None:
    for row in call("GET", f"/services/{sid}/deploys?limit=20"):
        d = row["deploy"]
        if d.get("status") == "live":
            return d
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sha")
    ap.add_argument("--only", default="")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--out", default="")
    ap.add_argument("--timeout-min", type=int, default=45)
    a = ap.parse_args()

    svcs = services()
    if a.only:
        wanted = set(a.only.split(","))
        svcs = [s for s in svcs if s["name"] in wanted]
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    pending: dict[str, dict] = {}

    if not a.verify_only:
        for s in svcs:
            d = call("POST", f"/services/{s['id']}/deploys", {"commitId": a.sha, "clearCache": "do_not_clear"})
            pending[s["id"]] = {"name": s["name"], "deploy_id": d["id"], "status": d.get("status")}
            print(f"triggered {s['name']:24} {d['id']}", flush=True)
            time.sleep(1)

        deadline = time.time() + a.timeout_min * 60
        while time.time() < deadline and any(
            p["status"] not in TERMINAL_OK | TERMINAL_BAD for p in pending.values()
        ):
            time.sleep(20)
            for sid, p in pending.items():
                if p["status"] in TERMINAL_OK | TERMINAL_BAD:
                    continue
                p["status"] = call("GET", f"/services/{sid}/deploys/{p['deploy_id']}")["status"]
            done = sum(p["status"] in TERMINAL_OK | TERMINAL_BAD for p in pending.values())
            print(f"  … {done}/{len(pending)} terminal", flush=True)

    results = []
    for s in svcs:
        live = latest_live(s["id"])
        live_sha = (live or {}).get("commit", {}).get("id", "")
        results.append({
            "service": s["name"],
            "id": s["id"],
            "type": s["type"],
            "triggered_deploy": pending.get(s["id"], {}).get("deploy_id"),
            "triggered_status": pending.get(s["id"], {}).get("status"),
            "live_commit": live_sha,
            "live_finished_at": (live or {}).get("finishedAt"),
            "matches_target": live_sha.startswith(a.sha) or a.sha.startswith(live_sha or "x"),
        })

    ok = all(r["matches_target"] for r in results)
    report = {
        "target_commit": a.sha,
        "started_at": started,
        "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "verdict": "PASS" if ok else "FAIL",
        "services": results,
    }
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if a.out:
        with open(a.out, "w") as f:
            f.write(text + "\n")
    for r in results:
        mark = "✓" if r["matches_target"] else "✗"
        print(f"{mark} {r['service']:24} live={r['live_commit'][:7] or '—':7} triggered={r['triggered_status']}")
    print(f"verdict: {report['verdict']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
