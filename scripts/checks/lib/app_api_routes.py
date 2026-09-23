#!/usr/bin/env python3
"""app_api_routes.py — محرِّكُ الفحصِ 24 (`M3-08`): عقدُ المسارِ بين التطبيقِ والخدمةِ.

السؤالُ الواحدُ الذي يجيبُ عنه:

    **كلُّ مسارِ API يناديه تطبيقٌ في `apps/*/src` — أله مسارٌ مُسجَّلٌ بالطريقةِ
    نفسِها في خدمةٍ من `services/*/src`، أم يُنادي فراغاً واختباراتُه خضراءُ؟**

ولِمَ وُجِد — قياسٌ لا تخوُّفٌ (2026-09-23 · تدقيقُ `CLM-0313`):
اختباراتُ الواجهاتِ الثلاثِ (Vitest + Playwright) تعترض كلَّ نداءٍ بمحاكاةٍ
(`page.route()` · `vi.fn()`)، فلا شيءَ فيها يشهد أنّ المسارَ **موجودٌ** في الخدمة.
وقيسَ على `main` @ `a9e028f`: لوحةُ الإدارةِ (`M3-04` · Completed) تنادي
`GET /customers` و`POST /customers/:id/suspend` و`GET /api/audit/audit/events`،
**ولا واحدَ منها في أيِّ خدمةٍ** — و`services/audit/` نفسُها محذوفةٌ (تسعُ فجواتٍ). وتطبيقُ
السائقِ (`M3-02` · Completed) ينادي `GET /drivers/:id/jobs` لشاشةِ الأرباحِ ولا
مسارَ له. وكلُّ ذلك أخضرُ في CI.

الأبوابُ:
  1) كلُّ نداءٍ يُقرأ مسارُه: نصٌّ حرفيٌّ، أو ثابتٌ محلّيٌّ يُحَلُّ إلى نصٍّ.
     وما لا يُحَلُّ **عجزٌ مُعلَنٌ يُسقِط الفحصَ** — إلّا وحدةَ النقلِ المُعلَنةَ
     في السجلِّ (العميلُ الذي يُركِّب `${baseUrl}${path}`).
  2) كلُّ نداءٍ يطابق مساراً في خدمةٍ (الطريقةُ + القطعُ؛ معاملُ الخدمةِ
     `:x` يقبل أيَّ قطعةٍ) — أو هو فجوةٌ مُسجَّلةٌ في §4 من الوثيقة.
  3) لا فجوةَ ميتةً: صفٌّ في §4 صار مساره موجوداً أو لم يَعُدْ مُنادىً يُسقِط الفحصَ.
  4) كلُّ فجوةٍ مملوكةٌ لبندٍ في اللوحةِ **ليس Completed**: فجوةٌ يملكها بندٌ
     مكتملٌ تناقضٌ — إمّا أنّ البندَ لم يكتمل أو أنّ الفجوةَ ليست فجوةً.
  5) الأرقامُ المنشورةُ في §5 من الوثيقةِ تطابق القياسَ.

وحدودُه المُعلَنةُ: يقيس **وجودَ** المسارِ لا **الوصولَ** إليه (أيُّ مضيفٍ؟
أيُّ بوّابةٍ؟) ولا شكلَ الجسمِ ولا الصلاحيةَ — تلك أسئلةٌ لها بنودُها.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

RED = "\033[31m"
GRN = "\033[32m"
DIM = "\033[2m"
RST = "\033[0m"

BOARD = "docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
CLIENT_NAMES = ("apiClient", "api", "client")
METHODS = {"get": "GET", "post": "POST", "put": "PUT", "patch": "PATCH", "delete": "DELETE", "del": "DELETE"}

SERVICE_ROUTE = re.compile(
    r"\.(get|post|put|patch|delete)\s*(?:<(?:[^<>()]|<[^<>()]*>)*>)?\(\s*([\"'`])(/[^\"'`]*)\2", re.S
)
APP_CALL = re.compile(
    r"\b(\w+)\.(get|post|put|patch|delete|del)\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\(\s*", re.S
)
FETCH_CALL = re.compile(r"(?<![\w.])fetch\(\s*", re.S)
LITERAL = re.compile(r"([\"'`])((?:\\.|(?!\1).)*)\1", re.S)
IDENT = re.compile(r"([A-Za-z_$][\w$]*)\s*[,)]")


def strip_comments(src: str) -> str:
    """يحذف التعليقاتِ ويُبقي النصوصَ — تعليقٌ يذكر مساراً ليس نداءً."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append(src[i : j + 1])
            i = j + 1
        elif src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            out.append(" ")
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def source_files(root: str) -> list[str]:
    files = []
    for ext in ("ts", "tsx"):
        files += glob.glob(f"{root}/**/*.{ext}", recursive=True)
    return sorted(
        f
        for f in files
        if "/__tests__/" not in f and ".test." not in f and ".spec." not in f and "/node_modules/" not in f
    )


def norm_service_path(path: str) -> tuple[str, ...]:
    return tuple(":" if seg.startswith(":") else seg for seg in path.strip("/").split("/"))


def norm_app_path(raw: str) -> tuple[str, ...] | None:
    """يُطبِّع مسارَ التطبيقِ: `${x}` قطعةً كاملةً ← `:`، ولاحقةُ استعلامٍ تُحذَف.

    ويُعيد None حين لا يُقرأ المسارُ (لا يبدأ بـ`/` أو فيه `${}` وسطَ قطعةٍ)."""
    raw = raw.split("?", 1)[0]
    if not raw.startswith("/"):
        return None
    segs = []
    for seg in raw.strip("/").split("/"):
        if re.fullmatch(r"\$\{[^}]*\}", seg):
            segs.append(":")
            continue
        # `order-requests${params}` — لاحقةُ استعلامٍ مُركَّبةٌ على قطعةٍ حرفيّةٍ.
        head = re.sub(r"\$\{[^}]*\}$", "", seg)
        if "${" in head or not head:
            return None
        segs.append(head)
    return tuple(segs)


def fmt(segs: tuple[str, ...]) -> str:
    return "/" + "/".join(segs)


def matches(app: tuple[str, ...], svc: tuple[str, ...]) -> bool:
    if len(app) != len(svc):
        return False
    return all(s == ":" or a == s for a, s in zip(app, svc))


def resolve_ident(src: str, name: str, before: int) -> str | None:
    """ثابتٌ محلّيٌّ قبل النداءِ في الملفِّ نفسِه: `const p = <نص>` أو
    `const p = cond ? <نص> : <نص>` — والفرعانِ يجب أن يُطبَّعا إلى مسارٍ واحدٍ،
    وإلّا فالمسارُ مُبهَمٌ ويُعلَن عجزاً."""
    found = None
    for m in re.finditer(r"\b(?:const|let)\s+" + re.escape(name) + r"\s*(?::[^=]+)?=\s*", src[:before]):
        end = src.find(";", m.end())
        expr = src[m.end() : end if end > 0 else before]
        lits = [x.group(2) for x in LITERAL.finditer(expr)]
        rest = LITERAL.sub("", expr)
        if not lits:
            found = None
        elif len(lits) == 1 and not rest.strip():
            found = lits[0]
        elif re.fullmatch(r"\s*[\w.$]+\s*\?\s*:\s*", rest) and len(lits) == 2:
            a, b = (norm_app_path(x) for x in lits)
            found = lits[0] if a is not None and a == b else None
        else:
            found = None
    return found


def collect_services() -> dict[tuple[str, tuple[str, ...]], set[str]]:
    routes: dict[tuple[str, tuple[str, ...]], set[str]] = {}
    for f in source_files("services"):
        if "/src/" not in f:
            continue
        svc = f.split("/")[1]
        src = strip_comments(open(f, encoding="utf-8").read())
        for m in SERVICE_ROUTE.finditer(src):
            routes.setdefault((m.group(1).upper(), norm_service_path(m.group(3))), set()).add(svc)
    return routes


def collect_calls(transport: set[str]) -> tuple[list[dict], list[str]]:
    calls: list[dict] = []
    unresolved: list[str] = []
    for app_dir in sorted(glob.glob("apps/*/src")):
        app = app_dir.split("/")[1]
        for f in source_files(app_dir):
            src = strip_comments(open(f, encoding="utf-8").read())
            sites = []
            for m in APP_CALL.finditer(src):
                if m.group(1) in CLIENT_NAMES:
                    sites.append((m.start(), m.end(), METHODS[m.group(2)]))
            for m in FETCH_CALL.finditer(src):
                tail = src[m.end() : m.end() + 600]
                close = tail.find(");")
                mm = re.search(r"method:\s*[\"'](\w+)[\"']", tail[: close if close > 0 else 600])
                sites.append((m.start(), m.end(), (mm.group(1).upper() if mm else "GET")))
            for start, end, method in sites:
                line = src.count("\n", 0, start) + 1
                where = f"{f}:{line}"
                lit = LITERAL.match(src, end)
                raw = lit.group(2) if lit else None
                if raw is None:
                    ident = IDENT.match(src, end)
                    raw = resolve_ident(src, ident.group(1), start) if ident else None
                if raw is not None and raw.startswith("${baseUrl}") and f in transport:
                    continue  # وحدةُ النقلِ المُعلَنةُ: المسارُ يأتيها من المُنادي.
                segs = norm_app_path(raw) if raw is not None else None
                if segs is None:
                    unresolved.append(f"{where} {method} {raw if raw is not None else '<غير نصٍّ>'}")
                    continue
                calls.append({"app": app, "method": method, "path": segs, "where": where})
    return calls, unresolved


def doc_block(doc: str, name: str) -> str:
    m = re.search(r"<!--\s*" + name + r":start\s*-->(.*?)<!--\s*" + name + r":end\s*-->", doc, re.S)
    return m.group(1) if m else ""


def table_rows(block: str) -> list[list[str]]:
    rows = []
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("|") or re.match(r"^\|\s*-", line):
            continue
        cells = [c.strip().strip("`") for c in line.strip("|").split("|")]
        rows.append(cells)
    return rows[1:]  # بلا سطرِ العنوان


def board_status() -> dict[str, str]:
    status = {}
    for line in open(BOARD, encoding="utf-8"):
        m = re.match(r"^\|\s*(M\d+-\d+)\s*\|", line)
        if m:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 5:
                status[m.group(1)] = cells[4]
    return status


def main(doc_path: str) -> int:
    failures = 0

    def ok(msg: str) -> None:
        print(f"  {GRN}✓{RST} {msg}")

    def bad(msg: str) -> None:
        nonlocal failures
        failures += 1
        print(f"  {RED}✗{RST} {msg}")

    if not os.path.isfile(doc_path):
        print(f"{RED}✗ {doc_path} مفقودٌ — لا سجلَّ فجواتٍ ولا أرقامَ منشورةً{RST}")
        return 1
    doc = open(doc_path, encoding="utf-8").read()

    transport = {r[0] for r in table_rows(doc_block(doc, "app-api-transport")) if r}
    for t in sorted(transport):
        if not os.path.isfile(t):
            bad(f"البابُ 1: وحدةُ نقلٍ مُعلَنةٌ غيرُ موجودةٍ: {t}")

    services = collect_services()
    calls, unresolved = collect_calls(transport)

    # ── البابُ 1 ──
    if unresolved:
        for u in unresolved:
            bad(f"البابُ 1: نداءٌ لا يُقرأ مسارُه — عجزٌ مُعلَنٌ لا مرورٌ: {u}")
    else:
        ok(f"البابُ 1: كلُّ نداءٍ ({len(calls)}) مسارُه مقروءٌ")

    # ── سجلُّ الفجوات ──
    gaps: dict[tuple[str, str, tuple[str, ...]], dict] = {}
    for r in table_rows(doc_block(doc, "app-api-gaps")):
        if len(r) < 5:
            bad(f"سجلُّ الفجوات: صفٌّ ناقصُ الأعمدةِ: {' | '.join(r)}")
            continue
        app, method, path, item, reason = r[:5]
        segs = norm_service_path(path)
        if not reason:
            bad(f"سجلُّ الفجوات: صفٌّ بلا سببٍ مكتوبٍ: {app} {method} {path}")
        gaps[(app, method.upper(), segs)] = {"item": item, "used": False}

    # ── البابُ 2 ──
    matched = 0
    unmatched = 0
    distinct: set[tuple[str, str, tuple[str, ...]]] = set()
    for c in calls:
        key = (c["app"], c["method"], c["path"])
        distinct.add(key)
        if any(m == c["method"] and matches(c["path"], p) for (m, p) in services):
            matched += 1
            continue
        gap = gaps.get(key)
        if gap is not None:
            gap["used"] = True
            unmatched += 1
            continue
        unmatched += 1
        bad(
            f"البابُ 2: {c['app']} ينادي {c['method']} {fmt(c['path'])} ({c['where']}) "
            f"ولا مسارَ له في أيِّ خدمةٍ ولا فجوةَ مُسجَّلةً في §4"
        )
    gate2_fail = sum(
        1
        for c in calls
        if not any(m == c["method"] and matches(c["path"], p) for (m, p) in services)
        and (c["app"], c["method"], c["path"]) not in gaps
    )
    if gate2_fail == 0:
        ok(f"البابُ 2: {matched} نداءً يطابق خدمةً · {unmatched} فجوةً كلُّها مُسجَّلةٌ")

    # ── البابُ 3: فجوةٌ ميتةٌ ──
    dead = 0
    for (app, method, segs), g in gaps.items():
        exists = any(m == method and matches(segs, p) for (m, p) in services)
        if exists:
            dead += 1
            bad(f"البابُ 3: فجوةٌ ميتةٌ — {app} {method} {fmt(segs)} صار له مسارٌ في خدمةٍ؛ احذف صفَّه")
        elif not g["used"]:
            dead += 1
            bad(f"البابُ 3: فجوةٌ ميتةٌ — {app} {method} {fmt(segs)} لم يَعُدْ مُنادىً؛ احذف صفَّه")
    if dead == 0:
        ok(f"البابُ 3: لا فجوةَ ميتةً ({len(gaps)} صفّاً حيّاً)")

    # ── البابُ 4: مالكُ الفجوةِ غيرُ مكتملٍ ──
    status = board_status()
    bad4 = 0
    for (app, method, segs), g in gaps.items():
        st = status.get(g["item"])
        if st is None:
            bad4 += 1
            bad(f"البابُ 4: فجوةُ {app} {method} {fmt(segs)} مملوكةٌ لـ{g['item']} ولا بندَ بهذا الاسمِ في اللوحة")
        elif st == "Completed":
            bad4 += 1
            bad(
                f"البابُ 4: فجوةُ {app} {method} {fmt(segs)} مملوكةٌ لـ{g['item']} وهو Completed — "
                f"تناقضٌ: البندُ لم يكتمل أو الفجوةُ ليست فجوةً"
            )
    if bad4 == 0:
        ok("البابُ 4: كلُّ فجوةٍ مملوكةٌ لبندٍ قائمٍ غيرِ مكتملٍ")

    # ── جدولُ التوجيهِ (يُقرأُ قبلَ البابِ 5 لأنَّ عدّادَه يُنشرُ مع الأرقامِ) ──
    rewrite_files = [r[0] for r in table_rows(doc_block(doc, "app-api-rewrites")) if r]
    rewrites: dict[str, str] = {}
    for rf in rewrite_files:
        if not os.path.isfile(rf):
            continue
        try:
            loaded = json.load(open(rf, encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        raw = loaded.get("prefixes") if isinstance(loaded, dict) else None
        if isinstance(raw, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in raw.items()):
            rewrites.update(raw)

    # ── البابُ 5: الأرقامُ المنشورة ──
    published = {m.group(1): int(m.group(2)) for m in re.finditer(r"(\w+)\s*=\s*(\d+)", doc_block(doc, "app-api-counts"))}
    expected = {
        "APPS_SCANNED": len(glob.glob("apps/*/src")),
        "SERVICE_ROUTES": len(services),
        "APP_CALL_SITES": len(calls),
        "DISTINCT_APP_CALLS": len(distinct),
        "MATCHED_CALL_SITES": matched,
        "REGISTERED_GAPS": len(gaps),
        "REWRITE_PREFIXES": len(rewrites),
    }
    bad5 = 0
    for key, value in expected.items():
        if key not in published:
            bad5 += 1
            bad(f"البابُ 5: `{key}` غيرُ منشورٍ في §5 — والقياسُ {value}")
        elif published[key] != value:
            bad5 += 1
            bad(f"البابُ 5: `{key}` منشورٌ {published[key]} والقياسُ {value}")
    if bad5 == 0:
        ok("البابُ 5: كلُّ رقمٍ منشورٍ يطابق القياسَ")

    # ── البابُ 6 (M3-09): جدولُ التوجيهِ — من المسارِ المُنادى إلى الخدمةِ ──
    # كلُّ بادئةٍ يناديها تطبيقٌ يجب أن يكونَ لها صفٌّ في جدولِ إعادةِ الكتابةِ،
    # يوجِّهُ إلى الخدمةِ نفسِها التي يطابقُ النداءُ مسارَها في البابِ الثاني،
    # وكلُّ صفٍّ في الجدولِ يجب أن تملكَهُ خدمةٌ فعلًا في الشفرةِ.
    bad6 = 0
    if not rewrite_files:
        bad6 += 1
        bad("البابُ 6: لا جدولَ توجيهٍ مُعلَنًا في `app-api-rewrites` — لا يُقاسُ مسارُ الوصولِ")
    for rf in rewrite_files:
        if not os.path.isfile(rf):
            bad6 += 1
            bad(f"البابُ 6: جدولُ التوجيهِ المُعلَنُ غيرُ موجودٍ: {rf}")
            continue
        try:
            loaded = json.load(open(rf, encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            bad6 += 1
            bad(f"البابُ 6: جدولُ التوجيهِ {rf} ليس JSON مقروءًا — {exc}")
            continue
        raw = loaded.get("prefixes") if isinstance(loaded, dict) else None
        if not isinstance(raw, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in raw.items()
        ):
            bad6 += 1
            bad(f"البابُ 6: جدولُ التوجيهِ {rf} بلا خريطةِ `prefixes` من نصٍّ إلى نصٍّ")
    for prefix, svc in rewrites.items():
        if not re.fullmatch(r"/[A-Za-z0-9_-]+", prefix):
            bad6 += 1
            bad(f"البابُ 6: بادئةُ توجيهٍ ليست قطعةً واحدةً تبدأ بـ`/`: {prefix}")
    # 6-أ و6-ب: كلُّ نداءٍ له بادئةٌ موجودةٌ توجِّهُ إلى خدمتِه المطابِقةِ.
    call_owners: dict[tuple[str, str, tuple[str, ...]], set[str]] = {}
    for c in calls:
        key = (c["app"], c["method"], c["path"])
        call_owners.setdefault(key, set()).update(
            svc for (m, p), svcs in services.items() if m == c["method"] and matches(c["path"], p) for svc in svcs
        )
    for (app, method, path), owners in sorted(call_owners.items(), key=lambda kv: fmt(kv[0][2])):
        if not path:
            bad6 += 1
            bad(f"البابُ 6: نداءٌ بلا قطعةِ بادئةٍ: {app} {method} {fmt(path)}")
            continue
        prefix = "/" + path[0]
        mapped = rewrites.get(prefix)
        if mapped is None:
            bad6 += 1
            bad(f"البابُ 6-أ: {app} ينادي {method} {fmt(path)} وبادئتُه {prefix} ليست في جدولِ التوجيهِ — النداءُ لا يعرفُ طريقَه إلى أيِّ خدمةٍ")
        elif owners and mapped not in owners:
            bad6 += 1
            bad(
                f"البابُ 6-ب: {app} ينادي {method} {fmt(path)} والجدولُ يوجِّهُ {prefix} إلى `{mapped}` "
                f"بينما الخدماتُ المطابِقةُ للنداءِ هي {sorted(owners)} — التوجيهُ والنداءُ يفترقان"
            )
    # 6-ج: كلُّ صفٍّ في الجدولِ تملكُهُ خدمةٌ فعلًا (بادئةٌ ميّتةٌ = صفٌّ يوجِّهُ إلى لا شيءٍ).
    for prefix, svc in sorted(rewrites.items()):
        seg = prefix[1:]
        owns = any(p and p[0] == seg for (m, p), svcs in services.items() if svc in svcs)
        if not owns:
            bad6 += 1
            bad(f"البابُ 6-ج: الجدولُ يوجِّهُ {prefix} إلى `{svc}` ولا مسارَ لهذهِ الخدمةِ يبدأُ بهذهِ البادئةِ — بادئةٌ ميّتةٌ")
    if bad6 == 0 and rewrites:
        ok(f"البابُ 6: كلُّ نداءٍ ({len(call_owners)}) له بادئةُ توجيهٍ تصلُ خدمتَه · {len(rewrites)} بادئةً كلُّها مملوكةً لخدمةٍ")

    print(
        f"  {DIM}تطبيقات {expected['APPS_SCANNED']} · مسارات خدمات {expected['SERVICE_ROUTES']} · "
        f"نداءات {len(calls)} · مطابِقة {matched} · فجوات مسجَّلة {len(gaps)}{RST}"
    )
    if failures:
        print(f"{RED}✗ عقدُ المسارِ بين التطبيقِ والخدمةِ: {failures} مشكلةً.{RST}")
        return 1
    print(f"{GRN}✓ عقدُ المسارِ بين التطبيقِ والخدمةِ: كلُّ نداءٍ له مسارٌ أو فجوةٌ مملوكةٌ لبندٍ مفتوحٍ.{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "docs/12-testing/APP_API_ROUTES.md"))
