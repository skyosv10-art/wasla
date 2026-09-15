#!/usr/bin/env python3
"""app_port_wiring.py — قارئُ تركيبِ المنافذِ **من شكلِ الشفرةِ لا من نصِّها**.

هذا الملفُّ هوَ محرِّكُ الفحصِ 17 (`M0-41`)، ويُستدعى من
`scripts/checks/validate-app-port-wiring.sh`.

── لماذا كُتِبَ من جديدٍ (2026-09-15) ───────────────────────────────────────
النسخةُ الأولى أثبتَتِ التركيبَ ببحثٍ نصيٍّ عن اسمِ المنفذِ في **كاملِ**
`server.ts`. وذاكَ **إيجابٌ كاذبٌ مُثبَتٌ لا محتملٌ**: في
`services/delivery/src/http/server.ts` يظهرُ `catalogPort` في مُعينٍ
(`function buildCatalogPort()` · السطرُ 92) **وفي** عقدِ النداءِ (السطرُ 246).
فحذفُ المفتاحِ من عقدِ النداءِ وحدَهُ — وهوَ عينُ العطبِ الذي وُلِدَ الحارسُ
لأجلِهِ — كانَ يمرُّ أخضرَ لأنَّ الاسمَ باقٍ في المُعينِ.

فالإثباتُ الآنَ **بنيويٌّ**: يُستخرَجُ العقدُ (object literal) المُمرَّرُ فعلاً
إلى نداءِ المصنعِ بمطابقةِ الأقواسِ، وتُقرأُ مفاتيحُهُ من **الطبقةِ الأولى**
وحدَها، ولا يُقبَلُ اسمٌ إلّا إذا كانَ مفتاحاً في ذلكَ العقدِ (أو في نشرٍ
يُحَلُّ إلى عقدٍ). وما لا يُحَلُّ **يُعلَنُ عجزاً ويُسقِطُ الفحصَ** — لا يُقرأُ
مروراً.

── القدراتُ المحروسةُ ──────────────────────────────────────────────────────
* صيغتا المصنعِ: `create*App` و`build*HttpApp` (وأيُّ `create|build …App`).
* عقودُ التبعيّاتِ المُستورَدةُ (خطوةٌ واحدةٌ) والعقودُ الداخليّةُ.
* الأسماءُ المُستعارةُ: `import { buildX as buildApp }` و`const f = buildX;`.
* أكثرُ من نداءٍ للمصنعِ في الملفِّ نفسِهِ: **كلُّ** نداءٍ يُقاسُ.
* النشرُ: الشرطيُّ (`...(x ? {} : { p })`) والمتغيِّرُ (`...deps`) يُحَلُّ
  بقراءةِ تعريفِهِ في الملفِّ نفسِهِ؛ وما بقيَ مُبهَماً يُسقِطُ الفحصَ.
* المنافذُ المُركَّبةُ شرطيّاً تُقاسُ وتُنشَرُ عدداً — لا تُخفى.
"""

from __future__ import annotations

import glob
import os
import re
import sys

RED = "\033[31m"
GRN = "\033[32m"
DIM = "\033[2m"
RST = "\033[0m"

FACTORY_DECL = re.compile(
    r"export\s+function\s+((?:create|build)\w*App)\s*\(\s*(\w+)\s*:\s*(\w+)"
    r"\s*(?:=\s*\{\s*\})?\s*,?\s*\)",
    re.S,
)


# ── 0) تعميةُ النصوصِ والتعليقاتِ ───────────────────────────────────────────
def mask(src: str) -> str:
    """يُبدِلُ محتوى النصوصِ والتعليقاتِ بفراغاتٍ مع حفظِ الأطوالِ والمواضعِ.

    ولِمَ: مطابقةُ الأقواسِ تُكسَرُ بقوسٍ داخلَ نصٍّ أو تعليقٍ، وكسرُها يُنتِجُ
    قراءةً خاطئةً للعقدِ — فيصيرُ الحارسُ عشوائيّاً لا صارماً.
    """
    out = list(src)
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = " "
            i = j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, j):
                if src[k] != "\n":
                    out[k] = " "
            i = j
            continue
        if c in "\"'`":
            quote = c
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == quote:
                    j += 1
                    break
                j += 1
            for k in range(i, min(j, n)):
                if src[k] != "\n":
                    out[k] = " "
            i = j
            continue
        i += 1
    return "".join(out)


def strip_comments(text: str) -> str:
    """يحذفُ التعليقاتِ ويُبقي النصوصَ — لِقراءةِ مفتاحٍ مكتوبٍ نصّاً بعدَ تعليقٍ."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j == -1 else j
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        if c in "\"'`":
            quote = c
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == quote:
                    j += 1
                    break
                j += 1
            out.append(text[i:j])
            i = j
            continue
        out.append(c)
        i += 1
    return "".join(out)


def match_brace(masked: str, start: int) -> int | None:
    """موضعُ القوسِ المُغلِقِ لِـ`{` عندَ `start` — أو `None` إن لم يُغلَقْ."""
    depth = 0
    for i in range(start, len(masked)):
        c = masked[i]
        if c in "{([":
            depth += 1
        elif c in "})]":
            depth -= 1
            if depth == 0:
                return i
    return None


# ── 1) العقودُ: المنافذُ الاختياريّةُ التي يقبلُها المصنعُ ──────────────────
def _body_in(src: str, name: str) -> str | None:
    m = re.search(r"(?:export\s+)?interface\s+" + re.escape(name) + r"\s*\{", src)
    if m is None:
        return None
    masked = mask(src)
    end = match_brace(masked, masked.index("{", m.start()))
    if end is None:
        return None
    return src[masked.index("{", m.start()) + 1 : end]


def _resolve_import(path: str, src: str, type_name: str) -> str | None:
    """ملفُّ الاستيرادِ الذي يُعلَنُ فيهِ عقدٌ — خطوةٌ واحدةٌ لا سلسلةٌ."""
    for members, source in re.findall(
        r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+\"([^\"]+)\"", src, re.S
    ):
        names = {
            n.strip().removeprefix("type ").strip().split(" as ")[-1].strip()
            for n in members.split(",")
            if n.strip()
        }
        if type_name not in names or not source.startswith("."):
            continue
        base = os.path.normpath(os.path.join(os.path.dirname(path), source))
        base = re.sub(r"\.js$", "", base)
        for candidate in (f"{base}.ts", os.path.join(base, "index.ts")):
            if os.path.isfile(candidate):
                return candidate
    return None


def interface_body(path: str, src: str, name: str) -> tuple[str, str, str] | None:
    """جسمُ العقدِ ومساره ومصدرُه — محليّاً أو عبرَ استيرادٍ واحدٍ."""
    local = _body_in(src, name)
    if local is not None:
        return local, path, src
    target = _resolve_import(path, src, name)
    if target is None:
        return None
    tsrc = open(target, encoding="utf-8").read()
    body = _body_in(tsrc, name)
    return None if body is None else (body, target, tsrc)


def is_port(name: str, type_name: str) -> bool:
    bare = type_name.replace("| undefined", "").strip().split("<")[0].strip()
    return name.endswith("Port") or bare.endswith("Port")


def collect_ports(path: str, src: str, type_name: str, depth: int = 3) -> list[str] | None:
    """المنافذُ الاختياريّةُ في العقدِ وعقودِهِ الداخليّةِ/المُستورَدةِ."""
    found = interface_body(path, src, type_name)
    if found is None:
        return None
    body, bpath, bsrc = found
    ports: list[str] = []
    for member in re.finditer(
        r"(?:readonly\s+)?(\w+)(\?)?\s*:\s*([\w<>\[\]., |]+);", body
    ):
        name, optional, tname = member.group(1), member.group(2), member.group(3)
        if optional and is_port(name, tname):
            ports.append(name)
            continue
        if depth > 1:
            bare = tname.replace("| undefined", "").strip().split("<")[0].strip()
            if bare and bare[0].isupper():
                nested = collect_ports(bpath, bsrc, bare, depth - 1)
                if nested:
                    ports.extend(nested)
    return ports


# ── 2) الإثباتُ البنيويُّ: مفاتيحُ العقدِ المُمرَّرِ إلى نداءِ المصنعِ ───────
def local_names_for(src: str, factory: str) -> set[str]:
    """أسماءُ المصنعِ محليّاً: الاسمُ نفسُهُ وكلُّ استعارةٍ لهُ."""
    names = {factory}
    for members, _source in re.findall(
        r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+\"([^\"]+)\"", src, re.S
    ):
        for entry in members.split(","):
            entry = entry.strip()
            if not entry:
                continue
            parts = [p.strip() for p in entry.split(" as ")]
            if parts[0].removeprefix("type ").strip() == factory:
                names.add(parts[-1])
    # استعارةٌ بإسنادٍ: `const buildApp = buildDeliveryHttpApp;`
    for _ in range(3):
        added = False
        for alias, target in re.findall(r"const\s+(\w+)\s*=\s*(\w+)\s*;", src):
            if target in names and alias not in names:
                names.add(alias)
                added = True
        if not added:
            break
    return names


def _object_entries(
    masked: str, src: str, obj_start: int, obj_end: int
) -> list[tuple[str, str]]:
    """مُدخلاتُ الطبقةِ الأولى في عقدٍ: ("key", name) أو ("spread", expr).

    الحدودُ تُمشى على الشفرةِ المُعمّاةِ (فلا يكسرُها قوسٌ في نصٍّ)، والمُدخلاتُ
    تُقرأُ من الشفرةِ الأصليّةِ (فلا يُفقَدُ مفتاحٌ مكتوبٌ نصّاً: `"port": v`).
    """
    entries: list[tuple[str, str]] = []
    depth = 0
    i = obj_start
    segment_start = obj_start + 1
    while i <= obj_end:
        c = masked[i]
        if c in "{([":
            depth += 1
        elif c in "})]":
            depth -= 1
            if depth == 0:
                entries.append(("raw", src[segment_start:i]))
                break
        elif c == "," and depth == 1:
            entries.append(("raw", src[segment_start:i]))
            segment_start = i + 1
        i += 1
    parsed: list[tuple[str, str]] = []
    for _kind, raw in entries:
        text = strip_comments(raw).strip()
        if not text:
            continue
        if text.startswith("..."):
            parsed.append(("spread", text[3:].strip()))
            continue
        m = re.match(r"^(?:\"([\w$]+)\"|'([\w$]+)'|([\w$]+))\s*(:|$)", text)
        if m is None:
            parsed.append(("unparsed", text))
            continue
        key = m.group(1) or m.group(2) or m.group(3)
        parsed.append(("key", key))
    return parsed


def _object_bounds_at(masked: str, pos: int) -> tuple[int, int] | None:
    j = pos
    while j < len(masked) and masked[j] in " \t\r\n":
        j += 1
    if j >= len(masked) or masked[j] != "{":
        return None
    end = match_brace(masked, j)
    return None if end is None else (j, end)


def _resolve_spread(
    masked: str, src: str, expr: str, depth: int = 2
) -> tuple[set[str], set[str], list[str]]:
    """مفاتيحُ نشرٍ: (مفاتيحٌ مؤكَّدةٌ، مفاتيحٌ شرطيّةٌ، أسبابُ إبهامٍ)."""
    certain: set[str] = set()
    conditional: set[str] = set()
    opaque: list[str] = []
    expr = expr.strip()
    if depth <= 0:
        return certain, conditional, [f"نشرٌ متداخلٌ أعمقُ من الحدِّ: `{expr[:60]}`"]

    # نشرٌ شرطيٌّ: كلُّ عقدٍ داخلَ التعبيرِ يُقرأُ **شرطيّاً** لا مؤكَّداً.
    if "{" in expr:
        for m in re.finditer(r"\{", expr):
            sub = mask(expr)
            end = match_brace(sub, m.start())
            if end is None:
                continue
            for kind, value in _object_entries(sub, expr, m.start(), end):
                if kind == "key":
                    conditional.add(value)
                elif kind == "spread":
                    c2, q2, o2 = _resolve_spread(masked, src, value, depth - 1)
                    conditional |= c2 | q2
                    opaque += o2
        if conditional:
            return certain, conditional, opaque

    # نشرُ متغيّرٍ: يُقرأُ تعريفُهُ في الملفِّ نفسِهِ.
    ident = re.match(r"^([\w$]+)$", expr)
    if ident:
        name = ident.group(1)
        for decl in re.finditer(
            r"const\s+" + re.escape(name) + r"\s*(?::[^=]+)?=\s*", masked
        ):
            bounds = _object_bounds_at(masked, decl.end())
            if bounds is None:
                continue
            for kind, value in _object_entries(masked, src, bounds[0], bounds[1]):
                if kind == "key":
                    certain.add(value)
                elif kind == "spread":
                    c2, q2, o2 = _resolve_spread(masked, src, value, depth - 1)
                    certain |= c2
                    conditional |= q2
                    opaque += o2
            return certain, conditional, opaque

    return certain, conditional, [f"نشرٌ لا يُحَلُّ إلى عقدٍ مقروءٍ: `{expr[:60]}`"]


def call_sites(path: str, src: str, factory: str) -> tuple[list[dict], list[str]]:
    """كلُّ نداءٍ للمصنعِ في الملفِّ ومفاتيحُ عقدِهِ — ومواضعُ العجزِ."""
    masked = mask(src)
    names = local_names_for(src, factory)
    sites: list[dict] = []
    problems: list[str] = []
    for name in sorted(names):
        for m in re.finditer(r"(?<![\w.$])" + re.escape(name) + r"\s*\(", masked):
            # إعلانٌ لا نداءٌ
            prefix = masked[max(0, m.start() - 24) : m.start()]
            if re.search(r"(function|interface|type)\s+$", prefix):
                continue
            bounds = _object_bounds_at(masked, m.end())
            line = src[: m.start()].count("\n") + 1
            if bounds is None:
                problems.append(
                    f"{path}:{line}: نداءُ `{name}` لا يُمرِّرُ عقداً حرفيّاً "
                    "(object literal) — لا يُقاسُ تركيبُهُ فلا يُقرأُ مروراً"
                )
                continue
            certain: set[str] = set()
            conditional: set[str] = set()
            for kind, value in _object_entries(masked, src, bounds[0], bounds[1]):
                if kind == "key":
                    certain.add(value)
                elif kind == "spread":
                    c, q, o = _resolve_spread(masked, src, value)
                    certain |= c
                    conditional |= q
                    for reason in o:
                        problems.append(f"{path}:{line}: {reason}")
                elif kind == "unparsed":
                    problems.append(
                        f"{path}:{line}: مُدخلٌ في العقدِ لا يُقرأُ: `{value[:60]}`"
                    )
            sites.append(
                {
                    "path": path,
                    "line": line,
                    "callee": name,
                    "certain": certain,
                    "conditional": conditional,
                }
            )
    return sites, problems


# ── 3) السجلُّ المُعلَنُ ────────────────────────────────────────────────────
def doc_block(doc: str, name: str) -> str:
    m = re.search(
        r"<!--\s*" + name + r":start\s*-->(.*?)<!--\s*" + name + r":end\s*-->", doc, re.S
    )
    return m.group(1) if m else ""


def harness_for(service: str) -> str | None:
    for base in (service, service.rstrip("s")):
        path = f"packages/{base}-e2e/src/harness.ts"
        if os.path.isfile(path):
            return path
    return None


def main(doc_path: str) -> int:
    fail = 0

    def ok(msg: str) -> None:
        print(f"  {GRN}✓{RST} {msg}")

    def bad(msg: str) -> None:
        nonlocal fail
        print(f"  {RED}✗{RST} {msg}")
        fail = 1

    # ── البابُ 1: كلُّ مصنعٍ مقروءٌ ولهُ جذرٌ ──────────────────────────────
    services: dict[str, dict] = {}
    for app_path in sorted(glob.glob("services/*/src/http/app.ts")):
        service = app_path.split("/")[1]
        src = open(app_path, encoding="utf-8").read()
        m = FACTORY_DECL.search(src)
        if m is None:
            bad(f"البابُ 1: `{app_path}` لا يُقرأُ لهُ مصنعُ تطبيقٍ — لا صمتَ عن خدمةٍ")
            continue
        factory, _param, typ = m.groups()
        ports = collect_ports(app_path, src, typ)
        if ports is None:
            bad(f"البابُ 1: عقدُ `{typ}` في `{app_path}` لا يُقرأُ — لا قياسَ على غيابٍ")
            continue
        root = f"services/{service}/src/http/server.ts"
        if not os.path.isfile(root):
            bad(f"البابُ 1: `{app_path}` بلا جذرِ تركيبٍ `{root}`")
            continue
        services[service] = {
            "app": app_path,
            "factory": factory,
            "type": typ,
            "ports": ports,
            "root": root,
        }

    if not services:
        bad("البابُ 1: لا خدمةَ ذاتُ مصنعِ تطبيقٍ وُجِدَت — قياسٌ على فراغٍ لا يُقبَلُ")
    elif fail == 0:
        ok(f"البابُ 1: كلُّ مصنعِ تطبيقٍ مقروءٌ ولهُ جذرُ تركيبٍ ({len(services)} خدمةً)")

    # ── السجلُّ ────────────────────────────────────────────────────────────
    if not os.path.isfile(doc_path):
        bad(f"السجلُّ `{doc_path}` غيرُ موجودٍ — لا استثناءَ بلا سجلٍّ مُعلَنٍ")
        print(f"\n{RED}✗ تركيبُ المنافذِ: إخفاقٌ.{RST}")
        return 1

    doc = open(doc_path, encoding="utf-8").read()
    exempt_block = doc_block(doc, "app-port-exemptions")
    counts_block = doc_block(doc, "app-port-counts")
    if not exempt_block or not counts_block:
        bad("السجلُّ بلا كتلتَيهِ المقروءتَينِ (`app-port-exemptions` · `app-port-counts`)")

    exemptions: dict[tuple[str, str, str], str] = {}
    for raw in exempt_block.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("```"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 4:
            bad(f"صفُّ استثناءٍ لا يُقرأُ (أربعةُ حقولٍ مطلوبةٌ): `{line}`")
            continue
        service, port, scope = parts[0], parts[1], parts[2]
        reason = "|".join(parts[3:])
        if scope not in ("scope:root", "scope:harness"):
            bad(f"نطاقُ استثناءٍ مجهولٌ في `{line}` — `scope:root` أو `scope:harness`")
            continue
        if not reason.startswith("reason:") or len(reason) < 48:
            bad(
                f"استثناءُ `{service}.{port}` بلا سببٍ مكتوبٍ كافٍ — "
                "الاستثناءُ بلا سببٍ تعميةٌ بمظهرِ سجلٍّ"
            )
            continue
        exemptions[(service, port, scope)] = reason

    # ── قياسُ كلِّ جذرٍ ومعوانٍ بنيويّاً ────────────────────────────────────
    measured = {
        "ports": 0,
        "root_wired": 0,
        "root_conditional": 0,
        "harness_wired": 0,
        "harnesses": 0,
        "call_sites": 0,
        "harness_pairs": 0,
    }
    used: set[tuple[str, str, str]] = set()

    def sites_for(path: str, factory: str) -> list[dict] | None:
        src = open(path, encoding="utf-8").read()
        sites, problems = call_sites(path, src, factory)
        for problem in problems:
            bad(f"البابُ 2: {problem}")
        if not sites:
            bad(
                f"البابُ 2: `{path}` لا يُقرأُ فيهِ نداءٌ للمصنعِ `{factory}` — "
                "جذرٌ لا يُقاسُ لا يُقرأُ مروراً"
            )
            return None
        return sites

    for service, info in sorted(services.items()):
        root_sites = sites_for(info["root"], info["factory"])
        if root_sites is None:
            continue
        measured["call_sites"] += len(root_sites)
        for port in info["ports"]:
            measured["ports"] += 1
            missing = [
                s for s in root_sites if port not in s["certain"] | s["conditional"]
            ]
            conditional_only = [
                s
                for s in root_sites
                if port in s["conditional"] and port not in s["certain"]
            ]
            if not missing:
                measured["root_wired"] += 1
                if conditional_only:
                    measured["root_conditional"] += 1
                continue
            key = (service, port, "scope:root")
            if key in exemptions:
                used.add(key)
                continue
            where = " · ".join(f"{s['path']}:{s['line']}" for s in missing)
            bad(
                f"البابُ 2: `{service}` يقبلُ `{port}` ولا يُمرِّرُهُ عقدُ نداءِ "
                f"المصنعِ ({where}) ولا سببَ في السجلِّ — ووجودُ الاسمِ في مُعينٍ "
                "أو أيِّ موضعٍ آخرَ من الملفِّ **ليسَ تركيباً**"
            )

    # ── البابُ 3: معوانُ بوّابةِ الخروجِ يُطابِقُ الجذرَ ───────────────────
    door3 = 0
    for service, info in sorted(services.items()):
        harness = harness_for(service)
        if harness is None:
            continue
        measured["harnesses"] += 1
        root_sites = sites_for(info["root"], info["factory"])
        harness_sites = sites_for(harness, info["factory"])
        if root_sites is None or harness_sites is None:
            continue
        measured["harness_pairs"] += len(harness_sites)
        for port in info["ports"]:
            if any(port not in s["certain"] | s["conditional"] for s in root_sites):
                continue
            door3 += 1
            missing = [
                s for s in harness_sites if port not in s["certain"] | s["conditional"]
            ]
            if not missing:
                measured["harness_wired"] += 1
                continue
            key = (service, port, "scope:harness")
            if key in exemptions:
                used.add(key)
                continue
            where = " · ".join(f"{s['path']}:{s['line']}" for s in missing)
            bad(
                f"البابُ 3: `{port}` مُمرَّرٌ في جذرِ `{service}` وغائبٌ عن عقدِ "
                f"نداءِ معوانِ بوّابةِ الخروجِ ({where}) — البوّابةُ تُجيزُ "
                "تركيباً لا يُشبِهُ الإنتاجَ"
            )

    if fail == 0:
        ok(
            f"البابُ 2: كلُّ منفذٍ اختياريٍّ مُمرَّرٌ في عقدِ نداءِ مصنعِهِ "
            f"({measured['root_wired']}/{measured['ports']} · منها "
            f"{measured['root_conditional']} شرطيٌّ مُعلَنٌ) أو مُستثنىً بسببٍ مكتوبٍ"
        )
        ok(
            f"البابُ 3: معوانُ كلِّ بوّابةِ خروجٍ يُطابِقُ جذرَهُ "
            f"({measured['harness_wired']}/{door3} منفذاً · "
            f"{measured['harnesses']} معواناً)"
        )

    # ── البابُ 4: لا استثناءَ ميتاً ────────────────────────────────────────
    dead = sorted(set(exemptions) - used)
    for service, port, scope in dead:
        bad(
            f"البابُ 4: استثناءٌ ميتٌ `{service}.{port}` ({scope}) — المنفذُ صارَ "
            "مُركَّباً أو لا وجودَ لهُ، والسجلُّ يُبارِكُ ما لا يُقاسُ"
        )
    if not dead:
        ok(f"البابُ 4: لا استثناءَ ميتاً في السجلِّ ({len(exemptions)} استثناءً حيّاً)")

    # ── البابُ 5: الأرقامُ المنشورةُ تُطابِقُ القياسَ ──────────────────────
    published = {
        m.group(1): int(m.group(2))
        for m in re.finditer(r"(\w+)\s*=\s*(\d+)", counts_block)
    }
    expected = {
        "SERVICES_SCANNED": len(services),
        "OPTIONAL_PORTS": measured["ports"],
        "ROOT_WIRED_PORTS": measured["root_wired"],
        "CONDITIONAL_WIRED_PORTS": measured["root_conditional"],
        "HARNESSES_SCANNED": measured["harnesses"],
        "FACTORY_CALL_SITES": measured["call_sites"] + measured["harness_pairs"],
        "EXEMPTIONS": len(exemptions),
    }
    for key, value in expected.items():
        if key not in published:
            bad(f"البابُ 5: `{key}` غيرُ منشورٍ في السجلِّ — رقمٌ مفقودٌ يُرى")
        elif published[key] != value:
            bad(
                f"البابُ 5: `{key}` منشورٌ {published[key]} والقياسُ {value} — "
                "الوثيقةُ تُخالِفُ الشجرةَ"
            )
    if fail == 0:
        ok("البابُ 5: كلُّ رقمٍ منشورٍ يُطابِقُ القياسَ (يُقاسُ ولا يُكتَبُ)")

    print(f"{DIM}  المرجع: {doc_path} · RISK-0044 · M0-41{RST}")
    if fail:
        print(f"\n{RED}✗ تركيبُ المنافذِ: إخفاقٌ — الدفعُ مرفوضٌ.{RST}")
        return 1
    print(f"\n{GRN}✓ تركيبُ المنافذِ: كلُّ الأبوابِ نجحت.{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "docs/12-testing/APP_PORT_WIRING.md"))
