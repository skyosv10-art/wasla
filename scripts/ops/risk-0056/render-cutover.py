#!/usr/bin/env python3
"""RISK-0056 · CLM-0429 — move every Render service's database variables from the
RETIRED production project to the CURRENT one, redeploy, and prove it live.

Fail-closed. No value is ever printed: only service names, variable names and the
Supabase project ref each value points at.

Env:
  RENDER_API_KEY   Render API key (repo secret).
  NEW_DB_URL       session-pooler URL of the CURRENT production (env secret
                   PRODUCTION_MIGRATION_DB_URL) — already checked by guard-target.py.
  NEW_REF          expected ref of NEW_DB_URL (ppixaauyqoykrogwdxtv).
  OLD_REFS         comma-separated retired refs (snlpxywskyqrjattbpgn).
Args:
  plan | apply | verify   [--out evidence.json]

plan    read-only: which (service, variable) pairs point at which ref.
apply   for every pair that points at a retired ref: PUT the new value, trigger a
        deploy of the service's current branch HEAD, wait for a terminal state,
        then run verify.
verify  read-only: (1) no variable of any wasla-* service references a retired
        ref; (2) every DB variable references NEW_REF; (3) every changed service's
        latest live deploy started AFTER its variable was changed; (4) /health of
        every DB-backed web service answers 200, and the delivery readiness probe
        reports database ok. Any miss → exit 1.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import unquote, urlsplit
# LEGACY-ONLY (CLM-0502): legacy RISK-0056 cutover (writes Render env)
sys.path.insert(0, next(str(_p / "scripts" / "ops") for _p in __import__("pathlib").Path(__file__).resolve().parents if (_p / "infra" / "render" / "deploy-target.json").is_file()))
from render_target import legacy_only  # noqa: E402

API = "https://api.render.com/v1"
OWNER = legacy_only("render-cutover.py")
REF_RE = re.compile(r"\b([a-z]{20})\b")
DB_KEYS = re.compile(r"(^|_)DATABASE_URL$")
TERMINAL_OK = {"live"}
TERMINAL_BAD = {"build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"}


def die(msg: str) -> None:
    print(f"::error::{msg}")
    sys.exit(1)


def call(method: str, path: str, body: dict | None = None):
    key = os.environ.get("RENDER_API_KEY", "")
    if not key:
        die("RENDER_API_KEY is empty")
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
            # never echo the body of a PUT: it may contain the value
            die(f"{method} {path.split('/env-vars/')[0]}… -> HTTP {e.code}")
    die("unreachable")


def ref_of(value: str) -> str | None:
    if not value:
        return None
    try:
        p = urlsplit(value)
        user, host = unquote(p.username or ""), (p.hostname or "").lower()
        if "." in user and host.endswith(".pooler.supabase.com"):
            return user.rsplit(".", 1)[1]
        if host.startswith("db.") and host.endswith(".supabase.co"):
            return host[3:-len(".supabase.co")]
    except ValueError:
        pass
    m = REF_RE.search(value)
    return m.group(1) if m and ("supabase" in value or m.group(1) in os.environ.get("OLD_REFS", "")) else None


def services() -> list[dict]:
    rows = call("GET", f"/services?ownerId={OWNER}&limit=100")
    return sorted((r["service"] for r in rows if r["service"]["name"].startswith("wasla-")), key=lambda s: s["name"])


def env_vars(sid: str) -> list[tuple[str, str]]:
    return [(e["envVar"]["key"], e["envVar"].get("value") or "") for e in call("GET", f"/services/{sid}/env-vars?limit=100")]


def scan(svcs, old_refs):
    rows = []
    for s in svcs:
        for k, v in env_vars(s["id"]):
            r = ref_of(v)
            if r or DB_KEYS.search(k):
                rows.append({"service": s["name"], "id": s["id"], "type": s["type"], "key": k,
                             "ref": r, "retired": r in old_refs})
    return rows


def latest_deploy(sid: str) -> dict | None:
    rows = call("GET", f"/services/{sid}/deploys?limit=10")
    return rows[0]["deploy"] if rows else None


def latest_live(sid: str) -> dict | None:
    for row in call("GET", f"/services/{sid}/deploys?limit=20"):
        if row["deploy"].get("status") == "live":
            return row["deploy"]
    return None


def http_get(url: str, attempts: int = 4, timeout: int = 90) -> tuple[int | None, str]:
    last: tuple[int | None, str] = (None, "")
    for _ in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "wasla-risk-0056-cutover/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read(600).decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = (e.code, e.read(600).decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001 — recorded, then fail-closed by the caller
            last = (None, str(e)[:200])
        time.sleep(10)
    return last


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else ""
    if mode not in ("plan", "apply", "verify"):
        die("usage: render-cutover.py plan|apply|verify [--out f]")
    new_ref = os.environ.get("NEW_REF", "")
    old_refs = {r for r in os.environ.get("OLD_REFS", "").split(",") if r}
    if not new_ref or not old_refs or new_ref in old_refs:
        die("NEW_REF / OLD_REFS invalid")
    new_url = os.environ.get("NEW_DB_URL", "")
    if mode == "apply":
        if ref_of(new_url) != new_ref:
            die(f"NEW_DB_URL points at {ref_of(new_url)!r}, expected {new_ref!r} — refusing")
        if urlsplit(new_url).port == 6543:
            die("NEW_DB_URL uses the transaction pooler (6543) — refusing")
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::add-mask::{new_url}")

    svcs = services()
    report: dict = {"mode": mode, "new_ref": new_ref, "retired_refs": sorted(old_refs),
                    "started_at": dt.datetime.now(dt.timezone.utc).isoformat()}
    before = scan(svcs, old_refs)
    report["before"] = [{k: r[k] for k in ("service", "key", "ref")} for r in before]
    for r in before:
        print(f"before  {r['service']:24} {r['key']:24} -> {r['ref']}")

    changed: dict[str, dict] = {}
    if mode == "apply":
        todo = [r for r in before if r["retired"]]
        if not todo:
            print("nothing points at a retired ref")
        for r in todo:
            call("PUT", f"/services/{r['id']}/env-vars/{r['key']}", {"value": new_url})
            c = changed.setdefault(r["id"], {"service": r["service"], "keys": [],
                                             "changed_at": dt.datetime.now(dt.timezone.utc).isoformat()})
            c["keys"].append(r["key"])
            print(f"changed {r['service']:24} {r['key']:24} -> {new_ref}")
        for sid, c in changed.items():
            d = call("POST", f"/services/{sid}/deploys", {"clearCache": "do_not_clear"})
            c["deploy_id"], c["status"] = d["id"], d.get("status")
            print(f"deploy  {c['service']:24} {d['id']}")
            time.sleep(1)
        deadline = time.time() + 45 * 60
        while time.time() < deadline and any(c["status"] not in TERMINAL_OK | TERMINAL_BAD for c in changed.values()):
            time.sleep(20)
            for sid, c in changed.items():
                if c["status"] not in TERMINAL_OK | TERMINAL_BAD:
                    c["status"] = call("GET", f"/services/{sid}/deploys/{c['deploy_id']}")["status"]
            print(f"  … {sum(c['status'] in TERMINAL_OK | TERMINAL_BAD for c in changed.values())}/{len(changed)} terminal", flush=True)
        report["changed"] = list(changed.values())
        if mode == "apply":
            json.dump(report, open(out or "/dev/null", "w"), indent=2)

    if mode == "plan":
        report["verdict"] = "PLAN"
        if out:
            json.dump(report, open(out, "w"), indent=2)
        return 0

    # ---- verify (also the tail of apply) ----
    problems: list[str] = []
    after = scan(services(), old_refs)
    report["after"] = [{k: r[k] for k in ("service", "key", "ref")} for r in after]
    for r in after:
        if r["retired"]:
            problems.append(f"{r['service']} {r['key']} still points at retired {r['ref']}")
        elif DB_KEYS.search(r["key"]) and r["ref"] != new_ref:
            problems.append(f"{r['service']} {r['key']} points at {r['ref']!r}, not {new_ref}")
    for sid, c in changed.items():
        if c["status"] not in TERMINAL_OK:
            problems.append(f"{c['service']} deploy {c['deploy_id']} ended {c['status']}")
    live_rows = []
    db_services = sorted({(r["id"], r["service"], r["type"]) for r in after if DB_KEYS.search(r["key"])}, key=lambda x: x[1])
    for sid, name, typ in db_services:
        live = latest_live(sid) or {}
        row = {"service": name, "live_deploy": live.get("id"), "live_commit": (live.get("commit") or {}).get("id", ""),
               "live_created_at": live.get("createdAt"), "live_finished_at": live.get("finishedAt")}
        c = changed.get(sid)
        if c and not (live.get("id") == c.get("deploy_id")):
            problems.append(f"{name}: live deploy {live.get('id')} is not the post-cutover deploy {c.get('deploy_id')}")
        if typ == "web_service" and not name.endswith("-bot"):
            st, body = http_get(f"https://{name}.onrender.com/health")
            row["health_http"], row["health_body"] = st, body[:300]
            if st != 200:
                problems.append(f"{name} /health -> {st}")
        elif typ == "web_service":
            st, body = http_get(f"https://{name}.onrender.com/health")
            row["health_http"], row["health_body"] = st, body[:300]
            if st != 200:
                problems.append(f"{name} /health -> {st}")
        live_rows.append(row)
    st, body = http_get("https://wasla-delivery.onrender.com/delivery/ready")
    report["delivery_ready"] = {"http": st, "body": body[:600]}
    try:
        doc = json.loads(body)
        db_ok = doc.get("status") == "ready" and any(
            c.get("name") == "database" and c.get("ok") is True for c in doc.get("checks", []))
    except (ValueError, AttributeError, TypeError):
        db_ok = False
    if not db_ok or "schema_missing" in body:
        problems.append("wasla-delivery /delivery/ready does not report database ok")
    report["live"] = live_rows
    report["problems"] = problems
    report["verdict"] = "PASS" if not problems else "FAIL"
    report["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    if out:
        json.dump(report, open(out, "w"), indent=2, ensure_ascii=False)
    for r in live_rows:
        print(f"live    {r['service']:24} commit={r['live_commit'][:7]} health={r.get('health_http')}")
    print(f"delivery ready: http={st} database_ok={db_ok}")
    for p in problems:
        print(f"::error::{p}")
    print(f"verdict: {report['verdict']}")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
