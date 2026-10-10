#!/usr/bin/env python3
"""edge_allowlist_guard — الحارس 28 · قوائم سماح حدّ القناة (ADR-069 §6-2 · المرحلة 2 · CLM-0521).

يقرأ قوائم `packages/channel-edge/allowlist/<surface>.json` ويحرسها ضد الشفرة الفعلية:

  (أ) مسار إنتاجي (production_open) بفئة W/N/ADM ⇒ إخفاق (P مسموحة مشروطة بدليل E-20).
  (ب) المدخل يدعي فئةً تخالف التصنيف المقيس من شفرة الخدمة (ownerScoped/assertedX/scoped...) ⇒ إخفاق.
  (ج) evidence_tests غائبة أو تشير إلى ملف/حالة غير موجودة ⇒ إخفاق.
  (د) المسار لا يناديه التطبيق في الفحص 24 (app_api_routes.py) ⇒ إخفاق.
  (هـ) المدخل خارج لقطة route-enforcement.json التاريخية بلا تعليل ⇒ إخفاق (باب انحراف العرض).

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


def check_surface(surface: str, app_calls: set[tuple[str, str, str]]) -> None:
    path = ALLOWLIST_DIR / f"{surface}.json"
    if not path.exists():
        fail(f"{surface}: الملف مفقود")
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("surface") != surface:
        fail(f"{surface}: حقل surface لا يطابق اسم الملف")

    entries = data.get("entries", [])
    if not entries:
        fail(f"{surface}: قائمة فارغة — لا يوثّق الحارس شيئًا")

    for e in entries:
        tag = f"{surface} {e.get('method')} {e.get('path')}"
        for field in ("method", "path", "service", "class", "required_scopes", "evidence_tests"):
            if field not in e:
                fail(f"{tag}: الحقل {field} غائب")
        if e.get("class") not in ("O", "P", "W", "N", "ADM"):
            fail(f"{tag}: فئة غير معروفة")
            continue
        if e.get("class") == "ADM":
            fail(f"{tag}: ADM في قائمة تطبيق Mini App — إدارة تُدار في admin-edge (المرحلة 4)")

        # (أ) فتح إنتاجي لفئة محجوبة
        if e.get("production_open") and e.get("class") not in PRODUCTION_OPEN_CLASSES:
            fail(f"{tag}: production_open=true لفئة {e['class']} — محجوبة حتى G-ENF/حارس مختبر")
        # الدليلُ شرطُ حصرٍ لا شرطَ فتحٍ: فئةُ O تُعلِنُ حصرَ القراءةِ إلى مالكِهِ
        # (ownerScoped)، ولا يُقبلُ بديعٌ لمسارٍ مصنَّفٍ O بلا اختبارٍ يقيسُ
        # هذا الحصرَ (فحصُ E-23). ``production_open=false`` يُعلِنُ انسدادَ الحدِّ
        # الحاليَّ لا غيابَ الدليلِ — وإلّا فيستطيعُ مسرِّحٌ إخفاءَ فئةِ P خلفَ
        # ``false`` بلا دليلٍ.
        if e.get("class") == "O" and not e.get("evidence_tests"):
            fail(f"{tag}: فئة O بلا evidence_tests — الدليلُ يقيسُ حصرَ القراءةِ (E-23)")

        # (ب) مواءمة الفئة مع الشفرة
        svc_routes = service_routes(e["service"])
        key = (e["method"], norm(e["path"]))
        hit = svc_routes.get(key)
        if hit is None:
            # جرب المواءمة المرنة (بارامتر بأسماء مختلفة)
            for (m, p), guard in svc_routes.items():
                if m == e["method"] and norm(p) == norm(e["path"]):
                    hit = guard
                    break
        if hit is None:
            fail(f"{tag}: لا مسار مطابق في services/{e['service']}/src/http/app.ts")
        else:
            measured = measured_class(e, hit)
            if measured != e["class"]:
                fail(
                    f"{tag}: الفئة المعلنة {e['class']} تخالف المقيس من الشفرة "
                    f"({hit.strip()[:-1]} ⇒ {measured})"
                )

        # (ج) evidence_tests موجودة فعلًا
        for t in e.get("evidence_tests", []):
            f = ROOT / t["file"]
            if not f.exists():
                fail(f"{tag}: ملف الدليل غير موجود: {t['file']}")
            else:
                src = f.read_text(encoding="utf-8")
                if t.get("case") and t["case"] not in src:
                    fail(f"{tag}: حالة الدليل غير موجودة في {t['file']}: {t['case'][:60]}…")

        # (د) التطبيق ينادي المسار (الفحص 24)
        called = any(
            app == surface and method == e["method"] and norm(a_path) == norm(e["path"])
            for app, method, a_path in app_calls
        )
        if not called:
            # مسارات الفحص 24 تحذف أسماء البارامترات (`:` بلا اسم) — مواءمة القطع،
            # وقطعةٌ حرفيّةٌ في مسار التطبيق تقبل بارامترًا مطابقًا في المدخل
            # (`/reputation/scores/customer/:` يقابل `:subjectType/:subjectPublicId`).
            called = any(
                app == surface
                and method == e["method"]
                and _segment_match(a_path, e["path"])
                for app, method, a_path in app_calls
            )
        if not called:
            fail(f"{tag}: التطبيق لا ينادي هذا المسار (الفحص 24)")

        # (هـ) باب انحراف العرض التاريخي
        if HISTORICAL.exists():
            snap = json.loads(HISTORICAL.read_text(encoding="utf-8"))
            row = next(
                (
                    r
                    for r in snap["routes"]
                    if r["app"] == surface
                    and r["method"] == e["method"]
                    and norm(r["path"]) == norm(e["path"])
                ),
                None,
            )
            if row is None:
                fail(
                    f"{tag}: مدخل جديد خارج لقطة route-enforcement.json — "
                    "يتعين تعليله في $comment أو تحديث اللقطة بقرار"
                )
            elif row["klass"] != e["class"]:
                fail(
                    f"{tag}: الفئة {e['class']} تخالف اللقطة التاريخية {row['klass']} "
                    "— التصنيف تغيّر ويحتاج قرارًا موثقًا"
                )


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
