#!/usr/bin/env python3
"""edge_wiring_guard — الحارس 29 · ترطيبُ حدِّ القناةِ في مدخلِ البوتِ (D6 · CLM-0691).

يقيسُ قياساً حيًّا — لا افتراضَ نشرٍ:
  1. مدخلُ بوتِ العميلِ (`bots/customer-bot/src/main.ts`) يبني التطبيقَ عبرَ
     `buildAppWithEdge` (من `./edge.js`) ويُمرِّرُهُ إلى `runBotApp` — لا `buildApp` مباشرةً
     (عيبُ السلفِ: عمليةٌ حيّةٌ بلا مساراتِ الحدِّ واختباراتٌ خضراء).
  2. `allowlistUrl` في `bots/{customer,driver}-bot/src/edge.ts` يُحَلُّ من موقعِ الوحدةِ
     (`import.meta.url`) إلى ملفٍّ موجودٍ وصالحِ JSON — استخراجُ المسارِ النسبيِّ من
     الشيفرةِ وحلُّهُ ضدَّ موقعِ الملفِّ نفسِهِ، فلا يمرَّرَ مسارٌ يُشيرُ إلى غائبٍ.

كلُّ إخفاقٍ برمزٍ ثابتٍ `[EW-…]` تطابقُهُ حالاتُ الطفرةِ بعينِها (عزلُ السببِ).
لا شبكةَ ولا git: قراءةُ قرصٍ محضةٌ — مرورٌ أو إخفاقٌ، ولا تخطّيَ.

المرجع: RENDER_TEST_ENVIRONMENT_PLAN (T1) · EDGE_ALLOWLIST.md · ADR-069 · CLM-0691.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MAIN = ROOT / "bots" / "customer-bot" / "src" / "main.ts"
EDGE = {
    "customer-bot": ROOT / "bots" / "customer-bot" / "src" / "edge.ts",
    "driver-bot": ROOT / "bots" / "driver-bot" / "src" / "edge.ts",
}

FAILURES: list[str] = []


def fail(code: str, msg: str) -> None:
    print(f"  ✗ [{code}] {msg}")
    FAILURES.append(f"[{code}] {msg}")


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def must_read(path: Path, what: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        fail("EW-READ", f"تعذّرت قراءةُ {what} ({path.relative_to(ROOT)}): {exc}")
        return ""


def check_main_wiring() -> None:
    src = must_read(MAIN, "مدخلُ بوتِ العميلِ")
    if not src:
        return
    # 1) الاستيرادُ من وحدةِ الحدِّ لا من جذرِ التركيبِ وحده
    if re.search(r'import\s*\{[^}]*\bbuildAppWithEdge\b[^}]*\}\s*from\s*"\./edge\.js"', src):
        ok("main.ts يستوردُ buildAppWithEdge من ./edge.js")
    else:
        fail("EW-MAIN-IMPORT", "main.ts لا يستوردُ buildAppWithEdge من ./edge.js")
    # 2) المُطلِقُ يبني عبرَ الحدِّ — لا عبرَ buildApp مباشرةً
    if re.search(r"runBotApp\s*\(\s*BOT\s*,\s*buildAppWithEdge\s*\)", src):
        ok("المُطلِقُ يمرِّرُ buildAppWithEdge إلى runBotApp")
    else:
        fail(
            "EW-MAIN-LAUNCH",
            "runBotApp لا يُمرَّرُ إليهِ buildAppWithEdge (الحدُّ غيرُ مرطَّبٍ في المدخلِ)",
        )
    # 3) منعُ العودةِ إلى بناءٍ بلا حدٍّ (نفيٌّ لا غيابُ فحصٍ)
    if re.search(r"runBotApp\s*\(\s*BOT\s*,\s*\(\s*\)\s*=>\s*buildApp\s*\(\s*\)\s*\)", src) or re.search(
        r"runBotApp\s*\(\s*BOT\s*,\s*buildApp\s*[\),]", src
    ):
        fail("EW-MAIN-LAUNCH", "المدخلُ يعودُ إلى بناءٍ من غيرِ الحدِّ (buildApp مباشرةً)")


def check_allowlist(bot: str, edge_path: Path) -> None:
    src = must_read(edge_path, f"وحدةُ حدِّ بوتِ {bot}")
    if not src:
        return
    # قياسٌ حيٌّ: استخراجُ المسارِ النسبيِّ كما يكتبُهُ الكودُ وحلُّهُ ضدَّ موقعِ الملفِّ
    m = re.search(
        r'new URL\(\s*"(\.\./[^"]+)"\s*,\s*import\.meta\.url\s*\)', src
    )
    if not m:
        fail("EW-ALLOWLIST-FORM", f"allowlistUrl في {bot} ليس حلًّا من موقعِ الوحدةِ (import.meta.url)")
        return
    rel = m.group(1)
    resolved = (edge_path.parent / rel).resolve()
    try:
        resolved.relative_to(ROOT)
    except ValueError:
        fail("EW-ALLOWLIST-URL", f"المسارُ المحلولُ لـ{bot} خارجَ جذرِ المستودعِ: {resolved}")
        return
    if not resolved.is_file():
        fail(
            "EW-ALLOWLIST-URL",
            f"allowlistUrl في {bot} يحلُّ إلى ملفٍّ غائبٍ: {resolved.relative_to(ROOT)}",
        )
        return
    ok(f"allowlistUrl في {bot} يحلُّ إلى ملفٍّ موجودٍ: {resolved.relative_to(ROOT)}")
    try:
        json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        fail("EW-ALLOWLIST-JSON", f"قائمةُ سماحِ {bot} ليست JSON صالحًا: {exc}")
        return
    ok(f"قائمةُ سماحِ {bot} صالحةُ JSON")


def main() -> int:
    print("── الحارسُ 29 · ترطيبُ حدِّ القناةِ في المدخلِ (D6 · CLM-0691) ──")
    if not MAIN.is_file():
        fail("EW-READ", f"مدخلُ بوتِ العميلِ مفقودٌ: {MAIN.relative_to(ROOT)}")
    else:
        check_main_wiring()
    for bot, edge_path in EDGE.items():
        if not edge_path.is_file():
            fail("EW-READ", f"وحدةُ حدِّ {bot} مفقودةٌ: {edge_path.relative_to(ROOT)}")
        else:
            check_allowlist(bot, edge_path)
    if FAILURES:
        print(f"\n✗ edge-wiring-guard: {len(FAILURES)} إخفاق. الدفعُ مرفوضٌ.")
        return 1
    print("\n✓ edge-wiring-guard: الترطيبُ مقيسٌ سليم.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
