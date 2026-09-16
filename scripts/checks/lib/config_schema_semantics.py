#!/usr/bin/env python3
# config_schema_semantics.py — دلالاتُ الفحصِ 18: مخطَّطُ الإعدادِ ومصدرُهُ الواحدُ. (M2-04)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# المقيسُ على `main` قبلَ العملِ (لا مُشتَقٌّ من تقريرٍ):
#
#   • **113 موضعَ قراءةٍ** للبيئةِ في 64 ملفّاً، و**لا `.env.example`** في الشجرةِ
#     كلِّها. فقائمةُ ما تحتاجُهُ النشرةُ **غيرُ موجودةٍ** — تُستنبَطُ بـ`rg`.
#   • `services/dispatch/src/http/server.ts` يقرأُ قواعدَ الإرسالِ الأربعَ بـ
#     `Number(process.env.X ?? n)`. و`Number("ثلاثة")` = `NaN` **بلا صياحٍ**:
#     `waveSize = NaN` يُنتِجُ موجةً بلا سائقٍ، والخدمةُ حيّةٌ خضراءُ صامتةٌ.
#     وهذا عطبٌ مقيسٌ لا مُتخيَّلٌ (`RISK-0046`).
#   • ثلاثةُ قرّاءٍ صارمينَ **مكتوبينَ ثلاثَ مرّاتٍ** بثلاثِ صيغٍ مختلفةِ الحزمِ
#     (`delivery/ops` · `delivery/domain` · `marketplace/http` · `bot-runtime`)،
#     ولا واحدَ منها مرجعٌ. فالصرامةُ صدفةُ ملفٍّ لا قاعدةُ مستودعٍ.
#
# ── وما يفرضُهُ هذا الملفُّ (ثمانيةُ أبوابٍ) ────────────────────────────────
# 1) **لا قراءةَ غيرَ مُسجَّلةٍ:** كلُّ (متغيّرٍ · ملفٍّ) مقيسٍ في الشجرةِ مُعلَنٌ
#    في السجلِّ. فمتغيّرٌ يُقرأُ ولا يُعلَنُ = نشرةٌ تسقطُ عندَ التشغيلِ الأوّلِ.
# 2) **لا إعلانَ ميّتاً:** كلُّ قارئٍ مُعلَنٍ يُقابَلُ **حيّاً** في ملفِّهِ. فسجلٌّ
#    يذكرُ قارئاً زالَ يُورِثُ ثقةً بلا سندٍ — وهوَ نوعُ العطبِ الذي يُنتِجُهُ
#    الحرّاسُ الأحاديّونَ الاتّجاهِ.
# 3) **الأرتفاكتُ مُشتَقٌّ لا مكتوبٌ:** يُعادُ توليدُ `.env.example` و
#    `registry.generated.ts` هنا ويُقارَنانِ **بايتاً بايتاً**.
# 4) **سلامةُ السجلِّ بنيويّاً:** أسماءٌ فريدةٌ · أنواعٌ من قائمةٍ مغلقةٍ · وصفٌ
#    عربيٌّ لكلِّ متغيّرٍ · قارئٌ واحدٌ على الأقلِّ · لا سرَّ لهُ افتراضيٌّ.
# 5) **الاسمُ يُلزِمُ نوعَهُ:** `*_URL` وصلةٌ، و`*_PORT` منفذٌ، و`*_MS` عددٌ —
#    فلا يُهرَبُ من الصرامةِ بتصنيفِ كلِّ شيءٍ `string`.
# 6) **لا تحليلَ رقميّاً عارياً:** `Number(process.env…)` و`parseInt(process.env…)`
#    محرَّمةٌ في شيفرةِ الإنتاجِ خارجَ حزمةِ الإعدادِ، وسجلُّ الاستثناءاتِ
#    **مغلقٌ في الاتّجاهَينِ**: استثناءٌ لا مورِدَ لهُ يُسقِطُ الفحصَ أيضاً.
# 7) **لا سرَّ في المثالِ:** كلُّ متغيّرٍ سرِّيٍّ قيمتُهُ في `.env.example` نائبٌ.
# 8) **القارئُ غيرُ المباشرِ مربوطٌ بالقياسِ:** `keyRegistryFromEnv` تقرأُ
#    `WASLA_SERVICE_AUTH_KEYS` من **قيمةٍ افتراضيّةٍ في دالّةٍ** لا من
#    `process.env.X`، فلا ماسحٌ ساذجٌ يراها. فيُلزَمُ أن يكونَ الاسمانِ مُعلَنَينِ
#    بنمطِ `default_literal` وأن يبقيا حاضرَينِ في `keys.ts` حرفاً.
#
# ── الحدُّ المُعلَن (لا يُدَّعى ما ليسَ مقيساً) ─────────────────────────────
# الماسحُ يقرأُ **نصَّ الملفِّ** بعدَ نزعِ التعليقاتِ: يرى `process.env.X` و
# `env.X` و`env["X"]` والأسماءَ النصّيّةَ المُعلَنةَ. ولا يرى قراءةً مبنيّةً في
# زمنِ التشغيلِ من قطعِ نصٍّ (`env[`X_`+kind]`)؛ ولذلكَ وُجِدَ البابُ 8: ما لا
# يُقاسُ بالنمطِ يُربَطُ بإعلانٍ مقروءٍ حرفاً. ولا يحكمُ الفحصُ على **صوابِ**
# القيمةِ الافتراضيّةِ ولا على وجودِ المتغيّرِ في بيئةِ نشرٍ حقيقيّةٍ.
#
#   python3 scripts/checks/lib/config_schema_semantics.py --print-measured
#   python3 scripts/checks/lib/config_schema_semantics.py --check [--root R]
#
# المرجع: docs/08-infrastructure/CONFIG_SCHEMA.md · ADR-032 · RISK-0046

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config_render import (  # noqa: E402
    ENV_EXAMPLE_PATH,
    GENERATED_TS_PATH,
    REGISTRY_PATH,
    SECRET_PLACEHOLDER,
    VALID_MODES,
    VALID_REQUIRED,
    VALID_SCOPES,
    VALID_TYPES,
    RegistryError,
    load_registry,
    rendered_artifacts,
    variables_sorted,
)

# أدلّةُ الشيفرةِ المقروءةُ. `infra/` مشمولةٌ: نصوصُ النشرِ تقرأُ البيئةَ أيضاً.
SCAN_ROOTS = ("services", "packages", "bots", "apps", "infra")
SCAN_SUFFIXES = (".ts", ".mts", ".cts")
EXCLUDED_PARTS = ("node_modules", "dist", "build", ".turbo", "coverage")

# حزمةُ الإعدادِ نفسُها مُستثناةٌ من القياسِ كلِّهِ: هيَ **موضعُ** التحليلِ الصارمِ
# لا مُستهلِكةٌ لهُ. ولا تقرأُ `process.env` بحالٍ — تأخذُ البيئةَ حُقنةً — فاستثناؤها
# لا يُخفي قراءةً. أمّا اختباراتُها فتُنادي القارئَ بأسماءٍ وهميّةٍ (`"D"` · `"N"`)،
# ولو قِيسَتْ لصارَ السجلُّ مُطالَباً بإعلانِ متغيّراتٍ لا وجودَ لها في نشرةٍ.
CONFIG_PACKAGE_PREFIX = "packages/config/"

DIRECT_PATTERNS = (
    re.compile(r"process\.env\.([A-Z][A-Z0-9_]*)"),
    re.compile(r"""process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]"""),
)
BAG_PATTERNS = (
    re.compile(r"\b(?:env|processEnv)\.([A-Z][A-Z0-9_]*)"),
    re.compile(r"""\b(?:env|processEnv)\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]"""),
)
# قراءةٌ عبرَ قارئِ `@wasla/config` باسمٍ حرفيٍّ: `readPortEnv(env, "PORT", 8080)`.
#
# ولِمَ نمطٌ ثالثٌ ولا يكفي النمطانِ: بعدَ M2-04 صارتِ القراءةُ الصحيحةُ تُمرِّرُ
# **البيئةَ حُقنةً والاسمَ نصّاً**، فلا `process.env.X` ولا `env.X` في السطرِ. ولو
# بقيَ الماسحُ على النمطَينِ وحدَهما لصارَ كلُّ ترحيلٍ إلى الحزمةِ **إخفاءً** للقراءةِ
# عن البابِ 1 — أي لصارَ الحارسُ يُكافئُ الهجرةَ بإطفاءِ نفسِهِ. وهذا النمطُ يمنعُ ذلكَ.
READER_PATTERNS = (
    re.compile(
        r"""\b(?:read[A-Za-z]*Env|requireEnv)\(\s*[^,()]+,\s*["']([A-Z][A-Z0-9_]*)["']"""
    ),
)
NUMERIC_PATTERNS = (
    re.compile(r"Number\(\s*process\.env\b"),
    re.compile(r"Number\(\s*(?:env|processEnv)\.[A-Z]"),
    re.compile(r"""Number\(\s*(?:env|processEnv)\[\s*["']"""),
    re.compile(r"parseInt\(\s*process\.env\b"),
    re.compile(r"parseFloat\(\s*process\.env\b"),
    re.compile(r"parseInt\(\s*(?:env|processEnv)\.[A-Z]"),
)

# البابُ 5: الاسمُ يُلزِمُ نوعَهُ. لاحقةٌ ⇒ الأنواعُ المقبولةُ لها.
SUFFIX_TYPE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("_DATABASE_URL", ("postgres_url",)),
    ("_SERVICE_URL", ("http_url",)),
    ("_BASE_URL", ("http_url",)),
    ("_MINI_APP_URL", ("http_url",)),
    ("_URL", ("postgres_url", "http_url")),
    ("_PORT", ("port",)),
    ("_MS", ("positive_int", "non_negative_int")),
    ("_SECONDS", ("positive_int", "non_negative_int")),
    ("_SIZE", ("positive_int",)),
    ("_WAVES", ("positive_int",)),
    ("_BATCHES", ("positive_int",)),
    ("_IDS", ("csv",)),
    ("_KEYS", ("secret_material",)),
    ("_SECRET", ("secret_material",)),
    ("_TOKEN", ("secret_material",)),
)
EXACT_TYPE_RULES = {"PORT": ("port",), "DATABASE_URL": ("postgres_url",)}

# البابُ 8: قارئٌ غيرُ مباشرٍ مقيسٌ — ملفٌّ ⇒ أسماءٌ يجبُ أن تُعلَنَ منهُ.
INDIRECT_BINDINGS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "packages/service-auth/src/keys.ts",
        ("WASLA_SERVICE_AUTH_KEYS", "WASLA_SERVICE_AUTH_ACTIVE_KID"),
    ),
)

# نائبُ السرِّ **مكتوباً هنا حرفاً**، ولا يُستوردُ من المُولِّدِ بقصدٍ.
#
# ولِمَ يُكرَّرُ أدبٌ يُنهى عن تكرارِهِ: لأنَّ البابَ 3 يُثبِتُ أنَّ `.env.example`
# **مُشتَقٌّ من مُولِّدِهِ**، فلو قرأَ البابُ 7 النائبَ من المُولِّدِ نفسِهِ لصارَ
# يُصادِقُ على المُولِّدِ بالمُولِّدِ: طفرةٌ في `SECRET_PLACEHOLDER` تكتبُ سرّاً
# حقيقيّاً في المثالِ **وتمرُّ البابانِ معاً**. وقد قِيسَ ذلكَ حرفاً في حزمةِ
# الطفراتِ (2026-09-16) قبلَ فصلِ الأدبَينِ. فالمعيارانِ اثنانِ بقصدٍ، والخُلْفُ
# بينَهُما إخفاقٌ مقروءٌ — وهوَ عينُ ما فعلَهُ `validate-test-invocation.sh`.
EXPECTED_SECRET_PLACEHOLDER = "__SET_ME__"

RESET, RED, GRN, YLW, BOLD = "\033[0m", "\033[31m", "\033[32m", "\033[33m", "\033[1m"


def strip_comments(text: str) -> str:
    """ينزعُ التعليقاتِ ويُبقي الأسطرَ (فالأرقامُ تبقى صادقةً في الرسائلِ).

    قراءةٌ في تعليقٍ ليست قراءةً: احتسابُها يُنتِجُ إعلاناً كاذباً يُطلَبُ لسطرٍ
    لا يُنفَّذُ. والعكسُ ليسَ ثغرةً: لا شيءَ يُقرأُ من تعليقٍ.
    """
    out: list[str] = []
    in_block = False
    for line in text.splitlines():
        result = []
        i = 0
        while i < len(line):
            two = line[i : i + 2]
            if in_block:
                if two == "*/":
                    in_block = False
                    i += 2
                    continue
                i += 1
                continue
            if two == "/*":
                in_block = True
                i += 2
                continue
            if two == "//":
                break
            result.append(line[i])
            i += 1
        out.append("".join(result))
    return "\n".join(out)


def scan_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for scan_root in SCAN_ROOTS:
        base = root / scan_root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix not in SCAN_SUFFIXES:
                continue
            if any(part in EXCLUDED_PARTS for part in path.parts):
                continue
            files.append(path)
    return files


def measure(root: Path) -> tuple[dict[tuple[str, str], set[str]], list[tuple[str, int, str]]]:
    """يُعيدُ: خريطةَ (متغيّرٍ · ملفٍّ) ⇒ أنماطٍ مقيسةٍ، وقائمةَ التحليلِ الرقميِّ."""
    reads: dict[tuple[str, str], set[str]] = {}
    numeric: list[tuple[str, int, str]] = []
    for path in scan_files(root):
        rel = path.relative_to(root).as_posix()
        if rel.startswith(CONFIG_PACKAGE_PREFIX):
            continue
        source = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
        for pattern in DIRECT_PATTERNS:
            for name in pattern.findall(source):
                reads.setdefault((name, rel), set()).add("direct")
        for pattern in BAG_PATTERNS:
            for name in pattern.findall(source):
                reads.setdefault((name, rel), set()).add("bag")
        for pattern in READER_PATTERNS:
            for name in pattern.findall(source):
                reads.setdefault((name, rel), set()).add("reader")
        for lineno, line in enumerate(source.splitlines(), start=1):
            if any(pattern.search(line) for pattern in NUMERIC_PATTERNS):
                numeric.append((rel, lineno, line.strip()))
    return reads, numeric


def declared_readers(registry: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    declared: dict[tuple[str, str], dict[str, Any]] = {}
    for var in registry["variables"]:
        for reader in var.get("readers", []):
            declared[(str(var.get("name")), str(reader.get("file")))] = reader
    return declared


class Gate:
    """بابٌ واحدٌ: اسمٌ وقائمةُ إخفاقاتٍ. لا بابَ يمرُّ بلا سؤالٍ مكتوبٍ."""

    def __init__(self, number: int, question: str) -> None:
        self.number = number
        self.question = question
        self.failures: list[str] = []

    def fail(self, message: str) -> None:
        self.failures.append(message)

    @property
    def passed(self) -> bool:
        return not self.failures


def run_gates(root: Path) -> list[Gate]:
    registry = load_registry(root)
    variables = variables_sorted(registry)
    reads, numeric = measure(root)
    declared = declared_readers(registry)
    gates: list[Gate] = []

    # ── 1) لا قراءةَ غيرَ مُسجَّلةٍ ────────────────────────────────────────
    g1 = Gate(1, "أكلُّ قراءةٍ مقيسةٍ في الشجرةِ مُعلَنةٌ في السجلِّ؟")
    for (name, rel), modes in sorted(reads.items()):
        if (name, rel) not in declared:
            g1.fail(f"قراءةٌ غيرُ مُسجَّلةٍ: {name} في {rel} (النمطُ: {'/'.join(sorted(modes))})")
    gates.append(g1)

    # ── 2) لا إعلانَ ميّتاً ──────────────────────────────────────────────
    g2 = Gate(2, "أكلُّ قارئٍ مُعلَنٍ حيٌّ في ملفِّهِ الآنَ؟")
    cache: dict[str, str] = {}
    for var in variables:
        name = str(var["name"])
        for reader in var.get("readers", []):
            rel = str(reader.get("file"))
            mode = str(reader.get("mode"))
            path = root / rel
            if not path.is_file():
                g2.fail(f"{name}: الملفُّ المُعلَنُ غيرُ موجودٍ — {rel}")
                continue
            if rel not in cache:
                cache[rel] = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
            source = cache[rel]
            if mode == "template":
                needle = str(reader.get("template", ""))
                if not needle:
                    g2.fail(f"{name}: نمطُ template بلا حقلِ `template` في {rel}")
                elif needle not in source:
                    g2.fail(f"{name}: القالبُ {needle!r} غائبٌ عن {rel}")
            elif name not in source:
                g2.fail(f"{name}: الاسمُ غائبٌ عن {rel} (إعلانٌ ميّتٌ · النمطُ {mode})")
    gates.append(g2)

    # ── 3) الأرتفاكتُ مُشتَقٌّ لا مكتوبٌ ─────────────────────────────────
    g3 = Gate(3, "أيطابقُ كلُّ أرتفاكتٍ مُشتَقٍّ إعادةَ توليدِهِ بايتاً بايتاً؟")
    for rel, expected in rendered_artifacts(registry).items():
        path = root / rel
        if not path.is_file():
            g3.fail(f"الأرتفاكتُ المُشتَقُّ مفقودٌ: {rel}")
            continue
        actual = path.read_text(encoding="utf-8")
        if actual != expected:
            first = next(
                (
                    i
                    for i, (a, b) in enumerate(
                        zip(actual.splitlines(), expected.splitlines()), start=1
                    )
                    if a != b
                ),
                min(len(actual.splitlines()), len(expected.splitlines())) + 1,
            )
            g3.fail(f"{rel} يخالفُ إعادةَ التوليدِ (أوّلُ فرقٍ في السطرِ {first})")
    gates.append(g3)

    # ── 4) سلامةُ السجلِّ بنيويّاً ────────────────────────────────────────
    g4 = Gate(4, "أسجلُّ المتغيّراتِ سليمٌ بنيويّاً بلا تكرارٍ ولا نقصٍ؟")
    seen: set[str] = set()
    for var in variables:
        name = str(var.get("name", ""))
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            g4.fail(f"اسمٌ غيرُ صالحٍ: {name!r}")
        if name in seen:
            g4.fail(f"اسمٌ مُكرَّرٌ في السجلِّ: {name}")
        seen.add(name)
        if var.get("type") not in VALID_TYPES:
            g4.fail(f"{name}: نوعٌ غيرُ معروفٍ {var.get('type')!r}")
        if var.get("required") not in VALID_REQUIRED:
            g4.fail(f"{name}: درجةُ إلزامٍ غيرُ معروفةٍ {var.get('required')!r}")
        scopes = var.get("scopes") or []
        if not scopes or any(s not in VALID_SCOPES for s in scopes):
            g4.fail(f"{name}: موضعُ استهلاكٍ غيرُ صالحٍ {scopes!r}")
        if not str(var.get("description_ar", "")).strip():
            g4.fail(f"{name}: بلا وصفٍ عربيٍّ — سجلٌّ بلا معنىً لا يُقرأُ")
        if not str(var.get("owner_item", "")).strip():
            g4.fail(f"{name}: بلا بندِ عملٍ مالكٍ")
        readers = var.get("readers") or []
        if not readers:
            g4.fail(f"{name}: بلا قارئٍ واحدٍ — متغيّرٌ لا يُقرأُ لا يُعلَنُ")
        for reader in readers:
            if reader.get("mode") not in VALID_MODES:
                g4.fail(f"{name}: نمطُ قراءةٍ غيرُ معروفٍ {reader.get('mode')!r}")
        if var.get("secret") and var.get("default") is not None:
            g4.fail(f"{name}: سرٌّ لهُ قيمةٌ افتراضيّةٌ — سرٌّ افتراضيُّهُ معروفٌ ليسَ سرّاً")
        # والعكسُ لا يُلزَمُ: وصلةُ Postgres سرٌّ وهيَ `postgres_url` بنوعِها — فحصُ
        # الشكلِ يبقى قائماً عليها. أمّا `secret_material` فسرٌّ بحدِّ تعريفِهِ.
        if var.get("type") == "secret_material" and not var.get("secret"):
            g4.fail(f"{name}: نوعُهُ مادّةٌ سرِّيّةٌ ولم يُعلَنْ سرّاً")
    gates.append(g4)

    # ── 5) الاسمُ يُلزِمُ نوعَهُ ──────────────────────────────────────────
    g5 = Gate(5, "أيوافقُ نوعُ كلِّ متغيّرٍ ما يُعلِنُهُ اسمُهُ؟")
    for var in variables:
        name = str(var.get("name", ""))
        declared_type = str(var.get("type"))
        allowed = EXACT_TYPE_RULES.get(name)
        if allowed is None:
            for suffix, types in SUFFIX_TYPE_RULES:
                if name.endswith(suffix):
                    allowed = types
                    break
        if allowed and declared_type not in allowed:
            g5.fail(
                f"{name}: نوعُهُ {declared_type!r} ولاحقتُهُ تُلزِمُ {' أو '.join(allowed)}"
            )
    gates.append(g5)

    # ── 6) لا تحليلَ رقميّاً عارياً (سجلٌّ مغلقٌ في الاتّجاهَينِ) ──────────
    g6 = Gate(6, "أزالَ التحليلُ الرقميُّ العاري من شيفرةِ الإنتاجِ؟")
    exceptions = registry.get("numeric_parse_exceptions") or []
    exception_files = {str(e.get("file")) for e in exceptions}
    for entry in exceptions:
        if not str(entry.get("reason_ar", "")).strip() or not str(entry.get("item", "")).strip():
            g6.fail(f"استثناءٌ بلا سببٍ مكتوبٍ أو بندٍ: {entry.get('file')}")
    live_numeric_files: set[str] = set()
    for rel, lineno, text in numeric:
        if rel.startswith(CONFIG_PACKAGE_PREFIX):
            continue
        if "/__tests__/" in rel or rel.endswith(".test.ts"):
            continue
        live_numeric_files.add(rel)
        if rel not in exception_files:
            g6.fail(f"تحليلٌ رقميٌّ عارٍ: {rel}:{lineno} — {text[:90]}")
    for rel in sorted(exception_files - live_numeric_files):
        g6.fail(f"استثناءٌ ميّتٌ يجبُ حذفُهُ: {rel} لا موضعَ تحليلٍ فيهِ")
    gates.append(g6)

    # ── 7) لا سرَّ في المثالِ ─────────────────────────────────────────────
    g7 = Gate(7, "أكلُّ سرٍّ في `.env.example` نائبٌ لا قيمةٌ؟")
    example_path = root / ENV_EXAMPLE_PATH
    if not example_path.is_file():
        g7.fail(f"{ENV_EXAMPLE_PATH} مفقودٌ")
    else:
        text = example_path.read_text(encoding="utf-8")
        assignments = dict(
            re.findall(r"^([A-Z][A-Z0-9_]*)=(.*)$", text, flags=re.MULTILINE)
        )
        for var in variables:
            name = str(var["name"])
            if name not in assignments:
                g7.fail(f"{name}: مُسجَّلٌ ولا سطرَ لهُ في {ENV_EXAMPLE_PATH}")
            elif var.get("secret") and assignments[name] != EXPECTED_SECRET_PLACEHOLDER:
                g7.fail(
                    f"{name}: سرٌّ بقيمةٍ مكتوبةٍ في المثالِ"
                    f" — يجبُ {EXPECTED_SECRET_PLACEHOLDER}"
                )
            elif var.get("secret") and SECRET_PLACEHOLDER != EXPECTED_SECRET_PLACEHOLDER:
                # المُولِّدُ يُصدِرُ نائباً غيرَ المُتوقَّعِ: البابُ 3 يمرُّ (المُشتَقُّ
                # مطابقٌ لمُولِّدِهِ) وهذا البابُ يعضُّ — وهوَ عينُ سببِ الأدبَينِ.
                g7.fail(
                    f"نائبُ المُولِّدِ {SECRET_PLACEHOLDER!r} يخالفُ"
                    f" المُتوقَّعَ {EXPECTED_SECRET_PLACEHOLDER!r}"
                )
    gates.append(g7)

    # ── 8) القارئُ غيرُ المباشرِ مربوطٌ بالقياسِ ────────────────────────────
    g8 = Gate(8, "أمُعلَنٌ كلُّ قارئٍ غيرِ مباشرٍ لا يراهُ الماسحُ، وحاضرٌ حرفاً؟")
    for rel, names in INDIRECT_BINDINGS:
        path = root / rel
        if not path.is_file():
            g8.fail(f"القارئُ غيرُ المباشرِ المُعلَنُ غائبٌ: {rel}")
            continue
        source = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
        for name in names:
            if name not in source:
                g8.fail(f"{name}: لا يُقرأُ حرفاً في {rel} — الرابطُ انفكَّ")
            reader = declared.get((name, rel))
            if reader is None:
                g8.fail(f"{name}: قراءتُهُ في {rel} غيرُ مُعلَنةٍ في السجلِّ")
            elif str(reader.get("mode")) != "default_literal":
                g8.fail(
                    f"{name} في {rel}: النمطُ المُعلَنُ {reader.get('mode')!r}"
                    " والمقيسُ قيمةٌ افتراضيّةٌ في دالّةٍ (default_literal)"
                )
    gates.append(g8)

    return gates


def print_measured(root: Path) -> None:
    reads, numeric = measure(root)
    payload: dict[str, Any] = {"reads": {}, "numeric": []}
    for (name, rel), modes in sorted(reads.items()):
        payload["reads"].setdefault(name, []).append(
            {"file": rel, "mode": "direct" if "direct" in modes else sorted(modes)[0]}
        )
    payload["numeric"] = [
        {"file": rel, "line": lineno, "text": text} for rel, lineno, text in numeric
    ]
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="دلالاتُ مخطَّطِ الإعدادِ (الفحصُ 18)")
    parser.add_argument("--root", default=".", help="جذرُ المستودعِ")
    parser.add_argument("--print-measured", action="store_true", help="يطبعُ المقيسَ JSON")
    parser.add_argument("--check", action="store_true", help="يُشغِّلُ الأبوابَ الثمانيةَ")
    args = parser.parse_args()
    root = Path(args.root).resolve()

    if args.print_measured:
        print_measured(root)
        return 0

    try:
        gates = run_gates(root)
    except RegistryError as exc:
        print(f"{RED}✗{RESET} {exc}")
        return 1

    failed = [g for g in gates if not g.passed]
    for gate in gates:
        if gate.passed:
            print(f"  {GRN}✓{RESET} البابُ {gate.number}: {gate.question}")
        else:
            print(f"  {RED}✗{RESET} البابُ {gate.number}: {gate.question}")
            for message in gate.failures[:25]:
                print(f"      {RED}·{RESET} {message}")
            if len(gate.failures) > 25:
                print(f"      … و{len(gate.failures) - 25} إخفاقاً آخرَ")
    if failed:
        print(
            f"\n{RED}✗{RESET} مخطَّطُ الإعدادِ: {len(failed)} بابٍ فاشلٍ من {len(gates)}."
            f" المرجعُ: {REGISTRY_PATH} · docs/08-infrastructure/CONFIG_SCHEMA.md"
        )
        return 1
    print(f"\n{GRN}✓{RESET} مخطَّطُ الإعدادِ: الأبوابُ الثمانيةُ كلُّها مرَّت.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
