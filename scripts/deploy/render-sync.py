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

Deploy target (CLM-0501 · INC-0005):
  The workspace is NOT a default in this file. It comes from
  infra/render/deploy-target.json:
    mode "frozen" → nothing is listed or deployed; a FROZEN report is written, exit 0
    mode "deploy" → owner_id is required, must not be a frozen owner, and every
                    service deployed must carry that ownerId.
  The old built-in default (the legacy workspace) made the first code merge of
  the blue/green window queue 24 deploys on the frozen legacy stack (INC-0005).

Selective deploy (CLM-0626 · RISK-0068):
  Only services whose build inputs differ between their *live* commit and the
  target are deployed; see scripts/deploy/render_plan.py for the rule. A
  service skipped as `runtime-equivalent` passes only because `git diff live
  target -- <runtime inputs>` is empty (runtime-input, not image-byte,
  equivalence — CLM-0628) — the evidence file records the live commit and inputs.
  `--all` restores the fleet deploy only under purpose FLEET (CLM-0635);
  `--plan-only` measures and deploys nothing.

Test environment only (CLM-0632 · owner decision 2026-10-19):
  Render hosts tests, never production, and nothing spends money. A deploy needs
  mode "deploy" + environment "test" + production_database_refs in the target
  file, RENDER_DEPLOY_INTENT=test-only and a RENDER_DEPLOY_PURPOSE (an item of
  docs/08-infrastructure/RENDER_TEST_ENVIRONMENT_PLAN.md), and an empty isolation
  preflight: no env group whose name says prod is linked to a wasla- service, and
  no DATABASE_URL-like key (read by key) points at a production project. The
  workflow runs on workflow_dispatch only — no push trigger.

Usage:
  RENDER_API_KEY=... python3 scripts/deploy/render-sync.py <sha> [--only a,b] \
      [--verify-only] [--plan-only] [--all] [--out path.json]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
TARGET_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "infra", "render", "deploy-target.json")


def load_target() -> dict:
    with open(TARGET_FILE, encoding="utf-8") as f:
        t = json.load(f)
    mode = t.get("mode")
    if mode == "frozen":
        return t
    if mode != "deploy":
        sys.exit(f"deploy-target.json: mode must be 'frozen' or 'deploy' (got {mode!r})")
    owner = t.get("owner_id") or ""
    if not owner.startswith("tea-") or owner in (t.get("frozen_owners") or []):
        sys.exit(f"deploy-target.json: owner_id {owner!r} is missing, malformed or frozen — refusing to deploy")
    # CLM-0632 (owner decision 2026-10-19): Render is a TEST environment only.
    if t.get("environment") != "test":
        sys.exit(f"deploy-target.json: environment must be 'test' (got {t.get('environment')!r}) — Render is not a production target")
    refs = t.get("production_database_refs")
    if not isinstance(refs, list) or not refs or not all(isinstance(r, str) and re.fullmatch(r"[a-z0-9]{20}", r) for r in refs):
        sys.exit("deploy-target.json: production_database_refs must list the production Supabase project ref(s) — refusing to deploy without an isolation rule")
    # CLM-0635: unfreezing names a reviewable isolation-evidence file (ADR-073 D4 · E1–E4).
    ev = t.get("isolation_evidence")
    root = os.path.normpath(os.path.join(os.path.dirname(TARGET_FILE), "..", ".."))
    if not isinstance(ev, str) or not ev.strip() or ev.startswith("/") or ".." in ev.split("/") or not os.path.isfile(os.path.join(root, ev)):
        sys.exit("deploy-target.json: isolation_evidence must name an existing evidence file in the repository (ADR-073 D4) — refusing to deploy")
    # CLM-0678 (RISK-0069, review #822): existence alone proved nothing — the guard
    # accepted any existing file (measured: README.md) as isolation evidence. The
    # evidence must now carry the measured E1–E4 content of ADR-073 D4, not a name.
    errs = isolation_evidence_errors(os.path.join(root, ev), refs) if isinstance(ev, str) and ev else []
    if errs:
        sys.exit("isolation_evidence " + ev + ": " + " · ".join(errs) + " — (ADR-073 D4 · E1–E4) refusing to deploy")
    return t


def isolation_evidence_errors(path: str, prod_refs: list[str]) -> list[str]:
    """E1–E4 content of an isolation-evidence file (ADR-073 D4 · CLM-0678).

    The evidence is reviewed in the unfreeze PR; this gate only refuses a file
    that does not even carry the measured shape: the four sections, each with
    its required measured values, and no production ref and no secret material.
    A file that passes here is NOT thereby approved — only deployable to review.
    """
    errs: list[str] = []
    try:
        text = open(path, encoding="utf-8").read()
    except OSError as exc:
        return [f"unreadable: {exc}"]
    if not text.strip():
        return ["empty file — an evidence file with no content proves nothing"]
    if "-----BEGIN" in text:
        errs.append("key material must never be pasted into the evidence")
    lines = [ln.strip() for ln in text.splitlines()]

    def section(marker: str) -> list[str] | None:
        for i, ln in enumerate(lines):
            if re.match(rf"^#+\s*{marker}\b", ln) or re.match(rf"^{marker}\s*[:：-]", ln):
                return lines[i + 1 :]
        return None

    def field(sec: list[str] | None, key: str) -> str | None:
        if sec is None:
            return None
        for ln in sec:
            m = re.match(rf"^{key}\s*[:=]\s*(.*)$", ln)
            if m:
                return m.group(1).strip()
        return None

    # E1 — a separate test database project: ref (not a production ref), name, date.
    e1 = section("E1")
    if e1 is None:
        errs.append("E1 section missing — the separate test database project is not evidenced")
    else:
        ref = field(e1, "ref")
        if not ref or not re.fullmatch(r"[a-z0-9]{20}", ref):
            errs.append("E1 needs `ref:` — the 20-char ref of the test database project")
        elif ref in prod_refs or ref in ("ppixaauyqoykrogwdxtv", "pvyuhjadrygqqdoczmnd"):
            errs.append(f"E1 `ref:` {ref} is a production/deleted project — isolation is not evidenced")
        if not (field(e1, "name") or "").strip():
            errs.append("E1 needs `name:` — the project name as measured")
        created = field(e1, "created") or ""
        if not re.match(r"^\d{4}-\d{2}-\d{2}", created):
            errs.append("E1 needs `created:` — the project creation date (YYYY-MM-DD)")

    # E2 — a limited role: the pg_roles row with every privilege false, plus grants.
    e2 = section("E2")
    if e2 is None:
        errs.append("E2 section missing — the limited role is not evidenced")
    else:
        joined = " ".join(e2).lower().replace(" ", "")
        privs = ("rolsuper", "rolcreaterole", "rolcreatedb", "rolbypassrls", "rolreplication")
        row_ok = all(f"{p}=false" in joined or f"{p}=f" in joined for p in privs)
        if not row_ok:
            # the pg_roles query also pastes as a table: header names + a row of false.
            tbl = False
            for i, ln in enumerate(e2[:-1]):
                if all(p in ln.lower() for p in privs):
                    vals = [v.strip().lower() for v in e2[i + 1].strip("| ").split("|")]
                    if len(vals) >= len(privs) and all(v in ("false", "f") for v in vals[-len(privs):]):
                        tbl = True
            row_ok = tbl
        if not row_ok:
            errs.append("E2 needs the pg_roles row with rolsuper/rolcreaterole/rolcreatedb/rolbypassrls/rolreplication all false")
        grants = field(e2, "grants")
        if grants is None or not grants.strip():
            errs.append("E2 needs `grants:` — the role's grant list as measured (write `none` if empty)")

    # E3 — env-group separation: wasla-prod-db unlinked, no prod-named group linked.
    e3 = section("E3")
    if e3 is None:
        errs.append("E3 section missing — env-group separation is not evidenced")
    else:
        if not re.search(r"wasla-prod-db[^\n]*linked\s*=\s*0", " ".join(e3), re.I):
            errs.append("E3 must state `wasla-prod-db ... linked=0` — the production group unlinked")
        for ln in e3:
            m = re.match(r"^(\S*prod\S*)[^=]*linked\s*=\s*(\d+)", ln, re.I)
            if m and int(m.group(2)) > 0:
                errs.append(f"E3: group {m.group(1)} is prod-named and linked — separation is not evidenced")

    # E4 — recently generated test keys: kids, sha256 fingerprints, date, method.
    e4 = section("E4")
    if e4 is None:
        errs.append("E4 section missing — the regenerated test keys are not evidenced")
    else:
        kids = [ln for ln in e4 if re.match(r"^kid\s*[:=]", ln)]
        if not kids:
            errs.append("E4 needs `kid:` entries — the key ids as measured")
        fps = [ln for ln in e4 if re.search(r"sha256\s*[:=]\s*[0-9a-f]{64}", ln, re.I)]
        if not fps:
            errs.append("E4 needs `sha256:` fingerprints — the key fingerprints as measured")
        generated = field(e4, "generated") or ""
        if not re.match(r"^\d{4}-\d{2}-\d{2}", generated):
            errs.append("E4 needs `generated:` — the key generation date (YYYY-MM-DD)")
        if not (field(e4, "method") or "").strip():
            errs.append("E4 needs `method:` — how the keys were generated")
    return errs


TARGET = load_target()
OWNER = TARGET.get("owner_id")
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


def wasla_service(sid: str) -> str | None:
    """Read the single env var WASLA_SERVICE by key — never the whole env list (secrets)."""
    try:
        return (call("GET", f"/services/{sid}/env-vars/WASLA_SERVICE") or {}).get("value")
    except RuntimeError as e:
        if "-> 404" in str(e):
            return None
        raise


# CLM-0632 — isolation preflight. Every DATABASE_URL-like key the code reads (by key,
# never the env-var list) plus the env groups linked to wasla- services. Values stay in
# memory, are matched against the production project refs and are never printed or
# written; a finding names only the service, group and key.
DB_KEYS = ("DATABASE_URL", "CUSTOMER_DATABASE_URL", "BILLING_DATABASE_URL", "BILLING_DELIVERY_EVENTS_DATABASE_URL",
           "DISPATCH_DATABASE_URL", "DRIVER_DATABASE_URL", "NEGOTIATION_DATABASE_URL", "ORDER_DATABASE_URL",
           "PARTNERS_DATABASE_URL")
PROD_NAME = re.compile(r"prod", re.I)


def isolation_findings(groups: list[dict], service_db: dict, prod_refs: list[str]) -> list[str]:
    """groups: [{name, linked: [service names], vars: {key: value}}]; service_db: {service: {key: value}}."""
    out = []
    for g in groups:
        if not g.get("linked"):
            continue
        if PROD_NAME.search(g.get("name", "")):
            out.append(f"env group {g['name']!r} (production-named) is linked to {sorted(g['linked'])}")
        for k, v in sorted((g.get("vars") or {}).items()):
            if k.endswith("DATABASE_URL") and any(r in (v or "") for r in prod_refs):
                out.append(f"env group {g['name']!r} key {k} points at a production database (linked to {len(g['linked'])} services)")
    for name, kv in sorted(service_db.items()):
        for k, v in sorted(kv.items()):
            if any(r in (v or "") for r in prod_refs):
                out.append(f"service {name} key {k} points at a production database")
    return out


def env_by_key(sid: str, key: str) -> str | None:
    try:
        return (call("GET", f"/services/{sid}/env-vars/{key}") or {}).get("value")
    except RuntimeError as e:
        if "-> 404" in str(e):
            return None
        raise


def collect_isolation(svcs: list[dict]) -> tuple[list[dict], dict]:
    names = {s["id"]: s["name"] for s in svcs}
    groups = []
    for row in call("GET", f"/env-groups?ownerId={OWNER}&limit=100"):
        g = row.get("envGroup", row)
        linked = [names[l.get("id") or l.get("serviceId")] for l in g.get("serviceLinks") or [] if (l.get("id") or l.get("serviceId")) in names]
        detail = call("GET", f"/env-groups/{g['id']}") if linked else {}
        groups.append({"name": g.get("name", ""), "linked": linked,
                       "vars": {e["key"]: e.get("value") for e in (detail or {}).get("envVars") or [] if e.get("key", "").endswith("DATABASE_URL")}})
    service_db = {}
    for s in svcs:
        if s["type"] == "static_site":
            continue
        kv = {k: v for k in DB_KEYS if (v := env_by_key(s["id"], k))}
        if kv:
            service_db[s["name"]] = kv
    return groups, service_db


# CLM-0635 — purpose gate. A deploy names ONE approved item of the test plan
# (docs/08-infrastructure/RENDER_TEST_ENVIRONMENT_PLAN.md) declared in
# deploy-target.json `test_plan_items`; it may touch only that item's services.
# `--all` (full=true) never widens an item: the whole fleet is a separate purpose,
# FLEET, with its own explicit approval in `fleet_deploy`. Checked before any call.
FLEET = "FLEET"
CONFIRM = "test-only"


def deploy_gate(target: dict, env: dict, full: bool) -> tuple[list[str] | None, str | None]:
    """→ (service names the run may deploy, None = whole fleet) or (None, refusal)."""
    if env.get("RENDER_DEPLOY_CONFIRM") != CONFIRM or env.get("RENDER_DEPLOY_INTENT") != CONFIRM:
        return None, f"confirm must be exactly {CONFIRM!r} (RENDER_DEPLOY_CONFIRM and RENDER_DEPLOY_INTENT)"
    purpose = (env.get("RENDER_DEPLOY_PURPOSE") or "").strip()
    items = target.get("test_plan_items") or {}
    if purpose == FLEET:
        fleet = target.get("fleet_deploy") or {}
        if not full:
            return None, "purpose FLEET is the whole-fleet path and requires full=true"
        if fleet.get("approved") is not True or not str(fleet.get("approval") or "").strip():
            return None, "purpose FLEET is not approved (fleet_deploy.approved/approval) — the whole fleet is never implied"
        return None, None
    if purpose not in items:
        return None, f"purpose {purpose[:40]!r} is not an item of the approved test plan ({sorted(items) + [FLEET]})"
    item = items[purpose]
    if item.get("approved") is not True or not str(item.get("approval") or "").strip():
        return None, f"test-plan item {purpose} is not approved by the owner (test_plan_items.{purpose}.approved/approval)"
    if full:
        return None, f"full=true cannot widen test-plan item {purpose} beyond its services — use purpose FLEET"
    names = item.get("services")
    if not isinstance(names, list) or not names or not all(isinstance(n, str) and n.startswith("wasla-") for n in names):
        return None, f"test-plan item {purpose} names no services"
    return sorted(names), None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sha")
    ap.add_argument("--only", default="")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--out", default="")
    ap.add_argument("--timeout-min", type=int, default=45)
    ap.add_argument("--plan-only", action="store_true")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()

    if TARGET["mode"] == "frozen":
        report = {"target_commit": a.sha, "verdict": "FROZEN", "deployed": 0,
                  "reason": TARGET.get("reason", ""), "since": TARGET.get("since"),
                  "checked_at": dt.datetime.now(dt.timezone.utc).isoformat()}
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"::notice::Render deploy target is FROZEN since {TARGET.get('since')} — nothing deployed. {TARGET.get('reason', '')}")
        return 0

    # CLM-0632: a deploy is a deliberate, manual test action — never implied by a push.
    deploying = not (a.plan_only or a.verify_only)
    if deploying and (os.environ.get("RENDER_DEPLOY_INTENT") != "test-only" or not os.environ.get("RENDER_DEPLOY_PURPOSE", "").strip()):
        sys.exit("refusing to deploy: RENDER_DEPLOY_INTENT=test-only and a RENDER_DEPLOY_PURPOSE (test-plan item) are required — Render is a test environment, deployed only on purpose")
    scope = None
    if deploying:
        scope, refusal = deploy_gate(TARGET, dict(os.environ), a.all)
        if refusal:
            sys.exit(f"refusing to deploy: {refusal}")
    elif a.all:
        pass  # --plan-only/--verify-only --all only measures

    svcs = services()
    if not svcs:
        sys.exit(f"no wasla- services visible for owner {OWNER} with this key — refusing to report a verdict")
    foreign = [s["name"] for s in svcs if s.get("ownerId") != OWNER]
    if foreign:
        sys.exit(f"services outside the declared owner {OWNER}: {foreign} — refusing to deploy")
    # CLM-0632: the whole workspace must be isolated from production data, not only
    # the services in this run — a test deploy next to a production-linked service is
    # still a non-isolated environment.
    iso = isolation_findings(*collect_isolation(svcs), TARGET["production_database_refs"])
    for f in iso:
        print(f"isolation: {f}", flush=True)
    if iso and deploying:
        sys.exit(f"refusing to deploy: {len(iso)} isolation finding(s) — the Render test environment reaches production data")
    if scope is not None:
        missing = sorted(set(scope) - {x["name"] for x in svcs})
        if missing:
            sys.exit(f"refusing to deploy: test-plan services not in the workspace: {missing}")
        if a.only and not set(a.only.split(",")) <= set(scope):
            sys.exit("refusing to deploy: --only names services outside the test-plan item")
        svcs = [x for x in svcs if x["name"] in scope]
    if a.only:
        wanted = set(a.only.split(","))
        svcs = [s for s in svcs if s["name"] in wanted]
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    pending: dict[str, dict] = {}

    # CLM-0626: plan per service from live commit → target, not from the last push.
    import render_plan  # lazy: the frozen path above must not need the repo
    repo = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    full = render_plan.git(repo, "rev-parse", "--verify", f"{a.sha}^{{commit}}")
    if full.returncode != 0:
        sys.exit(f"target {a.sha} is not a commit in this checkout (fetch-depth 0 required) — refusing to plan")
    target = full.stdout.strip()
    pkgs = render_plan.workspace_packages(repo, target)
    reg_path = os.path.join(repo, render_plan.REGISTRY_PATH)
    registry, reg_how = render_plan.registry_for_target(repo, target, open(reg_path, encoding="utf-8").read() if os.path.isfile(reg_path) else None)
    print(f"plan: {reg_how}", flush=True)
    plan: dict[str, dict] = {}
    for s in svcs:
        live0 = latest_live(s["id"])
        live0_sha = (live0 or {}).get("commit", {}).get("id", "")
        env = (s.get("serviceDetails") or {}).get("envSpecificDetails") or {}
        ws = wasla_service(s["id"]) if s["type"] != "static_site" and render_plan._norm(env.get("dockerContext")) in ("", ".") else None
        inputs, how = render_plan.inputs_for(repo, target, s, ws, pkgs, registry)
        plan[s["id"]] = {"live_before": live0_sha, "inputs_from": how, "inputs": inputs,
                         **render_plan.decide(repo, live0_sha, target, inputs, force=a.all, why=how)}
        print(f"plan {s['name']:24} {plan[s['id']]['decision']:18} live={live0_sha[:7] or '—':7} {plan[s['id']]['reason']}", flush=True)
    to_deploy = [s for s in svcs if plan[s["id"]]["decision"] == "deploy"]
    print(f"plan: deploy {len(to_deploy)}/{len(svcs)} (target {target[:8]})", flush=True)

    if a.plan_only:
        report = {"target_commit": target, "verdict": "PLAN", "deployed": 0, "started_at": started, "registry": reg_how,
                  "environment": "test", "isolation_findings": iso,
                  "policy": "runtime-input equivalence (CLM-0628/CLM-0630); image bytes not compared",
                  "services": [{"service": s["name"], "id": s["id"], **plan[s["id"]]} for s in svcs]}
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
        return 0

    if not a.verify_only:
        for s in to_deploy:
            d = call("POST", f"/services/{s['id']}/deploys", {"commitId": target, "clearCache": "do_not_clear"})
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
        p = plan[s["id"]]
        on_target = bool(live_sha) and (live_sha.startswith(target) or target.startswith(live_sha))
        # `runtime-equivalent` holds only while the live commit is the one the plan diffed.
        equivalent = p["decision"] == "runtime-equivalent" and live_sha == p["live_before"]
        results.append({
            "service": s["name"],
            "id": s["id"],
            "type": s["type"],
            "triggered_deploy": pending.get(s["id"], {}).get("deploy_id"),
            "triggered_status": pending.get(s["id"], {}).get("status"),
            "live_commit": live_sha,
            "live_finished_at": (live or {}).get("finishedAt"),
            "decision": p["decision"],
            "reason": p["reason"],
            "inputs_from": p["inputs_from"],
            "changed": p.get("changed", []),
            "matches_target": on_target or equivalent,
        })

    ok = all(r["matches_target"] for r in results)
    report = {
        "target_commit": target,
        "deployed": len(to_deploy) if not a.verify_only else 0,
        "policy": "runtime-input equivalence (CLM-0628/CLM-0630); image bytes not compared",
        "registry": reg_how,
        "environment": "test",
        "isolation_findings": iso,
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
        print(f"{mark} {r['service']:24} live={r['live_commit'][:7] or '—':7} {r['decision']:18} triggered={r['triggered_status']}")
    print(f"verdict: {report['verdict']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
