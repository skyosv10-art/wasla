#!/usr/bin/env python3
"""engineering_completion_inventory.py — جردٌ آليٌّ قابلٌ لإعادة التشغيل (قراءةٌ فقط).

يقيس من الشجرة وحدها (لا من تقارير):
  • services: كلُّ مسار HTTP مسجَّل · نوعُ حمايته (config) · الاختباراتُ التي تذكره
    (نجاحٌ 2xx / فشلٌ 4xx في الملف نفسه) · هل يناديه تطبيق · هل يناديه روبوت/خدمة.
  • apps: كلُّ نداء API · ملفُّه · المسارُ المطابق في خدمة.
  • screens: كلُّ شاشة · الأزرار/النماذج · المعالجاتُ الفارغة · مؤشراتُ البيانات الثابتة.
  • db: الترحيلاتُ والجداولُ لكلِّ خدمة واختباراتُ التكامل.
  • e2e: الحزمُ ونمطُها (HTTP حقيقي على Postgres أم in-memory أم محاكاة).

لا يتصل بأيِّ شبكةٍ ولا قاعدةٍ ولا يكتب إلّا إلى مسار --out.
    python3 scripts/audit/engineering_completion_inventory.py --out artifacts/audit/inventory.json
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts/checks/lib"))
import app_api_routes as eng  # noqa: E402

ROUTE_RX = re.compile(
    r"\b(\w+)\.(get|post|put|patch|delete)\s*(?:<(?:[^<>()]|<[^<>()]*>)*>)?\(\s*([\"'`])(/[^\"'`]*)\3\s*,\s*(\{[^{}]*?config\s*:\s*([^,}]+(?:\([^)]*\))?)[^{}]*\})?",
    re.S,
)


def read(p: str) -> str:
    with open(p, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def test_files(root: str) -> list[str]:
    out = []
    for ext in ("ts", "tsx"):
        out += glob.glob(f"{root}/**/*.test.{ext}", recursive=True)
        out += glob.glob(f"{root}/**/*.spec.{ext}", recursive=True)
    return sorted(f for f in out if "/node_modules/" not in f)


def path_regex(path: str) -> re.Pattern:
    parts = []
    for seg in path.strip("/").split("/"):
        if seg.startswith(":"):
            parts.append(r"(?:\$\{[^}]+\}|[A-Za-z0-9_\-.:%]+)")
        else:
            parts.append(re.escape(seg))
    return re.compile(r"[\"'`]/" + "/".join(parts) + r"(?:[?\"'`])")


def collect_routes() -> list[dict]:
    routes = []
    for f in eng.source_files("services"):
        if "/src/" not in f:
            continue
        svc = f.split("/")[1]
        src = eng.strip_comments(read(f))
        for m in ROUTE_RX.finditer(src):
            cfg = (m.group(6) or "").strip()
            if not cfg:
                # config may be on the next lines (multi-line options object)
                tail = src[m.end() : m.end() + 400]
                mm = re.match(r"\s*,?\s*\{\s*config\s*:\s*([^,}\n]+)", tail)
                cfg = mm.group(1).strip() if mm else ""
            routes.append({
                "service": svc,
                "method": m.group(2).upper(),
                "path": m.group(4),
                "file": f,
                "line": src.count("\n", 0, m.start()) + 1,
                "guard": cfg or "<none-declared>",
            })
    return routes


def classify_guard(g: str) -> str:
    gl = g.lower()
    if g == "<none-declared>":
        return "UNDECLARED"
    if "open" in gl:
        return "OPEN"
    if "owner" in gl:
        return "OWNER_SCOPED"
    if "scoped" in gl or "scope" in gl or "service" in gl:
        return "SCOPED"
    if "admin" in gl or "role" in gl:
        return "ROLE"
    return "OTHER:" + g[:40]


NON_RUNTIME = re.compile(r"packages/([a-z-]+-e2e|golden-e2e|test-utils|load-testing|contracts|authz-policy)/")


def is_runtime_caller(f: str) -> bool:
    if NON_RUNTIME.match(f):
        return False
    return not ("/__tests__/" in f or "harness" in f or "fixture" in f)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    doc = read("docs/12-testing/APP_API_ROUTES.md")
    transport = {r[0] for r in eng.table_rows(eng.doc_block(doc, "app-api-transport")) if r}
    calls, unresolved = eng.collect_calls(transport)
    routes = collect_routes()

    # caller index: apps
    for r in routes:
        segs = eng.norm_service_path(r["path"])
        r["app_callers"] = sorted({c["app"] + ":" + c["where"].split(":")[0].split("/src/")[-1]
                                   for c in calls if c["method"] == r["method"] and eng.matches(c["path"], segs)})
        r["guard_class"] = classify_guard(r["guard"])

    # internal callers (bots / services / packages, non-test) — literal path mention
    internal_files = [f for f in eng.source_files("bots") + eng.source_files("services") + eng.source_files("packages")]
    internal_src = {f: eng.strip_comments(read(f)) for f in internal_files}
    tests = {}
    for root in ("services", "packages", "bots", "apps"):
        for f in test_files(root):
            tests[f] = read(f)
    for r in routes:
        rx = path_regex(r["path"])
        own = r["service"]
        r["internal_callers"] = sorted({f for f, s in internal_src.items()
                                        if rx.search(s) and not f.startswith(f"services/{own}/")})
        hits = [f for f, s in tests.items() if rx.search(s)]
        r["tests"] = hits
        ok = neg = False
        for f in hits:
            s = tests[f]
            if re.search(r"\b20[01]\b|\b204\b", s):
                ok = True
            if re.search(r"\b4(00|01|03|04|09|22|29)\b", s):
                neg = True
        r["test_success"] = ok
        r["test_failure"] = neg
        r["e2e_tests"] = [f for f in hits if re.match(r"packages/[a-z-]+-e2e/", f) or "golden-e2e" in f]
        # runtime callers only: a literal path in a test harness, a contract type file or the
        # authz policy table is NOT a caller (the policy table names every route by design).
        r["runtime_http_callers"] = [f for f in r["internal_callers"] if is_runtime_caller(f)]
        r["caller_kind"] = ("app" if r["app_callers"] else
                            "internal-http" if r["runtime_http_callers"] else "none-http")

    # apps: unmatched calls
    svc_index = eng.collect_services()
    for c in calls:
        c["matched_services"] = sorted({s for (m, segs), ss in svc_index.items() for s in ss
                                        if m == c["method"] and eng.matches(c["path"], segs)})
        c["path"] = eng.fmt(c["path"])

    # screens
    screens = []
    for f in sorted(glob.glob("apps/*/src/screens/*.tsx")):
        s = read(f)
        screens.append({
            "app": f.split("/")[1],
            "screen": os.path.basename(f)[:-4],
            "file": f,
            "buttons": len(re.findall(r"<button\b|<Button\b", s)),
            "forms": len(re.findall(r"<form\b", s)),
            "inputs": len(re.findall(r"<input\b|<select\b|<textarea\b", s)),
            "onclick_handlers": len(re.findall(r"onClick=\{", s)),
            "empty_handlers": len(re.findall(r"on[A-Z]\w*=\{\s*\(\)\s*=>\s*\{\s*\}\s*\}|on[A-Z]\w*=\{\s*\(\)\s*=>\s*(?:undefined|null)\s*\}", s)),
            "todo_markers": len(re.findall(r"\b(TODO|FIXME|XXX|stub|placeholder|coming soon|not implemented)\b", s, re.I)),
            "store_imports": sorted(set(re.findall(r"from\s+[\"']\.\./store/([\w-]+)", s))),
            "api_imports": bool(re.search(r"from\s+[\"']\.\./api/", s)),
            "literal_arrays": len(re.findall(r"=\s*\[\s*\{\s*\w+\s*:", s)),
            "unit_tests": [t for t in tests if t.startswith(f"apps/{f.split('/')[1]}/") and os.path.basename(f)[:-4] in tests[t]],
        })
    # store → calls
    stores = {}
    for c in calls:
        key = c["app"] + ":" + c["where"].split(":")[0]
        stores.setdefault(key, []).append(f'{c["method"]} {c["path"]}')

    # db
    db = []
    for svc in sorted(os.listdir("services")):
        mig = sorted(glob.glob(f"services/{svc}/drizzle/*.sql") + glob.glob(f"services/{svc}/migrations/*.sql"))
        up = [m for m in mig if not m.endswith(".down.sql")]
        tables = set()
        for m in up:
            tables |= set(re.findall(r'CREATE TABLE(?: IF NOT EXISTS)?\s+"?(?:\w+"?\.)?"?(\w+)"?', read(m), re.I))
        itests = [t for t in tests if t.startswith(f"services/{svc}/") and ".integration." in t]
        db.append({"service": svc, "migrations_up": len(up), "migrations_down": len(mig) - len(up),
                   "tables": sorted(tables), "integration_tests": len(itests),
                   "has_http": any(r["service"] == svc for r in routes),
                   "src_files": len(eng.source_files(f"services/{svc}/src"))})

    # e2e packages
    e2e = []
    for p in sorted(set(glob.glob("packages/*-e2e")) | {"packages/golden-e2e"}):
        if not os.path.isdir(p):
            continue
        srcs = "\n".join(read(f) for f in glob.glob(f"{p}/**/*.ts", recursive=True) if "/node_modules/" not in f)
        e2e.append({"package": p,
                    "files": len([f for f in glob.glob(f"{p}/**/*.ts", recursive=True) if "/node_modules/" not in f]),
                    "uses_real_pg": bool(re.search(r"DATABASE_URL|new Pool|pg\.Pool|postgres", srcs)),
                    "uses_http_inject": bool(re.search(r"\.inject\(", srcs)),
                    "uses_real_listen": bool(re.search(r"\.listen\(", srcs)),
                    "in_memory": bool(re.search(r"in-memory|InMemory", srcs)),
                    "services_imported": sorted(set(re.findall(r"@wasla/([a-z-]+)-service", srcs)))})

    bots = []
    for b in sorted(glob.glob("bots/*")):
        srcs = {f: read(f) for f in eng.source_files(f"{b}/src")}
        allsrc = "\n".join(srcs.values())
        bots.append({"bot": b, "files": len(srcs),
                     "commands": sorted(set(re.findall(r"[\"'`]/(start|help|\w+)[\"'`]", allsrc)))[:40],
                     "http_paths": sorted(set(re.findall(r"[\"'`](/[a-z][\w/:\-${}.]*)[\"'`]", allsrc)))[:60],
                     "tests": len(test_files(b))})

    domain = [r for r in routes if not r["path"].endswith(("/health", "/ready"))]
    summary = {
        "routes_total": len(routes), "routes_domain": len(domain),
        "routes_domain_tested": sum(1 for r in domain if r["tests"]),
        "routes_domain_success_and_failure": sum(1 for r in domain if r["test_success"] and r["test_failure"]),
        "routes_domain_untested": [f'{r["service"]} {r["method"]} {r["path"]}' for r in domain if not r["tests"]],
        "caller_kind": {k: sum(1 for r in domain if r["caller_kind"] == k) for k in ("app", "internal-http", "none-http")},
        "routes_none_http": [f'{r["service"]} {r["method"]} {r["path"]}' for r in domain if r["caller_kind"] == "none-http"],
        "app_calls": len(calls), "app_calls_unresolved": len(unresolved),
        "app_calls_unmatched": sum(1 for c in calls if not c["matched_services"]),
        "note": "none-http = no runtime HTTP caller in-repo; in-process callers (bots importing use cases), "
                "tick-scheduler and relay consumers must be checked by hand — see the matrix.",
    }
    out = {"summary": summary, "routes": routes, "calls": calls, "unresolved_calls": unresolved, "screens": screens,
           "store_calls": stores, "db": db, "e2e": e2e, "bots": bots}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"routes={len(routes)} calls={len(calls)} unresolved={len(unresolved)} screens={len(screens)} "
          f"services_db={len(db)} e2e={len(e2e)} bots={len(bots)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
