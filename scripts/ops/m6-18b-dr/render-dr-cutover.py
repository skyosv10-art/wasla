#!/usr/bin/env python3
"""M6-18B · CLM-0449 — full Render → DR-replacement cutover, measured, then rolled back.

One process, one job, so the original production values never leave memory/the
runner's 0600 temp file and the rollback always runs (try/finally, plus SIGTERM).

Env:
  RENDER_API_KEY         Render API key (repo secret).
  DR_REPLACEMENT_DB_URL  session URL of the isolated DR project (repo secret); already
                         checked by guard-replacement.py: ref pvyuhjadrygqqdoczmnd only.
  PROD_REF               ppixaauyqoykrogwdxtv — every DB variable must point here before
                         the cutover and again after the rollback.
  DR_REF                 pvyuhjadrygqqdoczmnd.
Args:
  plan  | apply   --out evidence.json

Stages (apply):
  0 preflight  every wasla-* DB variable points at PROD_REF (else refuse); record the
               live commit per service and the full env fingerprint (sha256[:16] per
               key, never values).
  1 cutover    T0. PUT DR_REPLACEMENT_DB_URL on every DB variable; deploy each changed
               service pinned to its live commit (no code drift); wait for `live`.
  2 verify     /health 200 on every changed web service, delivery /delivery/ready
               database ok; T_ready. (Read/write is measured on the DR DB by the
               workflow step that follows; the script records its own probes only.)
  3 rollback   PUT the ORIGINAL value back on every changed variable; deploy pinned to
               the same commit; wait for `live`; /health + readiness on production.
  4 prove      env fingerprint after == fingerprint before, key for key, on every
               wasla-* service; no variable points at DR_REF.
Output: names, refs, deploy ids, timings, HTTP codes. No value, no URL, no password.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import signal
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import unquote, urlsplit

API = "https://api.render.com/v1"
OWNER = os.environ.get("RENDER_OWNER_ID", "tea-damm8atbedkc73ca3ahg")
DB_KEYS = re.compile(r"(^|_)DATABASE_URL$")
TERMINAL_OK = {"live"}
TERMINAL_BAD = {"build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"}


def now() -> float:
    return time.time()


def iso(t: float | None = None) -> str:
    return dt.datetime.fromtimestamp(t if t is not None else now(), dt.timezone.utc).isoformat()


def call(method: str, path: str, body: dict | None = None):
    key = os.environ["RENDER_API_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(6):
        req = urllib.request.Request(API + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {key}")
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f"{method} {path.split('/env-vars/')[0]} -> HTTP {e.code}") from None
        except (TimeoutError, urllib.error.URLError):
            if attempt < 5:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def ref_of(value: str) -> str | None:
    try:
        p = urlsplit(value)
        user, host = unquote(p.username or ""), (p.hostname or "").lower()
        if "." in user and host.endswith(".pooler.supabase.com"):
            return user.rsplit(".", 1)[1]
        if host.startswith("db.") and host.endswith(".supabase.co"):
            return host[3:-len(".supabase.co")]
    except ValueError:
        pass
    return None


def services() -> list[dict]:
    rows = call("GET", f"/services?ownerId={OWNER}&limit=100")
    return sorted((r["service"] for r in rows if r["service"]["name"].startswith("wasla-")), key=lambda s: s["name"])


def env_vars(sid: str) -> list[tuple[str, str]]:
    return [(e["envVar"]["key"], e["envVar"].get("value") or "") for e in call("GET", f"/services/{sid}/env-vars?limit=100")]


def fingerprint(svcs) -> dict[str, dict[str, str]]:
    return {s["name"]: {k: hashlib.sha256(v.encode()).hexdigest()[:16] for k, v in env_vars(s["id"])} for s in svcs}


def live_commit(sid: str) -> str | None:
    for row in call("GET", f"/services/{sid}/deploys?limit=20"):
        d = row["deploy"]
        if d.get("status") == "live":
            return (d.get("commit") or {}).get("id")
    return None


def deploy_and_wait(targets: dict[str, dict], label: str, fail_fast: bool = False) -> None:
    for sid, t in targets.items():
        d = call("POST", f"/services/{sid}/deploys", {"clearCache": "do_not_clear", "commitId": t["commit"]})
        t[f"{label}_deploy"], t[f"{label}_status"] = d["id"], d.get("status")
        print(f"{label:8s} deploy {t['service']:24s} {d['id']} @ {t['commit'][:7]}", flush=True)
        time.sleep(1)
    deadline = now() + 40 * 60
    while now() < deadline and any(t[f"{label}_status"] not in TERMINAL_OK | TERMINAL_BAD for t in targets.values()):
        time.sleep(10)
        for sid, t in targets.items():
            if t[f"{label}_status"] not in TERMINAL_OK | TERMINAL_BAD:
                st = call("GET", f"/services/{sid}/deploys/{t[f'{label}_deploy']}")["status"]
                t[f"{label}_status"] = st
                if st in TERMINAL_OK | TERMINAL_BAD:
                    t[f"{label}_terminal_at"] = iso()
        done = sum(t[f"{label}_status"] in TERMINAL_OK | TERMINAL_BAD for t in targets.values())
        print(f"  … {label} {done}/{len(targets)} terminal", flush=True)
        # CLM-0450: run 1 waited 15 min for Render to give up on two health-failed
        # deploys while the rest were already down on DR. One failed deploy is enough
        # to know the cutover failed: stop waiting and roll back.
        if fail_fast and any(t[f"{label}_status"] in TERMINAL_BAD for t in targets.values()):
            print(f"  … {label}: a deploy failed — fail fast", flush=True)
            return


def http_get(url: str, timeout: int = 30) -> tuple[int | None, str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "wasla-m6-18b-dr-cutover/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(800).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(800).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return None, type(e).__name__


def delivery_db_ok() -> tuple[bool, int | None]:
    st, body = http_get("https://wasla-delivery.onrender.com/delivery/ready")
    try:
        doc = json.loads(body)
        ok = doc.get("status") == "ready" and any(c.get("name") == "database" and c.get("ok") is True for c in doc.get("checks", []))
    except (ValueError, AttributeError, TypeError):
        ok = False
    return ok, st


def wait_healthy(targets: dict[str, dict], label: str, budget_s: int = 900) -> dict:
    """Polls until every changed web service answers /health 200 and delivery is ready."""
    web = {sid: t for sid, t in targets.items() if t["type"] == "web_service"}
    pending = set(web)
    first_ok: dict[str, str] = {}
    deadline = now() + budget_s
    ready_ok, ready_http = False, None
    while now() < deadline and (pending or not ready_ok):
        for sid in sorted(pending):
            st, _ = http_get(f"https://{web[sid]['service']}.onrender.com/health")
            if st == 200:
                first_ok[web[sid]["service"]] = iso()
                pending.discard(sid)
        if not ready_ok:
            ready_ok, ready_http = delivery_db_ok()
        if pending or not ready_ok:
            time.sleep(5)
    return {"health_ok": {web[s]["service"]: first_ok.get(web[s]["service"]) for s in web},
            "health_failed": sorted(web[s]["service"] for s in pending),
            "delivery_ready_db_ok": ready_ok, "delivery_ready_http": ready_http, "at": iso()}


def dr_read_write(dr_url: str) -> dict:
    import subprocess
    marker = f"m6-18b-cutover-{int(now())}"
    sql = (
        "CREATE TABLE IF NOT EXISTS public.dr_cutover_probe (marker text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now());"
        f"INSERT INTO public.dr_cutover_probe (marker) VALUES ('{marker}');"
        f"SELECT count(*) FROM public.dr_cutover_probe WHERE marker = '{marker}';"
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
    )
    t = now()
    try:
        u = urlsplit(dr_url)
        pg = {"PGHOST": u.hostname or "", "PGPORT": str(u.port or 5432), "PGUSER": unquote(u.username or ""),
              "PGPASSWORD": unquote(u.password or ""), "PGDATABASE": (u.path or "/postgres").lstrip("/") or "postgres",
              "PGSSLMODE": "require", "PGCONNECT_TIMEOUT": "15"}
        r = subprocess.run(["psql", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
                           env={**os.environ, **pg}, capture_output=True, text=True, timeout=60)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": type(e).__name__}
    lines = [x for x in r.stdout.splitlines() if x.strip().isdigit()]
    ok = r.returncode == 0 and len(lines) >= 2 and lines[0] == "1"
    return {"ok": ok, "marker": marker, "written_and_read": lines[0] if lines else None,
            "public_tables": int(lines[1]) if len(lines) > 1 else None,
            "seconds": round(now() - t, 2), "error": None if ok else f"psql exit {r.returncode}"}


def render_value(dr_url: str, prod_url: str) -> tuple[str, list[str]]:
    """CLM-0450: the DR value Render gets has the SAME query-parameter names as production.

    Run 1 (CI 37117434969) set the DR secret verbatim; it ends in `sslmode=require`,
    which psql needs but node-postgres reads as verify-full, so 12 services failed
    `SELF_SIGNED_CERT_IN_CHAIN` against the pooler chain. Production carries no query
    parameter at all. The drill measures a switch of DATABASES, not of TLS settings, so
    every parameter production does not have is dropped (names recorded, not values).
    """
    from urllib.parse import parse_qsl, urlencode, urlunsplit
    d, p = urlsplit(dr_url), urlsplit(prod_url)
    keep = {k for k, _ in parse_qsl(p.query, keep_blank_values=True)}
    kept = [(k, v) for k, v in parse_qsl(d.query, keep_blank_values=True) if k in keep]
    dropped = sorted({k for k, _ in parse_qsl(d.query, keep_blank_values=True)} - keep)
    return urlunsplit((d.scheme, d.netloc, d.path, urlencode(kept), d.fragment)), dropped


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "dr-cutover.json"
    prod_ref, dr_ref = os.environ.get("PROD_REF", ""), os.environ.get("DR_REF", "")
    if mode not in ("plan", "apply") or not prod_ref or not dr_ref or prod_ref == dr_ref:
        print("usage: render-dr-cutover.py plan|apply --out f   (PROD_REF, DR_REF set and distinct)")
        return 2
    dr_url = os.environ.get("DR_REPLACEMENT_DB_URL", "")
    if ref_of(dr_url) != dr_ref:
        print(f"::error::DR_REPLACEMENT_DB_URL points at {ref_of(dr_url)!r}, expected {dr_ref} — refusing")
        return 1
    if prod_ref in dr_url:
        print("::error::DR URL names the production ref — refusing")
        return 1
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::add-mask::{dr_url}")

    report: dict = {"mode": mode, "prod_ref": prod_ref, "dr_ref": dr_ref, "started_at": iso()}
    svcs = services()
    fp_before = fingerprint(svcs)
    targets: dict[str, dict] = {}
    originals: dict[tuple[str, str], str] = {}
    problems: list[str] = []
    for s in svcs:
        for k, v in env_vars(s["id"]):
            if not DB_KEYS.search(k):
                continue
            r = ref_of(v)
            if r != prod_ref:
                problems.append(f"preflight: {s['name']} {k} points at {r!r}, not production {prod_ref}")
                continue
            t = targets.setdefault(s["id"], {"service": s["name"], "type": s["type"], "keys": [], "commit": None})
            t["keys"].append(k)
            originals[(s["id"], k)] = v
            if os.environ.get("GITHUB_ACTIONS"):
                print(f"::add-mask::{v}")
    for sid, t in targets.items():
        t["commit"] = live_commit(sid)
        if not t["commit"]:
            problems.append(f"preflight: {t['service']} has no live deploy")
    report["preflight"] = {"services": len(targets), "variables": len(originals),
                           "map": [{"service": t["service"], "keys": t["keys"], "live_commit": t["commit"]} for t in targets.values()],
                           "problems": list(problems)}
    for t in targets.values():
        print(f"plan     {t['service']:24s} {','.join(t['keys']):40s} live={str(t['commit'])[:7]}")
    if mode == "plan" or problems:
        report["verdict"] = "PLAN" if not problems else "REFUSED"
        json.dump(report, open(out, "w"), indent=2, ensure_ascii=False)
        for p in problems:
            print(f"::error::{p}")
        return 0 if not problems else 1

    rolled_back = {"done": False}

    def rollback(reason: str) -> None:
        if rolled_back["done"]:
            return
        rolled_back["done"] = True
        rb0 = now()
        report["rollback"] = {"reason": reason, "started_at": iso(rb0)}
        for (sid, k), v in originals.items():
            call("PUT", f"/services/{sid}/env-vars/{k}", {"value": v})
        print(f"rollback restored {len(originals)} variables to their original values", flush=True)
        deploy_and_wait(targets, "rollback")
        health = wait_healthy(targets, "rollback")
        rb1 = now()
        report["rollback"].update({"variables": len(originals), "health": health, "finished_at": iso(rb1),
                                   "seconds": round(rb1 - rb0, 1),
                                   "deploys": {t["service"]: t.get("rollback_status") for t in targets.values()}})
        fp_after = fingerprint(services())
        diff = [f"{n}:{k}" for n in sorted(set(fp_before) | set(fp_after))
                for k in sorted(set(fp_before.get(n, {})) | set(fp_after.get(n, {})))
                if fp_before.get(n, {}).get(k) != fp_after.get(n, {}).get(k)]
        report["fingerprint"] = {"before_services": len(fp_before), "after_services": len(fp_after),
                                 "differences": diff, "identical": not diff}
        print(f"fingerprint after rollback identical to before: {not diff} ({len(diff)} differences)", flush=True)

    def on_term(signum, _frame):
        rollback(f"signal {signum}")
        json.dump(report, open(out, "w"), indent=2, ensure_ascii=False)
        sys.exit(1)

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)
    try:
        render_dr, dropped = render_value(dr_url, next(iter(originals.values())))
        if ref_of(render_dr) != dr_ref:
            raise RuntimeError("aligned DR value lost its project ref")
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::add-mask::{render_dr}")
        report["dr_value_params_dropped_to_match_production"] = dropped
        t0 = now()
        report["t0_cutover_start"] = iso(t0)
        for (sid, k) in originals:
            call("PUT", f"/services/{sid}/env-vars/{k}", {"value": render_dr})
        t_env = now()
        print(f"cutover  {len(originals)} variables now point at {dr_ref} (+{t_env - t0:.1f}s)", flush=True)
        deploy_and_wait(targets, "cutover", fail_fast=True)
        t_live = now()
        bad = [t["service"] for t in targets.values() if t["cutover_status"] not in TERMINAL_OK]
        if bad:
            problems.append(f"cutover deploys not live: {bad}")
        if bad:
            raise RuntimeError(f"cutover deploys failed: {bad}")
        # CLM-0450: 300 s on DR (run 1: the services that came up did so within 60 s of
        # `live`, the rest never did); the rollback keeps 900 s.
        health = wait_healthy(targets, "cutover", budget_s=300)
        t_ready = now()
        if health["health_failed"]:
            problems.append(f"on DR, /health not 200: {health['health_failed']}")
        if not health["delivery_ready_db_ok"]:
            problems.append("on DR, delivery /delivery/ready does not report database ok")
        report["cutover"] = {
            "env_switched_s": round(t_env - t0, 1),
            "all_deploys_terminal_s": round(t_live - t0, 1),
            "healthy_and_ready_s": round(t_ready - t0, 1),
            "deploys": {t["service"]: t.get("cutover_status") for t in targets.values()},
            "health": health,
        }
        # Proof that Render really points at DR: every DB variable now resolves to DR_REF.
        on_dr = [(s["name"], k) for s in services() for k, v in env_vars(s["id"]) if DB_KEYS.search(k) and ref_of(v) == dr_ref]
        report["cutover"]["variables_on_dr"] = len(on_dr)
        if len(on_dr) != len(originals):
            problems.append(f"only {len(on_dr)}/{len(originals)} DB variables point at DR")
        print(f"cutover  healthy+ready on DR after {t_ready - t0:.1f}s · deploys live after {t_live - t0:.1f}s", flush=True)
        # Read/write on the database Render now points at (DR only): a committed write to a
        # drill table, read back, plus a read of the restored data. psql gets the URL from
        # the environment, never from argv.
        rw = dr_read_write(dr_url)
        report["cutover"]["read_write"] = rw
        if not rw.get("ok"):
            problems.append(f"read/write on DR failed: {rw.get('error')}")
        t_rw = now()
        report["cutover"]["read_write_done_s"] = round(t_rw - t0, 1)
        report["full_rto_render_s"] = round(t_rw - t0, 1)
        report["cutover"]["dr_window_s"] = round(now() - t0, 1)
    except Exception as e:  # noqa: BLE001 — recorded, rollback still runs
        problems.append(f"cutover error: {type(e).__name__}: {str(e)[:200]}")
    finally:
        try:
            rollback("planned" if not problems else "after failure")
        except Exception as e:  # noqa: BLE001
            problems.append(f"ROLLBACK ERROR: {type(e).__name__}: {str(e)[:200]} — operator must restore manually")
    rb = report.get("rollback", {})
    if rb.get("health", {}).get("health_failed"):
        problems.append(f"after rollback, /health not 200: {rb['health']['health_failed']}")
    if not rb.get("health", {}).get("delivery_ready_db_ok"):
        problems.append("after rollback, delivery readiness does not report database ok")
    if not report.get("fingerprint", {}).get("identical"):
        problems.append(f"fingerprint differs after rollback: {report.get('fingerprint', {}).get('differences')}")
    report["problems"] = problems
    report["verdict"] = "PASS" if not problems else "FAIL"
    report["finished_at"] = iso()
    json.dump(report, open(out, "w"), indent=2, ensure_ascii=False)
    for p in problems:
        print(f"::error::{p}")
    print(f"verdict: {report['verdict']}")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
