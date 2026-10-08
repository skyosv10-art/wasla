"""render_target.py — Render workspace resolution for ops tools (CLM-0502 · INC-0005 · P5-9).

No ops tool carries a workspace id. The single source is infra/render/deploy-target.json:
  legacy_owner   the legacy (oregon) workspace — the only one the legacy tools were built for
  frozen_owners  workspaces that must not be written to (blue/green freeze)

legacy_only(tool)    LEGACY-ONLY tools (host convention `wasla-<svc>.onrender.com`, legacy DR,
                     cutover and rotation drills). Refuse (exit 3) while the legacy owner is
                     frozen, and refuse any other owner: their host logic is wrong for a new stack.
explicit_owner(tool) read-only tools: RENDER_OWNER_ID is required, no default (exit 2).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

LEGACY_EXIT = 3


def _target() -> dict:
    for p in Path(__file__).resolve().parents:
        f = p / "infra" / "render" / "deploy-target.json"
        if f.is_file():
            return json.loads(f.read_text(encoding="utf-8"))
    sys.exit("render_target: infra/render/deploy-target.json not found")


def legacy_only(tool: str) -> str:
    t = _target()
    legacy = t.get("legacy_owner") or ""
    if legacy in (t.get("frozen_owners") or []):
        print(f"{tool}: LEGACY-ONLY tool — the legacy Render workspace is frozen since {t.get('since')} "
              f"(infra/render/deploy-target.json, CLM-0501/CLM-0502). Refusing to run.", file=sys.stderr)
        sys.exit(LEGACY_EXIT)
    owner = os.environ.get("RENDER_OWNER_ID", legacy)
    if owner != legacy:
        print(f"{tool}: LEGACY-ONLY tool — built for {legacy} only; refusing owner {owner}.", file=sys.stderr)
        sys.exit(LEGACY_EXIT)
    return legacy


def explicit_owner(tool: str) -> str:
    owner = os.environ.get("RENDER_OWNER_ID", "")
    if not owner.startswith("tea-"):
        print(f"{tool}: RENDER_OWNER_ID is required (no default workspace; CLM-0502).", file=sys.stderr)
        sys.exit(2)
    return owner
