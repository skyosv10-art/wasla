"""تدقيقُ استدعاءِ الاختباراتِ **بمعيارٍ مستقلٍّ** عن مُشتَقِّ المُشغِّلِ. (M0-35)

    python3 audit_test_invocation.py --scan-lines <root>
        يطبعُ كلَّ سطرٍ يحملُ **صيغةَ** `pnpm … -r … test` خارجَ المُشغِّلِ —
        بلا `rg`، فالأداةُ الغائبةُ كانت تُخرِجُ قائمةً فارغةً فحارساً أخضرَ.

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
import vitest_config_semantics as vcs  # noqa: E402  (M0-42 — دلالةُ الإعدادِ لا نصُّهُ)

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


# ── مسحُ الأسطرِ: صيغةُ الاستدعاءِ في أيِّ ملفٍّ نصّيٍّ ─────────────────────
# ولمَ هنا لا بـ`rg`؟ لأنَّ الحارسَ كانَ يمسحُ بـ`rg … 2>/dev/null || true`،
# و`rg` **غيرُ مُثبَّتٍ على عاملِ GitHub**: فكانَ «الأمرُ غيرُ موجودٍ» يُبتلَعُ
# فتخرجُ القائمةُ فارغةً فيمرُّ البابُ الأوّلُ أخضرَ على لا شيءٍ. وذاكَ مقيسٌ لا
# مُتخيَّلٌ: أوّلُ حكمٍ حقيقيٍّ من CI (سيرُ 34873584143) أسقطَ حالةَ الطفرةِ (8)
# «متوقع fail وجاء pass» فيما هيَ خضراءُ محلّيّاً — أي **مُحلّيٌّ يُخالِفُ CI**، وهوَ
# عينُ العطبِ الذي أُنشئَ هذا الحارسُ لمنعِهِ. و`python3` شرطُ تشغيلِ البوّابةِ
# أصلاً، فالمسحُ بهِ يُلغي أداةً ثالثةً من مسارِ الثقةِ.
_SCAN_SKIP_DIRS = {".git", "node_modules", "dist", "docs", ".pnpm-store", "coverage"}
_SCAN_SKIP_FILES = {
    "scripts/run-tests.sh",
    "scripts/checks/validate-test-invocation.sh",
    "scripts/checks/test-governance.sh",
    "scripts/checks/lib/gov-cases-test-invocation.sh",
}
# ── صيغةُ الاستدعاءِ **بمقاطعَ** لا بأسطرٍ (M0-42) ─────────────────────────
# قِيسَ (وثيقةُ دليلِ M0-42 · الحالةُ ب) أنَّ الاستدعاءَ الثانيَ يمرُّ إذا لم
# يبدأِ السطرُ بـ`pnpm` حرفاً: `cd pkg && pnpm -r test` و`npx pnpm -r test`
# ونداءُ pnpm بمسارٍ مطلقٍ — كلُّها كانت تُفلِتُ لأنَّ المعيارَ كانَ «بدايةَ
# السطرِ» لا «بدايةَ الأمرِ». فصارَ السطرُ يُقسَّمُ إلى مقاطعَ أوامرَ
# (بـ`&&` · `||` · `;` · `|`)، ويُحكَمُ على **أوّلِ كلمةٍ من كلِّ مقطعٍ** بعدَ
# تجريدِ إسناداتِ البيئةِ والمُغلِّفاتِ المعروفةِ (`npx` · `corepack` ·
# `exec` · `command` · `sudo` · `env`). فمَن يذكرُ (`echo pnpm -r test`) لا
# يُعاقَبُ، ومَن يستدعي (`cd pkg && pnpm -r test`) يُرفَضُ.
_SEGMENT_SPLIT = re.compile(r"&&|\|\||;|\|")
_ENV_ASSIGN = re.compile(r"^[A-Za-z_]\w*=(?:\"[^\"]*\"|'[^']*'|[^\s]+)\s+")
_WRAPPER = re.compile(r"^(npx|corepack|exec|command|sudo|env)\s+")
_SHELL_C = re.compile(r"^(?:ba|z|da)?sh(?:\.[^\s]*)?$")
# الشكلُ داخلَ `sh -c "…"` — الاستدعاءُ بنصٍّ مقتبسٍ يُحكَمُ عليهِ كذلك.
_INNER_FORM = re.compile(r"pnpm\b[^#&|;]*\s(?:-r\b|--recursive\b)[^#&|;]*\btest\b")


def _is_pnpm_invocation(seg: str) -> bool:
    """أيبدأُ هذا المقطعُ باستدعاءِ `pnpm … -r … test`؟"""
    while True:
        m = _ENV_ASSIGN.match(seg)
        if m:
            seg = seg[m.end():]
            continue
        m = _WRAPPER.match(seg)
        if m:
            seg = seg[m.end():]
            continue
        break
    m = re.match(r"^(\S+)", seg)
    if not m:
        return False
    cmd = m.group(1)
    rest = seg[m.end():]
    if cmd != "pnpm" and not cmd.endswith("/pnpm"):
        # `sh -c "pnpm -r test"` — قشرةٌ بنصٍّ محكمٍ يحملُ الشكلَ
        if _SHELL_C.match(cmd) and re.search(r"\s-c\s", seg):
            return bool(_INNER_FORM.search(seg))
        return False
    hash_at = rest.find("#")
    if hash_at != -1:
        rest = rest[:hash_at]
    toks = re.findall(r"[^\s\"'=&|;]+", rest)
    return any(t in ("-r", "--recursive") for t in toks) and "test" in toks


def _line_has_second_invocation(line: str) -> bool:
    work = line.lstrip()
    if work.startswith("- "):
        work = work[2:].lstrip()
    if work.startswith("run:"):
        work = work[4:].lstrip()
        if work[:1] in ("|", ">"):
            return False  # علامةُ كتلةٍ — الأمرُ في السطرِ التالي
    for seg in _SEGMENT_SPLIT.split(work):
        if seg.strip() and _is_pnpm_invocation(seg.strip()):
            return True
    return False


def scan_lines(root: str) -> list[str]:
    """كلُّ سطرٍ يحملُ **صيغةَ** استدعاءِ الاختباراتِ خارجَ المُشغِّلِ.

    والمخفيُّ يُمسَحُ بقصدٍ (`.github/workflows/` · `.gitlab-ci.yml`): كانَ الحارسُ
    يعمى عنهُما فسقطَ أوّلُ موضعٍ يُكرَّرُ فيهِ الاستدعاءُ. والوثائقُ (`docs/` ·
    `*.md`) خارجَ المسحِ لأنَّ منعَ **ذكرِ** العطبِ يُعاقِبُ التوثيقَ.
    """
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SCAN_SKIP_DIRS]
        for name in filenames:
            if name.endswith(".md"):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            if rel in _SCAN_SKIP_FILES or os.path.islink(full):
                continue
            try:
                with open(full, encoding="utf-8", errors="replace") as fh:
                    for n, line in enumerate(fh, 1):
                        if _line_has_second_invocation(line):
                            out.append("./%s:%d:%s" % (rel, n, line.rstrip("\n")))
            except (OSError, ValueError):
                # وتعذُّرُ القراءةِ **يُعلَنُ** ولا يُبتلَعُ: ملفٌّ لا يُقرأُ ليسَ ملفّاً نظيفاً.
                out.append("./%s:0:<تعذَّرَ فتحُ الملفِّ للمسحِ>" % rel)
    return sorted(out)


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
    """ملفّاتُ الاختبارِ التي يُشغِّلُها الإعدادُ الافتراضيُّ **فعلاً** (M0-42).

    كانَ البابُ يستثني ملفَّ بوّابةٍ إذا وُجِدَ وسمُ `{integration,e2e}`
    في **نصِّ** الإعدادِ — فيعتمُ عن الوسمِ في تعليقٍ، وعن وسمٍ في نمطِ
    استثناءٍ لا يُطابِقُ موضعَ الملفِّ، فيُسقِطُ DDL من الإغلاقِ ويُخضِرُ
    الحارسُ على مَشهدٍ يُنفِّذُهُ. فصارَ الحكمُ لدلالةِ الإعدادِ
    (قارئُ `vitest_config_semantics`) ولأثرِها على الملفِّ بعينِهِ.
    """
    pkg_dir = os.path.join(root, pkg)
    cfg = os.path.join(pkg_dir, "vitest.config.ts")
    files = []
    for f in glob.glob(os.path.join(pkg_dir, "src", "**", "*.ts"), recursive=True):
        b = os.path.basename(f)
        if not _TEST_FILE.search(b):
            continue
        files.append(f)
    if not os.path.exists(cfg):
        return files  # لا إعدادَ ⇒ مفهومُ Vitest الافتراضيُّ
    rels = [os.path.relpath(f, pkg_dir).replace(os.sep, "/") for f in files]
    include, exclude, has_include = vcs.default_run_globs(cfg)
    keep = [f for f, r in zip(files, rels) if vcs.runs_file(include, exclude, r, has_include)]
    return keep


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
        print("usage: audit_test_invocation.py --scan-lines|--scan-scripts|--audit-groups [root]")
        return 2
    mode = sys.argv[1]
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    if mode == "--scan-lines":
        for line in scan_lines(root):
            print(line)
        return 0
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
