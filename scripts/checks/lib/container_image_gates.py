#!/usr/bin/env python3
# container_image_gates.py — منطقُ الفحصِ 19: صورةُ الحاويةِ وسلسلةُ توريدِها. (M2-01)
#
# ── العطبُ المحروسُ (مقيسٌ على main قبلَ هذهِ الدورةِ) ─────────────────────
#   · لا Dockerfile في الشجرةِ أصلاً، ولا قائمةَ موادٍ، ولا فحصَ ثغراتٍ. فكلُّ
#     كلامٍ عن «نشرٍ» كانَ ادّعاءً بلا أرتفاكتٍ.
#   · والمحاولةُ السابقةُ (PR #205) كتبَتْ Dockerfile ينسخُ `services/*/dist`
#     بنجومٍ ولا يُبنى، وسكربتَ قائمةِ موادٍ **بديلُهُ الصامتُ** يكتبُ ملفاً
#     شبهَ فارغٍ إن غابَ `syft` — أي أخضرٌ يعني «لم يُقَسْ شيءٌ».
#     ولا وظيفةَ CI تبنيها، فلا أحدَ يعلمُ أنّها لا تُبنى.
#
# ── لماذا حارسٌ ولا يكفي أنَّ CI يبني ─────────────────────────────────────
# لأنَّ وظيفةَ CI **تُحذَفُ بسطرٍ**. الحارسُ يمنعُ ثلاثةَ أنواعٍ من الانحدارِ لا
# يراها بناءٌ ناجحٌ: مَحوُ الوظيفةِ أو سياقِها الحاجزِ · انفصالُ العقدِ المُعلَنِ
# عن الشجرةِ (خدمةٌ جديدةٌ بلا مدخلٍ، أو صفٌّ ميتٌ في الوثيقةِ) · تكرارُ مصدرِ
# الحقيقةِ (نسخةُ pnpm أو نسخةُ أداةٍ مكتوبةٌ مرَّتَينِ فتفترقانِ بصمتٍ).
#
# ── الأبوابُ التسعةُ ──────────────────────────────────────────────────────
# 1) الأساسُ مُثبَّتٌ بالبصمةِ · 2) نسخةُ العقدةِ = نسخةُ CI · 3) الطبقةُ الأخيرةُ
# غيرُ جِذرٍ · 4) لا نسخةَ pnpm مكتوبةً في Dockerfile · 5) `.dockerignore` يحملُ
# المُدخَلاتِ الإلزاميّةَ · 6) وظيفةُ CI موجودةٌ وتستدعي السكربتاتِ الخمسةَ
# 7) السياقُ في MERGE_BLOCKING.json (مانعُ المَحوِ) · 8) العقدُ المُعلَنُ = المقيسُ
# في الاتّجاهَينِ · 9) الأدواتُ مُثبَّتةٌ بنسخةٍ وبصمةٍ من مصدرٍ واحدٍ.
#
# حدُّهُ المُعلَنُ: يقرأُ نصوصاً وشجرةً. **لا يبني صورةً ولا يشغّلُ حاويةً** —
# ذلكَ حكمُ CI في وظيفةِ `image-supply-chain`، ولا يُعوِّضُ أحدُهما الآخرَ.
#
# المرجع: docs/08-infrastructure/CONTAINER_IMAGES.md · ADR-033 · docs/12-testing/M2-01_GATE.md
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from container_image import (  # noqa: E402
    ROOT,
    base_image,
    ci_node_version,
    declared_contract,
    package_manager_version,
    runnable_packages,
    tool_pins,
)

RED = "\033[31m"
GRN = "\033[32m"
DIM = "\033[2m"
RST = "\033[0m"

DOCKERFILE = ROOT / "Dockerfile"
DOCKERIGNORE = ROOT / ".dockerignore"
CI = ROOT / ".github/workflows/ci.yml"
DOC = ROOT / "docs/08-infrastructure/CONTAINER_IMAGES.md"
MERGE_BLOCKING = ROOT / "docs/12-testing/MERGE_BLOCKING.json"
PINS = ROOT / "scripts/container/tool-pins.env"
SBOM_SCRIPT = ROOT / "scripts/container/generate-sbom.sh"

CI_JOB = "image-supply-chain"

REQUIRED_IGNORES = (".git", "node_modules", "artifacts", ".env")

REQUIRED_SCRIPTS = (
    "scripts/container/build-image.sh",
    "scripts/container/verify-image-contract.sh",
    "scripts/container/generate-sbom.sh",
    "scripts/container/compare-sbom.sh",
    "scripts/container/scan-image.sh",
)

problems: list[str] = []
notes: list[str] = []


def fail(message: str) -> None:
    problems.append(message)


def note(message: str) -> None:
    notes.append(message)


def dockerfile_text() -> str:
    if not DOCKERFILE.is_file():
        fail("Dockerfile مفقودٌ من جذرِ المستودعِ")
        return ""
    return DOCKERFILE.read_text(encoding="utf-8")


def strip_comments(text: str) -> str:
    return "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("#")
    )


# ── البابُ 1+2: الأساسُ مُثبَّتٌ ونسختُهُ نسخةُ CI ───────────────────────
def gate_base_image() -> None:
    try:
        ref, node_version, digest = base_image(DOCKERFILE)
    except SystemExit as error:
        fail(str(error).lstrip("✗ "))
        return

    note(f"الأساسُ: {ref}")

    expected = ci_node_version(CI)
    if node_version != expected:
        fail(
            f"نسخةُ العقدةِ في الأساسِ {node_version} ≠ NODE_VERSION في ci.yml {expected} "
            "— ما يُختبَرُ ليسَ ما يُشحَنُ"
        )

    if not DOC.is_file():
        fail(f"وثيقةُ الصورِ مفقودةٌ: {DOC.relative_to(ROOT)}")
        return

    doc_text = DOC.read_text(encoding="utf-8")
    digests = set(re.findall(r"sha256:[0-9a-f]{64}", doc_text))
    if digest not in digests:
        fail(
            "بصمةُ الأساسِ في Dockerfile غيرُ مُعلَنةٍ في وثيقةِ الصورِ "
            f"({DOC.relative_to(ROOT)}) — انفصالُ مصدرَينِ"
        )
    stale = digests - {digest}
    if stale:
        fail(
            "الوثيقةُ تُعلِنُ بصمةً لا يُستعمِلُها Dockerfile: "
            + ", ".join(sorted(stale))
        )


# ── البابُ 3: الطبقةُ الأخيرةُ غيرُ جِذرٍ ────────────────────────────────
def gate_non_root(text: str) -> None:
    if not text:
        return
    stages: list[list[str]] = []
    for line in strip_comments(text).splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("FROM "):
            stages.append([])
        if stages:
            stages[-1].append(stripped)

    if not stages:
        fail("لا مرحلةَ بناءٍ واحدةً في Dockerfile")
        return

    users = [
        line.split()[1]
        for line in stages[-1]
        if line.upper().startswith("USER ")
    ]
    if not users:
        fail("الطبقةُ الأخيرةُ بلا `USER` — الصورةُ تعملُ جِذراً")
        return
    if users[-1] in {"root", "0"}:
        fail(f"الطبقةُ الأخيرةُ تعملُ جِذراً (`USER {users[-1]}`)")
    else:
        note(f"مستخدمُ التشغيلِ المُعلَنُ: {users[-1]}")

    if not any(line.upper().startswith("ENTRYPOINT ") for line in stages[-1]):
        fail("الطبقةُ الأخيرةُ بلا `ENTRYPOINT` — لا عقدَ تشغيلٍ للصورةِ")


# ── البابُ 4: لا نسخةَ pnpm مكتوبةً ─────────────────────────────────────
def gate_single_package_manager(text: str) -> None:
    if not text:
        return
    declared = package_manager_version()
    hardcoded = re.findall(r"pnpm@(\d+\.\d+\.\d+)", strip_comments(text))
    if hardcoded:
        fail(
            "نسخةُ pnpm مكتوبةٌ في Dockerfile ("
            + ", ".join(sorted(set(hardcoded)))
            + f") — مصدرُها الوحيدُ `packageManager` في package.json ({declared})"
        )
    else:
        note(f"pnpm من `packageManager` وحدَه: {declared}")


# ── البابُ 5: المُدخَلاتُ الإلزاميّةُ في .dockerignore ───────────────────
def gate_dockerignore() -> None:
    if not DOCKERIGNORE.is_file():
        fail(".dockerignore مفقودٌ — سياقُ البناءِ يحملُ `.git` و`node_modules` والأسرارَ")
        return
    entries = {
        line.strip()
        for line in DOCKERIGNORE.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }
    missing = [item for item in REQUIRED_IGNORES if item not in entries]
    if missing:
        fail(".dockerignore ناقصٌ مُدخَلاتٍ إلزاميّةً: " + ", ".join(missing))


# ── البابُ 6: وظيفةُ CI موجودةٌ وتستدعي السكربتاتِ ───────────────────────
def gate_ci_job() -> None:
    if not CI.is_file():
        fail(".github/workflows/ci.yml مفقودٌ")
        return
    text = CI.read_text(encoding="utf-8")

    if not re.search(rf"^\s{{2}}{re.escape(CI_JOB)}:\s*$", text, re.M):
        fail(f"وظيفةُ «{CI_JOB}» غائبةٌ عن ci.yml — لا بناءَ صورةٍ في CI فلا إثباتَ")
        return

    for script in REQUIRED_SCRIPTS:
        path = ROOT / script
        if not path.is_file():
            fail(f"سكربتٌ مطلوبٌ مفقودٌ: {script}")
            continue
        if not path.stat().st_mode & 0o111:
            fail(f"سكربتٌ غيرُ قابلٍ للتنفيذِ: {script}")
        if script not in text:
            fail(f"ci.yml لا يستدعي {script} — أرتفاكتٌ لا يُقاسُ")

    job_body = text.split(f"\n  {CI_JOB}:", 1)[1]
    job_body = re.split(r"\n  [a-z][a-z0-9-]*:\n", job_body, maxsplit=1)[0]
    if re.search(r"continue-on-error:\s*true", job_body):
        fail(f"وظيفةُ «{CI_JOB}» بـ`continue-on-error: true` — بوّابةٌ مُقنَّعةٌ")
    if re.search(r"^\s{4}if:", job_body, re.M):
        fail(f"وظيفةُ «{CI_JOB}» مشروطةٌ بـ`if:` — لا تعملُ دائماً فليست حاجزاً")


# ── البابُ 7: السياقُ في عقدِ الحجزِ (مانعُ المَحوِ) ────────────────────
def gate_merge_blocking() -> None:
    if not MERGE_BLOCKING.is_file():
        fail(f"عقدُ الحجزِ مفقودٌ: {MERGE_BLOCKING.relative_to(ROOT)}")
        return
    data = json.loads(MERGE_BLOCKING.read_text(encoding="utf-8"))
    protection = data.get("protection") or {}
    required = protection.get("required_status_checks") or {}
    contexts = set(required.get("contexts") or [])
    if not contexts:
        fail("لقطةُ الحمايةِ بلا سياقاتٍ مطلوبةٍ — القياسُ نفسُهُ معطوبٌ")
        return
    if CI_JOB not in contexts:
        fail(
            f"«{CI_JOB}» ليسَ في السياقاتِ المطلوبةِ في MERGE_BLOCKING.json — "
            "وظيفةٌ تعملُ ولا تحجزُ الدمجَ"
        )
    else:
        note(f"«{CI_JOB}» سياقٌ حاجزٌ ضمنَ {len(contexts)} سياقاً")


# ── البابُ 8: العقدُ المُعلَنُ = المقيسُ في الاتّجاهَينِ ────────────────
def gate_contract() -> None:
    try:
        measured = runnable_packages()
    except SystemExit as error:
        fail(str(error).lstrip("✗ "))
        return
    declared = declared_contract(DOC) if DOC.is_file() else []

    measured_set = {(r.package, r.directory, r.entry) for r in measured}
    declared_set = {(r.package, r.directory, r.entry) for r in declared}

    for package, directory, entry in sorted(measured_set - declared_set):
        fail(f"حزمةٌ قابلةٌ للتشغيلِ غيرُ مُعلَنةٍ في عقدِ الصورةِ: {package} ({directory} → {entry})")
    for package, directory, entry in sorted(declared_set - measured_set):
        fail(f"صفٌّ ميتٌ في عقدِ الصورةِ — لا يُطابقُ الشجرةَ: {package} ({directory} → {entry})")

    if measured_set and measured_set == declared_set:
        note(f"عقدُ التشغيلِ: {len(measured_set)} حزمةً مُعلَنةً = المقيسُ")

    # الأرقامُ المنشورةُ تُقاسُ لا تُكتَبُ.
    if DOC.is_file():
        doc_text = DOC.read_text(encoding="utf-8")
        stated = re.search(r"RUNNABLE_PACKAGE_COUNT\s*[:=]\s*(\d+)", doc_text)
        if not stated:
            fail("الوثيقةُ لا تُعلِنُ RUNNABLE_PACKAGE_COUNT — رقمٌ منشورٌ بلا قياسٍ")
        elif int(stated.group(1)) != len(measured_set):
            fail(
                f"RUNNABLE_PACKAGE_COUNT المنشورُ {stated.group(1)} ≠ المقيسُ {len(measured_set)}"
            )


# ── البابُ 9: أدواتٌ مُثبَّتةٌ بنسخةٍ وبصمةٍ من مصدرٍ واحدٍ ─────────────
def gate_tool_pins() -> None:
    if not PINS.is_file():
        fail(f"ملفُّ تثبيتِ الأدواتِ مفقودٌ: {PINS.relative_to(ROOT)}")
        return
    pins = tool_pins(PINS)
    for tool in ("SYFT", "TRIVY"):
        version = pins.get(f"{tool}_VERSION", "")
        sha = pins.get(f"{tool}_SHA256", "")
        if not re.fullmatch(r"\d+\.\d+\.\d+", version):
            fail(f"{tool}_VERSION غيرُ مُثبَّتٍ بصيغةِ x.y.z: «{version}»")
        if not re.fullmatch(r"[0-9a-f]{64}", sha):
            fail(f"{tool}_SHA256 ليسَ sha256 من 64 خانةً: «{sha}» — تنزيلٌ بلا تحقُّقٍ")

    # النسخةُ مكتوبةٌ في موضعٍ واحدٍ فقط.
    #
    # ونطاقُ البحثِ محدودٌ بقصدٍ بالمواضعِ التي **تُنزِّلُ الأداةَ أو تُشغِّلُها**:
    # سكربتاتُ الحاويةِ وسيرُ العملِ. وتُستثنى حزمةُ حالاتِ الطفرةِ لأنَّ الطفرةَ
    # نفسَها تكتبُ نسخةً بقصدٍ لتُقاسَ عضّةُ هذا البابِ — ولو حُسِبَت عيباً لصارَ
    # الحارسُ يمنعُ إثباتَ نفسِهِ. والتعليقاتُ تُنزَعُ قبلَ القياسِ: تعليقٌ يذكرُ
    # رقماً ليسَ مصدرَ حقيقةٍ ثانياً، والعيبُ المحروسُ سطرٌ **يُنفَّذُ**.
    scanned = sorted(ROOT.glob("scripts/container/*.sh")) + sorted(
        ROOT.glob(".github/workflows/*.yml")
    )
    for path in scanned:
        if path == PINS:
            continue
        text = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
        for tool, key in (("syft", "SYFT_VERSION"), ("trivy", "TRIVY_VERSION")):
            version = pins.get(key, "")
            if version and re.search(rf"{tool}[_-]?v?{re.escape(version)}", text, re.I):
                fail(
                    f"نسخةُ {tool} مكتوبةٌ خارجَ tool-pins.env في "
                    f"{path.relative_to(ROOT)} — مصدرانِ يفترقانِ بصمتٍ"
                )

    if SBOM_SCRIPT.is_file():
        text = SBOM_SCRIPT.read_text(encoding="utf-8")
        if "SBOM_MIN_COMPONENTS" not in text:
            fail("generate-sbom.sh بلا حدٍّ أدنى للمكوِّناتِ — قائمةٌ فارغةٌ تمرُّ خضراءَ")
        if re.search(r"\|\|\s*(true|echo)", text):
            fail("generate-sbom.sh فيهِ بديلٌ صامتٌ (`|| true`) — فشلٌ يُقرأُ نجاحاً")


def main() -> int:
    text = dockerfile_text()
    gate_base_image()
    gate_non_root(text)
    gate_single_package_manager(text)
    gate_dockerignore()
    gate_ci_job()
    gate_merge_blocking()
    gate_contract()
    gate_tool_pins()

    for message in notes:
        print(f"{DIM}  • {message}{RST}")

    if problems:
        print(f"{RED}✗ صورةُ الحاويةِ وسلسلةُ توريدِها — {len(problems)} إخفاقاً:{RST}")
        for message in problems:
            print(f"  ✗ {message}")
        print(
            f"{DIM}  العقدُ: docs/08-infrastructure/CONTAINER_IMAGES.md · "
            f"البوّابةُ: docs/12-testing/M2-01_GATE.md{RST}"
        )
        return 1

    print(
        f"{GRN}✓ صورةُ الحاويةِ: أساسٌ مُثبَّتٌ بالبصمةِ · غيرُ جِذرٍ · "
        f"عقدُ تشغيلٍ مُطابقٌ للشجرةِ · أدواتٌ بنسخةٍ وبصمةٍ.{RST}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
