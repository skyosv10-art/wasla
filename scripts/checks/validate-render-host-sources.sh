#!/usr/bin/env bash
# validate-render-host-sources.sh — CLM-0502 · INC-0005 · P5-9
# Every tracked non-doc file that names a Render host, the legacy host convention or a
# Render workspace id is classified in infra/render/host-sources.json, and:
#   1. no file outside the registry carries a default workspace (RENDER_OWNER_ID, "tea-…");
#   2. legacy write tools call render_target.legacy_only and REFUSE (exit 3) while the legacy
#      owner is frozen — executed for real, with network blocked;
#   3. legacy read tools call render_target.explicit_owner and refuse without RENDER_OWNER_ID;
#   4. every legacy file carries the LEGACY-ONLY (CLM-0502) marker.
# Self-test: mutations of a temporary copy must each be caught.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

check() {  # $1 = tree root; prints first failure, returns non-zero on failure
  python3 - "$1" <<'PY'
import json, os, re, subprocess, sys
from pathlib import Path
R = Path(sys.argv[1]); M = json.loads((R / "infra/render/host-sources.json").read_text())
MARK = "LEGACY-ONLY (CLM-0502)"
listed = {f for k in ("registry", "guards", "legacy_write_tools", "legacy_read_tools", "legacy_marked") for f in M[k]}
pat = re.compile(r"onrender\.com|wasla-\$\{|wasla-\{|tea-[a-z0-9]{10,}")
skip = re.compile(r"(^docs/|\.md$|/__tests__/|\.test\.ts$|node_modules/|^infra/render/host-sources\.json$)")
files = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=R, capture_output=True, text=True).stdout.split() if (R / ".git").exists() \
    else [str(p.relative_to(R)) for p in R.rglob("*") if p.is_file()]
def fail(m): print(f"✗ render host sources: {m}"); sys.exit(1)
for f in files:
    if skip.search(f) or not (R / f).is_file(): continue
    try: s = (R / f).read_text(encoding="utf-8")
    except Exception: continue
    if pat.search(s) and f not in listed: fail(f"{f} names a Render host/workspace but is not classified in infra/render/host-sources.json")
    if f not in M["registry"] and re.search(r"RENDER_OWNER_ID[\"']\s*,\s*[\"']tea-", s): fail(f"{f} carries a default Render workspace")
for f in listed:
    if not (R / f).is_file(): fail(f"{f} is classified but missing")
for f in M["legacy_marked"] + M["legacy_write_tools"]:
    s = (R / f).read_text(encoding="utf-8")
    if MARK not in s and not (f.endswith("render-tls-activate.py") and "render-dr-cutover.py" in s): fail(f"{f} lacks the {MARK} marker")
env = {k: v for k, v in os.environ.items() if k not in ("RENDER_API_KEY", "RENDER_OWNER_ID")}
env.update(HTTPS_PROXY="http://127.0.0.1:9", https_proxy="http://127.0.0.1:9", HTTP_PROXY="http://127.0.0.1:9", http_proxy="http://127.0.0.1:9", PYTHONDONTWRITEBYTECODE="1")
t = json.loads((R / "infra/render/deploy-target.json").read_text())
if t.get("legacy_owner") not in (t.get("frozen_owners") or []): fail("legacy_owner is not frozen — the blue/green freeze requires it (CLM-0501)")
for f in M["legacy_write_tools"]:
    p = subprocess.run([sys.executable, str(R / f), "plan"], cwd=R, env=env, capture_output=True, text=True, timeout=60)
    if p.returncode != 3 or "LEGACY-ONLY" not in p.stderr: fail(f"{f} did not refuse while legacy is frozen (rc={p.returncode})")
for f in M["legacy_read_tools"]:
    p = subprocess.run([sys.executable, str(R / f)], cwd=R, env=env, capture_output=True, text=True, timeout=60)
    if p.returncode != 2 or "RENDER_OWNER_ID is required" not in p.stderr: fail(f"{f} ran without an explicit RENDER_OWNER_ID (rc={p.returncode})")
print(f"  ✓ Render host sources classified ({len(listed)} files); no default workspace; {len(M['legacy_write_tools'])} legacy write tools refuse while frozen; {len(M['legacy_read_tools'])} read tools need RENDER_OWNER_ID; legacy files marked")
PY
}

check "$ROOT" || exit 1

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
n=0; caught=0
mutate() {  # $1 description, $2 python snippet run inside the copy
  n=$((n+1)); rm -rf "$T/m"; mkdir -p "$T/m"
  (cd "$ROOT" && git ls-files -z --cached --others --exclude-standard | grep -zv '^docs/' | xargs -0 -I{} cp --parents {} "$T/m/") 2>/dev/null
  (cd "$T/m" && python3 -c "$2")
  if check "$T/m" >/dev/null 2>&1; then echo "  ✗ mutation not caught: $1"; else caught=$((caught+1)); fi
}
rm -rf "$T/m"; mkdir -p "$T/m"; (cd "$ROOT" && git ls-files -z --cached --others --exclude-standard | grep -zv '^docs/' | xargs -0 -I{} cp --parents {} "$T/m/") 2>/dev/null
check "$T/m" >/dev/null || { echo "  ✗ self-test baseline: unmutated copy fails"; exit 1; }
mutate "unclassified file with a legacy host" 'open("scripts/new-tool.py","w").write("U=\"https://wasla-orders.onrender.com\"\n")'
mutate "default workspace re-introduced" 'p="scripts/ops/render-env-fingerprint.py";s=open(p).read();open(p,"w").write(s.replace("explicit_owner(\"render-env-fingerprint.py\")","os.environ.get(\"RENDER_OWNER_ID\", \"tea-damm8atbedkc73ca3ahg\")"))'
mutate "legacy write tool guard removed" 'p="scripts/ops/risk-0056/render-cutover.py";s=open(p).read();open(p,"w").write(s.replace("legacy_only(\"render-cutover.py\")","\"tea-x\"; import sys; sys.exit(0)"))'
mutate "read tool guard removed" 'p="scripts/ops/risk-0042/observe-report.py";s=open(p).read();open(p,"w").write(s.replace("explicit_owner(\"observe-report.py\")","\"tea-x\"; import sys; sys.exit(0)"))'
mutate "legacy marker removed" 'p="infra/terraform/cron/main.tf";s=open(p).read();open(p,"w").write(s.replace("LEGACY-ONLY (CLM-0502)","legacy"))'
mutate "legacy owner unfrozen" 'import json;p="infra/render/deploy-target.json";t=json.load(open(p));t["frozen_owners"]=[];json.dump(t,open(p,"w"))'
mutate "classified file deleted" 'import os;os.remove("scripts/m3-07-health-scan.py")'
echo "  ✓ self-test: ${caught}/${n} mutations caught"
[ "$caught" = "$n" ]
