"""قراءةُ **دلالةِ** إعدادِ Vitest من ملفِّه — لا وجودِ نصٍّ فيهِ. (M0-42)

    from vitest_config_semantics import default_run_globs, runs_file
    include, exclude, has_include = default_run_globs(cfg_path)

لماذا هذا الملفُّ؟ لأنَّ بابَينِ اثنَينِ في حارسِ استدعاءِ الاختباراتِ
(الفحصُ 14) كانا يقيسانِ **نصَّ** إعدادِ الحزمةِ لا دلالتَهُ:

* `test_groups.py` يُعلِمُ الحزمةَ بوّابةً إذا ظهرَ في نصِّ الإعدادِ وسمُ
  `{integration,e2e}` — **حتى لو كانَ في تعليقٍ**، وحتى لو كانَ في نمطِ
  استثناءٍ لا يُطابِقُ موضعَ ملفِّ البوّابةِ الفعليَّ.
* `audit_test_invocation.py` يستثني ملفّاتِ البوّاباتِ من إغلاقِ الاستيرادِ
  بالمعيارِ النصّيِّ نفسِهِ.

فقِيسَ على مَشهدٍ صناعيٍّ (الحالةُ أ في وثيقةِ دليلِ M0-42): إعدادٌ يحملُ
الوسمَ **في تعليقٍ** ونمطَ ضمٍّ يبتلِعُ ملفَّ بوّابةٍ — فصُنِّفَتِ الحزمةُ
متوازيةً، واستُبعدَ الملفُّ من إغلاقِ الاستيرادِ، والحارسُ أخضرُ، وDDL
حقيقيٌّ كانَ سيُنفَّذَ في الشِّقِّ المتوازي. والبابانِ **تشاركا العطبَ
نفسَهُ** لأنَّهما تشاركا النصَّ نفسَهُ — وذاكَ عينُ «المنطقُ يُقاسُ بنفسِهِ»
الذي أُنشئَ الحارسُ لمنعِهِ.

## المعيارُ البنيويُّ

لا `python-parser` لـTypeScript في بوّابةٍ تركضُ بـpython3 وحدَهُ (شرطُ
تشغيلِها قبلَ `pnpm install`). فالمعيارُ هنا: يُجرَّدُ التعليقُ، ثم
يُستخرَجُ **القاموسُ الحرفيُّ** الذي يُمرَّرُ إلى `defineConfig(…)` أو
يُصدَّرُ افتراضيّاً، ثم يُقرَأُ بالحرفِ (مفاتيحُ غيرُ مُقتبَسةٍ تُقتبَسُ،
و`true/false/null` تُعرَّبُ، والفواصلُ الذيليّةُ تُرفَعُ). فإن كانَ في
القاموسِ تعبيرٌ غيرُ حرفيٍّ (دالّةٌ · شَرْطٌ · استيرادُ نمطٍ) **خارجَ
الدلالةِ المضمونةِ** — ويُعلَنُ ذلكَ سبباً لا يُسكَتُ عنهُ، ويُعامِلُهُ
المُشتَقُّ بالاتجاهِ الآمنِ (بوّابةٌ مُسلسَلةٌ) لا بالمراهنةِ على نصٍّ.

## حدودٌ مُعلَنةٌ

* أنماطُ الضمِّ والاستثناءِ تُطابَقُ بتبسيطِ glob المكتوبِ في
  `glob_matches` (شرائحُ بـ`/`، و`**` أيُّ عمقٍ بما فيهِ الصفرُ، و`*`
  ضمنَ الجزءِ، و`{a,b}` فئةٌ). نمطٌ أفقهُ من ذلكَ يُعلَنُ في حكمِ
  المطابقةِ (`_UNSUPPORTED_GLOB`) — لا يُبتلَعُ.
* ملفُّ الإعدادِ المقروءُ هو `vitest.config.ts` وحدَهُ؛ مِلفٌّ بامتدادٍ
  آخر يُعلَنُ كذلكَ — ولا حالةَ كذلكَ في المستودعِ اليومَ (مقيسٌ).
"""

from __future__ import annotations

import ast
import re

GATE_SUFFIXES = (".integration.test.ts", ".e2e.test.ts")

# أنماطٌ أفقهُ من مُطابِقِنا المُبسَّطِ — تُعلَنُ ولا تُبتلَعُ.
_UNSUPPORTED_GLOB = re.compile(r"[\[\]!]")

def _strip_comments(src: str) -> str:
    """يجردُ التعليقاتِ **خارجَ النصوصِ الحرفيّةِ** — بماسحٍ واعٍ بالنصوصِ.

    لماذا ماسحٌ لا `re.sub`؟ لأنَّ أنماطَ glob في عقودِ الإعدادِ تحملُ
    `/**` و`*/` داخلَ نصوصٍ مقتبسةٍ، فكانَ تجريدُ التعليقاتِ بالنمطِ
    الساذجِ **يأكلُ الأنماطَ نفسَها** ويُخرِّبُ الدلالةَ التي جاءَ هذا
    الملفُّ ليقيسَها — قِيسَ على `src/**/*.test.ts` (مقيسٌ لا مُتخيَّلٌ).
    """
    out = []
    i = 0
    n = len(src)
    quote = None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c == "/" and src.startswith("/*", i):
            end = src.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if c == "/" and src.startswith("//", i):
            end = src.find("\n", i)
            i = n if end == -1 else end
            continue
        if c == '"' or c == "'" or c == "`":
            quote = c
        out.append(c)
        i += 1
    return "".join(out)


def _unquote_keys(js: str) -> str:
    js = re.sub(r"([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)", r'\1"\2"\3', js)
    js = re.sub(r"\btrue\b", "True", js)
    js = re.sub(r"\bfalse\b", "False", js)
    js = re.sub(r"\bnull\b", "None", js)
    js = re.sub(r",\s*([}\]])", r"\1", js)
    return js


def _extract_object(src: str) -> str | None:
    """نصُّ القاموسِ الحرفيِّ الأولِ في الملفِّ — سطرياً وواعياً بالنصوصِ."""
    m = re.search(r"defineConfig\s*\(", src)
    if m:
        open_at = src.find("{", m.end() - 1)
    else:
        m2 = re.search(r"export\s+default\s*", src)
        if not m2:
            return None
        open_at = src.find("{", m2.end())
        if open_at == -1:
            return None
    depth = 0
    quote = None
    i = open_at
    while i < len(src):
        c = src[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c == '"' or c == "'" or c == '`':
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[open_at : i + 1]
        i += 1
    return None


def default_run_globs(cfg_path: str) -> tuple[list[str] | None, list[str], bool]:
    """`(include, exclude, has_include)` بدلالةِ الملفِّ.

    * `include=None` و`has_include=False`: لا ضمَّ مُعلَناً — مفهومُ Vitest
      الافتراضيُّ: كلُّ ملفِّ اختبارٍ.
    * `include=None` و`has_include=True`: ضمٌّ **خارجُ الدلالةِ** (قائمةٌ
      غيرُ حرفيّةٍ أو تعبيرٌ) — المُشتَقُّ يعامِلُهُ بالاتجاهِ الآمنِ.
    """
    with open(cfg_path, encoding="utf-8") as fh:
        src = _strip_comments(fh.read())
    obj_text = _extract_object(src)
    include: list[str] | None = None
    exclude: list[str] = []
    has_include = False
    if obj_text is not None:
        try:
            obj = ast.literal_eval(_unquote_keys(obj_text))
        except (ValueError, SyntaxError):
            obj = None
        if isinstance(obj, dict):
            test = obj.get("test")
            if isinstance(test, dict):
                if "include" in test:
                    has_include = True
                    inc = test["include"]
                    if isinstance(inc, list) and all(isinstance(x, str) for x in inc):
                        include = inc
                exc = test.get("exclude")
                if isinstance(exc, list) and all(isinstance(x, str) for x in exc):
                    exclude = exc
                elif "exclude" in test:
                    exclude = ["**/*"]  # استثناءٌ خارجُ الدلالةِ: يُفترَضُ أسوأَ
    return include, exclude, has_include


def _segment_regex(part: str) -> str | None:
    """جزءُ نمطٍ (بينَ شرطتَينِ) إلى تعبيرٍ نمطيٍّ — أو `None` إن عجزنا."""
    if _UNSUPPORTED_GLOB.search(part):
        return None
    out = ""
    i = 0
    while i < len(part):
        c = part[i]
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        elif c == "{":
            end = part.find("}", i)
            if end == -1:
                return None
            alts = [a.strip() for a in part[i + 1 : end].split(",")]
            subs = [_segment_regex(a) for a in alts]
            if any(s is None for s in subs):
                return None
            out += "(?:" + "|".join(subs) + ")"
            i = end
        else:
            out += re.escape(c)
        i += 1
    return out


def glob_matches(pattern: str, path: str) -> bool | None:
    """هل يُطابِقُ النمطُ المسارَ؟ `True`/`False` — أو `None` إن عجزَ التبسيطُ.

    `**` جزءاً كاملاً يُطابِقُ **صفرَ** شرائحَ أو أكثرَ (مفهومُ micromatch
    الذي تعملُ بهِ Vitest فعلًا، مقيسٌ على `src/**/*.test.ts` مقابلِ
    `src/x.test.ts`).
    """
    import re as _re

    parts = pattern.split("/")
    rx = ""
    for idx, part in enumerate(parts):
        if part == "**":
            rx += "(?:[^/]+/)*" if idx < len(parts) - 1 else ".*"
            continue
        seg = _segment_regex(part)
        if seg is None:
            return None
        rx += seg
        if idx < len(parts) - 1:
            rx += "/"
    return _re.match("^" + rx + "$", path) is not None


def runs_file(include: list[str] | None, exclude: list[str], rel_path: str, has_include: bool) -> bool:
    """هل يُشغِّلُ الإعدادُ الافتراضيُّ هذا الملفَّ؟ — دلالةً لا نصًّا.

    `rel_path` مسارٌ نسبيٌّ إلى جذرِ الحزمةِ (`src/__tests__/x.e2e.test.ts`).
    ونمطٌ عجزَ تبسيطُ مطابقتِهِ **لا يُحسَبُ استثناءً ولا ضمًّا**: يُعلَنُ
    `None` ويُعامِلُهُ المُشتَقُّ بالاتجاهِ الآمنِ.
    """
    for e in exclude:
        m = glob_matches(e, rel_path)
        if m is True:
            return False
    if include is not None:
        verdicts = [glob_matches(i, rel_path) for i in include]
        if True in verdicts:
            return True
        if None in verdicts:
            return True  # نمطٌ غيرُ مفهومٍ: الاتجاهُ الآمنُ (يُحسَبُ مُضمَّاً)
        return False
    if has_include:
        return True
    return True  # لا ضمَّ ولا استثناءَ: مفهومُ Vitest الافتراضيُّ


def gate_files_in_default_run(cfg_path: str, test_files: list[str]) -> list[str]:
    """ملفّاتُ البوّاباتِ التي يُشغِّلُها الإعدادُ الافتراضيُّ **فعلاً**.

    `test_files` مساراتٌ نسبيّةٌ إلى جذرِ الحزمةِ. والعائدُ الفارغُ: لا
    ملفَّ بوّابةٍ يجري في المسارِ الافتراضيِّ.
    """
    include, exclude, has_include = default_run_globs(cfg_path)
    return [
        f
        for f in test_files
        if f.endswith(GATE_SUFFIXES) and runs_file(include, exclude, f, has_include)
    ]
