#!/usr/bin/env python3
"""render_plan.py — decide, per Render service, whether a deploy is needed (CLM-0626).

Why (RISK-0068 · 2026-10-19):
  `render-sync.py` used to deploy all 24 services on every non-doc push to main.
  897 deploys in 19 days drained the workspace's build pipeline minutes, and the
  first code merge after that (#772 · `c386a98e`) failed 24/24 `build_failed`.
  Most of those builds rebuilt services whose inputs had not changed.

The rule — live commit against target commit, never "the last push":
  For each service the planner diffs the service's *live* commit (as reported by
  Render) against the *target* commit, restricted to that service's build
  inputs. A docs-only push therefore cannot hide an earlier code change that
  never went live: if `wasla-customer-app` is live on `811341de` and main is now
  `c5ea8a34`, the diff `811341de..c5ea8a34 -- <customer-app inputs>` contains the
  #772 change even though #773 (the last push) touched docs only.

Decisions:
  current             live commit == target commit
  runtime-equivalent  live commit is in history and `git diff live target --
              <runtime inputs>` is empty: everything the service process can
              load or read is identical. This is NOT image-byte equivalence —
              the shared image is `COPY . .`, so its bytes change with any file
              in the build context (CLM-0628 decision; see runtime_reads.py)
  deploy      anything else, with a reason. Ambiguity always deploys: no live
              deploy, live commit not in history, inputs not derivable from the
              Render config, `--all`, or a non-empty input diff.

Where the inputs come from (one source of truth: Render's own config + the repo):
  static_site                build command `pnpm --filter <pkg> build` → <pkg>
  image, context "."         env var WASLA_SERVICE (read by key only) → <pkg>
  image, other context dir   that context dir + its Dockerfile
  <pkg> → its workspace dir plus the transitive closure of its workspace
  dependencies (all dependency kinds), read at the target commit, plus the
  root files every install reads, plus EVERY workspace package.json (pnpm
  install links from all manifests and scripts/container/resolve-package.mjs
  reads all of them to resolve WASLA_SERVICE), plus the declared runtime reads
  (scripts/deploy/runtime-reads.json) of every file inside the closure. Image
  builds add Dockerfile, .dockerignore and scripts/container/.

The runtime-read registry used must pass `runtime_reads.audit()` on the TARGET
tree (the target's own registry, else the checkout's); otherwise every
node-based service is `deploy` (fail closed). `--all` (workflow_dispatch input
`full`) forces a fleet deploy.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile

import runtime_reads

REGISTRY_PATH = "scripts/deploy/runtime-reads.json"

ROOT_COMMON = ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", ".npmrc")
IMAGE_COMMON = (".dockerignore", "scripts/container/")
DEP_FIELDS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")


def git(repo: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)


def _norm(p: str | None) -> str:
    p = (p or "").strip()
    while p.startswith("./"):
        p = p[2:]
    return p.rstrip("/")


def workspace_packages(repo: str, rev: str) -> dict[str, str]:
    """Package name → workspace dir, read at `rev` (not the working tree)."""
    ws = git(repo, "show", f"{rev}:pnpm-workspace.yaml")
    if ws.returncode != 0:
        raise RuntimeError(f"pnpm-workspace.yaml unreadable at {rev}")
    globs = re.findall(r'^\s*-\s*["\']?([^"\'\s]+)["\']?\s*$', ws.stdout, re.M)
    pats = [re.compile("^" + re.escape(g).replace(r"\*", "[^/]+") + "/package.json$") for g in globs]
    files = git(repo, "ls-tree", "-r", "--name-only", rev).stdout.splitlines()
    out: dict[str, str] = {}
    for f in files:
        if any(p.match(f) for p in pats):
            meta = json.loads(git(repo, "show", f"{rev}:{f}").stdout or "{}")
            if meta.get("name"):
                out[meta["name"]] = f[: -len("/package.json")]
    return out


def closure(repo: str, rev: str, pkg: str, pkgs: dict[str, str]) -> list[str]:
    """Workspace dirs of `pkg` and every workspace package it depends on, transitively."""
    seen: set[str] = set()
    todo = [pkg]
    while todo:
        name = todo.pop()
        if name in seen or name not in pkgs:
            continue
        seen.add(name)
        meta = json.loads(git(repo, "show", f"{rev}:{pkgs[name]}/package.json").stdout or "{}")
        for field in DEP_FIELDS:
            for dep in (meta.get(field) or {}):
                if dep in pkgs:  # any spec naming a workspace package: conservative
                    todo.append(dep)
    return sorted(pkgs[n] + "/" for n in seen)


def registry_for_target(repo: str, rev: str, fallback_text: str | None) -> tuple[dict | None, str]:
    """Runtime-read registry proven to describe the target tree, or (None, why)."""
    shown = git(repo, "show", f"{rev}:{REGISTRY_PATH}")
    text, origin = (shown.stdout, "target") if shown.returncode == 0 else (fallback_text, "checkout")
    try:
        reg = runtime_reads.load_registry(text)
    except (ValueError, json.JSONDecodeError) as e:
        return None, f"runtime-read registry unusable ({origin}): {e}"
    tmp = tempfile.mkdtemp()
    try:
        arch = subprocess.run(["git", "-C", repo, "archive", "--format=tar", rev], capture_output=True)
        if arch.returncode != 0:
            return None, "git archive of target failed"
        subprocess.run(["tar", "-x", "-C", tmp], input=arch.stdout, check=True)
        errs = runtime_reads.audit(tmp, reg)
    finally:
        shutil.rmtree(tmp)
    if errs:
        return None, f"runtime-read registry ({origin}) does not describe the target: {errs[0][:160]}"
    return reg, f"runtime-read registry from {origin}, audited on target"


def inputs_for(repo: str, rev: str, svc: dict, wasla_service: str | None, pkgs: dict[str, str],
               registry: dict | None = None) -> tuple[list[str] | None, str]:
    """(input paths, how they were derived) — (None, reason) when not derivable."""
    stype = svc.get("type")
    manifests = sorted(d + "/package.json" for d in pkgs.values())

    def node_inputs(pkg: str) -> tuple[list[str] | None, str]:
        if registry is None:
            return None, "no audited runtime-read registry"
        cl = closure(repo, rev, pkg, pkgs)
        unresolved = runtime_reads.unresolved_in(registry, cl)
        if unresolved:   # CLM-0630: a read the auditor cannot resolve never yields runtime-equivalent
            return None, f"unresolved runtime read declared in {', '.join(unresolved)} (conservative)"
        return cl + list(ROOT_COMMON) + manifests + runtime_reads.extra_inputs(registry, cl), ""

    det = svc.get("serviceDetails") or {}
    if stype == "static_site":
        m = re.findall(r"--filter\s+(\S+)", det.get("buildCommand") or "")
        if len(m) != 1 or m[0] not in pkgs:
            return None, "static site build command has no single known --filter package"
        ins, why = node_inputs(m[0])
        return (ins, f"static_site --filter {m[0]}") if ins is not None else (None, why)
    env = det.get("envSpecificDetails") or {}
    dockerfile, ctx = _norm(env.get("dockerfilePath")), _norm(env.get("dockerContext"))
    if not dockerfile:
        return None, f"service type {stype!r} without a Dockerfile path"
    if ctx in ("", "."):
        if not wasla_service or wasla_service not in pkgs:
            return None, f"image built from the repo root but WASLA_SERVICE={wasla_service!r} is not a workspace package"
        ins, why = node_inputs(wasla_service)
        if ins is None:
            return None, why
        return ins + [dockerfile, *IMAGE_COMMON], f"image WASLA_SERVICE={wasla_service}"
    return sorted({ctx + "/", dockerfile}), f"image context {ctx}"


def decide(repo: str, live: str | None, target: str, inputs: list[str] | None, force: bool = False,
           why: str = "") -> dict:
    if force:
        return {"decision": "deploy", "reason": "forced (--all)"}
    if live and (live == target or live.startswith(target) or target.startswith(live)):
        return {"decision": "current", "reason": "live commit is the target"}
    if not live:
        return {"decision": "deploy", "reason": "no live deploy"}
    if inputs is None:
        return {"decision": "deploy", "reason": "build inputs not derivable" + (f": {why}" if why else "")}
    if git(repo, "cat-file", "-e", f"{live}^{{commit}}").returncode != 0:
        return {"decision": "deploy", "reason": f"live commit {live[:8]} not in history"}
    d = git(repo, "diff", "--name-only", live, target, "--", *inputs)
    if d.returncode != 0:
        return {"decision": "deploy", "reason": f"git diff failed: {d.stderr.strip()[:120]}"}
    changed = [x for x in d.stdout.splitlines() if x]
    if changed:
        return {"decision": "deploy", "reason": f"{len(changed)} input file(s) changed since live {live[:8]}", "changed": changed[:20]}
    return {"decision": "runtime-equivalent",
            "reason": f"runtime inputs identical between live {live[:8]} and target (image bytes not compared: COPY . .)"}
