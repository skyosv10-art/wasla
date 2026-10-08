#!/usr/bin/env bash
# validate-observability-targets.sh — monitoring targets are per environment, never hard-coded
# (CLM-0499 · ADR-068 · M6-18B blue/green).
#
# Fails when:
#   1. prometheus.yml (template) or services/observability/src/config.ts carries a Render hostname;
#   2. a targets file does not render through the REAL entrypoint, or renders other hosts than it lists;
#   3. two environments list the same host (a new environment silently scraping the old stack);
#   4. more than one environment owns paging (duplicate Telegram alerts);
#   5. environments disagree on the service set, or Dockerfile.prometheus does not ship targets/;
#   6. the entrypoint starts without WASLA_OBS_ENVIRONMENT (must fail closed);
#   7. scripts/ops/health/check-health.py carries a hostname, or service-health.yml probes
#      another environment than the paging owner.
# Then mutates a copy of the tree for each rule and requires a failure (self-test).
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import os, re, shutil, subprocess, sys, tempfile, yaml

def check(root):
    errs = []
    obs = os.path.join(root, "infra/observability")
    tpl = open(os.path.join(obs, "prometheus.yml")).read()
    if re.search(r"[a-z0-9-]+\.onrender\.com", tpl): errs.append("prometheus.yml template contains a Render hostname")
    cfg = open(os.path.join(root, "services/observability/src/config.ts")).read()
    if "onrender.com" in cfg: errs.append("services/observability/src/config.ts contains a Render hostname")
    if not re.search(r"^COPY targets/ /etc/prometheus/targets/$", open(os.path.join(obs, "Dockerfile.prometheus")).read(), re.M):
        errs.append("Dockerfile.prometheus does not COPY targets/")
    tdir = os.path.join(obs, "targets"); files = sorted(f for f in os.listdir(tdir) if f.endswith(".targets"))
    if not files: return errs + ["no targets files"]
    owners, hosts, names = [], {}, {}
    for f in files:
        env = f[:-8]; lines = [l.split() for l in open(os.path.join(tdir, f)) if l.strip() and not l.lstrip().startswith("#")]
        am = [l[1] for l in lines if l[0] == "alertmanager"]
        svc = [(l[1], l[2]) for l in lines if l[0] == "service"]
        if am and am[0] != "none": owners.append(env)
        names[env] = [n for n, _ in svc]
        listed = [re.sub(r"^https://", "", u) for _, u in svc]
        for h in listed: hosts.setdefault(h, []).append(env)
        r = subprocess.run(["sh", os.path.join(obs, "prometheus-entrypoint.sh")], capture_output=True, text=True,
                           env={"PATH": os.environ["PATH"], "WASLA_OBS_ENVIRONMENT": env, "WASLA_OBS_CONFIG_DIR": obs, "WASLA_OBS_RENDER_ONLY": "1"})
        if r.returncode: errs.append(f"{env}: entrypoint failed: {r.stderr.strip()}"); continue
        c = yaml.safe_load(r.stdout)
        got = c["scrape_configs"][0]["static_configs"][0]["targets"]
        if got != listed: errs.append(f"{env}: rendered targets differ from the file")
        if c["scrape_configs"][0]["static_configs"][0]["labels"]["environment"] != env: errs.append(f"{env}: environment label wrong")
        ams = c["alerting"]["alertmanagers"]
        if (am[0] == "none") != (ams == []): errs.append(f"{env}: alerting block does not match the alertmanager line")
    if len(owners) > 1: errs.append(f"more than one environment owns paging: {owners}")
    hc = open(os.path.join(root, "scripts/ops/health/check-health.py")).read()
    if "onrender.com" in hc: errs.append("scripts/ops/health/check-health.py contains a Render hostname")
    wf = re.findall(r"WASLA_OBS_ENVIRONMENT:\s*([a-z0-9-]+)", open(os.path.join(root, ".github/workflows/service-health.yml")).read())
    if wf != owners: errs.append(f"service-health.yml probes {wf}, paging owner is {owners}")
    for h, envs in hosts.items():
        if len(envs) > 1: errs.append(f"host {h} listed by several environments: {envs}")
    ref = next(iter(names.values()))
    for e, n in names.items():
        if sorted(n) != sorted(ref): errs.append(f"{e}: service set differs")
    r = subprocess.run(["sh", os.path.join(obs, "prometheus-entrypoint.sh")], capture_output=True, text=True,
                       env={"PATH": os.environ["PATH"], "WASLA_OBS_CONFIG_DIR": obs, "WASLA_OBS_RENDER_ONLY": "1"})
    if r.returncode == 0: errs.append("entrypoint starts without WASLA_OBS_ENVIRONMENT")
    return errs

errs = check(".")
for e in errs: print("  ✗", e)
if errs: sys.exit(1)
print("  ✓ targets per environment: template and collector host-free; every environment renders through the real entrypoint; no shared host; ≤1 paging owner; fail closed without environment")

def mutate(desc, fn):
    d = tempfile.mkdtemp()
    try:
        for p in ("infra/observability", "services/observability/src"): shutil.copytree(p, os.path.join(d, p))
        for p in ("scripts/ops/health/check-health.py", ".github/workflows/service-health.yml"):
            os.makedirs(os.path.dirname(os.path.join(d, p)), exist_ok=True); shutil.copy(p, os.path.join(d, p))
        fn(d)
        if not check(d): print(f"  ✗ self-test: mutation not caught — {desc}"); return False
        return True
    finally: shutil.rmtree(d)

def edit(path, a, b):
    def f(d):
        p = os.path.join(d, path); s = open(p).read(); assert a in s, (path, a); open(p, "w").write(s.replace(a, b, 1))
    return f

# CLM-0504: self-test anchors must be state-independent. The paging owner
# legitimately moves (blue/green flip: singapore none->AM host, oregon-legacy
# AM host->none, service-health.yml env follows), so mutations anchored on the
# CURRENT content derive their anchor from the live files instead of literals.
SG = "infra/observability/targets/render-singapore.targets"
WF = ".github/workflows/service-health.yml"
sg_text = open(SG).read()
sg_host = re.search(r"^service wasla-audit (\S+)$", sg_text, re.M).group(1)
wf_text = open(WF).read()
wf_env = re.search(r"WASLA_OBS_ENVIRONMENT: ([a-z0-9-]+)", wf_text).group(1)
other = "render-singapore" if wf_env != "render-singapore" else "render-oregon-legacy"
# the "second paging owner" mutation gives an AM host to a currently-AM-less
# environment (whichever file declares `alertmanager none`), so it always
# produces two owners and stays catchable in any paging-owner state.
none_files = [os.path.join("infra/observability/targets", f) for f in os.listdir("infra/observability/targets")
              if f.endswith(".targets") and re.search(r"^alertmanager none$", open(os.path.join("infra/observability/targets", f)).read(), re.M)]
second_owner = (edit(none_files[0], "alertmanager none", "alertmanager wasla-alertmanager-x.onrender.com")
                if none_files else None)
cases = [
    ("second paging owner", second_owner),
    ("hostname in template", edit("infra/observability/prometheus.yml", "__SERVICE_TARGETS__", '          - "wasla-orders.onrender.com"')),
    ("hostname in collector", edit("services/observability/src/config.ts", "const ENV_NAME", "const X = 'https://wasla-orders.onrender.com';\nconst ENV_NAME")),
    ("new env scrapes a legacy host", edit(SG, sg_host, "https://wasla-orders.onrender.com")),
    ("service set differs", edit(SG, "service wasla-audit ", "service wasla-audit2 ")),
    ("targets not shipped", edit("infra/observability/Dockerfile.prometheus", "COPY targets/ /etc/prometheus/targets/", "")),
    ("default environment", edit("infra/observability/prometheus-entrypoint.sh", ': "${WASLA_OBS_ENVIRONMENT:?', f'WASLA_OBS_ENVIRONMENT="${{WASLA_OBS_ENVIRONMENT:-{other}}}"; : "${{WASLA_OBS_ENVIRONMENT:?')),
    ("hostname in health probe", edit("scripts/ops/health/check-health.py", "ENVIRONMENT = ", "X = 'https://wasla-orders.onrender.com'\nENVIRONMENT = ")),
    ("health workflow watches a non-owner", edit(WF, f"WASLA_OBS_ENVIRONMENT: {wf_env}", f"WASLA_OBS_ENVIRONMENT: {other}")),
    ("declared environment mismatch", edit(SG, "environment render-singapore", "environment render-oregon-legacy")),
]
live_cases = [c for c in cases if c[1] is not None]
if second_owner is None: print("  ⊘ second-paging-owner mutation N/A: every environment owns paging")
ok = all([mutate(d, f) for d, f in live_cases])
if not ok: sys.exit(1)
print(f"  ✓ self-test: {len(live_cases)}/{len(cases)} mutations caught")
PY
