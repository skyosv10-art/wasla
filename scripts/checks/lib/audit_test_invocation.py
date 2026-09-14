"""تدقيقُ استدعاءِ الاختباراتِ **بمعيارٍ مستقلٍّ** عن مُشتَقِّ المُشغِّلِ. (M0-35)

    python3 audit_test_invocation.py --scan-scripts <root>
        يطبعُ كلَّ مدخلِ `scripts.*` في أيِّ `package.json` يستدعي
        `pnpm … -r … test` مباشرةً — أي استدعاءً ثانياً خارجَ المُشغِّلِ.

    python3 audit_test_invocation.py --audit-groups <root>  < groups
        يقرأُ خَرْجَ `run-tests.sh --print-groups` ويطبعُ سطراً لكلِّ خُلْفٍ.
        **ولا خَرْجَ يعني لا خُلْفَ.**

ولمَ لا يُعيدُ استخدامَ `test_groups.py`؟ لأنَّ منطقاً يُقاسُ بنفسِهِ **يُصادِقُ
على نفسِهِ**: يمرُّ دائماً ولو كانَ خطأً. فالمعيارانِ هنا مستقلّانِ عنهُ:

* **الاكتمالُ** من `package.json` وحدَهُ: كلُّ حزمةٍ لها `test` تَظهرُ في شِقٍّ
  **واحدٍ** لا صفرٍ ولا اثنَينِ.
* **تسلسلُ مالكي المخطَّطِ** من **إغلاقِ الاستيرادِ**: يُبدَأُ من ملفّاتِ
  الاختبارِ التي يُشغِّلُها الإعدادُ الافتراضيُّ، وتُتبَّعُ الاستيراداتُ النسبيّةُ
  حتّى تُستنفَدَ، ثمَّ يُسألُ: أفي الإغلاقِ ملفٌّ **يُنفِّذُ** DDL على مُشغِّلٍ؟

## لماذا «يُنفِّذُ» لا «يذكرُ»

أوّلُ صياغةٍ عدَّت **ذكرَ** `CREATE TABLE` في أيِّ ملفٍّ دليلاً، فأشعلَت 12 حزمةً
بريئةً: `schema-drift.test.ts` يحملُ `CREATE TABLE` **داخلَ تعبيرٍ نمطيٍّ** يقرأُ
بهِ نصَّ العقدِ بلا قاعدةٍ، و`pg-harness.ts` يحملُ DDL حقيقيّاً **ولا يستوردُهُ
إلّا ملفُّ تكاملٍ مستثنىً**. وحارسٌ يُشعِلُ اثنتي عشرةَ حزمةً بريئةً حارسٌ
**يُعطَّلُ أو يُسكَتُ في أوّلِ أسبوعٍ**، فيصيرُ حمايةً مكتوبةً بلا إنفاذٍ. فوجبَ
شرطانِ معاً: أن يكونَ الملفُّ **مبلوغاً** من اختبارٍ يجري فعلاً، وأن يكونَ فيهِ
DDL **مُمرَّراً إلى مُشغِّلٍ** (`pool.query(…)` · `client.query(…)` ·
`db.execute(…)` · `sql\u0060…\u0060`) لا مجرَّدَ نصٍّ.

الحدُّ المُعلَنُ: تُتبَّعُ الاستيراداتُ **النسبيّةُ** داخلَ الحزمةِ. فحزمةٌ
تستوردُ مِرقاةً تُنشئُ مخطَّطاً من حزمةٍ **أخرى** باسمِها (`@wasla/…`) قد تُفلِتُ.
ولا حزمةَ كذلكَ اليومَ — كلُّ مِرقاةٍ في حزمتِها، مقيسٌ — والحدُّ مُعلَنٌ لا مسكوتٌ
عنهُ.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

# DDL يُذكَرُ نصّاً في أيِّ مكانٍ؛ وما يُهِمُّ أن يُمرَّرَ إلى مُشغِّلٍ.
_DDL_TEXT = re.compile(
    r"\bDROP\s+TABLE\b|\bCREATE\s+TABLE\b|\bTRUNCATE\s+TABLE\b|\bALTER\s+TABLE\b",
    re.IGNORECASE,
)
# مُشغِّلٌ حقيقيٌّ: تمريرُ نصٍّ إلى قاعدةٍ عبرَ مُستقبِلٍ مُسمّىً. والصيغةُ مُقيَّدةٌ
# بمُعرِّفٍ قبلَ النقطةِ بقصدٍ: صياغةٌ أرخى (`sql` + علامةُ قالبٍ) طابقَت
# «`contracts/schema.sql`» في **تعليقٍ**، فأشعلَت اثنتَي عشرةَ حزمةً بريئةً.
_EXECUTOR = re.compile(
    r"\b\w+\.query\s*\(|\b\w+\.execute\s*\(|\b\w+\.unsafe\s*\("
    r"|\bapply[A-Za-z]*Schema\s*\(",
)
# ووصلةٌ حقيقيّةٌ في الإغلاقِ: DDL بلا سبيلٍ إلى قاعدةٍ نصٌّ لا سباقٌ.
_CONNECTION = re.compile(r"\bDATABASE_URL\b|\bconnectionString\b")
_GATE_FILE = re.compile(r"\.(integration|e2e)\.test\.ts$")
_TEST_FILE = re.compile(r"\.test\.ts$")
_IMPORT = re.compile(
    r"""(?:from|import)\s*\(?\s*["'](\.[^"']+)["']|import\s+["'](\.[^"']+)["']"""
)
_RECURSIVE_TEST = re.compile(r"\bpnpm\b[^&|;]*(?:-r\b|--recursive\b)[^&|;]*\btest\b")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from workspace_packages import (  # noqa: E402
    all_packages,
    packages_with_test as _ws_packages_with_test,
    pnpm_packages,
)


# ── مسحُ مداخلِ `scripts.*` ────────────────────────────────────────────────
def scan_scripts(root: str) -> list[str]:
    out: list[str] = []
    for pj in [os.path.join(root, "package.json")] + [
        os.path.join(root, d, "package.json") for d in all_packages(root)
    ]:
        if not os.path.exists(pj):
            continue
        with open(pj, encoding="utf-8") as fh:
            scripts = json.load(fh).get("scripts") or {}
        for name, body in scripts.items():
            if _RECURSIVE_TEST.search(body or ""):
                out.append(
                    "%s: scripts.%s = %s" % (os.path.relpath(pj, root), name, body)
                )
    return out


# ── اكتمالُ الشِّقَّينِ ────────────────────────────────────────────────────
def packages_with_test(root: str) -> set[str]:
    """الجردُ من `pnpm-workspace.yaml` — لا نمطَ مكتوبٌ بيدٍ في هذا الملفِّ.

    كانَ هنا `_ROOTS = ("packages", "services", "bots")` بنمطِ `*/package.json`،
    وهوَ النمطُ نفسُهُ الذي كانَ في مُشتَقِّ الشِّقَّينِ — **فكانَ الحارسُ يُصادِقُ
    المُشتَقَّ بعطبِ المُشتَقِّ نفسِهِ**، ومرَّ أخضرَ وأربعَ عشرةَ حزمةً ساقطةً
    (`packages/contracts/*`) لا تُشغَّلُ أصلاً. (M0-35 · القياسُ في
    `docs/12-testing/test-invocation-evidence/2026-09-14-m0-35.md`)
    """
    return set(_ws_packages_with_test(root))


def inventory_drift(root: str) -> list[str]:
    """مُصادَقةٌ **خارجيّةٌ** على الجردِ من `pnpm` نفسِهِ — الحَكَمُ لا نسخةٌ ثانيةٌ منّا.

    لولا هذا لكانَ قارئُنا لـ`pnpm-workspace.yaml` مصدرَ حقيقةٍ **بلا مُكذِّبٍ**:
    خطأٌ في قراءةِ نمطٍ يُنتِجُ جرداً ناقصاً يوافقُ نفسَهُ. وتعذُّرُ `pnpm` **إخفاقٌ
    لا تخطٍّ**.
    """
    ours = set(all_packages(root))
    theirs = set(pnpm_packages(root))
    problems: list[str] = []
    only_pnpm = sorted(theirs - ours)
    if only_pnpm:
        problems.append(
            "حزمٌ يراها `pnpm` ولا يراها جردُنا — **فقد تسقطُ من الاختبارِ صامتةً**: "
            + " · ".join(only_pnpm)
        )
    only_ours = sorted(ours - theirs)
    if only_ours:
        problems.append(
            "حزمٌ في جردِنا لا يراها `pnpm` — جردٌ يصفُ ما لا يُشغَّلُ: "
            + " · ".join(only_ours)
        )
    return problems


# ── إغلاقُ الاستيرادِ من الاختباراتِ المُشغَّلةِ افتراضيّاً ─────────────────
def _resolve(spec: str, from_file: str) -> str | None:
    base = os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    for cand in (base, base + ".ts", os.path.join(base, "index.ts")):
        if cand.endswith(".ts") and os.path.isfile(cand):
            return cand
    for ext in (".ts", "/index.ts"):
        cand = re.sub(r"\.js$", "", base) + ext
        if os.path.isfile(cand):
            return cand
    return None


def _default_test_files(root: str, pkg: str) -> list[str]:
    cfg = os.path.join(root, pkg, "vitest.config.ts")
    excludes_gate = False
    if os.path.exists(cfg):
        with open(cfg, encoding="utf-8") as fh:
            excludes_gate = "{integration,e2e}" in fh.read()
    files = []
    for f in glob.glob(os.path.join(root, pkg, "src", "**", "*.ts"), recursive=True):
        b = os.path.basename(f)
        if not _TEST_FILE.search(b):
            continue
        if excludes_gate and _GATE_FILE.search(b):
            continue
        files.append(f)
    return files


_EXPORT_DEF = re.compile(
    r"^export\s+(?:async\s+)?(?:function\s+|const\s+|let\s+|class\s+)(\w+)",
    re.MULTILINE,
)
_NAMED_IMPORT = re.compile(
    r"import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*[\"']([^\"']+)[\"']"
)
_IDENT = re.compile(r"\b([A-Za-z_$][\w$]*)\s*\(")


def _spans(src: str) -> dict[str, str]:
    """مدى كلِّ تصديرٍ: من رأسِهِ إلى رأسِ التصديرِ التالي.

    تقريبٌ نصّيٌّ مُعلَنٌ — لا مُحلِّلَ صياغةٍ هنا بقصدٍ: حارسُ حوكمةٍ يجبُ أن
    يعملَ بـpython3 وحدَهُ بلا سلسلةِ أدواتٍ، ومُحلِّلُ TypeScript كانَ سيُدخِلَ
    اعتماديّةً إلى بوّابةٍ يجبُ أن تركضَ قبلَ `pnpm install`.
    """
    heads = [(m.start(), m.group(1)) for m in _EXPORT_DEF.finditer(src)]
    out: dict[str, str] = {}
    for i, (pos, name) in enumerate(heads):
        stop = heads[i + 1][0] if i + 1 < len(heads) else len(src)
        out[name] = src[pos:stop]
    return out


def _top_level(src: str) -> str:
    """ما خارجَ مدَياتِ التصديرِ — يجري بمجرَّدِ الاستيرادِ فيُحسَبُ دائماً."""
    heads = [m.start() for m in _EXPORT_DEF.finditer(src)]
    return src[: heads[0]] if heads else src


_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"(?<![:\"'\\])//[^\n]*")


def _strip_comments(src: str) -> str:
    """يُجرَّدُ التعليقُ قبلَ القياسِ — **وإلّا قِيسَ الشرحُ سلوكاً**.

    وهذا ليسَ تجميلاً: ثلاثُ خدماتٍ أُشعِلَت لأنَّ رأسَ `db/migrate.ts` **يشرحُ**
    `pool.query(ddl)` و`CREATE TABLE` في تعليقٍ توثيقيٍّ. فحارسٌ يقرأُ التعليقَ
    شفرةً يُعاقِبُ الوثيقةَ ويُكافئُ الصمتَ — وذاكَ ضدُّ قانونِ التوثيقِ في
    المستودعِ.

    الحدُّ المُعلَنُ: تجريدٌ نصّيٌّ، فـ`/*` داخلَ نصٍّ حرفيٍّ قد يُقصَّ خطأً. ولا
    حالةَ كذلكَ اليومَ، والأثرُ في الاتّجاهِ الآمنِ للقياسِ (يُقصُّ نصٌّ فيُقَلُّ
    الإشعالُ الزائفُ لا الحقيقيُّ: DDL المُنفَّذُ يعيشُ في قالبٍ لا في `/*`).
    """
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", src))


def _runs_ddl(text: str) -> bool:
    stripped = _strip_comments(text)
    return bool(_DDL_TEXT.search(stripped) and _EXECUTOR.search(stripped))


def ddl_runners(root: str, pkg: str) -> list[str]:
    """ملفّاتٌ **مبلوغةٌ فعلاً** من اختبارِ الحزمةِ الافتراضيِّ وتُنفِّذُ DDL.

    يُتبَّعُ **الاسمُ** لا الملفُّ: ملفٌّ يُصدِّرُ ثابتَ مسارٍ وفيهِ دالّةُ ترحيلٍ
    تُنفِّذُ DDL **ليسَ سباقاً** إن لم يُستورَد إلّا الثابتُ. وأوّلُ صياغةٍ تبِعَتِ
    الملفَّ فأشعلَت ثلاثَ خدماتٍ تستوردُ `SCHEMA_CONTRACT_PATH` وحدَهُ — وحارسٌ
    يُشعِلُ البريءَ يُسكَتُ في أوّلِ أسبوعٍ فيصيرُ حمايةً بلا إنفاذٍ.

    الحدُّ المُعلَنُ: تقريبٌ نصّيٌّ بمدَياتِ التصديرِ وبنداءٍ **واحدِ** الدرجةِ من
    كلِّ مدىً. فاسمٌ يُصدَّرُ ثمَّ يُنادي محلّيّاً **غيرَ مُصدَّرٍ** يُنفِّذُ DDL قد
    يُفلِتُ، وكذا الاستيرادُ بالاسمِ من حزمةٍ أخرى (`@wasla/…`). ولا حالةَ كذلكَ
    اليومَ — مقيسٌ — والحدُّ مُعلَنٌ لا مسكوتٌ عنهُ.
    """
    hits: list[str] = []
    connected = False
    seen: set[tuple[str, str]] = set()
    # عنصرُ العملِ: (الملفُّ، الاسمُ المطلوبُ) — و`*` يعني الملفَّ كلَّهُ (مَدخَلٌ).
    stack: list[tuple[str, str]] = [
        (f, "*") for f in _default_test_files(root, pkg)
    ]
    cache: dict[str, str] = {}
    while stack:
        f, want = stack.pop()
        f = os.path.normpath(f)
        if (f, want) in seen or not os.path.isfile(f):
            continue
        seen.add((f, want))
        if f not in cache:
            with open(f, encoding="utf-8", errors="replace") as fh:
                cache[f] = fh.read()
        src = cache[f]
        if _CONNECTION.search(src):
            connected = True

        spans = _spans(src)
        scope = src if want == "*" else (_top_level(src) + spans.get(want, ""))
        if _runs_ddl(scope):
            hits.append(os.path.relpath(f, root))

        # خريطةُ الاسمِ ← وحدتِهِ، للاستيراداتِ النسبيّةِ وحدَها.
        imported: dict[str, str] = {}
        for m in _NAMED_IMPORT.finditer(src):
            spec = m.group(2)
            if not spec.startswith("."):
                continue
            for raw in m.group(1).split(","):
                nm = raw.strip().split(" as ")[0].strip().removeprefix("type ").strip()
                if nm:
                    imported[nm] = spec
        for m in _IMPORT.finditer(src):
            spec = m.group(1) or m.group(2)
            imported.setdefault("*%s" % spec, spec)

        # من المَدخَلِ: يُتبَعُ كلُّ مُستورَدٍ. ومن مدىً: ما يُنادى فيهِ وحدَهُ.
        wanted_names = (
            list(imported)
            if want == "*"
            else [n for n in {mm.group(1) for mm in _IDENT.finditer(scope)} if n in imported]
        )
        for nm in wanted_names:
            spec = imported[nm]
            nxt = _resolve(spec, f)
            if nxt:
                stack.append((nxt, "*" if nm.startswith("*") else nm))

    # DDL بلا سبيلٍ إلى قاعدةٍ في الإغلاقِ كلِّهِ نصٌّ لا تنفيذٌ.
    return sorted(set(hits)) if connected else []


def audit_groups(root: str, text: str) -> list[str]:
    par: list[str] = []
    ser: list[str] = []
    saw_ok = False
    for raw in text.splitlines():
        if not raw.strip():
            continue
        kind, _, rest = raw.partition("\t")
        if kind == "PARALLEL":
            par.append(rest)
        elif kind == "SERIAL":
            ser.append(rest)
        elif kind == "OK":
            saw_ok = True

    problems: list[str] = list(inventory_drift(root))

    # خَرْجٌ مقطوعٌ يُقرأُ إخفاقاً لا نجاحاً، وإلّا كانَ سكوتُ المُشتَقِّ يُنتِجُ
    # حارساً أخضرَ على لا شيءَ — وهيَ العلّةُ التي أنشأَت هذا الحارسَ.
    if not saw_ok:
        return ["خَرْجُ الشِّقَّينِ بلا وسمِ خِتامٍ (`OK`) — مقطوعٌ، ولا يُقرأُ نجاحاً."]

    both = sorted(set(par) & set(ser))
    if both:
        problems.append("حزمٌ في الشِّقَّينِ معاً (فتُشغَّلُ مرّتَينِ): " + " · ".join(both))

    declared = set(par) | set(ser)
    on_disk = packages_with_test(root)

    missing = sorted(on_disk - declared)
    if missing:
        problems.append(
            "حزمٌ لها `test` وسقطَت من الشِّقَّينِ — **فلا تُختبَرُ صامتةً**: "
            + " · ".join(missing)
        )

    phantom = sorted(declared - on_disk)
    if phantom:
        problems.append(
            "حزمٌ مُعلَنةٌ في الشِّقَّينِ ولا `test` لها على القرصِ: " + " · ".join(phantom)
        )

    if not ser:
        problems.append(
            "الشِّقُّ المُسلسَلُ فارغٌ — وفي المستودعِ حزمُ بوّاباتٍ تملكُ مخطَّطاً: "
            "الاشتقاقُ معطوبٌ."
        )

    leaked = []
    for pkg in sorted(set(par)):
        hits = ddl_runners(root, pkg)
        if hits:
            leaked.append("%s (%s)" % (pkg, hits[0]))
    if leaked:
        problems.append(
            "حزمٌ تُنفِّذُ DDL في اختبارِها الافتراضيِّ وهيَ في الشِّقِّ المتوازي "
            "— فتتسابقُ على القاعدةِ: " + " · ".join(leaked)
        )

    return problems


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: audit_test_invocation.py --scan-scripts|--audit-groups [root]")
        return 2
    mode = sys.argv[1]
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    if mode == "--scan-scripts":
        for line in scan_scripts(root):
            print(line)
        return 0
    if mode == "--audit-groups":
        for line in audit_groups(root, sys.stdin.read()):
            print(line)
        return 0
    print("وضعٌ غيرُ معروفٍ: %s" % mode)
    return 2


if __name__ == "__main__":
    sys.exit(main())
