#!/usr/bin/env python3
"""render-env-fingerprint.py — fingerprint Render env vars without revealing values.

Why (CLM-0448 · RISK-0042 P3 observe · CLM-0449 · M6-18B DR cutover):
  Any change to Render env vars has to be provable before and after, and
  reversible. Values are secrets, so the evidence must never contain them.
  For each `wasla-*` service this tool reads the env vars through the Render API
  and records, per key, `sha256(value)[:16]`. The service fingerprint is
  `sha256` over the sorted `key=valuehash` lines. Two snapshots compare by key:
  added / removed / changed. No value, and no prefix of a value, is printed.

Usage:
  RENDER_API_KEY=... python3 scripts/ops/render-env-fingerprint.py snapshot --out before.json [--only a,b]
  python3 scripts/ops/render-env-fingerprint.py diff before.json after.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import urllib.request
# Workspace from RENDER_OWNER_ID only (CLM-0502): read-only fingerprint
sys.path.insert(0, next(str(_p / "scripts" / "ops") for _p in __import__("pathlib").Path(__file__).resolve().parents if (_p / "infra" / "render" / "deploy-target.json").is_file()))
from render_target import explicit_owner  # noqa: E402

API = "https://api.render.com/v1"
OWNER = explicit_owner("render-env-fingerprint.py")


def call(path: str) -> object:
    key = os.environ.get("RENDER_API_KEY", "")
    if not key:
        sys.exit("RENDER_API_KEY is not set")
    req = urllib.request.Request(API + path)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"null")


def services(only: set[str] | None) -> list[dict]:
    out = []
    for row in call(f"/services?ownerId={OWNER}&limit=100"):
        s = row["service"]
        if not s["name"].startswith("wasla-") or s["type"] == "static_site":
            continue
        if only and s["name"] not in only:
            continue
        out.append({"id": s["id"], "name": s["name"]})
    return sorted(out, key=lambda x: x["name"])


def env_of(service_id: str) -> dict[str, str]:
    env: dict[str, str] = {}
    cursor = ""
    while True:
        page = call(f"/services/{service_id}/env-vars?limit=100" + (f"&cursor={cursor}" if cursor else ""))
        if not page:
            break
        for row in page:
            ev = row["envVar"]
            env[ev["key"]] = hashlib.sha256(ev.get("value", "").encode()).hexdigest()[:16]
            cursor = row.get("cursor", "")
        if len(page) < 100:
            break
    return env


def snapshot(args: argparse.Namespace) -> None:
    only = set(args.only.split(",")) if args.only else None
    doc = {"taken_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "services": {}}
    for s in services(only):
        env = env_of(s["id"])
        lines = "\n".join(f"{k}={v}" for k, v in sorted(env.items()))
        doc["services"][s["name"]] = {
            "id": s["id"],
            "fingerprint": "sha256:" + hashlib.sha256(lines.encode()).hexdigest(),
            "keys": dict(sorted(env.items())),
        }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    for name, v in doc["services"].items():
        print(f"{name:28s} {v['fingerprint'][:23]}  keys={len(v['keys'])}")


def diff(args: argparse.Namespace) -> None:
    a = json.load(open(args.before))["services"]
    b = json.load(open(args.after))["services"]
    changed = 0
    for name in sorted(set(a) | set(b)):
        ka, kb = a.get(name, {}).get("keys", {}), b.get(name, {}).get("keys", {})
        add = sorted(set(kb) - set(ka))
        rem = sorted(set(ka) - set(kb))
        mod = sorted(k for k in set(ka) & set(kb) if ka[k] != kb[k])
        if add or rem or mod:
            changed += 1
            print(f"{name}: +{add} -{rem} ~{mod}")
    print(f"services changed: {changed}")


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot")
    s.add_argument("--out", required=True)
    s.add_argument("--only", default="")
    s.set_defaults(fn=snapshot)
    d = sub.add_parser("diff")
    d.add_argument("before")
    d.add_argument("after")
    d.set_defaults(fn=diff)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
