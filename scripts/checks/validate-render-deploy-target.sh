#!/usr/bin/env bash
# validate-render-deploy-target.sh — main deploys only to the declared Render workspace (CLM-0501 · INC-0005).
#
# Fails when:
#   1. infra/render/deploy-target.json is invalid: mode not frozen|deploy; frozen with an owner;
#      deploy without a well-formed owner, or with a frozen owner;
#   2. scripts/deploy/render-sync.py carries a workspace id (tea-…) or does not read the target file;
#   3. .github/workflows/render-deploy.yml does not run render-sync.py;
#   4. in frozen mode render-sync.py touches the network (run without RENDER_API_KEY: must exit 0, FROZEN).
# Then mutates a copy of the tree for each rule and requires a failure (self-test).
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import json, os, re, shutil, subprocess, sys, tempfile

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
    if mode == "frozen":
        env = {k: v for k, v in os.environ.items() if k != "RENDER_API_KEY"}
        r = subprocess.run([sys.executable, os.path.join(root, "scripts/deploy/render-sync.py"), "0" * 40], capture_output=True, text=True, env=env)
        if r.returncode != 0 or "FROZEN" not in r.stdout: errs.append(f"frozen render-sync.py did not skip cleanly: rc={r.returncode} {r.stderr.strip()[:160]}")
    return errs

errs = check(".")
for e in errs: print("  ✗", e)
if errs: sys.exit(1)
mode = json.load(open("infra/render/deploy-target.json"))["mode"]
print(f"  ✓ Render deploy target declared ({mode}); render-sync.py has no built-in workspace; frozen mode deploys nothing without network")

def mutate(desc, path, a, b):
    d = tempfile.mkdtemp()
    try:
        for p in ("infra/render/deploy-target.json", "scripts/deploy/render-sync.py", ".github/workflows/render-deploy.yml"):
            os.makedirs(os.path.dirname(os.path.join(d, p)), exist_ok=True); shutil.copy(p, os.path.join(d, p))
        q = os.path.join(d, path); s = open(q).read(); assert a in s, (path, a); open(q, "w").write(s.replace(a, b, 1))
        if not check(d): print(f"  ✗ self-test: mutation not caught — {desc}"); return False
        return True
    finally: shutil.rmtree(d)

T, R = "infra/render/deploy-target.json", "scripts/deploy/render-sync.py"
cases = [
    ("deploy to the frozen legacy owner", T, '"mode": "frozen",\n  "owner_id": null', '"mode": "deploy",\n  "owner_id": "tea-damm8atbedkc73ca3ahg"'),
    ("frozen but naming an owner", T, '"owner_id": null', '"owner_id": "tea-db0vtkpsrm7s739dm5c0"'),
    ("unknown mode", T, '"mode": "frozen"', '"mode": "auto"'),
    ("built-in workspace default returns", R, 'OWNER = TARGET.get("owner_id")', 'OWNER = TARGET.get("owner_id") or "tea-damm8atbedkc73ca3ahg"'),
    ("frozen check removed (would reach Render)", R, 'if TARGET["mode"] == "frozen":\n        report', 'if False:\n        report'),
    ("workflow stops using render-sync.py", ".github/workflows/render-deploy.yml", "scripts/deploy/render-sync.py", "scripts/deploy/other.py"),
]
ok = all([mutate(*c) for c in cases])
if not ok: sys.exit(1)
print(f"  ✓ self-test: {len(cases)}/{len(cases)} mutations caught")
PY
