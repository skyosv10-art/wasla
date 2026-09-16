#!/usr/bin/env python3
# render-config-artifacts.py — يُولِّدُ `.env.example` و`registry.generated.ts`. (M2-04)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# لأنَّ `packages/config/env-registry.json` هوَ **مصدرُ الحقيقةِ الوحيدُ**، وكلُّ
# ما عداهُ يُشتَقُّ. ولو كُتِبَ المُشتَقُّ بيدٍ لصارَ مصدراً ثانياً، وأوّلُ انحرافٍ
# بينهما يُنتِجُ نشرةً تقرأُ قائمةً ناقصةً — وذلكَ نوعُ العطبِ الذي عولِجَ ثلاثَ
# مرّاتٍ في هذا المستودعِ (M0-04 · M0-12 · M0-15).
#
# ولا منطقَ توليدٍ هنا: كلُّهُ في `scripts/checks/lib/config_render.py` كي يكونَ
# **المُولِّدُ والحارسُ نسخةً واحدةً**. فلو كانَ للحارسِ توليدُهُ الخاصُّ لصارَ
# التطابقُ دعوى مقارنةِ نسختَينِ لا برهانَ اشتقاقٍ.
#
#   python3 scripts/config/render-config-artifacts.py             # يكتبُ
#   python3 scripts/config/render-config-artifacts.py --check     # يقارنُ ويُخرِجُ 1
#
# المرجع: docs/08-infrastructure/CONFIG_SCHEMA.md · ADR-032

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "checks" / "lib"))

from config_render import RegistryError, load_registry, rendered_artifacts  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="توليدُ أرتفاكتِ الإعدادِ من السجلِّ")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--check", action="store_true", help="يقارنُ بلا كتابةٍ")
    args = parser.parse_args()
    root = Path(args.root).resolve()

    try:
        registry = load_registry(root)
    except RegistryError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1

    drifted = 0
    for rel, expected in rendered_artifacts(registry).items():
        path = root / rel
        current = path.read_text(encoding="utf-8") if path.is_file() else None
        if args.check:
            if current != expected:
                print(f"✗ {rel} يخالفُ إعادةَ التوليدِ")
                drifted += 1
            else:
                print(f"✓ {rel} مطابقٌ")
            continue
        if current == expected:
            print(f"= {rel} (لا تغييرَ)")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(expected, encoding="utf-8")
        print(f"✎ {rel} كُتِبَ ({len(expected.splitlines())} سطراً)")
    return 1 if drifted else 0


if __name__ == "__main__":
    sys.exit(main())
