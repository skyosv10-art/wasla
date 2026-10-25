#!/usr/bin/env bash
# validate-render-deploy-target.sh — main deploys only to the declared Render workspace (CLM-0501 · INC-0005).
#
# Fails when:
#   1. infra/render/deploy-target.json is invalid: mode not frozen|deploy; frozen with an owner;
#      deploy without a well-formed owner, or with a frozen owner;
#   2. scripts/deploy/render-sync.py carries a workspace id (tea-…) or does not read the target file;
#   3. .github/workflows/render-deploy.yml does not run render-sync.py;
#   4. in frozen mode render-sync.py touches the network (run without RENDER_API_KEY: must exit 0, FROZEN).
#   CLM-0632 (owner decision 2026-10-19 — Render is a TEST environment only, no production deploy):
#   5. the target lacks environment=test or production_database_refs; deploy-mode render-sync.py
#      starts without them (behavioural, no network);
#   6. render-deploy.yml has any trigger but workflow_dispatch, or lacks the required sha/purpose/confirm
#      inputs and the `test-only` gate, or render-sync.py deploys without RENDER_DEPLOY_INTENT=test-only
#      (behavioural, no network);
#   7. the isolation preflight misses a production-named env group or a production DATABASE_URL
#      (unit fixtures), leaks a value into a finding, or is not on the deploy path (fake Render API:
#      a finding must stop the run before any POST).
# Then mutates a copy of the tree for each rule and requires a failure (self-test).
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import json, os, re, shutil, subprocess, sys, tempfile
import importlib.util, contextlib, io

def wf_triggers(wf):
    m = re.search(r"^on:[ \t]*\n((?:[ \t][^\n]*\n|\n)*)", wf, re.M)
    if not m: return None
    return [k for k in re.findall(r"^  ([a-z_]+):", m.group(1), re.M)]

def load_sync(root, target_override=None, env=None, ev_content=None):
    """Import a copy of render-sync.py with an optional target file; returns (module|None, exit text)."""
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "scripts/deploy")); os.makedirs(os.path.join(d, "infra/render"))
        shutil.copy(os.path.join(root, "scripts/deploy/render-sync.py"), os.path.join(d, "scripts/deploy/render-sync.py"))
        t = json.load(open(os.path.join(root, "infra/render/deploy-target.json")))
        if target_override: t.update(target_override)
        ev = t.get("isolation_evidence")
        if isinstance(ev, str) and ev and not ev.startswith("missing/"):
            os.makedirs(os.path.dirname(os.path.join(d, ev)) or d, exist_ok=True); open(os.path.join(d, ev), "w").write(ev_content if ev_content is not None else VALID_EVIDENCE)
        json.dump(t, open(os.path.join(d, "infra/render/deploy-target.json"), "w"))
        spec = importlib.util.spec_from_file_location("rs_under_test", os.path.join(d, "scripts/deploy/render-sync.py"))
        mod = importlib.util.module_from_spec(spec)
        old_env = dict(os.environ)
        try:
            for k in ("RENDER_API_KEY", "RENDER_DEPLOY_INTENT", "RENDER_DEPLOY_PURPOSE", "RENDER_DEPLOY_CONFIRM"): os.environ.pop(k, None)
            os.environ.update(env or {})
            spec.loader.exec_module(mod)
            return mod, ""
        except SystemExit as e:
            return None, str(e.code)
        finally:
            os.environ.clear(); os.environ.update(old_env)
    finally: shutil.rmtree(d)

DEPLOY = {"mode": "deploy", "owner_id": "tea-testworkspace01", "isolation_evidence": "docs/fixture/isolation.md"}
VERBOSE = []  # case lines, printed for the real tree only
PROD = "abcdefghijklmnopqrst"
SECRET = "s3cr3t-value-must-not-leak"

def run_main(mod, argv, env, api):
    calls = []
    def fake(method, path, body=None):
        calls.append((method, path)); return api(method, path)
    mod.call = fake
    mod.time.sleep = lambda *_: None
    sys.modules["render_plan"] = STUB_PLAN
    old_env, old_argv = dict(os.environ), sys.argv
    out = io.StringIO()
    try:
        os.environ.update(env); sys.argv = ["render-sync.py"] + argv
        with contextlib.redirect_stdout(out):
            try: rc = mod.main(); msg = ""
            except SystemExit as e: rc, msg = 1, str(e.code)
            except Exception as e: rc, msg = 1, f"crashed past the guard: {e!r}"
    finally:
        os.environ.clear(); os.environ.update(old_env); sys.argv = old_argv
    return rc, msg, out.getvalue(), calls

import types
STUB_PLAN = types.ModuleType("render_plan")  # the plan itself is CLM-0626's check; here every service plans `deploy`
STUB_PLAN.git = lambda repo, *a: types.SimpleNamespace(returncode=0, stdout="f" * 40 + "\n")
STUB_PLAN.workspace_packages = lambda repo, target: {}
STUB_PLAN.REGISTRY_PATH = "no-registry.json"
STUB_PLAN.registry_for_target = lambda repo, target, cur: ({}, "stub registry")
STUB_PLAN._norm = lambda x: (x or "").strip("/")
STUB_PLAN.inputs_for = lambda repo, target, s, ws, pkgs, reg: ([], "stub")
STUB_PLAN.decide = lambda repo, live, target, inputs, force=False, why=None: {"decision": "deploy", "reason": "stub"}

SVC = [("srv-a", "wasla-customer-bot"), ("srv-b", "wasla-identity"), ("srv-c", "wasla-orders")]

# CLM-0678 (RISK-0069): the isolation evidence is content, not a filename. The
# fixture below carries the full E1–E4 shape of ADR-073 D4; the E-cases below
# feed wrong content and require a refusal.
VALID_EVIDENCE = """# Isolation evidence — E1–E4 (ADR-073 D4)

## E1 — separate test database project
ref: zyxwvutsrqponmlkjihg
name: wasla-test-db
created: 2026-10-19

## E2 — limited role
pg_roles: wasla_test | rolsuper=false | rolcreaterole=false | rolcreatedb=false | rolbypassrls=false | rolreplication=false
grants: SELECT on public.orders (wasla_test)

## E3 — env-group separation
wasla-prod-db linked=0
wasla-test-db linked=3

## E4 — recently generated test keys
kid: svc-test-key-01
sha256: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
generated: 2026-10-19
method: service-auth rotate --test-only
"""

def fake_api(isolated=True):
    def api(method, path):
        if method == "POST": return {"id": "dep-" + path.split("/")[2], "status": "live"}
        if path.startswith("/services?"):
            return [{"service": {"id": i, "name": n, "type": "web_service", "ownerId": "tea-testworkspace01",
                                 "serviceDetails": {"envSpecificDetails": {"dockerContext": "services/x"}}}} for i, n in SVC]
        if path.startswith("/env-groups?"):
            return [{"envGroup": {"id": "evg-1", "name": "wasla-test-db" if isolated else "wasla-prod-db", "serviceLinks": [{"id": i} for i, _ in SVC]}}]
        if path.startswith("/env-groups/"):
            ref = "zyxwvutsrqponmlkjihg" if isolated else PROD
            return {"envVars": [{"key": "DATABASE_URL", "value": f"postgresql://wasla_test.{ref}:{SECRET}@x/postgres"}]}
        if "/env-vars/" in path: raise RuntimeError(f"GET {path} -> 404: b''")
        if "/deploys?" in path: return [{"deploy": {"status": "live", "commit": {"id": "f" * 40}}}]
        return []
    return api

def approved(**over):
    items = {"T1": {"services": ["wasla-customer-bot", "wasla-identity", "wasla-customers"], "approved": False, "approval": None},
             "T2": {"services": ["wasla-customer-bot", "wasla-identity"], "approved": True, "approval": "docs/fixture/owner-approval.md"}}
    fleet = {"approved": False, "approval": None}
    for k, v in over.items():
        if k == "fleet": fleet = v
        else: items[k] = v
    return {**DEPLOY, "environment": "test", "production_database_refs": [PROD], "test_plan_items": items, "fleet_deploy": fleet}

GOOD = {"RENDER_API_KEY": "k", "RENDER_DEPLOY_INTENT": "test-only", "RENDER_DEPLOY_CONFIRM": "test-only", "RENDER_DEPLOY_PURPOSE": "T2"}
# (id, description, target override, env, argv extra, isolated, expected refusal fragment | None, expected POSTed services)
NEG = [
    ("N1", "confirm absent", {}, {**GOOD, "RENDER_DEPLOY_CONFIRM": ""}, [], True, "confirm must be exactly", None),
    ("N2", "confirm wrong ('yes')", {}, {**GOOD, "RENDER_DEPLOY_CONFIRM": "yes"}, [], True, "confirm must be exactly", None),
    ("N3", "intent absent (workflow gate bypassed)", {}, {k: v for k, v in GOOD.items() if k != "RENDER_DEPLOY_INTENT"}, [], True, "RENDER_DEPLOY_INTENT", None),
    ("N4", "purpose not in the plan ('smoke-test')", {}, {**GOOD, "RENDER_DEPLOY_PURPOSE": "smoke-test"}, [], True, "is not an item of the approved test plan", None),
    ("N5", "purpose blank", {}, {**GOOD, "RENDER_DEPLOY_PURPOSE": "  "}, [], True, "RENDER_DEPLOY_PURPOSE", None),
    ("N6", "purpose T1 defined but not approved", {}, {**GOOD, "RENDER_DEPLOY_PURPOSE": "T1"}, [], True, "is not approved by the owner", None),
    ("N7", "full=true on item T2", {}, GOOD, ["--all"], True, "cannot widen test-plan item T2", None),
    ("N8", "FLEET without full=true", {}, {**GOOD, "RENDER_DEPLOY_PURPOSE": "FLEET"}, [], True, "requires full=true", None),
    ("N9", "FLEET + full=true, fleet not approved", {}, {**GOOD, "RENDER_DEPLOY_PURPOSE": "FLEET"}, ["--all"], True, "FLEET is not approved", None),
    ("N10", "approved T2 on a non-isolated workspace", {}, GOOD, [], False, "isolation finding", None),
    ("N11", "--only outside the item", {}, GOOD, ["--only", "wasla-orders"], True, "outside the test-plan item", None),
    ("N12", "item names a service absent from the workspace", {"T2": {"services": ["wasla-customer-bot", "wasla-ghost"], "approved": True, "approval": "x"}}, GOOD, [], True, "not in the workspace", None),
    ("N13", "approved item with an empty approval reference", {"T2": {"services": ["wasla-customer-bot"], "approved": True, "approval": " "}}, GOOD, [], True, "is not approved by the owner", None),
    ("P1", "control: approved T2, isolated → only T2 services", {}, GOOD, [], True, None, ["srv-a", "srv-b"]),
    ("P2", "control: approved FLEET + full=true, isolated → whole fleet", {"fleet": {"approved": True, "approval": "docs/fixture/fleet.md"}}, {**GOOD, "RENDER_DEPLOY_PURPOSE": "FLEET"}, ["--all"], True, None, ["srv-a", "srv-b", "srv-c"]),
]

def gate_cases(root):
    errs = []
    for cid, desc, over, env, extra, isolated, refusal, posted in NEG:
        mod, msg = load_sync(root, approved(**over))
        if mod is None: errs.append(f"{cid} {desc}: approved fixture target did not load: {msg[:140]}"); continue
        rc, msg, out, calls = run_main(mod, ["0" * 40] + extra, env, fake_api(isolated))
        posts = sorted(p.split("/")[2] for m, p in calls if m == "POST")
        if refusal:
            ok = rc != 0 and refusal in msg and not posts
            gate_only = refusal not in ("isolation finding", "outside the test-plan item", "not in the workspace")
            if gate_only and calls: ok = False
            got = f"refused before {'any call' if not calls else 'any POST'} ({len(calls)} GET) — {msg[:110]}" if rc != 0 else f"NOT refused, POST {posts}"
        else:
            ok = rc == 0 and posts == posted and "verdict: PASS" in out
            got = f"rc={rc} POST {posts}"
        VERBOSE.append(f"    {'✓' if ok else '✗'} {cid} {desc}: {got}")
        if not ok: errs.append(f"{cid} {desc}: expected {'refusal «' + refusal + '» with 0 POST' if refusal else 'POST ' + str(posted)}, got {got}")
        if SECRET in out + msg or PROD in out + msg: errs.append(f"{cid}: a database value was printed")
        if any(re.search(r"/services/[^/]+/env-vars(\?|$)", p) for _, p in calls): errs.append(f"{cid}: the isolation preflight read the env-var list instead of keys")
    # E — deploy mode needs an isolation-evidence file (CLM-0635) whose CONTENT
    # carries E1–E4 (CLM-0678 · RISK-0069 — review #822: existence alone accepted README.md).
    ev_neg = (
        ("E1", "deploy mode without isolation_evidence", None, None),
        ("E2", "isolation_evidence names a missing file", "missing/iso.md", None),
        ("E3", "isolation_evidence escapes the repo", "../outside.md", None),
        ("E4", "an unrelated existing file (README.md) as evidence", "docs/fixture/iso.md", "# Wasla\n\nA customer app.\n"),
        ("E5", "an empty evidence file", "docs/fixture/iso.md", ""),
        ("E6", "E3 section missing", "docs/fixture/iso.md", VALID_EVIDENCE.replace("## E3 — env-group separation\nwasla-prod-db linked=0\nwasla-test-db linked=3\n", "")),
        ("E7", "E1 names the production ref", "docs/fixture/iso.md", VALID_EVIDENCE.replace("zyxwvutsrqponmlkjihg", PROD)),
        ("E8", "E2 without grants", "docs/fixture/iso.md", VALID_EVIDENCE.replace("grants: SELECT on public.orders (wasla_test)", "")),
        ("E9", "E4 without fingerprints", "docs/fixture/iso.md", VALID_EVIDENCE.replace("sha256: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2\n", "")),
        ("E10", "E3 with the production group linked", "docs/fixture/iso.md", VALID_EVIDENCE.replace("wasla-prod-db linked=0", "wasla-prod-db linked=17")),
        ("E11", "key material pasted into the evidence", "docs/fixture/iso.md", VALID_EVIDENCE + "\n" + "-----BEGIN PRIVATE " + "KEY-----\n"),  # مُركَّبٌ من قطعتين: لا يظهر النمطُ الحرفيُّ في المصدرِ أمامَ فاحصِ الأسرارِ — والحراسةُ تُقاسُ في التشغيلِ كما هي
        ("E12", "another prod-named group is linked", "docs/fixture/iso.md", VALID_EVIDENCE.replace("wasla-test-db linked=3", "wasla-test-db linked=3\nwasla-prod-legacy linked=5")),
        ("P3", "control: complete E1–E4 evidence loads", "docs/fixture/iso.md", None),
    )
    for cid, desc, ev, content in ev_neg:
        mod, msg = load_sync(root, {**approved(), "isolation_evidence": ev}, ev_content=content)
        if cid == "P3":
            ok = mod is not None
            VERBOSE.append(f"    {'✓' if ok else '✗'} {cid} {desc}: {'loaded' if ok else 'refused: ' + msg[:110]}")
            if not ok: errs.append(f"{cid} {desc}: a complete E1–E4 evidence was refused: {msg[:160]}")
        else:
            ok = mod is None and "isolation_evidence" in msg
            VERBOSE.append(f"    {'✓' if ok else '✗'} {cid} {desc}: {'refused' if ok else 'LOADED'}")
            if not ok: errs.append(f"{cid} {desc}: deploy target loaded")
    return errs

def test_only_rules(root, t):
    errs = []
    if t.get("environment") != "test": errs.append("deploy-target.json must declare environment=test (Render is a test environment only — CLM-0632)")
    refs = t.get("production_database_refs")
    if not isinstance(refs, list) or not refs: errs.append("deploy-target.json must list production_database_refs (isolation rule)")
    wf = open(os.path.join(root, ".github/workflows/render-deploy.yml")).read()
    trig = wf_triggers(wf)
    if trig != ["workflow_dispatch"]: errs.append(f"render-deploy.yml must trigger on workflow_dispatch only (got {trig})")
    for inp in ("sha", "purpose", "confirm"):
        if not re.search(rf"^      {inp}:\n(?:        .*\n)*?        required: true", wf, re.M): errs.append(f"render-deploy.yml input {inp} must be required")
    if '"${RENDER_DEPLOY_CONFIRM}" != "test-only"' not in wf or "RENDER_DEPLOY_INTENT=test-only" not in wf:
        errs.append("render-deploy.yml must gate on confirm=test-only and pass RENDER_DEPLOY_INTENT")
    if "github.sha" in wf.split("env:", 1)[-1].split("steps:", 1)[0]: errs.append("render-deploy.yml must not default the target to the pushed commit")
    # 5 — deploy mode without the test-only fields must not start
    for drop in ("environment", "production_database_refs"):
        mod, msg = load_sync(root, {**DEPLOY, drop: None})
        if mod is not None: errs.append(f"render-sync.py starts in deploy mode without {drop}")
    mod, msg = load_sync(root, {**DEPLOY, "environment": "production"})
    if mod is not None: errs.append("render-sync.py starts in deploy mode with environment=production")
    mod, msg = load_sync(root, {**DEPLOY, "environment": "test", "production_database_refs": [PROD]})
    if mod is None: errs.append(f"render-sync.py does not load a valid test-only deploy target: {msg[:160]}"); return errs
    if not hasattr(mod, "isolation_findings"): errs.append("render-sync.py has no isolation_findings"); return errs
    # 7 — unit fixtures
    F = mod.isolation_findings
    cases = [
        ("production-named group linked", [{"name": "wasla-prod-db", "linked": ["wasla-orders"], "vars": {}}], {}, True),
        ("group DATABASE_URL on the production project", [{"name": "shared", "linked": ["wasla-orders"], "vars": {"DATABASE_URL": f"postgresql://postgres.{PROD}:{SECRET}@x/postgres"}}], {}, True),
        ("service DATABASE_URL on the production project", [], {"wasla-orders": {"ORDER_DATABASE_URL": f"postgres://u:{SECRET}@db.{PROD}.supabase.co/postgres"}}, True),
        ("isolated test project", [{"name": "wasla-test-db", "linked": ["wasla-orders"], "vars": {"DATABASE_URL": f"postgresql://postgres.zyxwvutsrqponmlkjihg:{SECRET}@x/postgres"}}], {"wasla-orders": {"DATABASE_URL": "postgres://u:p@localhost/test"}}, False),
        ("production-named group not linked", [{"name": "wasla-prod-db", "linked": [], "vars": {}}], {}, False),
    ]
    for desc, g, sv, want in cases:
        got = F(g, sv, [PROD])
        if bool(got) != want: errs.append(f"isolation_findings wrong for '{desc}': {got}")
        if any(SECRET in x or PROD in x for x in got): errs.append(f"isolation finding leaks a value for '{desc}'")
    # 6/7 — behavioural gate + isolation on a fake Render API (CLM-0635: table of negative cases)
    errs += gate_cases(root)
    # workflow/target consistency (CLM-0635)
    items = t.get("test_plan_items")
    if not isinstance(items, dict) or not items: errs.append("deploy-target.json must declare test_plan_items")
    else:
        m = re.search(r"^      purpose:\n(?:        .*\n)*?        options:\n((?:          - .*\n)+)", wf, re.M)
        opts = re.findall(r"- (\S+)", m.group(1)) if m else None
        if opts != sorted(items) + ["FLEET"]: errs.append(f"render-deploy.yml purpose must be a choice of exactly {sorted(items) + ['FLEET']} (got {opts})")
        for k, v in items.items():
            if not isinstance(v.get("approved"), bool): errs.append(f"test_plan_items.{k}.approved must be a boolean")
        if t.get("mode") == "frozen" and any(v.get("approved") for v in items.values()) and not t.get("isolation_evidence"):
            pass  # an approval may be recorded while frozen; deploy mode still needs isolation_evidence
    if not isinstance(t.get("fleet_deploy"), dict): errs.append("deploy-target.json must declare fleet_deploy (separate whole-fleet path)")
    if 'case "${RENDER_DEPLOY_PURPOSE}" in' not in wf or '[ "${FULL_DEPLOY}" = "true" ] && [ "${RENDER_DEPLOY_PURPOSE}" != "FLEET" ]' not in wf:
        errs.append("render-deploy.yml must reject unknown purposes and full=true outside FLEET")
    if t.get("mode") == "deploy" and not (isinstance(t.get("isolation_evidence"), str) and os.path.isfile(os.path.join(root, t["isolation_evidence"]))):
        errs.append("deploy mode needs isolation_evidence naming an existing evidence file (ADR-073 D4)")
    return errs

def check(root):
    errs = []
    t = json.load(open(os.path.join(root, "infra/render/deploy-target.json")))
    mode, owner, frozen = t.get("mode"), t.get("owner_id"), t.get("frozen_owners") or []
    if mode not in ("frozen", "deploy"): errs.append(f"mode {mode!r} is not frozen|deploy")
    if mode == "frozen" and owner: errs.append("frozen mode must not name an owner_id")
    if mode == "deploy" and (not isinstance(owner, str) or not re.fullmatch(r"tea-[a-z0-9]+", owner)): errs.append("deploy mode needs owner_id tea-…")
    if mode == "deploy" and owner in frozen: errs.append(f"owner_id {owner} is frozen")
    rs = open(os.path.join(root, "scripts/deploy/render-sync.py")).read()
    if re.search(r"tea-[a-z0-9]{6,}", rs): errs.append("render-sync.py hard-codes a workspace id")
    if "deploy-target.json" not in rs: errs.append("render-sync.py does not read deploy-target.json")
    wf = open(os.path.join(root, ".github/workflows/render-deploy.yml")).read()
    if "scripts/deploy/render-sync.py" not in wf: errs.append("render-deploy.yml does not run render-sync.py")
    errs += test_only_rules(root, t)
    # CLM-0635 — the local T2 procedure (no Render): its guard must hold offline
    t2 = os.path.join(root, "scripts/test-env/t2_local.py")
    if not os.path.isfile(t2): errs.append("scripts/test-env/t2_local.py missing (T2 local procedure)")
    else:
        r = subprocess.run([sys.executable, t2, "self-test"], capture_output=True, text=True)
        if r.returncode != 0: errs.append("T2 local self-test failed: " + " | ".join(l.strip() for l in r.stdout.splitlines() if "✗" in l)[:200])
        elif root == ".": VERBOSE.extend("  " + l for l in r.stdout.splitlines()[1:])
    if mode == "frozen":
        env = {k: v for k, v in os.environ.items() if k != "RENDER_API_KEY"}
        r = subprocess.run([sys.executable, os.path.join(root, "scripts/deploy/render-sync.py"), "0" * 40], capture_output=True, text=True, env=env)
        if r.returncode != 0 or "FROZEN" not in r.stdout: errs.append(f"frozen render-sync.py did not skip cleanly: rc={r.returncode} {r.stderr.strip()[:160]}")
    return errs

errs = check(".")
print("  gate + isolation cases (fake Render API, target unfrozen only inside the fixture):")
for line in VERBOSE: print(line)
VERBOSE.clear()
for e in errs: print("  ✗", e)
if errs: sys.exit(1)
mode = json.load(open("infra/render/deploy-target.json"))["mode"]
print(f"  ✓ Render deploy target declared ({mode}, environment=test); render-sync.py has no built-in workspace; frozen mode deploys nothing without network")
print("  ✓ test-only: workflow_dispatch only (sha/purpose/confirm=test-only), deploy intent required, isolation preflight blocks production data before any deploy")
print("  ✓ purpose gate (CLM-0635): one approved test-plan item, its services only; full=true never widens an item; FLEET is a separate approval; deploy mode needs isolation evidence")

def mutate(desc, edits):
    """edits: list of (path, anchor, replacement) applied in order; all anchors must exist."""
    d = tempfile.mkdtemp()
    try:
        for p in ("infra/render/deploy-target.json", "scripts/deploy/render-sync.py", ".github/workflows/render-deploy.yml", "scripts/test-env/t2_local.py"):
            os.makedirs(os.path.dirname(os.path.join(d, p)), exist_ok=True); shutil.copy(p, os.path.join(d, p))
        for path, a, b in edits:
            q = os.path.join(d, path); s = open(q).read(); assert a in s, (path, a); open(q, "w").write(s.replace(a, b, 1))
        e = check(d)
        if not e: print(f"  ✗ self-test: mutation not caught — {desc}"); return False
        print(f"    ✓ {desc}\n        caught by: {e[0][:170]}")
        return True
    finally: shutil.rmtree(d)

# CLM-0503: the self-test must be state-independent — the target file is legitimately
# frozen OR deploy (STEP B flips it), so every deploy-target mutation is anchored on
# the CURRENT file content, not on a hard-coded frozen-state literal. The caught rules
# are the same in both states: frozen owner refused (deploy), frozen naming an owner
# refused (frozen), unknown mode refused (both).
cur = json.load(open("infra/render/deploy-target.json"))
cur_mode, cur_owner = cur["mode"], cur.get("owner_id")
frozen_legacy = (cur.get("frozen_owners") or ["tea-damm8atbedkc73ca3ahg"])[0]
mode_anchor = f'"mode": "{cur_mode}"'
owner_anchor = '"owner_id": ' + ("null" if cur_owner is None else json.dumps(cur_owner))
T, R, W, X = "infra/render/deploy-target.json", "scripts/deploy/render-sync.py", ".github/workflows/render-deploy.yml", "scripts/test-env/t2_local.py"
if cur_mode == "frozen":
    mut_owner = [(T, mode_anchor + ",\n  " + owner_anchor, f'"mode": "deploy",\n  "owner_id": {json.dumps(frozen_legacy)}')]
    mut_freeze = [(T, owner_anchor, f'"owner_id": {json.dumps(cur.get("legacy_owner") or "tea-db0vtkpsrm7s739dm5c0")}')]
else:
    mut_owner = [(T, owner_anchor, f'"owner_id": {json.dumps(frozen_legacy)}')]
    mut_freeze = [(T, mode_anchor, '"mode": "frozen"')]

# rule 4 (frozen must not reach the network) is tested on a copy forced into the
# frozen state, whatever the current file is — the forced edits are no-ops when
# the file is already frozen.
force_frozen = [(T, mode_anchor, '"mode": "frozen"'), (T, owner_anchor, '"owner_id": null')]
cases = [
    ("deploy to the frozen legacy owner", mut_owner),
    ("frozen but naming an owner", mut_freeze),
    ("unknown mode", [(T, mode_anchor, '"mode": "auto"')]),
    ("built-in workspace default returns", [(R, 'OWNER = TARGET.get("owner_id")', 'OWNER = TARGET.get("owner_id") or "tea-damm8atbedkc73ca3ahg"')]),
    ("frozen check removed (would reach Render)", force_frozen + [(R, 'if TARGET["mode"] == "frozen":\n        report', 'if False:\n        report')]),
    ("workflow stops using render-sync.py", [(".github/workflows/render-deploy.yml", "scripts/deploy/render-sync.py", "scripts/deploy/other.py")]),
    # CLM-0632 — test-only rules
    ("target loses environment=test", [(T, '"environment": "test"', '"environment": "production"')]),
    ("target loses production_database_refs", [(T, '"production_database_refs": [', '"production_database_refs_off": [')]),
    ("workflow regains a push trigger", [(W, "on:\n  workflow_dispatch:", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:")]),
    ("workflow gains a schedule", [(W, "on:\n  workflow_dispatch:", "on:\n  schedule:\n    - cron: '0 * * * *'\n  workflow_dispatch:")]),
    ("workflow confirm gate removed", [(W, '"${RENDER_DEPLOY_CONFIRM}" != "test-only"', '"${RENDER_DEPLOY_CONFIRM}" = "never"')]),
    ("workflow purpose optional", [(W, "FLEET only with full=true and its own approval\"\n        required: true", "FLEET only with full=true and its own approval\"\n        required: false")]),
    ("workflow target defaults to the pushed commit", [(W, "TARGET_SHA: ${{ github.event.inputs.sha }}", "TARGET_SHA: ${{ github.event.inputs.sha || github.sha }}")]),
    ("render-sync accepts environment=production", [(R, 'if t.get("environment") != "test":', 'if t.get("environment") not in ("test", "production"):')]),
    ("render-sync deploy intent check removed", [(R, 'if deploying and (os.environ.get("RENDER_DEPLOY_INTENT") != "test-only"', 'if False and (os.environ.get("RENDER_DEPLOY_INTENT") != "test-only"')]),
    ("isolation ignores production-named groups", [(R, "if PROD_NAME.search(g.get(\"name\", \"\")):", "if False:")]),
    ("isolation ignores service DATABASE_URLs", [(R, "    for name, kv in sorted(service_db.items()):", "    for name, kv in []:")]),
    ("isolation finding prints the value", [(R, 'out.append(f"service {name} key {k} points at a production database")', 'out.append(f"service {name} key {k}={v} points at a production database")')]),
    ("isolation findings do not stop the deploy", [(R, "if iso and deploying:", "if iso and False:")]),
    ("isolation preflight dropped from the deploy path", [(R, 'iso = isolation_findings(*collect_isolation(svcs), TARGET["production_database_refs"])', "iso = []")]),
    ("isolation reads the env-var list", [(R, 'call("GET", f"/services/{sid}/env-vars/{key}")', 'call("GET", f"/services/{sid}/env-vars?limit=100")')]),
    # CLM-0635 — purpose gate
    ("gate accepts any purpose", [(R, "    if purpose not in items:\n", "    if False:\n"), (R, "    item = items[purpose]", "    item = items.get(purpose) or {'approved': True, 'approval': 'x', 'services': ['wasla-customer-bot']}")]),
    ("gate ignores owner approval", [(R, '    if item.get("approved") is not True or not str(item.get("approval") or "").strip():', "    if False:")]),
    ("full=true widens an item", [(R, "    if full:\n        return None, f\"full=true cannot widen", "    if False:\n        return None, f\"full=true cannot widen")]),
    ("FLEET without its approval", [(R, '        if fleet.get("approved") is not True or not str(fleet.get("approval") or "").strip():', "        if False:")]),
    ("gate drops the confirm check", [(R, '    if env.get("RENDER_DEPLOY_CONFIRM") != CONFIRM or env.get("RENDER_DEPLOY_INTENT") != CONFIRM:', "    if False:")]),
    ("gate not called on the deploy path", [(R, "        scope, refusal = deploy_gate(TARGET, dict(os.environ), a.all)", "        scope, refusal = None, None")]),
    ("item scope not applied to the services", [(R, '        svcs = [x for x in svcs if x["name"] in scope]', "        pass")]),
    ("--only may leave the item", [(R, '        if a.only and not set(a.only.split(",")) <= set(scope):', "        if False:")]),
    ("deploy target without isolation evidence loads", [(R, '    if not isinstance(ev, str) or not ev.strip() or ev.startswith("/") or ".." in ev.split("/") or not os.path.isfile(os.path.join(root, ev)):', "    if False:")]),
    # CLM-0678 — the evidence is content, not a filename (RISK-0069)
    ("evidence content check removed", [(R, '    errs = isolation_evidence_errors(os.path.join(root, ev), refs) if isinstance(ev, str) and ev else []', '    errs = []')]),
    ("evidence check accepts the production ref in E1", [(R, 'elif ref in prod_refs or ref in ("ppixaauyqoykrogwdxtv", "pvyuhjadrygqqdoczmnd"):', 'elif False:')]),
    ("evidence check accepts pasted key material", [(R, '    if "-----BEGIN" in text:\n        errs.append("key material must never be pasted into the evidence")', '    if False:\n        pass')]),
    ("evidence check accepts a linked production group", [(R, '            if m and int(m.group(2)) > 0:\n                errs.append(f"E3: group {m.group(1)} is prod-named and linked — separation is not evidenced")', '            if False:\n                pass')]),
    ("workflow purpose is free text", [(W, "        type: choice\n        options:\n          - T1\n          - T2\n          - FLEET\n", "")]),
    ("workflow accepts full=true outside FLEET", [(W, '[ "${FULL_DEPLOY}" = "true" ] && [ "${RENDER_DEPLOY_PURPOSE}" != "FLEET" ]', '[ "${FULL_DEPLOY}" = "never" ]')]),
    ("workflow accepts unknown purposes", [(W, 'case "${RENDER_DEPLOY_PURPOSE}" in', 'case "skip" in')]),
    ("T2 register ignores the owner approval", [(X, '    if not t2_approval(target_path):\n        return None, "T2 is not approved', '    if False:\n        return None, "T2 is not approved')]),
    ("T2 preflight accepts a remote database", [(X, '                if (u.hostname or "") not in LOCAL_HOSTS:', '                if False:')]),
    ("T2 webhook URL may be plain http or Render", [(X, '    if u.scheme != "https" or not u.hostname:\n        return "the webhook URL must be https://"\n    if u.hostname.endswith("onrender.com") or u.hostname in LOCAL_HOSTS:', '    if False:\n        return "the webhook URL must be https://"\n    if False:')]),
    ("T2 preflight accepts reused service-auth keys", [(X, '        if not kids or any(not k.startswith(KID_PREFIX) for k in kids):', '        if False:')]),
    ("workflow options drift from the plan", [(W, "          - T2\n          - FLEET\n", "          - T2\n          - T3\n          - FLEET\n")]),
]
ok = all([mutate(*c) for c in cases])
if not ok: sys.exit(1)
print(f"  ✓ self-test: {len(cases)}/{len(cases)} mutations caught")
PY
