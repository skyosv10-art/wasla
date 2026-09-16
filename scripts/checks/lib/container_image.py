#!/usr/bin/env python3
# container_image.py — قياسُ عقدِ صورةِ الحاويةِ من الشجرةِ لا من الوصفِ. (M2-01 · الفحصُ 19)
#
# ── لماذا مكتبةٌ واحدةٌ ────────────────────────────────────────────────────
# ثلاثةُ مستهلكينَ يسألونَ **السؤالَ نفسَه** («ما الحِزَمُ القابلةُ للتشغيلِ؟»):
# الحارسُ (الفحصُ 19)، ومُتحقِّقُ العقدِ داخلَ CI، والوثيقةُ. ولو قاسَ كلٌّ
# منهم بنفسِهِ لصارَ لدينا ثلاثةُ أرقامٍ تفترقُ بصمتٍ، فتُنشَرُ صورةٌ لا مدخلَ
# فيها لخدمةٍ ويظلُّ الأخضرُ أخضرَ.
#
# لا يُقاسُ شيءٌ من نصٍّ حرٍّ: `runnable_packages()` تقرأُ بياناتَ الحِزَمِ
# الحقيقيّةَ، و`declared_contract()` تقرأُ الجدولَ المُعلَنَ، والمقارنةُ
# **ثنائيّةُ الاتّجاهِ**: صفٌّ ميتٌ في الجدولِ كذبٌ كغيابِ صفٍّ حيٍّ.
#
# الاستعمال:
#   python3 scripts/checks/lib/container_image.py runnable        # الحِزَمُ المقيسةُ
#   python3 scripts/checks/lib/container_image.py contract-diff   # المقيسُ ضدَّ المُعلَنِ
#
# المرجع: docs/08-infrastructure/CONTAINER_IMAGES.md · ADR-033
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

# أدلّةُ الحِزَمِ القابلةِ للتشغيلِ — من pnpm-workspace.yaml، لا تخميناً.
RUNNABLE_ROOTS = ("services", "bots", "apps")

DOC = ROOT / "docs/08-infrastructure/CONTAINER_IMAGES.md"
DOCKERFILE = ROOT / "Dockerfile"
DOCKERIGNORE = ROOT / ".dockerignore"
CI = ROOT / ".github/workflows/ci.yml"
PINS = ROOT / "scripts/container/tool-pins.env"
ROOT_MANIFEST = ROOT / "package.json"

ENTRY_RE = re.compile(r"([\w./-]+\.(?:ts|mts|js|mjs|cjs))")


@dataclass(frozen=True)
class Runnable:
    package: str
    directory: str
    entry: str

    def as_row(self) -> str:
        return f"| `{self.package}` | `{self.directory}` | `{self.entry}` |"


def runnable_packages(root: Path = ROOT) -> list[Runnable]:
    """كلُّ حزمةٍ في فضاءِ العملِ لها أمرُ `start` — مقيسةً من بيانِها."""
    found: list[Runnable] = []
    for area in RUNNABLE_ROOTS:
        base = root / area
        if not base.is_dir():
            continue
        for manifest_path in sorted(base.glob("*/package.json")):
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            start = (data.get("scripts") or {}).get("start")
            if not start:
                continue
            match = ENTRY_RE.search(start)
            if not match:
                raise SystemExit(
                    f"✗ {manifest_path}: أمرُ start «{start}» لا يُستخرَجُ منهُ ملفُّ مدخلٍ"
                )
            entry = match.group(1)
            entry_path = manifest_path.parent / entry
            if not entry_path.is_file():
                raise SystemExit(
                    f"✗ {manifest_path}: ملفُّ المدخلِ المُعلَنُ في start مفقودٌ — {entry}"
                )
            found.append(
                Runnable(
                    package=data["name"],
                    directory=str(manifest_path.parent.relative_to(root)),
                    entry=entry,
                )
            )
    return found


def declared_contract(doc: Path = DOC) -> list[Runnable]:
    """الجدولُ المُعلَنُ في §3 من وثيقةِ الصورِ — مصدرُ الادّعاءِ لا القياسِ."""
    if not doc.is_file():
        raise SystemExit(f"✗ وثيقةُ الصورِ مفقودةٌ: {doc}")
    rows: list[Runnable] = []
    for line in doc.read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 3:
            continue
        if not cells[0].startswith("`@wasla/"):
            continue
        rows.append(
            Runnable(
                package=cells[0].strip("`"),
                directory=cells[1].strip("`"),
                entry=cells[2].strip("`"),
            )
        )
    return rows


def base_image(dockerfile: Path = DOCKERFILE) -> tuple[str, str, str]:
    """(الوسمُ الكاملُ، نسخةُ العقدةِ، البصمةُ) من أوّلِ `FROM` — أو خطأٌ صريحٌ."""
    if not dockerfile.is_file():
        raise SystemExit(f"✗ Dockerfile مفقودٌ: {dockerfile}")
    for line in dockerfile.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped.startswith("FROM "):
            continue
        ref = stripped.split()[1]
        match = re.fullmatch(r"node:(\d+\.\d+\.\d+)-alpine@(sha256:[0-9a-f]{64})", ref)
        if not match:
            raise SystemExit(
                "✗ أساسُ الصورةِ غيرُ مُثبَّتٍ بالشكلِ المُلزِمِ "
                f"«node:<x.y.z>-alpine@sha256:<64>» — وُجِدَ: {ref}"
            )
        return ref, match.group(1), match.group(2)
    raise SystemExit("✗ لا سطرَ FROM في Dockerfile")


def ci_node_version(ci: Path = CI) -> str:
    match = re.search(r'^\s*NODE_VERSION:\s*"([^"]+)"', ci.read_text(encoding="utf-8"), re.M)
    if not match:
        raise SystemExit("✗ NODE_VERSION غيرُ موجودٍ في .github/workflows/ci.yml")
    return match.group(1)


def package_manager_version(manifest: Path = ROOT_MANIFEST) -> str:
    data = json.loads(manifest.read_text(encoding="utf-8"))
    pm = data.get("packageManager", "")
    match = re.fullmatch(r"pnpm@(\d+\.\d+\.\d+)", pm)
    if not match:
        raise SystemExit(f"✗ packageManager غيرُ مفهومٍ في package.json: «{pm}»")
    return match.group(1)


def tool_pins(pins: Path = PINS) -> dict[str, str]:
    if not pins.is_file():
        raise SystemExit(f"✗ ملفُّ تثبيتِ الأدواتِ مفقودٌ: {pins}")
    values: dict[str, str] = {}
    for line in pins.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def _cmd_runnable() -> int:
    for item in runnable_packages():
        print(f"{item.package}\t{item.directory}\t{item.entry}")
    return 0


def _cmd_rows() -> int:
    for item in runnable_packages():
        print(item.as_row())
    return 0


def _cmd_contract_diff() -> int:
    measured = {(r.package, r.directory, r.entry) for r in runnable_packages()}
    declared = {(r.package, r.directory, r.entry) for r in declared_contract()}
    missing = sorted(measured - declared)
    dead = sorted(declared - measured)
    for package, directory, entry in missing:
        print(f"MISSING\t{package}\t{directory}\t{entry}")
    for package, directory, entry in dead:
        print(f"DEAD\t{package}\t{directory}\t{entry}")
    return 1 if (missing or dead) else 0


def main(argv: list[str]) -> int:
    commands = {
        "runnable": _cmd_runnable,
        "rows": _cmd_rows,
        "contract-diff": _cmd_contract_diff,
    }
    if len(argv) != 2 or argv[1] not in commands:
        print(f"الاستعمال: {argv[0]} {{{'|'.join(commands)}}}", file=sys.stderr)
        return 64
    return commands[argv[1]]()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
