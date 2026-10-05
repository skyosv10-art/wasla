#!/usr/bin/env python3
"""state_sync.py: the STATE-SYNC guard (CLM-0467, M0-52, ADR-061).

Invariant: NO STATE-SYNC -> NO PUSH/MERGE.
A change that moves the project (code, tests, config, infrastructure, guards, docs) must carry,
in the same range (the same PR), the project-state updates that describe it. Those updates must be
comparable with the change: same claim, same work item, the changed units named, risk statuses
equal to the register, and evidence paths that exist.

Usage: state_sync.py OLD NEW [--map PATH]
  The branch is read from WASLA_STATE_SYNC_BRANCH, or else from `git rev-parse --abbrev-ref HEAD`.
Exit 0 prints "PASS - project state synchronized". Exit 1 prints
"BLOCKED - project state synchronization required" with the exact records to update.

Reference: docs/00-rules/STATE_SYNC_RULE.md. The map is scripts/checks/lib/state-sync-map.json.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MAP = os.path.join(HERE, "state-sync-map.json")
PASS_LINE = "PASS — project state synchronized"
BLOCK_LINE = "BLOCKED — project state synchronization required"


def git(*args: str, check: bool = True) -> str:
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def show(ref: str, path: str) -> str | None:
    r = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def added_lines(old: str, new: str, path: str) -> list[str]:
    out = git("-c", "color.ui=false", "diff", "--unified=0", f"{old}..{new}", "--", path, check=False)
    return [l[1:] for l in out.splitlines() if l.startswith("+") and not l.startswith("+++")]


def removed_lines(old: str, new: str, path: str) -> list[str]:
    out = git("-c", "color.ui=false", "diff", "--unified=0", f"{old}..{new}", "--", path, check=False)
    return [l[1:] for l in out.splitlines() if l.startswith("-") and not l.startswith("---")]


@dataclass
class Claim:
    cid: str
    item: str
    branch: str
    status: str
    notes: str
    raw: str


def parse_claims(text: str) -> list[Claim]:
    rows = []
    for line in text.splitlines():
        if not re.match(r"^\|\s*CLM-\d+\s*\|", line):
            continue
        cols = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cols) < 8:
            continue
        rows.append(Claim(cols[0], cols[1], cols[3], cols[7], " | ".join(cols[8:]).strip(), line))
    return rows


def risk_statuses(text: str) -> dict[str, str]:
    out = {}
    for m in re.finditer(r"^(RISK-\d{4})\s*\|.*?\|\s*status:([a-z-]+)\s*\|", text, re.M):
        out[m.group(1)] = m.group(2)
    return out


@dataclass
class Verdict:
    blocked: list[str] = field(default_factory=list)
    required: dict[str, list[str]] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def need(self, record: str, reason: str) -> None:
        self.required.setdefault(record, []).append(reason)

    def block(self, reason: str) -> None:
        self.blocked.append(reason)


def unit_of(path: str) -> str | None:
    parts = path.split("/")
    if parts[0] in ("services", "packages", "apps", "bots", "infra") and len(parts) > 2:
        if parts[0] == "packages" and parts[1] == "contracts" and len(parts) > 3:
            return "/".join(parts[:3])
        return "/".join(parts[:2])
    if parts[0] == "scripts" or parts[0] == ".github":
        return path
    if len(parts) == 1 and parts[0] not in ("ROADMAP.md",):
        return path
    return None


def unit_named(unit: str, files: list[str], text: str) -> bool:
    low = text.lower()
    cands = {unit.lower(), unit.split("/")[-1].lower()}
    for f in files:
        b = os.path.basename(f).lower()
        cands.add(b)
        cands.add(os.path.splitext(b)[0])
    cands = {c for c in cands if len(c) >= 3}
    return any(c in low for c in cands)


FIELD = r"^\s*(?:[-*]\s+)?\*\*{name}:?\*\*:?\s*(.*)$"


def field_values(lines: list[str], name: str) -> list[str]:
    rx = re.compile(FIELD.format(name=re.escape(name)), re.I)
    return [m.group(1).strip() for l in lines if (m := rx.match(l))]


PATH_RX = re.compile(
    r"`((?:services|packages|apps|bots|infra|scripts|docs|\.github)/[A-Za-z0-9_./@-]+)(?::[^`]*)?`"
)


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--map")]
    mp = DEFAULT_MAP
    for a in argv:
        if a.startswith("--map="):
            mp = a.split("=", 1)[1]
    old = args[0] if len(args) > 0 else "origin/main"
    new = args[1] if len(args) > 1 else "HEAD"
    cfg = json.load(open(mp, encoding="utf-8"))
    rec = cfg["state_records"]
    v = Verdict()

    for ref in (old, new):
        if subprocess.run(["git", "rev-parse", "--verify", f"{ref}^{{commit}}"], capture_output=True).returncode:
            print(BLOCK_LINE)
            print(f"  reason: cannot resolve '{ref}' (fail-closed). Run: git fetch origin main")
            return 1

    status_lines = git("-c", "color.ui=false", "diff", "--name-status", "-M", f"{old}..{new}").splitlines()
    changes: list[tuple[str, str, str | None]] = []
    for l in status_lines:
        p = l.split("\t")
        if not p or not p[0]:
            continue
        st = p[0][0]
        if st == "R" and len(p) >= 3:
            changes.append(("R", p[2], p[1]))
        else:
            changes.append((st, p[-1], None))
    files = [c[1] for c in changes]
    if not files:
        print(PASS_LINE)
        print("  no changes in range.")
        return 0

    # ── 1) classify every changed path; an unmapped path is never PASS ──
    cats: dict[str, list[str]] = {}
    unmapped = []
    for f in files:
        hit = False
        for c in cfg["categories"]:
            if any(re.search(rx, f) for rx in c["paths"]) and not any(re.search(rx, f) for rx in c["exclude"]):
                cats.setdefault(c["id"], []).append(f)
                hit = True
        if not hit:
            unmapped.append(f)
    if unmapped:
        v.block("REVIEW REQUIRED — unmapped path(s); the guard cannot tell which state they affect:\n"
                + "\n".join(f"      {f}" for f in unmapped)
                + "\n    add a category in scripts/checks/lib/state-sync-map.json (with a mutation case)")

    ledger_only = all(any(re.search(rx, f) for rx in cfg["ledger_only"]) for f in files)
    requires: set[str] = set()
    for c in cfg["categories"]:
        if c["id"] in cats:
            requires |= set(c["requires"])

    tl_add = added_lines(old, new, rec["task_log"])
    tl_text = "\n".join(tl_add)
    if tl_add and not tl_text.strip():
        v.need(rec["task_log"], "the change to TASK_LOG is whitespace only")

    branch = os.environ.get("WASLA_STATE_SYNC_BRANCH") or git("rev-parse", "--abbrev-ref", "HEAD").strip()
    claims_new = parse_claims(show(new, rec["claims"]) or "")
    claims_add = "\n".join(added_lines(old, new, rec["claims"]))

    # ── 2) state-only change: no documentation catch-up PR ──
    if ledger_only:
        kinds = field_values(tl_add, "Kind")
        ok_kind = [k for k in kinds if any(k.lower().startswith(x) for x in cfg["state_only_kinds"])]
        flips = []
        for l in removed_lines(old, new, rec["claims"]):
            m = re.match(r"^\|\s*(CLM-\d+)\s*\|", l)
            if m and re.search(r"\|\s*Active\s*\|", l):
                if any(c.cid == m.group(1) and not c.status.startswith("Active") for c in claims_new):
                    flips.append(m.group(1))
        if not ok_kind:
            why = ("state-only change (ledgers only, no implementation). A separate catch-up PR is "
                   "forbidden: state must travel with the change it describes.")
            if flips:
                why += f"\n    it releases {', '.join(flips)} after the fact; the release belongs in the implementation PR."
            why += ("\n    if this is a genuine correction or an owner decision, declare it in the new TASK_LOG entry:\n"
                    "      - **Kind:** state-correction — <what was wrong, measured, and which record it fixes>")
            v.need(rec["task_log"], why)
        else:
            reason = ok_kind[0].split(None, 1)[1] if len(ok_kind[0].split(None, 1)) > 1 else ""
            if len(reason.strip(" —-:")) < cfg["min_reason_chars"]:
                v.need(rec["task_log"], f"**Kind:** needs a reason of at least {cfg['min_reason_chars']} characters")
        return report(v, cats, branch, [])

    # ── 3) the branch's claim is closed in this same change ──
    mine = [c for c in claims_new if c.branch == branch]
    if "claim_closed" in requires:
        if not mine:
            v.need(rec["claims"], f"no claim row for branch '{branch}'")
        for c in mine:
            if c.raw not in claims_add:
                v.need(rec["claims"], f"{c.cid}: the claim row is not updated in this change")
            if not re.match(r"^(Released|Cancelled)\b", c.status):
                v.need(rec["claims"],
                       f"{c.cid}: status is '{c.status}'. Agents hand off sequentially, so the merge is the release: "
                       "set 'Released' in this PR with what was delivered (no release PR after merge)")
            elif len(c.notes) < cfg["min_reason_chars"]:
                v.need(rec["claims"], f"{c.cid}: the release note is empty; say what this PR delivered")
    cids = [c.cid for c in mine]
    items = sorted({c.item for c in mine})

    # ── 4) TASK_LOG entry describes this change ──
    if "task_log_entry" in requires:
        if not tl_add:
            v.need(rec["task_log"], "no entry added for this change")
        else:
            for cid in cids:
                if cid not in tl_text:
                    v.need(rec["task_log"], f"the new entry does not name {cid}")
            wis = " ".join(field_values(tl_add, "Work Item(s)"))
            for it in items:
                if it not in wis:
                    v.need(rec["task_log"], f"the new entry's **Work Item(s):** does not list {it}")
            sts = field_values(tl_add, "Status")
            if not sts:
                v.need(rec["task_log"], "the new entry has no **Status:** line")
            for s in sts:
                # A status line may keep its history: "<old> → <new>". The state is the last segment.
                cur = s.split("→")[-1]
                for pat in cfg["stale_status_patterns"]:
                    if pat.lower() in cur.lower():
                        v.need(rec["task_log"],
                               f"**Status:** '{s[:80]}' would be stale on main the moment this merges "
                               f"('{pat}'). Write the state as it will be after merge")
            for m in PATH_RX.finditer(tl_text):
                p = m.group(1).rstrip("/.,")
                if "*" in p or "<" in p:
                    continue
                # "branch `docs/x`" names a git ref, not a file: branches share the path namespace.
                if re.search(r"(?i)(branch|branches|الفرع|فرع)\s*$", tl_text[max(0, m.start() - 16):m.start()]):
                    continue
                if show(new, p) is None and not git("ls-tree", "-d", "--name-only", new, p, check=False).strip():
                    v.need(rec["task_log"], f"evidence path `{p}` does not exist at {new[:12]}")

    if "units_named" in requires and tl_add:
        units: dict[str, list[str]] = {}
        for f in files:
            if any(re.search(rx, f) for rx in cfg["ledger_only"]):
                continue
            u = unit_of(f)
            if u:
                units.setdefault(u, []).append(f)
        for u, fs in sorted(units.items()):
            if not unit_named(u, fs, tl_text):
                v.need(rec["task_log"], f"the new entry does not mention the changed unit `{u}`")

    # ── 5) board row and roadmap line ──
    if "board_row" in requires:
        b_add = added_lines(old, new, rec["board"])
        for it in items:
            if not any(re.match(rf"^\|\s*{re.escape(it)}\s*\|", l) for l in b_add):
                v.need(rec["board"], f"row {it} is not updated")
        if not items and not b_add:
            v.need(rec["board"], "not updated")
    if "roadmap_line" in requires:
        r_add = "\n".join(added_lines(old, new, rec["roadmap"]))
        if not r_add.strip():
            v.need(rec["roadmap"], "not updated")
        elif cids and not any(c in r_add for c in cids):
            v.need(rec["roadmap"], f"the added text does not name {' or '.join(cids)}")

    # ── 6) tests travel with implementation ──
    if "tests" in requires:
        impl = [f for f in cats.get("implementation", []) if not re.search(cfg["test_file"], f)]
        tests = [f for f in files if re.search(cfg["test_file"], f)]
        if impl and not tests:
            reasons = field_values(tl_add, "No-Test-Reason")
            if not reasons or len(reasons[0]) < cfg["min_reason_chars"]:
                v.need("tests", "implementation changed with no test change. Add or adjust tests, or state "
                       "**No-Test-Reason:** in the entry (reviewed by the code owner)")

    # ── 7) risk statuses equal the register ──
    if "risk_sync" in requires:
        reg = risk_statuses(show(new, rec["risk_register"]) or "")
        vals = field_values(tl_add, "Risk(s)")
        if not vals:
            v.need(rec["task_log"], "security-relevant change: add **Risk(s):** RISK-NNNN → <status> "
                   "(or 'none — <reason>') to the entry")
        for val in vals:
            if val.lower().startswith("none"):
                if len(val[4:].strip(" —-:")) < cfg["min_reason_chars"]:
                    v.need(rec["task_log"], "**Risk(s):** none needs a reason")
                continue
            pairs = re.findall(r"(RISK-\d{4})\s*(?:→|->|=|:)\s*`?([a-z-]+)", val)
            if not pairs:
                v.need(rec["task_log"], f"**Risk(s):** '{val[:60]}' has no RISK-NNNN → <status> pair")
            for rid, st in pairs:
                if rid not in reg:
                    v.need(rec["risk_register"], f"{rid} is named in the entry but not in the register")
                elif reg[rid] != st:
                    v.need(rec["risk_register"],
                           f"{rid}: the entry says '{st}', the register says '{reg[rid]}' — synchronize the register")

    # ── 8) deployment evidence ──
    if "evidence_field" in requires:
        ev = [x for x in field_values(tl_add, "Evidence") if len(x) >= 10]
        dep = field_values(tl_add, "Deployment") + field_values(tl_add, "Security / Data / Deployment")
        if not ev:
            v.need(rec["task_log"], "deployment/infrastructure change: **Evidence:** (run, URL, artifact) is missing")
        if not dep:
            v.need(rec["task_log"], "deployment/infrastructure change: **Deployment:** (live effect or 'none — why') is missing")

    # ── 9) a new guard is part of the documented governance ──
    if "guard_documented" in requires:
        new_guards = [f for st, f, _ in changes if st == "A" and re.match(r"^scripts/checks/[^/]+\.(sh|py)$", f)]
        if new_guards:
            docs = git("ls-tree", "-r", "--name-only", new, "docs/00-rules", "docs/15-decisions").split()
            corpus = "\n".join(show(new, d) or "" for d in docs if d.endswith(".md"))
            for g in new_guards:
                if os.path.basename(g) not in corpus:
                    v.need("docs/00-rules/ or docs/15-decisions/", f"new guard `{g}` is not referenced by any rule or ADR")

    # ── 10) deleted or renamed files are not still referenced by executable/rule surfaces ──
    gone = [p for st, f, p in changes if st == "R" and p] + [f for st, f, _ in changes if st == "D"]
    if gone:
        surf = [f for f in git("ls-tree", "-r", "--name-only", new).split()
                if re.match(r"^(scripts/|\.github/|docs/00-rules/|CODEOWNERS$|package\.json$)", f)]
        for g in gone:
            refs = [f for f in surf if g in (show(new, f) or "")]
            if refs:
                v.block(f"`{g}` was deleted/renamed but is still referenced by: {', '.join(refs[:5])}")

    impl_files = [f for f in files if not any(re.search(rx, f) for rx in cfg["ledger_only"])]
    return report(v, cats, branch, impl_files)


def report(v: Verdict, cats: dict[str, list[str]], branch: str, impl: list[str]) -> int:
    if not v.blocked and not v.required:
        print(PASS_LINE)
        for c, fs in cats.items():
            print(f"  {c}: {len(fs)} file(s)")
        return 0
    print(BLOCK_LINE)
    if impl:
        print("BLOCKED: implementation changed but project-state documentation was not synchronized.")
    else:
        print("BLOCKED: state-only change without a declared, reasoned kind (no documentation catch-up PR).")
    if impl:
        print("  implementation changed:")
        for f in sorted(set(impl))[:25]:
            print(f"    {f}")
        if len(set(impl)) > 25:
            print(f"    … {len(set(impl)) - 25} more")
    if v.required:
        print("  required state updates:")
        for r, why in v.required.items():
            print(f"    {r}")
            for w in why:
                print(f"      - {w}")
    for b in v.blocked:
        print(f"  {b}")
    print(f"  branch: {branch}")
    print("  reason:\n    project state is stale")
    print("  rule: docs/00-rules/STATE_SYNC_RULE.md")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:  # fail closed
        print(BLOCK_LINE)
        print(f"  reason: guard error (fail-closed): {e}")
        sys.exit(1)
