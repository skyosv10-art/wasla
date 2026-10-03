#!/usr/bin/env python3
"""RISK-0060 · CLM-0454: turn on verified TLS for every DB-backed Render service.

The code (CLM-0453, `withPgPoolDefaults` / `pgSslFromEnv`) already reads
`WASLA_PG_SSL_MODE` and `WASLA_PG_SSL_CA`; this tool sets them on Render, measured
and reversible. It reuses the Render helpers of the M6-18B cutover tool instead of
keeping a second copy.

Env:
  RENDER_API_KEY   Render API key (repo secret).
  PROD_REF         ppixaauyqoykrogwdxtv. Every DB variable of a target must point here.
Args:
  plan | apply | rollback   --out evidence.json

CA: `infra/tls/supabase-root-2021-ca.pem` (Supabase Root 2021 CA, public). Its
SHA-256 (DER) is pinned below; a different file is refused before any write.

apply:
  0 preflight  targets = wasla-* services with a *DATABASE_URL, all on PROD_REF;
               live commit per target; env fingerprint (sha256[:16] per key).
  1 set        PUT WASLA_PG_SSL_MODE=verify-full and WASLA_PG_SSL_CA=<PEM> on each target.
  2 deploy     pinned to the commit already live (no code drift), fail fast.
  3 verify     /health 200 on every web target, delivery /delivery/ready database ok.
               node-postgres with `ssl` set sends SSLRequest first and fails if the
               server declines, and `rejectUnauthorized: true` fails on a certificate
               the pinned CA did not sign — so a healthy target is a TLS-verified one.
  4 prove      fingerprint diff == exactly the two keys on each target, values equal
               to the expected hashes, nothing else changed anywhere.
  On any failure: rollback (restore the two keys to their prior state), redeploy,
  health — the same path as `rollback` mode.
Output: names, deploy ids, timings, HTTP codes, hashes. Never a value.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import signal
import ssl
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("cutover", ROOT / "scripts/ops/m6-18b-dr/render-dr-cutover.py")
R = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R)  # type: ignore[union-attr]

CA_FILE = ROOT / "infra/tls/supabase-root-2021-ca.pem"
CA_SHA256 = "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa"
MODE_KEY, CA_KEY = "WASLA_PG_SSL_MODE", "WASLA_PG_SSL_CA"
TLS_KEYS = (MODE_KEY, CA_KEY)


def h16(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()[:16]


def load_ca() -> str:
    pem = CA_FILE.read_text()
    got = hashlib.sha256(ssl.PEM_cert_to_DER_cert(pem)).hexdigest()
    if got != CA_SHA256:
        raise SystemExit(f"::error::{CA_FILE.name} sha256 {got} != pinned {CA_SHA256} — refusing")
    return pem.strip()


def diff(before: dict, after: dict) -> list[tuple[str, str, str | None, str | None]]:
    return [(n, k, before.get(n, {}).get(k), after.get(n, {}).get(k))
            for n in sorted(set(before) | set(after))
            for k in sorted(set(before.get(n, {})) | set(after.get(n, {})))
            if before.get(n, {}).get(k) != after.get(n, {}).get(k)]


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "risk-0060-tls.json"
    prod_ref = os.environ.get("PROD_REF", "")
    if mode not in ("plan", "apply", "rollback") or not prod_ref:
        print("usage: render-tls-activate.py plan|apply|rollback --out f   (PROD_REF set)")
        return 2
    ca = load_ca()
    want = {MODE_KEY: "verify-full", CA_KEY: ca}
    report: dict = {"mode": mode, "prod_ref": prod_ref, "ca_sha256": CA_SHA256, "started_at": R.iso(),
                    "expected_hash": {MODE_KEY: h16(want[MODE_KEY]), CA_KEY: h16(ca)}}
    svcs = R.services()
    fp_before = R.fingerprint(svcs)
    targets: dict[str, dict] = {}
    prior: dict[tuple[str, str], str | None] = {}
    problems: list[str] = []
    for s in svcs:
        env = dict(R.env_vars(s["id"]))
        db = [k for k in env if R.DB_KEYS.search(k)]
        if not db:
            continue
        for k in db:
            if R.ref_of(env[k]) != prod_ref:
                problems.append(f"preflight: {s['name']} {k} points at {R.ref_of(env[k])!r}, not {prod_ref}")
        targets[s["id"]] = {"service": s["name"], "type": s["type"], "keys": db, "commit": R.live_commit(s["id"])}
        for k in TLS_KEYS:
            prior[(s["id"], k)] = env.get(k)
        if not targets[s["id"]]["commit"]:
            problems.append(f"preflight: {s['name']} has no live deploy")
    report["preflight"] = {"targets": len(targets), "problems": list(problems), "map": [
        {"service": t["service"], "db_keys": t["keys"], "live_commit": t["commit"],
         "tls_before": {k: (h16(prior[(sid, k)]) if prior[(sid, k)] is not None else None) for k in TLS_KEYS}}
        for sid, t in targets.items()]}
    for t in targets.values():
        print(f"plan     {t['service']:24s} {','.join(t['keys']):40s} live={str(t['commit'])[:7]}")

    def dump() -> None:
        json.dump(report, open(out, "w"), indent=2, ensure_ascii=False)

    if mode == "plan" or problems:
        report["verdict"] = "PLAN" if not problems else "REFUSED"
        dump()
        for p in problems:
            print(f"::error::{p}")
        return 0 if not problems else 1

    def restore(label: str, values: dict[tuple[str, str], str | None]) -> dict:
        t0 = R.now()
        for (sid, k), v in values.items():
            if v is None:
                try:
                    R.call("DELETE", f"/services/{sid}/env-vars/{k}")
                except RuntimeError as e:
                    if "HTTP 404" not in str(e):
                        raise
            else:
                R.call("PUT", f"/services/{sid}/env-vars/{k}", {"value": v})
        R.deploy_and_wait(targets, label)
        health = R.wait_healthy(targets, label)
        return {"seconds": round(R.now() - t0, 1), "health": health,
                "deploys": {t["service"]: t.get(f"{label}_status") for t in targets.values()}}

    if mode == "rollback":
        rb = restore("rollback", {key: None for key in prior})
        report["rollback"] = rb
        left = [(n, k) for n, keys in R.fingerprint(R.services()).items() for k in keys if k in TLS_KEYS]
        if left:
            problems.append(f"TLS keys still present: {left}")
        if rb["health"]["health_failed"] or not rb["health"]["delivery_ready_db_ok"]:
            problems.append(f"after rollback not healthy: {rb['health']['health_failed']}")
        report["problems"], report["verdict"], report["finished_at"] = problems, ("PASS" if not problems else "FAIL"), R.iso()
        dump()
        for p in problems:
            print(f"::error::{p}")
        return 0 if not problems else 1

    done = {"rolled_back": False}

    def rollback(reason: str) -> None:
        if done["rolled_back"]:
            return
        done["rolled_back"] = True
        report["rollback"] = {"reason": reason, **restore("rollback", prior)}
        d = diff(fp_before, R.fingerprint(R.services()))
        report["rollback"]["fingerprint_identical"] = not d
        report["rollback"]["differences"] = [f"{n}:{k}" for n, k, _, _ in d]

    def on_term(signum, _frame):
        rollback(f"signal {signum}")
        dump()
        sys.exit(1)

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)
    try:
        t0 = R.now()
        report["t0"] = R.iso(t0)
        for sid in targets:
            for k in TLS_KEYS:
                R.call("PUT", f"/services/{sid}/env-vars/{k}", {"value": want[k]})
        print(f"set      {len(targets) * len(TLS_KEYS)} variables on {len(targets)} services (+{R.now() - t0:.1f}s)", flush=True)
        R.deploy_and_wait(targets, "activate", fail_fast=True)
        t_live = R.now()
        bad = [t["service"] for t in targets.values() if t["activate_status"] not in R.TERMINAL_OK]
        if bad:
            raise RuntimeError(f"deploys not live: {bad}")
        health = R.wait_healthy(targets, "activate", budget_s=600)
        t_ready = R.now()
        report["activate"] = {"all_deploys_live_s": round(t_live - t0, 1), "healthy_and_ready_s": round(t_ready - t0, 1),
                              "deploys": {t["service"]: t.get("activate_status") for t in targets.values()},
                              "health": health}
        if health["health_failed"]:
            problems.append(f"with TLS, /health not 200: {health['health_failed']}")
        if not health["delivery_ready_db_ok"]:
            problems.append("with TLS, delivery /delivery/ready does not report database ok")
        fp_after = R.fingerprint(R.services())
        d = diff(fp_before, fp_after)
        names = {t["service"] for t in targets.values()}
        unexpected = [f"{n}:{k}" for n, k, _, a in d if n not in names or k not in TLS_KEYS or a != report["expected_hash"][k]]
        missing = [f"{n}:{k}" for n in names for k in TLS_KEYS if fp_after.get(n, {}).get(k) != report["expected_hash"][k]]
        report["fingerprint"] = {"changed": [f"{n}:{k}" for n, k, _, _ in d], "unexpected": unexpected, "missing": missing}
        if unexpected or missing:
            problems.append(f"fingerprint: unexpected {unexpected} missing {missing}")
        print(f"activate healthy+ready after {t_ready - t0:.1f}s · {len(d)} keys changed · unexpected {len(unexpected)}", flush=True)
    except Exception as e:  # noqa: BLE001 — recorded, rollback follows
        problems.append(f"activate error: {type(e).__name__}: {str(e)[:200]}")
    if problems:
        try:
            rollback("after failure")
        except Exception as e:  # noqa: BLE001
            problems.append(f"ROLLBACK ERROR: {type(e).__name__}: {str(e)[:200]} — operator must restore manually")
    report["problems"], report["verdict"], report["finished_at"] = problems, ("PASS" if not problems else "FAIL"), R.iso()
    dump()
    for p in problems:
        print(f"::error::{p}")
    print(f"verdict: {report['verdict']}")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
