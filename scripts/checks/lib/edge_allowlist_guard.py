#!/usr/bin/env python3
"""edge_allowlist_guard — الحارس 28 · قوائم سماح حدّ القناة (ADR-069 §6-2 · المرحلة 2 · CLM-0521).

يقرأ قوائم `packages/channel-edge/allowlist/<surface>.json` ويحرسها ضد الشفرة والقرار.
كل إخفاق يُطبع برمز ثابت `[EA-…]` تطابقه حالات الطفرة بعينه:

  حالة الفتح  EA-OPEN-CLASS · EA-OPEN-TYPE · EA-FIELD · EA-BLOCKED-REASON
  الفئة O     EA-O-E18 (كل O يُفتح) · EA-O-E19 (كل O يقبل عقده جسمًا) · EA-EVID-O (E-23)
  عقد الجسم   EA-BODY-CONTRACT (accepts_body المعلن = المقيس من الشفرة، فشل مغلق)
  الفئة P     EA-P-E20 (تقييد المعاملات + المنشور فقط)
  الفئة       EA-CLASS-CODE (مقيس من الشفرة) · EA-CLASS-SNAPSHOT · EA-ADM
  الصلاحيات   EA-SCOPE-EMPTY · EA-SCOPE-UNKNOWN (كتالوج الخدمة) · EA-SCOPE-CODE (تطابق تام
              مع حارس المسار) · EA-SCOPE-SNAPSHOT · EA-SCOPE-GRANT (PRODUCTION_GRANTS عند الفتح)
  الوجهة      EA-SVC-SNAPSHOT · EA-SVC-ROUTE
  الأدلة      EA-EVID-FILE · EA-EVID-CASE (it()/test() حيّة)
  النداء      EA-CALL (الفحص 24) · EA-SNAPSHOT-NEW

لا شبكة ولا git: قراءة قرص محضة — مرور أو إخفاق.
المرجع: docs/12-testing/EDGE_ALLOWLIST.md · ADR-069 §2.8.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ALLOWLIST_DIR = ROOT / "packages" / "channel-edge" / "allowlist"
HISTORICAL = (
    ROOT / "docs" / "12-testing" / "ci-evidence"
    / "2026-10-09T140000Z-clm-0518-human-auth-adr" / "route-enforcement.json"
)

# الفئات المسموح فتحها في الإنتاج (ADR-069 §2.8): O بلا قيد، P مشروطة بدليل لم يُكتب.
PRODUCTION_OPEN_CLASSES = {"O", "P"}
SURFACES = ("customer-mini-app", "driver-mini-app")
ALLOWED_SURFACES = set(SURFACES)

# حراس التوجيه كما تُقاس من الشفرة (services/*/src/http/app.ts).
GUARD_PATTERNS: dict[str, str] = {
    "O": r"ownerScoped\(",
    "W": r"asserted(?:Staff|Driver)\(",
    "ADM": r"adminScoped\(",
    "N": r"(?:^|[^\w])(?:scoped|internalScoped|tenantScoped)\(",
}


def fail(msg: str) -> None:
    print(f"  ✗ {msg}")
    FAILURES.append(msg)


FAILURES: list[str] = []


def load_app_calls() -> set[tuple[str, str, str]]:
    """نداءات التطبيقات المقيسة من الفحص 24 (app_api_routes.py)."""
    spec = importlib.util.spec_from_file_location(
        "app_api_routes", ROOT / "scripts" / "checks" / "lib" / "app_api_routes.py"
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    calls, _ = mod.collect_calls(set())
    return {(c["app"], c["method"], mod.fmt(c["path"])) for c in calls}


def service_routes(service: str) -> dict[tuple[str, str], str]:
    """(method, path) → جملة الحارس المقيسة من الشفرة (أول تطابق)."""
    src = (ROOT / "services" / service / "src" / "http" / "app.ts").read_text(encoding="utf-8")
    routes: dict[tuple[str, str], str] = {}
    pattern = re.compile(
        r'app\.(get|put|post|delete|patch)\(\s*\n?\s*"(/[^"]*)",\s*\n?\s*\{[^}]*config:\s*([A-Za-z]+\()'
    )
    for m in pattern.finditer(src):
        method, path, guard = m.group(1).upper(), m.group(2), m.group(3)
        routes.setdefault((method, path), guard)
    return routes


def classify_guard(guard: str) -> str:
    for klass, pat in GUARD_PATTERNS.items():
        if re.search(pat, guard):
            return klass
    return "?"


def measured_class(entry: dict, guard: str) -> str:
    """الفئة المقيسة مع تسامح P.

    ADR-069 §2.8 يصنّف القراءات العامةِ (`P`) بمحتوى الجواب لا بحارس المستقبلِ وحده:
    قراءةٌ عامةٌ تُعلن `scoped`/`internalScoped` ويثبّتُ الحدُّ معاملاتِها (E-20).
    لذا لا يُعدّ التنافرُ إخفاقًا إذا أعلنَ المدخلُ `P` بشرطِ `blocked_until`
    ودليلٍ لم يُكتب — فالحدُّ لا يفتحُها أصلًا.
    """
    measured = classify_guard(guard)
    if measured == "N" and entry.get("class") == "P" and entry.get("blocked_until"):
        return "P"
    return measured


def norm(entry_path: str) -> str:
    """مواءمة مسار المدخل مع مسارات الشفرة (بارامترات مرنة).

    مسارات التطبيقات في الفحص 24 تأتي بصيغة `/customers/:/profile` (اسم البارامتر
    يُحذف) بينما مسارات الشفرة تحتفظ بالاسم — التطبيع يحذف أسماء البارامترات
    من الطرفين ويطابق القطع قطعةً قطعة.
    """
    return re.sub(r":\w+", ":x", entry_path)


def _segment_match(app_path: str, entry_path: str) -> bool:
    """مواءمة قطعةً قطعة: بارامتر التطبيق (`:`) يطابق أي قطعة في المدخل.

    مسار التطبيق قد يحمل قيمةً حرفيّةً حيث يحمل المدخلُ اسمَ بارامترٍ —
    مثال: التطبيق ينادي `/reputation/scores/customer/${customerId}` فيرى
    الفحصُ 24 `/reputation/scores/customer/:` بينما المدخل
    `/reputation/scores/:subjectType/:subjectPublicId`. القطعةُ الحرفيّةُ
    في مسار التطبيقٍ تقبل بارامترًا مطابقًا في المدخل، وبارامترُ التطبيق (`:`)
    يطابق بارامترَ المدخل.
    """
    a = app_path.split("/")
    e = entry_path.split("/")
    if len(a) != len(e):
        return False
    for x, y in zip(a, e):
        if x == y:
            continue
        # بارامتر التطبيق يقابل بارامتر المدخل فقط.
        if x == ":" and y.startswith(":"):
            continue
        # قطعة حرفيّة في التطبيق تقبل بارامترًا في المدخل.
        if y.startswith(":") and x != ":":
            continue
        return False
    return True


# ── مصادر الحقيقة للصلاحيات ووجهة الخدمة ─────────────────────────────────────

SURFACE_ROLE = {"customer-mini-app": "customer-bot", "driver-mini-app": "driver-bot"}
BODY_METHODS = {"POST", "PUT", "PATCH"}
# ADR-069 §7.2 E-20: معاملات يجب أن يرفضها الحد على مسارات P.
# ADR-069 §7.2 E-19: حقول هوية في الجسم يجب ألا تُخزَّن ولا تغيّر المالك.
E19_IDENTITY_FIELDS = ("owner_public_id", "acting_party", "customer_public_id",
                       "driver_public_id", "wasla_public_id", "rater_public_id")
E20_FORBIDDEN_PARAMS = ("state", "moderation_state", "visible_only", "owner_public_id")


def scope_catalog(service: str) -> dict[str, str]:
    """`X_SCOPES.key` → القيمة، من `services/<svc>/src/http/service-identity.ts`.

    الكتالوج المعتمد للخدمة = ثوابت `*_SCOPES` المعلنة فيها، مقصورةً على ما يبدأ
    بـ`<service>:` (صلاحياتها هي لا صلاحيات ما تناديه).
    """
    f = ROOT / "services" / service / "src" / "http" / "service-identity.ts"
    if not f.exists():
        return {}
    src = f.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for m in re.finditer(r"export const (\w+_SCOPES)\s*=\s*\{(.*?)\}", src, re.S):
        const, body = m.group(1), m.group(2)
        for k, v in re.findall(r"(\w+):\s*\"([^\"]+)\"", body):
            if v.startswith(f"{service}:"):
                out[f"{const}.{k}"] = v
    return out


def guard_expression(service: str, method: str, path: str) -> str | None:
    """جملة `config: <guard>(…)` كاملةً (أقواس متوازنة) للمسار في شفرة الخدمة."""
    f = ROOT / "services" / service / "src" / "http" / "app.ts"
    if not f.exists():
        return None
    src = f.read_text(encoding="utf-8")
    rx = re.compile(r"app\." + method.lower() + r"\(\s*\"(/[^\"]*)\"")
    for m in rx.finditer(src):
        if norm(m.group(1)) != norm(path):
            continue
        i = src.find("config:", m.end())
        if i < 0 or i - m.end() > 200:
            continue
        j = i + len("config:")
        while j < len(src) and src[j].isspace():
            j += 1
        k = src.find("(", j)
        depth, q = 0, k
        while q < len(src):
            if src[q] == "(":
                depth += 1
            elif src[q] == ")":
                depth -= 1
                if depth == 0:
                    break
            q += 1
        return " ".join(src[j : q + 1].split())
    return None


def _route_block(src: str, method: str, path: str) -> str | None:
    """نص تسجيل المسار ومعالجه: من `app.<method>("path"` حتى تسجيل المسار التالي."""
    rx = re.compile(r"app\." + method.lower() + r"\(\s*\"(/[^\"]*)\"")
    nxt = re.compile(r"\n\s*app\.(?:get|post|put|patch|delete|head|options|route|register)\(")
    for m in rx.finditer(src):
        if norm(m.group(1)) == norm(path):
            n = nxt.search(src, m.end())
            return src[m.end() : n.start() if n else len(src)]
    return None


def _balanced(src: str, i: int, open_c: str, close_c: str) -> int:
    depth = 0
    for q in range(i, len(src)):
        if src[q] == open_c:
            depth += 1
        elif src[q] == close_c:
            depth -= 1
            if depth == 0:
                return q
    return len(src) - 1


def _local_function_body(src: str, name: str) -> str | None:
    """جسم `function name(…) {…}` أو `const name = (…) => {…}` في الملف نفسه، وإلا None."""
    m = re.search(r"(?:async\s+)?function\s+" + re.escape(name) + r"\s*\(", src) or \
        re.search(r"const\s+" + re.escape(name) + r"\s*=\s*(?:async\s*)?\(", src)
    if not m:
        return None
    sig_end = _balanced(src, m.end() - 1, "(", ")")
    b = src.find("{", sig_end)
    if b < 0:
        return None
    return src[b : _balanced(src, b, "{", "}") + 1]


def measured_accepts_body(service: str, method: str, path: str) -> tuple[bool, str]:
    """عقد قبول جسم الطلب، مقيسًا من الشفرة (ADR-069 §2.8 قاعدة E-18/E-19) — فشل مغلق.

    POST/PUT/PATCH قابلة للجسم دائمًا. GET/DELETE وغيرها: قابلة إن قرأ المعالج `body`،
    أو مرّر `request` إلى دالة محلية تقرؤه، أو إلى دالة لا يُعرف تعريفها في الملف.
    """
    if method in BODY_METHODS:
        return True, f"{method} قابلة للجسم بدلالة HTTP"
    f = ROOT / "services" / service / "src" / "http" / "app.ts"
    src = f.read_text(encoding="utf-8") if f.exists() else ""
    blk = _route_block(src, method, path)
    if blk is None:
        return True, "المسار غير موجود — فشل مغلق"
    if re.search(r"\bbody\b", blk):
        return True, "المعالج يقرأ body"
    for m in re.finditer(r"\brequest\b(?!\s*\??\.)(?!\s*:)", blk):
        # الدالة المحيطة: أقرب `(` غير مغلق قبل الموضع.
        depth, q = 0, m.start() - 1
        while q >= 0:
            if blk[q] == ")":
                depth += 1
            elif blk[q] == "(":
                if depth == 0:
                    break
                depth -= 1
            q -= 1
        name = re.search(r"([A-Za-z_$][\w$]*)\s*$", blk[:q]) if q >= 0 else None
        if not name or name.group(1) in ("async", "function"):
            continue  # قائمة معاملات المعالج `(request, reply) =>`
        body_src = _local_function_body(src, name.group(1))
        if body_src is None:
            return True, f"يمرّر request إلى {name.group(1)} غير المعرّفة محليًا — فشل مغلق"
        if re.search(r"\bbody\b", body_src):
            return True, f"يمرّر request إلى {name.group(1)} التي تقرأ body"
    return False, "لا قراءة جسم في المعالج ولا في ما يمرَّر إليه request"


def resolve_scopes(expr: str, catalog: dict[str, str]) -> list[str] | None:
    """وسائط الحارس → قيم الصلاحيات. ثابت غير محلول ⇒ None (فشل مغلق)."""
    m = re.match(r"\w+\((.*)\)$", expr)
    if not m:
        return None
    out: list[str] = []
    for arg in [a.strip() for a in m.group(1).split(",") if a.strip()]:
        lit = re.fullmatch(r"[\"'`]([^\"'`]+)[\"'`]", arg)
        if lit:
            out.append(lit.group(1))
        elif arg in catalog:
            out.append(catalog[arg])
        else:
            return None
    return out


def bot_grants(role: str, audience: str) -> set[str]:
    """صلاحيات `role` على `audience` في `PRODUCTION_GRANTS` (packages/authz-policy/src/grants.ts)."""
    src = (ROOT / "packages" / "authz-policy" / "src" / "grants.ts").read_text(encoding="utf-8")
    src = re.sub(r"//[^\n]*", "", src)
    m = re.search(r"\"?" + re.escape(role) + r"\"?\s*:\s*\[", src)
    if not m:
        return set()
    depth, q = 0, m.end() - 1
    while q < len(src):
        if src[q] == "[":
            depth += 1
        elif src[q] == "]":
            depth -= 1
            if depth == 0:
                break
        q += 1
    block = src[m.end() : q]
    found: set[str] = set()
    for g in re.finditer(r"audience:\s*\"([^\"]+)\"\s*,\s*scopes:\s*\[(.*?)\]", block, re.S):
        if g.group(1) == audience:
            found |= set(re.findall(r"\"([^\"]+)\"", g.group(2)))
    return found


# ── الأدلة ──────────────────────────────────────────────────────────────────

def path_regex(entry_path: str) -> re.Pattern[str]:
    """مسار المدخل → نمط يطابق نداءه في ملف اختبار (`:x` ⇒ قطعة واحدة، `${A}` مقبول)."""
    parts = []
    for seg in entry_path.split("/"):
        parts.append(r"[^/\s\"'`?]+" if seg.startswith(":") else re.escape(seg))
    return re.compile("/".join(parts) + r"(?![\w-])")


def in_ci_package(f: Path) -> bool:
    """ملف `*.test.ts(x)` داخل حزمة مساحة عمل لها سكربت `test` — أي أن CI يشغّله."""
    if not re.search(r"\.(test|spec)\.(ts|tsx)$", f.name):
        return False
    d = f.parent
    while d != ROOT and d != d.parent:
        pj = d / "package.json"
        if pj.exists():
            try:
                return "test" in (json.loads(pj.read_text(encoding="utf-8")).get("scripts") or {})
            except Exception:
                return False
        d = d.parent
    return False


def case_is_live_test(src: str, case: str) -> bool:
    """العنوان حالة `it(`/`test(` فعلية — لا تعليق ولا `it.skip`/`it.todo`."""
    q = r"[\"'`]" + re.escape(case) + r"[\"'`]"
    live = re.search(r"(?<![\w.])(?:it|test)\(\s*" + q, src)
    dead = re.search(r"(?:it|test)\.(?:skip|todo)\(\s*" + q, src)
    return bool(live) and not dead


def evidence_for(e: dict, proof: str, tag: str, need_off: bool) -> list[str]:
    """أخطاء دليل `proof` للمسار نفسه؛ قائمة فارغة = دليل صريح مستوفٍ."""
    route = f"{e['method']} {e['path']}"
    cands = [t for t in e.get("evidence_tests", []) if proof in (t.get("proves") or [])]
    if not cands:
        return [f"لا دليل {proof} معلن (proves) على هذا المسار"]
    problems: list[str] = []
    for t in cands:
        why: list[str] = []
        if t.get("route") != route:
            why.append(f"route={t.get('route')!r} لا يساوي {route!r}")
        f = ROOT / str(t.get("file", ""))
        if not f.is_file():
            why.append(f"الملف غير موجود: {t.get('file')}")
        else:
            src = f.read_text(encoding="utf-8")
            if not in_ci_package(f):
                why.append("الملف ليس ملف اختبار في حزمة يشغّلها CI")
            if not t.get("case") or not case_is_live_test(src, t["case"]):
                why.append("الحالة ليست it()/test() حيّة في الملف")
            if not path_regex(e["path"]).search(src):
                why.append("الملف لا ينادي المسار نفسه")
            if need_off:
                if t.get("receiver_mode") != "off":
                    why.append(f"receiver_mode={t.get('receiver_mode')!r} لا 'off'")
                if "WASLA_USER_ASSERTION_MODE" not in src or not re.search(r"[\"'`]off[\"'`]", src):
                    why.append("الملف لا يضبط WASLA_USER_ASSERTION_MODE=off")
            if proof == "E-19" and not any(re.search(r"\b" + k + r"\b", src) for k in E19_IDENTITY_FIELDS):
                why.append(f"لا يرسل أي حقل هوية من §7.2 {list(E19_IDENTITY_FIELDS)}")
            if proof == "E-20:params":
                missing = [p for p in E20_FORBIDDEN_PARAMS if p not in src]
                if missing:
                    why.append(f"لا يختبر رفض المعاملات {missing}")
                if "400" not in src:
                    why.append("لا يؤكد 400 من الحد")
        if not why:
            return []
        problems.append(f"{t.get('file')}: " + "؛ ".join(why))
    return problems


def check_surface(surface: str, app_calls: set[tuple[str, str, str]]) -> None:
    path = ALLOWLIST_DIR / f"{surface}.json"
    if not path.exists():
        fail(f"[EA-FILE] {surface}: الملف مفقود")
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("surface") != surface:
        fail(f"[EA-FILE] {surface}: حقل surface لا يطابق اسم الملف")

    entries = data.get("entries", [])
    if not entries:
        fail(f"[EA-FILE] {surface}: قائمة فارغة — لا يوثّق الحارس شيئًا")

    snap = json.loads(HISTORICAL.read_text(encoding="utf-8")) if HISTORICAL.exists() else None
    if snap is None:
        fail("[EA-SNAPSHOT-MISSING] لقطة route-enforcement.json مفقودة — لا مصدر تاريخي للفئة والخدمة (فشل مغلق)")
    role = SURFACE_ROLE[surface]

    for e in entries:
        tag = f"{surface} {e.get('method')} {e.get('path')}"
        missing = [f for f in ("method", "path", "service", "class", "required_scopes",
                               "evidence_tests", "production_open", "accepts_body") if f not in e]
        if missing:
            fail(f"[EA-FIELD] {tag}: حقول غائبة {missing}")
            continue
        if e["class"] not in ("O", "P", "W", "N", "ADM"):
            fail(f"[EA-CLASS-UNKNOWN] {tag}: فئة غير معروفة {e['class']!r}")
            continue
        if e["class"] == "ADM":
            fail(f"[EA-ADM] {tag}: ADM في قائمة تطبيق Mini App — إدارة تُدار في admin-edge (المرحلة 4)")

        # ── حالة الفتح ───────────────────────────────────────────────────
        opened = e["production_open"]
        if not isinstance(opened, bool):
            fail(f"[EA-OPEN-TYPE] {tag}: production_open={opened!r} ليست true/false حرفيًا")
            opened = True  # فشل مغلق: قيمة ملتبسة تُعامل كفتح فتُفحص أبوابه كلها
        if opened and e["class"] not in PRODUCTION_OPEN_CLASSES:
            fail(f"[EA-OPEN-CLASS] {tag}: production_open لفئة {e['class']} — محجوبة حتى G-ENF/حارس مختبر")

        # عقد قبول الجسم: المعلن يساوي المقيس من الشفرة (ADR-069 §2.8 قاعدة E-18/E-19).
        body_measured, body_why = measured_accepts_body(e["service"], e["method"], e["path"])
        declared = e["accepts_body"]
        if not isinstance(declared, bool):
            fail(f"[EA-BODY-CONTRACT] {tag}: accepts_body={declared!r} ليست true/false حرفيًا")
        elif declared != body_measured:
            fail(f"[EA-BODY-CONTRACT] {tag}: accepts_body={declared} يخالف المقيس "
                 f"({body_measured}: {body_why}) — العقد يُقاس من الشفرة لا يُعلن")
        accepts_body = body_measured or declared is not False  # فشل مغلق

        # O: E-18 لكل مسار يُفتح؛ E-19 لكل مسار يقبل عقده جسمًا — لا بالطريقة.
        if opened and e["class"] == "O":
            for why in evidence_for(e, "E-18", tag, need_off=True):
                fail(f"[EA-O-E18] {tag}: فتح O بلا دليل E-18 صريح — {why}")
            if accepts_body:
                for why in evidence_for(e, "E-19", tag, need_off=True):
                    fail(f"[EA-O-E19] {tag}: فتح O يقبل عقده جسمًا بلا دليل E-19 صريح — {why}")
        # P: E-20 بشقيه — معاملات مقيدة، وجواب لا يحوي إلا المنشور.
        e20_ok = False
        if e["class"] == "P":
            p1 = evidence_for(e, "E-20:params", tag, need_off=False)
            p2 = evidence_for(e, "E-20:published-only", tag, need_off=False)
            e20_ok = not p1 and not p2
            if opened:
                for why in p1:
                    fail(f"[EA-P-E20] {tag}: فتح P بلا دليل تقييد المعاملات (E-20) — {why}")
                for why in p2:
                    fail(f"[EA-P-E20] {tag}: فتح P بلا دليل «المنشور فقط» (E-20) — {why}")
        if not opened and e["class"] != "O" and not e.get("blocked_until"):
            fail(f"[EA-BLOCKED-REASON] {tag}: مدخل مغلق غير O بلا blocked_until")

        # الدليل شرط حصر: كل مدخل O يحمل اختبار ملكية ولو كان مغلقًا (E-23).
        if e["class"] == "O" and not e["evidence_tests"]:
            fail(f"[EA-EVID-O] {tag}: فئة O بلا evidence_tests — الدليل يقيس حصر الملكية (E-23)")

        # ── وجهة الخدمة: التاريخي والمقيس ────────────────────────────────
        row = None
        if snap is not None:
            row = next((r for r in snap["routes"] if r["app"] == surface and r["method"] == e["method"]
                        and norm(r["path"]) == norm(e["path"])), None)
            if row is None:
                fail(f"[EA-SNAPSHOT-NEW] {tag}: مدخل خارج لقطة route-enforcement.json — يحتاج قرارًا موثقًا")
            else:
                if row["service"] != e["service"]:
                    fail(f"[EA-SVC-SNAPSHOT] {tag}: الخدمة {e['service']!r} تخالف وجهة اللقطة "
                         f"{row['service']!r} — تغيير الوجهة قرار لا تعديل قائمة")
                if row["klass"] != e["class"]:
                    fail(f"[EA-CLASS-SNAPSHOT] {tag}: الفئة {e['class']} تخالف اللقطة {row['klass']}")
        expr = guard_expression(e["service"], e["method"], e["path"])
        if expr is None:
            fail(f"[EA-SVC-ROUTE] {tag}: لا مسار مطابق في services/{e['service']}/src/http/app.ts")
        else:
            measured = classify_guard(expr)
            if measured == "N" and e["class"] == "P" and (e.get("blocked_until") or e20_ok):
                measured = "P"
            if measured != e["class"]:
                fail(f"[EA-CLASS-CODE] {tag}: الفئة المعلنة {e['class']} تخالف المقيس ({expr} ⇒ {measured})")

        # ── الصلاحيات ────────────────────────────────────────────────────
        scopes = e["required_scopes"]
        catalog = scope_catalog(e["service"])
        approved = set(catalog.values())
        if not isinstance(scopes, list) or not scopes or not all(isinstance(x, str) and x for x in scopes):
            fail(f"[EA-SCOPE-EMPTY] {tag}: required_scopes يجب أن تكون قائمة نصوص غير فارغة")
            scopes = []
        elif len(set(scopes)) != len(scopes):
            fail(f"[EA-SCOPE-DUP] {tag}: صلاحيات مكررة {scopes}")
        unknown = [x for x in scopes if x not in approved]
        if unknown:
            fail(f"[EA-SCOPE-UNKNOWN] {tag}: {unknown} ليست في كتالوج صلاحيات {e['service']} المعتمد")
        if expr is not None:
            code_scopes = resolve_scopes(expr, catalog)
            if code_scopes is None:
                fail(f"[EA-SCOPE-CODE] {tag}: تعذّر حل صلاحيات الحارس {expr} من الكتالوج (فشل مغلق)")
            elif sorted(code_scopes) != sorted(scopes):
                fail(f"[EA-SCOPE-CODE] {tag}: required_scopes {scopes} ≠ صلاحيات المسار في الشفرة {code_scopes}")
        if row is not None:
            snap_scopes = resolve_scopes(row["guard"], scope_catalog(row["service"]))
            if snap_scopes is None or sorted(snap_scopes) != sorted(scopes):
                fail(f"[EA-SCOPE-SNAPSHOT] {tag}: required_scopes {scopes} ≠ صلاحيات اللقطة "
                     f"({row['guard']} ⇒ {snap_scopes}) — تغيير الإذن يحتاج قرارًا موثقًا")
        if opened:
            granted = bot_grants(role, e["service"])
            lacking = [x for x in scopes if x not in granted]
            if lacking:
                fail(f"[EA-SCOPE-GRANT] {tag}: فتح بلا منح {lacking} للدور {role} على {e['service']} في PRODUCTION_GRANTS")

        # ── الأدلة المعلنة موجودة فعلًا ──────────────────────────────────
        for t in e["evidence_tests"]:
            f = ROOT / str(t.get("file", ""))
            if not f.is_file():
                fail(f"[EA-EVID-FILE] {tag}: ملف الدليل غير موجود: {t.get('file')}")
            elif t.get("case") and not case_is_live_test(f.read_text(encoding="utf-8"), t["case"]):
                fail(f"[EA-EVID-CASE] {tag}: الحالة ليست it()/test() حيّة في {t['file']}: {t['case'][:60]}…")

        # ── التطبيق ينادي المسار (الفحص 24) ─────────────────────────────
        called = any(app == surface and method == e["method"]
                     and (norm(a_path) == norm(e["path"]) or _segment_match(a_path, e["path"]))
                     for app, method, a_path in app_calls)
        if not called:
            fail(f"[EA-CALL] {tag}: التطبيق لا ينادي هذا المسار (الفحص 24)")


def main() -> int:
    files = sorted(p.name for p in ALLOWLIST_DIR.glob("*.json")) if ALLOWLIST_DIR.exists() else []
    unexpected = [f for f in files if f.removesuffix(".json") not in ALLOWED_SURFACES]
    if unexpected:
        fail(f"ملفات قوائم غير معتمدة: {unexpected}")
    missing = [s for s in SURFACES if f"{s}.json" not in files]
    if missing:
        fail(f"قوائم مفقودة: {missing}")

    app_calls = load_app_calls()
    for surface in SURFACES:
        if f"{surface}.json" in files:
            check_surface(surface, app_calls)

    total = 0
    for surface in SURFACES:
        p = ALLOWLIST_DIR / f"{surface}.json"
        if p.exists():
            total += len(json.loads(p.read_text(encoding="utf-8")).get("entries", []))

    if FAILURES:
        print(f"\n✗ edge-allowlist-guard: {len(FAILURES)} إخفاقًا (من {total} مدخلًا)")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print(f"\n✓ edge-allowlist-guard: مرور — {total} مدخلًا مطابقة للشفرة والقرار")
    return 0


if __name__ == "__main__":
    sys.exit(main())
