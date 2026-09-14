"""اشتقاقُ شِقَّي تشغيلِ الاختباراتِ من القرصِ — لا قائمةَ يدٍ تصدأُ. (M0-35)

يُطبَعُ سطرٌ لكلِّ حزمةٍ لها `test` في `package.json`:

    PARALLEL\t<path>     حزمةٌ لا تُشغِّلُ ملفَّ بوّابةٍ — تجري بالتوازي الافتراضيِّ
    SERIAL\t<path>       حزمةُ بوّاباتٍ تملكُ مخطَّطاً على القاعدةِ — تُسلسَلُ

ثمَّ سطرُ الخِتامِ `OK\t<عدد>`. **وغيابُ سطرِ الخِتامِ إخفاقٌ لا نجاحٌ**: مُشتَقٌّ
نصفُهُ ناقصٌ يُنتِجُ شِقّاً ناقصاً **فتسقطُ حزمٌ من الاختبارِ صامتةً**، وهيَ العلّةُ
نفسُها التي أنشأَت هذا الملفَّ.

المعيارُ (يُقاسُ من `vitest.config.ts` لا من الاسمِ): إعدادٌ **يُضمِّنُ**
`*.e2e.test.ts` أو **لا يستثني** `{integration,e2e}` ⇒ الحزمةُ تُشغِّلُ شفرةَ
قاعدةٍ في `pnpm -r test` فتُسلسَلُ. ولمَ لا يُعتمَدُ على اللاحقةِ `-e2e` في الاسمِ؟
لأنَّ حزمةً تُسمّى بغيرِ ذلكَ وتُشغِّلُ بوّابةً كانت ستُفلِتُ، **والاسمُ ليسَ
سلوكاً**.
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from workspace_packages import packages_with_test  # noqa: E402

_GATE_INCLUDE = re.compile(r"include:\s*\[[^\]]*\.e2e\.test\.ts")
_EXCLUDE_TAG = "{integration,e2e}"


def derive(root: str = ".") -> list[tuple[str, bool]]:
    """يُرجِعُ [(مسارُ الحزمةِ، أهيَ بوّابةٌ؟)] مرتَّباً. يرفعُ عندَ العُطلِ."""
    out: list[tuple[str, bool]] = []
    for d in packages_with_test(root):   # الجردُ من pnpm-workspace.yaml لا من نمطٍ بيدٍ
        cfg = os.path.join(root, d, "vitest.config.ts")
        gate = False
        if os.path.exists(cfg):
            with open(cfg, encoding="utf-8") as fh:
                c = fh.read()
            gate = bool(_GATE_INCLUDE.search(c)) or _EXCLUDE_TAG not in c
        out.append((d, gate))
    if not out:
        raise RuntimeError("لم تُعَدَّ حزمةٌ واحدةٌ لها `test` — لا اشتقاقَ ممكناً")
    return out


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    try:
        rows = derive(root)
    except Exception as exc:                                  # noqa: BLE001
        print("FATAL\t%s" % exc)
        return 1
    for d, gate in rows:
        print("%s\t%s" % ("SERIAL" if gate else "PARALLEL", d))
    print("OK\t%d" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
