#!/usr/bin/env bash
# validate-render-deploy-plan.sh — selective Render deploy decides from the LIVE
# commit of each service, not from the last push (CLM-0626), under a declared
# runtime-input-equivalence policy (CLM-0628) whose runtime-read guard binds
# every file-system call to its evaluated target (CLM-0630) · RISK-0068 · M6-18B.
#
# Policy: the shared image is `COPY . .`, so image bytes are NOT compared. A
# service is `runtime-equivalent` only when everything its process can load or
# read is identical between its live commit and the target: its workspace
# closure, root install files, every workspace manifest, the container scripts
# and the runtime reads declared in scripts/deploy/runtime-reads.json — audited
# against the code. A read whose target the auditor cannot decide never yields
# `runtime-equivalent`: either the audit fails (every Node service deploys) or
# it is declared `unresolved` and the services containing it deploy.
#
# Proves, on a throw-away git repository with a real pnpm-workspace layout,
# printing every case with its actual decision:
#   1. a docs-only target still deploys a service whose earlier code change never
#      went live (#772 behind #773), and only that service;
#   2. outside a service's closure but inside the Docker context → stays
#      `runtime-equivalent` (reason states image bytes are not compared);
#      another manifest or a declared runtime read → deploy;
#   3. CLM-0630 hardening (each independent, from a clean registered base; the
#      live commit already runs the variant, the target only changes a file the
#      variant reads): absolute `/app/...` path, composed path, a constant
#      re-pointed with a stale-but-existing registration, a removed guard, an
#      overridden default, aliasing, dynamic fs import, re-export,
#      getBuiltinModule, start-script path, delegated value turned dynamic;
#   4. every ambiguity deploys (no live deploy, unknown history, inputs not
#      derivable, no registry, --all);
#   5. on the real repository: the registry audit passes, no package imports an
#      @wasla/* package it does not declare, render-sync.py deploys only `deploy`
#      decisions and records why, render-deploy.yml fetches full history.
# Then mutates render_plan.py / runtime_reads.py / the wiring; every mutation
# must be caught and the catching case is printed.
#
# Mandatory in scripts/verify.sh. References: docs/12-testing/ci-evidence/
# 2026-10-19T120000Z-clm-0626-render-selective-deploy/README.md,
# 2026-10-19T140000Z-clm-0628-deploy-runtime-closure/README.md,
# 2026-10-19T160000Z-clm-0630-runtime-reads-hardening/README.md
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import importlib.util, json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.getcwd()
PLAN = os.path.join(ROOT, "scripts/deploy/render_plan.py")
RR = os.path.join(ROOT, "scripts/deploy/runtime_reads.py")
REG = os.path.join(ROOT, "scripts/deploy/runtime-reads.json")
SYNC = os.path.join(ROOT, "scripts/deploy/render-sync.py")
WF = os.path.join(ROOT, ".github/workflows/render-deploy.yml")
VERBOSE = True
_n = [0]


def load(plan_path, rr_path):
    """Fresh (render_plan, runtime_reads) pair; render_plan imports runtime_reads by name."""
    _n[0] += 1
    spec = importlib.util.spec_from_file_location(f"rr_{_n[0]}", rr_path)
    rr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rr)
    sys.modules["runtime_reads"] = rr
    spec = importlib.util.spec_from_file_location(f"rp_{_n[0]}", plan_path)
    rp = importlib.util.module_from_spec(spec); spec.loader.exec_module(rp)
    return rp, rr


def sh(repo, *a):
    subprocess.run(["git", "-C", repo, *a], check=True, capture_output=True)


def write(repo, path, text):
    p = os.path.join(repo, path); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").write(text)


def commit(repo, msg):
    sh(repo, "add", "-A"); sh(repo, "commit", "-qm", msg)
    return subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


# services/o2 mirrors services/observability/src/config.ts (guarded prefix read
# outside the package) plus an in-package schema read via a const URL.
OBS_SRC = """import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export const TARGETS_DIR = fileURLToPath(new URL('../../../infra/targets/', import.meta.url));
const ENV_NAME = /^[a-z0-9-]+$/;
export function load(env: NodeJS.ProcessEnv = process.env, dir: string = TARGETS_DIR): string {
  const name = env.OBS_ENV;
  if (!name) throw new Error('unset');
  if (!ENV_NAME.test(name)) throw new Error('bad name');
  return readFileSync(`${dir}/${name}.targets`, 'utf8');
}
const SCHEMA = new URL('../contracts/s.sql', import.meta.url);
export const schema = () => readFileSync(SCHEMA, 'utf8');
export const targets = () => load();
"""
# packages/edge mirrors packages/channel-edge (path delegated to the caller option).
EDGE_SRC = """import { readFileSync } from "node:fs";
export interface EdgeOptions { readonly allowlistUrl: string }
function loadAllow(allowlistUrl: string): string { return readFileSync(allowlistUrl, "utf-8"); }
export const edge = (options: EdgeOptions) => loadAllow(options.allowlistUrl);
"""
A_EDGE = 'import { edge } from "@t/edge";\nexport const e = () => edge({ allowlistUrl: "/app/infra/allow.json" });\n'
# Hard-coded expectations — the fingerprint is not produced by the code under test.
BASE_REG = {"files": {
    "services/o2/src/config.ts": {"calls": ["readFileSync(`${dir}/${name}.targets`, 'utf8') → prefix:infra/targets/",
                                            "readFileSync(SCHEMA, 'utf8') → repo:services/o2/contracts/s.sql"],
                                  "reads": ["infra/targets/"], "why": "fixture: guarded prefix outside the package"},
    "packages/edge/src/edge.ts": {"calls": ['readFileSync(allowlistUrl, "utf-8") → unresolved (parameter `allowlistUrl` of loadAllow)'],
                                  "reads": [], "delegated": ["allowlistUrl"], "why": "fixture: path from options.allowlistUrl"},
    "services/a/src/edge.ts": {"calls": [], "reads": ["infra/allow.json"], "why": "fixture: delegated allowlistUrl value"},
}}


def fixture():
    r = tempfile.mkdtemp()
    sh(r, "init", "-q"); sh(r, "config", "user.email", "t@t"); sh(r, "config", "user.name", "t")
    write(r, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "services/*"\n  - "apps/*"\n')
    for f in ("package.json", "pnpm-lock.yaml", "tsconfig.json", "Dockerfile", ".dockerignore"):
        write(r, f, "v1\n")
    write(r, "scripts/container/entrypoint.sh", '#!/bin/sh\ncd "$DIR" || exit 66\nexec sh -c "$START"\n')
    pk = lambda n, deps=None, start=None: json.dumps({"name": n, "dependencies": deps or {}, **({"scripts": {"start": start}} if start else {})})
    write(r, "packages/y/package.json", pk("@t/y")); write(r, "packages/y/src/y.ts", "export const y = 1;\n")
    write(r, "packages/x/package.json", pk("@t/x", {"@t/y": "workspace:*"})); write(r, "packages/x/src/x.ts", "export const x = 1;\n")
    write(r, "packages/edge/package.json", pk("@t/edge")); write(r, "packages/edge/src/edge.ts", EDGE_SRC)
    write(r, "services/a/package.json", pk("@t/a", {"@t/x": "workspace:*", "@t/edge": "workspace:*"}, "tsx src/main.ts"))
    write(r, "services/a/src/a.ts", "export const a = 1;\n"); write(r, "services/a/src/edge.ts", A_EDGE)
    write(r, "services/b/package.json", pk("@t/b")); write(r, "services/b/src/b.ts", "export const b = 1;\n")
    write(r, "services/b/config.json", "1\n")
    write(r, "services/o2/package.json", pk("@t/o2")); write(r, "services/o2/src/config.ts", OBS_SRC)
    write(r, "services/o2/contracts/s.sql", "1\n")
    write(r, "apps/web/package.json", pk("@t/web")); write(r, "apps/web/src/w.ts", "export const w = 1;\n")
    write(r, "infra/obs/Dockerfile.p", "1\n"); write(r, "infra/obs/config.yml", "1\n")
    write(r, "infra/targets/prod.targets", "1\n"); write(r, "infra/other/prod.targets", "1\n")
    write(r, "infra/allow.json", "1\n"); write(r, "docs/readme.md", "1\n")
    write(r, "scripts/deploy/runtime-reads.json", json.dumps(BASE_REG))
    c = {"c1": commit(r, "base")}
    write(r, "packages/y/src/y.ts", "export const y = 2;\n"); c["c2"] = commit(r, "transitive code change (the #772)")
    write(r, "docs/readme.md", "2\n"); c["c3"] = commit(r, "docs only (the #773)")
    write(r, "pnpm-lock.yaml", "v2\n"); c["c4"] = commit(r, "lockfile")
    write(r, "infra/obs/config.yml", "2\n"); c["c5"] = commit(r, "observability context")
    write(r, "services/b/src/b.ts", "export const b = 2;\n"); c["c6"] = commit(r, "outside A's closure, inside the Docker context")
    write(r, "infra/targets/prod.targets", "2\n"); c["c7"] = commit(r, "declared guarded-prefix read outside o2's closure")
    write(r, "infra/allow.json", "2\n"); c["c7d"] = commit(r, "delegated read target of A")
    write(r, "services/b/package.json", json.dumps({"name": "@t/b", "version": "2.0.0"})); c["c8"] = commit(r, "another package's manifest")
    return r, c


O2 = "services/o2/src/config.ts"
# (description, {path: new content}, registration mode, extra registry edits, file the target changes,
#  expected decisions, reason fragments, expected audit error fragment on the target tree — None = audit clean)
#   registration: "stale"   → keep the base registration (proves a stale-but-existing registration cannot pass)
#                 "updated" → re-measure the fingerprint with the code under test, keep reads (proves the
#                             coverage/resolution rules themselves, not just fingerprint drift)
ND = "not derivable"
HARD = [
    ("H1 absolute /app path, stale registration",
     {O2: OBS_SRC.replace("readFileSync(SCHEMA, 'utf8')", "readFileSync('/app/services/b/config.json', 'utf8')")},
     "stale", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND, "A": ND}, 'fs calls changed'),
    ("H1b absolute /app path, fingerprint re-measured, reads not extended",
     {O2: OBS_SRC.replace("readFileSync(SCHEMA, 'utf8')", "readFileSync('/app/services/b/config.json', 'utf8')")},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND, "A": ND}, 'not covered by registered reads'),
    ("H1c absolute /app path, honestly registered (reads += services/b/config.json)",
     {O2: OBS_SRC.replace("readFileSync(SCHEMA, 'utf8')", "readFileSync('/app/services/b/config.json', 'utf8')")},
     "updated", {"reads": ["infra/targets/", "services/b/config.json"]}, "services/b/config.json",
     {"O2": "deploy", "A": "runtime-equivalent"}, {"O2": "input file(s) changed"}, None),
    ("H2 composed \"services/\" + serviceName + \"/config.json\", not declared",
     {O2: OBS_SRC.replace("export const schema = () => readFileSync(SCHEMA, 'utf8');",
                          "export const schema = (serviceName: string) => readFileSync(\"services/\" + serviceName + \"/config.json\", 'utf8');")},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND, "A": ND}, 'cannot be resolved'),
    ("H2b composed path declared `unresolved` → conservative deploy of its services only",
     {O2: OBS_SRC.replace("export const schema = () => readFileSync(SCHEMA, 'utf8');",
                          "export const schema = (serviceName: string) => readFileSync(\"services/\" + serviceName + \"/config.json\", 'utf8');")},
     "updated", {"unresolved": [{"call": "readFileSync", "why": "fixture"}]}, "services/b/config.json",
     {"O2": "deploy", "A": "runtime-equivalent"}, {"O2": "unresolved runtime read"}, None),
    ("H3 const re-pointed to an absolute path (argument text unchanged), stale registration",
     {O2: OBS_SRC.replace("new URL('../contracts/s.sql', import.meta.url)", "'/app/services/b/config.json'")},
     "stale", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'fs calls changed'),
    ("H3b const re-pointed via join(process.cwd(), '..', 'b', ...), fingerprint re-measured",
     {O2: OBS_SRC.replace('import { fileURLToPath } from "node:url";', 'import { fileURLToPath } from "node:url";\nimport { join } from "node:path";')
                 .replace("new URL('../contracts/s.sql', import.meta.url)", "join(process.cwd(), '..', 'b', 'config.json')")},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'not covered by registered reads'),
    ("H3c read target moved to infra/other/ while registered infra/targets/ still exists",
     {O2: OBS_SRC.replace("'../../../infra/targets/'", "'../../../infra/other/'")},
     "updated", None, "infra/other/prod.targets", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'not covered by registered reads'),
    ("H3d target moved and covered, but the old read left registered (stale registration)",
     {O2: OBS_SRC.replace("'../../../infra/targets/'", "'../../../infra/other/'")},
     "updated", {"reads": ["infra/targets/", "infra/other/"]}, "infra/other/prod.targets", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'stale registration'),
    ("H4 guard on the dynamic file name removed",
     {O2: OBS_SRC.replace("  if (!ENV_NAME.test(name)) throw new Error('bad name');\n", "")},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'without a verified guard'),
    ("H5 guarded dir default overridden by a runtime caller",
     {O2: OBS_SRC + "export const other = () => load(process.env, '/app/services/b');\n"},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'default overridable'),
    ("H6 fs function aliased (const r = readFileSync)",
     {O2: OBS_SRC + "const r = readFileSync;\nexport const hidden = () => r('/app/services/b/config.json');\n"},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'aliasing'),
    ("H7 fs reached through a literal dynamic import",
     {O2: OBS_SRC + "export const hidden = async () => (await import('node:fs')).readFileSync('/app/services/b/config.json');\n"},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'outside a static import'),
    ("H8 fs re-exported by another module",
     {"services/b/src/fsx.ts": 'export { readFileSync } from "node:fs";\n'},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'outside a static import'),
    ("H9 process.getBuiltinModule('fs')",
     {O2: OBS_SRC + "export const hidden = () => process.getBuiltinModule('node:fs');\n"},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'getBuiltinModule'),
    ("H10 delegated allowlistUrl value turned into an environment value",
     {"services/a/src/edge.ts": A_EDGE.replace('"/app/infra/allow.json"', "process.env.ALLOW ?? ''")},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'value of delegated'),
    ("H11 start script names a path outside its package",
     {"services/b/package.json": json.dumps({"name": "@t/b", "version": "2.0.0", "scripts": {"start": "tsx ../../infra/run.ts"}})},
     "updated", None, "docs/readme.md", {"O2": "deploy"}, {"O2": ND}, 'start script'),
    ("H12 new fs-using file left unregistered",
     {"services/b/src/peek.ts": 'import { readFileSync } from "node:fs";\nexport const peek = () => readFileSync("/app/infra/allow.json", "utf8");\n'},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, 'not registered'),
    ("H13 out-of-package path literal handed to a non-fs consumer (no fs call changed)",
     {O2: OBS_SRC + "export const EXTRA = new URL('../../../services/b/config.json', import.meta.url);\n"},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, "out-of-package path 'services/b/config.json' not covered"),
    ("H14 target outside the package reached by a dirname() chain (no `..` or /app literal)",
     {O2: OBS_SRC.replace('import { fileURLToPath } from "node:url";', 'import { fileURLToPath } from "node:url";\nimport { dirname, join } from "node:path";')
                 .replace("new URL('../contracts/s.sql', import.meta.url)", "join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'b', 'config.json')")},
     "updated", None, "services/b/config.json", {"O2": "deploy", "A": "deploy"}, {"O2": ND}, "repo:services/b/config.json outside services/o2 and not covered"),
]


def variant(rp, rr, repo, c, files, mode, reg_edit, touch):
    """live = clean base + variant; target = live + change of `touch`. Returns (live, target)."""
    sh(repo, "checkout", "-q", "--detach", c["c8"])
    for p, t in files.items():
        write(repo, p, t)
    reg = json.loads(json.dumps(BASE_REG))
    if mode == "updated":
        _, facts = rr.analyse(repo)
        for rel, f in facts.items():
            if rel in reg["files"]:
                reg["files"][rel]["calls"] = rr.fingerprint(f["calls"])
    if reg_edit:
        reg["files"][O2].update(reg_edit)
    write(repo, "scripts/deploy/runtime-reads.json", json.dumps(reg))
    live = commit(repo, "variant")
    write(repo, touch, open(os.path.join(repo, touch)).read() + "x\n")
    target = commit(repo, f"change {touch}")
    return live, target


def img(ctx=".", df="Dockerfile"):
    return {"type": "web_service", "serviceDetails": {"envSpecificDetails": {"dockerfilePath": df, "dockerContext": ctx}}}


SVC = {
    "A": (img(), "@t/a"),
    "B": (img("./", "./Dockerfile"), "@t/b"),
    "O2": (img(), "@t/o2"),
    "W": ({"type": "static_site", "serviceDetails": {"buildCommand": "pnpm install && pnpm --filter @t/web build"}}, None),
    "O": (img("infra/obs", "infra/obs/Dockerfile.p"), None),
}
ALL = tuple(SVC)


def plan(rp, repo, live, target, names=ALL, ws_override=None, svc_override=None, force=False, registry="audit"):
    pkgs = rp.workspace_packages(repo, target)
    if registry == "audit":
        registry, _ = rp.registry_for_target(repo, target, None)
    out = {}
    for n in names:
        svc, ws = (svc_override or {}).get(n, SVC[n])
        if ws_override and n in ws_override: ws = ws_override[n]
        inputs, why = rp.inputs_for(repo, target, svc, ws, pkgs, registry)
        out[n] = rp.decide(repo, live, target, inputs, force=force, why=why)
    return out


RE = "runtime-equivalent"


class _Stop(Exception):
    pass


def cases(rp, rr, repo, c, log=None, fail_fast=False):
    """Runs every case; returns [(description, error)] for failures. `log` collects every outcome.
    fail_fast (mutation runs): stop at the first failing case — that case is the one reported."""
    fails = []
    try:
        _cases(rp, rr, repo, c, log, fail_fast, fails)
    except _Stop:
        pass
    return fails


def _cases(rp, rr, repo, c, log, fail_fast, fails):
    def check(desc, got, want, reason_has):
        bad = []
        for n, w in want.items():
            if got[n]["decision"] != w:
                bad.append(f"{n} = {got[n]['decision']} ({got[n]['reason'][:140]}), want {w}")
            elif reason_has and n in reason_has and reason_has[n] not in got[n]["reason"]:
                bad.append(f"{n} reason {got[n]['reason'][:140]!r} lacks {reason_has[n]!r}")
        if log is not None:
            shown = " · ".join(f"{n}={got[n]['decision']} ({got[n]['reason'][:90]})" for n in want)
            log.append(("✓" if not bad else "✗", desc, shown))
        if bad:
            fails.append((desc, "; ".join(bad)))
            if fail_fast: raise _Stop
    def run(desc, *a, want, reason_has=None, **k):
        try:
            check(desc, plan(rp, repo, *a, **k), want, reason_has)
        except Exception as e:  # a crash is a failed case, not a pass
            fails.append((desc, f"raised {type(e).__name__}: {e}"))
            if log is not None: log.append(("✗", desc, f"raised {type(e).__name__}: {e}"))
            if fail_fast: raise _Stop
    run("C1 docs-only target behind an undeployed code change", c["c1"], c["c3"],
        want={"A": "deploy", "B": RE, "O2": RE, "W": RE, "O": RE})
    run("C2 live already carries the code change", c["c2"], c["c3"], want={"A": RE})
    run("C3 live is the target", c["c3"], c["c3"], want={"A": "current", "O": "current"})
    run("C4 lockfile change", c["c3"], c["c4"], want={"A": "deploy", "B": "deploy", "W": "deploy", "O": RE})
    run("C5 Docker context change", c["c4"], c["c5"], want={"A": RE, "W": RE, "O": "deploy"})
    run("C6 REGRESSION outside A's closure, inside the Docker build context", c["c5"], c["c6"],
        want={"A": RE, "B": "deploy", "O2": RE, "W": RE, "O": RE}, reason_has={"A": "image bytes not compared"})
    run("C7 declared guarded-prefix read outside the closure (infra/targets/)", c["c6"], c["c7"], want={"O2": "deploy", "A": RE, "B": RE})
    run("C7d delegated read target (infra/allow.json via allowlistUrl)", c["c7"], c["c7d"], want={"A": "deploy", "O2": RE, "B": RE})
    run("C8 another package's manifest", c["c7d"], c["c8"], want={"A": "deploy", "O2": "deploy", "W": "deploy", "O": RE})
    for desc, files, mode, reg_edit, touch, want, reason, audit_has in HARD:
        try:
            live, target = variant(rp, rr, repo, c, files, mode, reg_edit, touch)
            aud = rr.audit(repo, rr.load_registry(open(os.path.join(repo, "scripts/deploy/runtime-reads.json")).read()))
        except Exception as e:
            fails.append((desc, f"variant setup raised {type(e).__name__}: {e}"))
            if log is not None: log.append(("✗", desc, f"setup raised {e}"))
            if fail_fast: raise _Stop
            continue
        run(desc, live, target, want=want, reason_has=reason)
        hit = [x for x in aud if audit_has and audit_has in x]
        ok = (not aud) if audit_has is None else bool(hit)
        if not ok:
            fails.append((desc, f"audit on target: want {'clean' if audit_has is None else repr(audit_has)}, got {aud[:2]}"))
            if fail_fast: raise _Stop
        if log is not None:
            log.append(("✓" if ok else "✗", f"{desc} — audit", "clean" if not aud else (hit or aud)[0][:200]))
    sh(repo, "checkout", "-q", "--detach", c["c8"])
    run("A1 no registry at all", c["c2"], c["c3"], registry=None, want={"A": "deploy", "W": "deploy", "O": RE}, reason_has={"A": ND})
    run("A2 live commit not in history", "d" * 40, c["c3"], want={"A": "deploy", "O": "deploy"}, reason_has={"A": "not in history"})
    run("A3 no live deploy", "", c["c3"], want={"A": "deploy"}, reason_has={"A": "no live deploy"})
    run("A4 WASLA_SERVICE unknown", c["c2"], c["c3"], ws_override={"A": None}, want={"A": "deploy"}, reason_has={"A": ND})
    two = {"W": ({"type": "static_site", "serviceDetails": {"buildCommand": "pnpm --filter @t/web --filter @t/b build"}}, None)}
    run("A5 static build command ambiguous", c["c2"], c["c3"], svc_override=two, want={"W": "deploy"}, reason_has={"W": ND})
    run("A6 --all", c["c2"], c["c3"], force=True, want={n: "deploy" for n in ALL})
    return fails


def repo_checks(sync_src, wf_src):
    errs = []
    if "import render_plan" not in sync_src: errs.append("render-sync.py does not use render_plan")
    if 'plan[s["id"]]["decision"] == "deploy"' not in sync_src: errs.append("render-sync.py does not deploy only `deploy` decisions")
    if "for s in to_deploy:" not in sync_src: errs.append("render-sync.py triggers deploys outside the plan")
    if "registry_for_target(" not in sync_src: errs.append("render-sync.py does not audit the runtime-read registry against the target")
    if "why=how" not in sync_src: errs.append("render-sync.py does not record why inputs were not derivable")
    if sync_src.count('"policy": "runtime-input equivalence') < 2 or "image bytes not compared" not in sync_src:
        errs.append("render-sync.json (plan and result) must state that image bytes are not compared")
    if "/env-vars/WASLA_SERVICE" not in sync_src or re.search(r"/env-vars\?", sync_src):
        errs.append("render-sync.py must read WASLA_SERVICE by key, never the env-var list")
    if not re.search(r"fetch-depth:\s*0\b", wf_src): errs.append("render-deploy.yml must fetch full history (fetch-depth: 0)")
    # CLM-0632 (owner decision 2026-10-19): Render is a test environment — no push trigger;
    # the plan runs on every deliberate dispatch instead (supersedes the CLM-0626 every-push rule).
    m = re.search(r"^on:[ \t]*\n((?:[ \t][^\n]*\n|\n)*)", wf_src, re.M)
    if m and set(re.findall(r"^  ([a-z_]+):", m.group(1), re.M)) & {"push", "schedule", "pull_request", "workflow_run"}:
        errs.append("render-deploy.yml must not deploy on push/schedule/PR/workflow_run (Render is test-only — CLM-0632)")
    return errs


def undeclared_imports():
    pk = {}
    for base in ("packages", "services", "apps", "bots", "packages/contracts"):
        if not os.path.isdir(base): continue
        for d in sorted(os.listdir(base)):
            f = os.path.join(base, d, "package.json")
            if os.path.isfile(f):
                m = json.load(open(f))
                if m.get("name"): pk[m["name"]] = (os.path.join(base, d), m)
    bad = []
    rx = re.compile(r"""(?:from|import\()\s*["'](@wasla/[a-z0-9-]+)""")
    for name, (d, m) in pk.items():
        declared = set()
        for k in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            declared |= set((m.get(k) or {}).keys())
        for dirpath, dirs, files in os.walk(os.path.join(d, "src")):
            dirs[:] = [x for x in dirs if x != "node_modules"]
            for fn in files:
                if not fn.endswith((".ts", ".tsx", ".js", ".mjs")): continue
                for imp in rx.findall(open(os.path.join(dirpath, fn), encoding="utf-8").read()):
                    if imp in pk and imp != name and imp not in declared:
                        bad.append(f"{name} imports {imp} without declaring it ({os.path.join(dirpath, fn)})")
    return sorted(set(bad))


repo, c = fixture()
try:
    rp, rr = load(PLAN, RR)
    log = []
    fails = cases(rp, rr, repo, c, log)
    for mark, desc, shown in log:
        print(f"  {mark} {desc}\n      → {shown}")
    errs = [f"{d}: {e}" for d, e in fails]
    errs += [f"runtime-reads: {e}" for e in rr.audit(ROOT, rr.load_registry(open(REG).read()))]
    errs += repo_checks(open(SYNC).read(), open(WF).read())
    errs += undeclared_imports()
    if errs:
        for e in errs: print(f"  ✗ {e}")
        sys.exit(1)
    nreg = len(json.load(open(REG))["files"])
    print(f"  ✓ plan: {len(log)} cases · runtime-input equivalence (image bytes not compared) · every fs call bound to its evaluated target · unresolved never runtime-equivalent · registry audit {nreg} files clean · closure premise holds")

    PLAN_MUT = [
        ("diff from the last push instead of the live commit", '"diff", "--name-only", live, target', '"diff", "--name-only", target + "~1", target'),
        ("history check removed", 'if git(repo, "cat-file", "-e", f"{live}^{{commit}}").returncode != 0:', "if False:"),
        ("unknown inputs treated as equivalent", 'return {"decision": "deploy", "reason": "build inputs not derivable"', 'return {"decision": "runtime-equivalent", "reason": "build inputs not derivable"'),
        ("closure not transitive", "                    todo.append(dep)", "                    seen.add(dep)"),
        ("lockfile not an input", '"pnpm-lock.yaml", ', ""),
        ("Docker context not an input", 'return sorted({ctx + "/", dockerfile})', "return [dockerfile]"),
        ("always deploy (no saving)", "    if changed:\n", "    if True:\n"),
        ("workspace manifests not inputs", "list(ROOT_COMMON) + manifests + ", "list(ROOT_COMMON) + "),
        ("declared runtime reads not inputs", " + runtime_reads.extra_inputs(registry, cl)", ""),
        ("registry not audited on the target", "errs = runtime_reads.audit(tmp, reg)", "errs = []"),
        ("CLM-0630 declared unresolved read not conservative", "        if unresolved:   #", "        if False:   #"),
    ]
    RR_MUT = [
        ("unregistered fs use ignored", "        if entry is None:\n            errs.append(", "        if entry is None:\n            continue\n            errs.append("),
        ("fingerprint compared by call name only (argument/target ignored)", 'if entry.get("calls") != fp:',
         'if [x.split("(")[0] for x in entry.get("calls") or []] != [x.split("(")[0] for x in fp]:'),
        ("out-of-package path literal coverage not checked", "            if not hit:\n", "            if False:\n"),
        ("../ literals not seen", 'if "../" in s or s == "..":', "if False:"),
        ("CLM-0630 /app literals not seen", "        if s.startswith(APP + \"/\"):\n", "        if False:\n"),
        ("CLM-0630 resolved target coverage not checked", "            if not any(_covers(r, p) for r in reads):\n", "            if False:\n"),
        ("CLM-0630 unresolved read silently treated as a write", '                    target = f"unresolved ({e})"', '                    target = "write"'),
        ("CLM-0630 undeclared unresolved read accepted", '                if c["call"] not in declared_unres:', "                if False:"),
        ("CLM-0630 dynamic-segment guard not verified", '    for m in re.finditer(rf"if\\s*\\(\\s*!\\s*', '    return True\n    for m in re.finditer(rf"if\\s*\\(\\s*!\\s*'),
        ("CLM-0630 overriding callers of a defaulted parameter ignored", "            why = _callers_pass(src.project, fname, idx, src)", "            why = None"),
        ("CLM-0630 delegated values not evaluated", "_delegate_values(project, rel, pm.group(1))", "[]"),
        ("CLM-0630 fs aliasing ignored", "                if not mm:\n                    errs.append(f\"{src.rel}: fs binding", "                if not mm:\n                    continue\n                    errs.append(f\"{src.rel}: fs binding"),
        ("CLM-0630 fs module outside a static import ignored", "            if not src.in_import(m.start()):\n                errs.append(f\"{src.rel}: fs module", "            if False:\n                errs.append(f\"{src.rel}: fs module"),
        ("CLM-0630 getBuiltinModule ignored", 'if re.search(r"\\bprocess\\s*\\.\\s*(?:getBuiltinModule|binding)\\b", src.code):', "if False:"),
        ("CLM-0630 stale registered read accepted", "            elif not any(_covers(r, p) or _covers(p, r) for p in uses.get(rel, [])):", "            elif False:"),
        ("CLM-0630 start-script paths not checked", '            errs.append(f"{pkg}/package.json: start script', '            pass  # errs.append(f"{pkg}/package.json: start script'),
        ("CLM-0630 re-export check and module-name check both removed", "            if not src.in_import(m.start()):\n                errs.append(f\"{src.rel}: fs module", "            if False:\n                errs.append(f\"{src.rel}: fs module"),
    ]
    caught, total = 0, 0
    print("  self-test (each mutation → first catching case):")
    for target_path, muts in ((PLAN, PLAN_MUT), (RR, RR_MUT)):
        src = open(target_path).read()
        for desc, a, b in muts:
            total += 1
            assert a in src, f"self-test anchor missing: {desc}"
            d = tempfile.mkdtemp()
            try:
                pp, rp_ = os.path.join(d, "render_plan.py"), os.path.join(d, "runtime_reads.py")
                shutil.copy(PLAN, pp); shutil.copy(RR, rp_)
                mutated = src.replace(a, b, 1)
                if desc.startswith("CLM-0630 re-export check"):
                    mutated = mutated.replace('    if re.search(r"\\bexport\\s*(?:\\*|\\{[^}]*\\})\\s*from', '    if False and re.search(r"\\bexport\\s*(?:\\*|\\{[^}]*\\})\\s*from', 1)
                open(os.path.join(d, os.path.basename(target_path)), "w").write(mutated)
                mp, mr = load(pp, rp_)
                f = cases(mp, mr, repo, c, fail_fast=True)
                if f:
                    caught += 1
                    print(f"    ✓ {desc}\n        caught by: {f[0][0]} — {f[0][1][:150]}")
                else:
                    print(f"    ✗ {desc} — NOT caught")
            finally: shutil.rmtree(d)
    sync, wf = open(SYNC).read(), open(WF).read()
    WIRE_MUT = [
        ("render-sync deploys every service", sync.replace('plan[s["id"]]["decision"] == "deploy"', "True"), wf),
        ("render-sync reads the whole env list", sync.replace('f"/services/{sid}/env-vars/WASLA_SERVICE"', 'f"/services/{sid}/env-vars?limit=100"'), wf),
        ("render-sync skips the registry audit", sync.replace("registry_for_target(", "registry_unchecked("), wf),
        ("render-sync drops why inputs were not derivable", sync.replace("why=how", "why=''"), wf),
        ("render-sync.json no longer states image bytes are not compared", sync.replace("image bytes not compared", "equivalent"), wf),
        ("plan-only render-sync.json drops the policy", sync.replace('"policy": "runtime-input equivalence', '"note": "runtime-input equivalence', 1), wf),
        ("workflow shallow clone", sync, re.sub(r"fetch-depth:\s*0", "fetch-depth: 1", wf)),
        ("workflow deploys on every push again", sync, wf.replace("on:\n  workflow_dispatch:", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:", 1)),
    ]
    for desc, s2, w2 in WIRE_MUT:
        total += 1
        e = repo_checks(s2, w2)
        if e:
            caught += 1; print(f"    ✓ {desc}\n        caught by: wiring — {e[0]}")
        else:
            print(f"    ✗ {desc} — NOT caught")
    if caught != total: sys.exit(1)
    print(f"  ✓ self-test: {caught}/{total} mutations caught")
finally:
    shutil.rmtree(repo)
PY
