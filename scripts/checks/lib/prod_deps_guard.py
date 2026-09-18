"""جردُ استيراداتِ الإنتاجِ ومُطابقتُها بالتبعيّاتِ المُعلَنة (M0-43 · الفحصُ 22).

**السّؤالُ الذي يجيبُ عنهُ هذا الفحصُ واحدٌ ومحدودٌ:**

  هل يستوردُ ملفُّ إنتاجٍ (تحتَ ``src/`` بلا ``__tests__``) حزمةً خارجيّةً أو
  حزمةَ مساحةِ عملٍ لم تُعلَن في ``dependencies`` ولا في ``peerDependencies``
  للملفِّ ``package.json`` الذي يحويه؟

وليسَ السّؤالُ «أهيَ التبعيّاتُ كاملةٌ؟» — فليستْ، وذاكَ شأنُ ``tsc``. وهذا
الحارسُ يمنعُ صنفاً واحداً من العيوبِ لا يراهُ ``tsc``: حزمةٌ يُستورَدُ
**إنتاجيًّا** (قيمةً، لا نوعاً) من ``devDependencies`` وحدَها، فلا تُركَّبُ في
جذرِ الإنتاجِ ولا في صورةِ الحاويةِ، فينفجرُ ``Cannot find module`` عندَ
التشغيلِ لا عندَ البناءِ.

**ولماذا لا يكفي ``tsc``:** ``tsc`` يُمرِّرُ ``import type`` من أيِّ مكانٍ
لأنَّه يُمحى في زمنِ التحويلِ، ويُمرِّرُ أيَّ استيرادٍ **طالما وُجدَ في
``devDependencies``** لأنَّه لا يُفرِّقُ الإنتاجَ عنِ التطويرِ. فالحارسُ يُفرِّقُ:

  - **حزمُ ``*-e2e`` اختباريّةٌ** — استيرادُها من ``devDependencies`` صحيحٌ
    لأنَّها لا تُنشرُ ولا تُركَّبُ في الإنتاجِ. وهيَ مُستثناةٌ جملةً.
  - **``import type`` من ``peerDependencies`` الاختياريّةِ** صحيحٌ لأنَّ النوعَ
    يُمحى ولا يحتاجُ الحزمةَ في زمنِ التشغيلِ.
  - **استيرادُ القيمةِ من ``devDependencies``** هو العيبُ — وحدَهُ.

**المرجع:** ``docs/07-security/RISK_REGISTER.md`` (RISK-0043).
"""

from __future__ import annotations

import json
import os
import re
import sys

# استيرادُ جردِ الحزمِ من قارئِ مساحةِ العملِ الموحَّدِ (M0-35).
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from workspace_packages import all_packages  # noqa: E402

# ── المُستثنياتُ ───────────────────────────────────────────────────────────

# حزمُ الاختبارِ لا تُفحَصُ — استيرادُها من devDeps صحيحٌ.
# والاسمُ يُطابَقُ بنهايةِ اسمِ الحزمةِ في package.json لا بمسارِها.
E2E_SUFFIXES = ("-e2e",)

# وحداتُ Node المدمجةُ لا تُحصى تبعيّاتٍ — ``node:fs`` و``path`` وغيرُها.
# كذلك ``node:`` prefix في Node 16+.
NODE_BUILTIN_RE = re.compile(
    r"^(?:node:)?(?:"
    r"assert|async_hooks|buffer|child_process|cluster|console|constants|"
    r"crypto|dgram|diagnostics_channel|dns|events|fs|http|http2|https|inspector|"
    r"module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|"
    r"stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|"
    r"wasi|worker_threads|zlib"
    r")$"
)

# أنماطُ الاستيرادِ: نلتقطُ الاسمَ المُستورَدَ و**هل هو نوعٌ أم قيمةٌ**.
# تُطابِقُ الاستيراداتِ متعددةَ الأسطرِ أيضاً (``import {\n  x\n} from "pkg"``).
# ``import type X from "pkg"``       ⇒ type only
# ``import { type X } from "pkg"``   ⇒ type only (TypeScript 4.5+)
# ``import X from "pkg"``            ⇒ value
# ``import "pkg"``                   ⇒ value (side-effect import)
# ``import * as X from "pkg"``       ⇒ value
# ``export ... from "pkg"``          ⇒ value (re-export)
IMPORT_RE = re.compile(
    r"""^\s*import\s+(?:type\s+)?(?:(?:[\w*{}\s,]+?)\s+from\s+)?['"]([^'"]+)['"]""",
    re.MULTILINE | re.DOTALL,
)
TYPE_ONLY_IMPORT_RE = re.compile(
    r"""^\s*import\s+type\s+""",
    re.MULTILINE,
)
EXPORT_FROM_RE = re.compile(
    r"""^\s*export\s+(?:type\s+)?(?:[\w*{}\s,]+?)\s+from\s+['"]([^'"]+)['"]""",
    re.MULTILINE | re.DOTALL,
)
EXPORT_TYPE_FROM_RE = re.compile(
    r"""^\s*export\s+type\s+""",
    re.MULTILINE,
)

# ملفاتُ الاختبارِ والدليلُ الذي يُستثنى.
TEST_FILE_RE = re.compile(r"\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$")


def _package_name(spec: str) -> str:
    """اسمُ الحزمةِ من مواصفِ الاستيرادِ: ``@scope/pkg/sub`` ⇒ ``@scope/pkg``."""
    if spec.startswith("@"):
        parts = spec.split("/")
        if len(parts) >= 2:
            return "/".join(parts[:2])
        return parts[0]
    return spec.split("/")[0]


def _is_type_only_import_text(text: str) -> bool:
    """هل نصُّ الاستيرادِ ``import type`` (نوعٌ فقط) أم ``import`` (قيمةٌ)؟

    يقبلُ نصًّا كاملاً قد يمتدُّ عدةَ أسطرٍ (``import {\n  type X\n} from ...``).
    """
    stripped = text.lstrip()
    if stripped.startswith("import type"):
        return True
    # ``import { type X } from "..."`` — كلُّ المُستورَدِ نوعٌ.
    # نتحقَّقُ: هل كلُّ ما بين الأقواسِ مُسبوقٌ بـ``type``؟
    m = re.match(r'import\s+\{([^}]*)\}\s+from\s+["\']', stripped, re.DOTALL)
    if m:
        inner = m.group(1)
        # إن كان كلُّ عنصرٍ يبدأُ بـ``type `` فالاستيرادُ نوعيٌّ كلُّه.
        members = [s.strip() for s in inner.split(",") if s.strip()]
        if members and all(re.match(r"^type\b", s) for s in members):
            return True
    return False


def _is_type_only_export_text(text: str) -> bool:
    """هل نصُّ التصديرِ نوعٌ فقط؟

    - ``export type { X } from "pkg"`` ⇒ نوعٌ فقط.
    - ``export { type X } from "pkg"`` ⇒ نوعٌ فقط (TypeScript 4.5+ —
      كلُّ العناصرِ مُسبوقةٌ بـ``type`` فتُمحى في زمنِ التحويلِ).
    - ``export { X } from "pkg"`` ⇒ قيمةٌ.
    """
    stripped = text.lstrip()
    if stripped.startswith("export type"):
        return True
    # ``export { type X } from "..."`` — كلُّ ما بين الأقواسِ نوعٌ.
    m = re.match(r'export\s+\{([^}]*)\}\s+from\s+["\']', stripped, re.DOTALL)
    if m:
        inner = m.group(1)
        members = [s.strip() for s in inner.split(",") if s.strip()]
        if members and all(re.match(r"^type\b", s) for s in members):
            return True
    return False


def collect_production_imports(src_dir: str) -> dict[str, list[str]]:
    """جمعُ استيراداتِ القيمةِ من ``src/**`` بلا ``__tests__``.

    يُرجِعُ خريطةً: اسمُ الحزمةِ ⇒ قائمةُ المساراتِ التي تستوردُهُ.
    استيراداتُ الأنواعِ وحدَها (``import type``) **لا تُحسَبُ** لأنَّها
    تُمحى في زمنِ التحويلِ ولا تحتاجُ الحزمةَ في زمنِ التشغيلِ.
    """
    imports: dict[str, list[str]] = {}
    if not os.path.isdir(src_dir):
        return imports

    for root, dirs, files in os.walk(src_dir):
        # استبعادُ ``__tests__`` و``node_modules`` و``dist`` و``build``.
        dirs[:] = [d for d in dirs if d not in ("__tests__", "node_modules", "dist", "build", ".turbo")]

        for fname in files:
            if not fname.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")):
                continue
            if TEST_FILE_RE.search(fname):
                continue
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, encoding="utf-8", errors="replace") as fh:
                    content = fh.read()
            except OSError:
                continue

            # نُطابِقُ على الملفِ كاملًا لا سطراً بسطرٍ — فالاستيرادُ متعددُ الأسطرِ
            # (``import {\n  x\n} from "pkg"``) سطرٌ واحدٌ في القراءةِ لكنَّهُ متعددٌ في المصدرِ.
            # نستخدمُ finditer على النصِّ كاملِهِ فنلتقطُ بدايةَ كلِّ استيرادٍ/تصديرٍ.
            for m in IMPORT_RE.finditer(content):
                spec = m.group(1)
                # نأخذُ نصَّ الاستيرادِ كاملًا من بدايةِ المطابقةِ إلى نهايةِ السطرِ
                # الذي يُغلقُ علامةَ الاقتباسِ (قد يكونُ متعددَ الأسطرِ).
                match_text = m.group(0)
                # نُحدِّدُ هل هو نوعٌ فقط: ننظرُ إلى بدايةِ النصِّ.
                # إن بدأَ بـ``import type`` فهو نوعٌ.
                # وإن بدأَ بـ``import { type ... }`` فكلُّ عناصرِهِ أنواعٌ.
                # نأخذُ النصَّ من بدايةِ السطرِ إلى نهايةِ المطابقةِ.
                start = m.start()
                line_start = content.rfind("\n", 0, start) + 1
                full_text = content[line_start:m.end()]
                type_only = _is_type_only_import_text(full_text)

                if spec.startswith(".") or spec.startswith("/"):
                    continue
                pkg = _package_name(spec)
                if NODE_BUILTIN_RE.match(pkg):
                    continue
                if type_only:
                    continue

                imports.setdefault(pkg, []).append(
                    os.path.relpath(fpath, os.path.dirname(src_dir))
                )

            for m in EXPORT_FROM_RE.finditer(content):
                spec = m.group(1)
                start = m.start()
                line_start = content.rfind("\n", 0, start) + 1
                full_text = content[line_start:m.end()]
                type_only = _is_type_only_export_text(full_text)

                if spec.startswith(".") or spec.startswith("/"):
                    continue
                pkg = _package_name(spec)
                if NODE_BUILTIN_RE.match(pkg):
                    continue
                if type_only:
                    continue

                imports.setdefault(pkg, []).append(
                    os.path.relpath(fpath, os.path.dirname(src_dir))
                )

    return imports


def is_e2e_package(pkg_json: dict) -> bool:
    """هل هذهِ الحزمةُ اختباريّةٌ (``*-e2e``)؟"""
    name = pkg_json.get("name", "")
    if not name:
        return False
    return any(name.endswith(suffix) for suffix in E2E_SUFFIXES)


def check_package(pkg_dir: str, root: str) -> list[dict]:
    """فحصُ حزمةٍ واحدةٍ — يُرجِعُ قائمةَ المخالفاتِ (فارغةٌ = نظيفٌ)."""
    pj_path = os.path.join(pkg_dir, "package.json")
    if not os.path.isfile(pj_path):
        return []

    with open(pj_path, encoding="utf-8") as fh:
        pkg_json = json.load(fh)

    # حزمُ الاختبارِ مستثناةٌ — استيرادُها من devDeps صحيحٌ.
    if is_e2e_package(pkg_json):
        return []

    deps = set(pkg_json.get("dependencies", {}).keys())
    peer_deps = set(pkg_json.get("peerDependencies", {}).keys())
    dev_deps = set(pkg_json.get("devDependencies", {}).keys())

    # ``peerDependencies`` الاختياريّةُ (``optional: true`` في ``peerDependenciesMeta``)
    # قد لا تكونُ متوفّرةً في الإنتاجِ. فاستيرادُ القيمةِ منها عيبٌ — المستهلكُ
    # قد لا يُثبِّتُها. لكن ``import type`` منها صحيحٌ (يُمحى في زمنِ التحويلِ).
    peer_meta = pkg_json.get("peerDependenciesMeta", {})
    optional_peers = {
        name for name, meta in peer_meta.items()
        if isinstance(meta, dict) and meta.get("optional") is True
    }

    # كلُّ ما هو في ``dependencies`` أو ``peerDependencies`` الإلزاميّةِ يُعتبرُ
    # إنتاجيًّا صحيحًا. أمَّا الاختياريّةُ فلا — استيرادُ القيمةِ منها عيبٌ.
    production_ok = deps | (peer_deps - optional_peers)
    # ``import type`` من ``peerDependencies`` الاختياريّةِ صحيحٌ — لكنَّه يُعالَجُ
    # في ``collect_production_imports`` (لا يُحسَبُ استيرادُ نوعٍ).

    src_dir = os.path.join(pkg_dir, "src")
    prod_imports = collect_production_imports(src_dir)

    violations = []
    for pkg_name, files in sorted(prod_imports.items()):
        if pkg_name not in production_ok:
            # هل هو في devDependencies وحدَها؟ هذا هو العيبُ المقصودُ.
            in_dev = pkg_name in dev_deps
            violations.append(
                {
                    "package": pkg_json.get("name", pkg_dir),
                    "dir": os.path.relpath(pkg_dir, root),
                    "imported": pkg_name,
                    "in_devdeps": in_dev,
                    "files": files,
                }
            )

    return violations


def main() -> int:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    os.chdir(root)

    all_pkgs = all_packages(root)
    all_violations: list[dict] = []
    checked = 0
    e2e_skipped = 0

    for pkg_dir_rel in all_pkgs:
        pkg_dir = os.path.join(root, pkg_dir_rel)
        pj_path = os.path.join(pkg_dir, "package.json")
        if not os.path.isfile(pj_path):
            continue

        with open(pj_path, encoding="utf-8") as fh:
            pkg_json = json.load(fh)

        if is_e2e_package(pkg_json):
            e2e_skipped += 1
            continue

        # هل لها ``src/``؟ إن لم يكن فلا ما يُفحَصُ.
        src_dir = os.path.join(pkg_dir, "src")
        if not os.path.isdir(src_dir):
            continue

        checked += 1
        violations = check_package(pkg_dir, root)
        all_violations.extend(violations)

    # التقريرُ.
    print(f"الحزمُ المُفحوصةُ: {checked} (و{e2e_skipped} حزمةَ ``*-e2e`` مستثناةٌ)")
    print(f"المخالفاتُ: {len(all_violations)}")

    if all_violations:
        print("\nمخالفاتُ استيرادِ الإنتاجِ من devDependencies:")
        for v in all_violations:
            loc = v["in_devdeps"] and "devDependencies" or "لا مكانَ"
            files_str = ", ".join(v["files"][:3])
            if len(v["files"]) > 3:
                files_str += f" (+{len(v['files']) - 3})"
            print(
                f"  ✗ {v['package']} ({v['dir']}) يستوردُ '{v['imported']}' "
                f"من {loc} — في: {files_str}"
            )

    # مخرجاتٌ آليّةٌ للقاعدةِ (``exit 1`` عندَ المخالفةِ).
    return 1 if all_violations else 0


if __name__ == "__main__":
    sys.exit(main())
