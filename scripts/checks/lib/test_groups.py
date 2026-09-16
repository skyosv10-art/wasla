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

import glob

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import vitest_config_semantics as vcs  # noqa: E402  (M0-42 — دلالةُ الإعدادِ لا نصُّهُ)
from workspace_packages import packages_with_test  # noqa: E402

def _gate_by_semantics(root: str, pkg: str) -> bool | None:
    """بوّابةٌ **بدلالةِ الإعدادِ** (M0-42) — لا بوجودِ نصٍّ فيهِ.

    `True`: ملفُّ بوّابةٍ يجري في المسارِ الافتراضيِّ فعلاً ⇒ يُسلسَلُ.
    `False`: الإعدادُ يستثني ملفّاتِ البوّاباتِ كلَّها ⇒ يُتوازى.
    `None`: الإعدادُ **خارجُ الدلالةِ المضمونةِ** (ضمٌّ غيرُ حرفيٍّ أو ملفُّ
    إعدادٍ بامتدادٍ غيرِ مقروءٍ) ⇒ يُسلسَلُ بسببٍ مكتوبٍ — الاتجاهُ الآمنُ
    لا المراهنةُ على نصٍّ.

    ولماذا لا بقاءُ المعيارِ النصّيِّ؟ قِيسَ (وثيقةُ دليلِ M0-42 · الحالةُ أ)
    أنَّ وسمَ `{integration,e2e}` **في تعليقٍ** كانَ يُعطي «ليست بوّابةً»،
    وأنَّ الوسمَ في نمطِ استثناءٍ لا يُطابِقُ موضعَ الملفِّ الفعليَّ كانَ
    يعطيها كذلك — والحارسُ أخضرُ في الحالتَينِ على مَشهدٍ يُنفِّذُ DDL في
    الشِّقِّ المتوازي. فصارَ الحكمُ لملفّاتِ البوّاباتِ التي يُشغِّلُها
    الإعدادُ **فعلاً** لا لوجودِ وسمٍّ في النصِّ.
    """
    pkg_dir = os.path.join(root, pkg)
    cfg = os.path.join(pkg_dir, "vitest.config.ts")
    if not os.path.exists(cfg):
        cfg_path = os.path.join(pkg_dir, "vitest.config.js")
        if not os.path.exists(cfg_path):
            return False  # لا إعدادَ ⇒ مفهومُ Vitest الافتراضيُّ وحدَهُ يقرأ
        return None  # امتدادٌ غيرُ مقروءٍ — يُعلَنُ لا يُبتلَعُ
    test_files = glob.glob(os.path.join(pkg_dir, "src", "**", "*.test.ts"), recursive=True)
    rels = [os.path.relpath(f, pkg_dir).replace(os.sep, "/") for f in test_files]
    include, exclude, has_include = vcs.default_run_globs(cfg)
    if has_include and include is None:
        return None  # قائمةُ ضمٍّ غيرُ حرفيّةٍ — خارجُ الدلالةِ المضمونةِ
    if has_include and any(vcs.glob_matches(p, "") is None for p in (include or [])):
        return None  # نمطٌ أفهمُ من مُطابِقِنا — لا نراهنُ على قِراءةٍ ناقصةٍ
    for e in exclude:
        if vcs.glob_matches(e, "") is None:
            return None
    gates = vcs.gate_files_in_default_run(cfg, rels)
    return bool(gates)


def derive(root: str = ".") -> list[tuple[str, bool]]:
    """يُرجِعُ [(مسارُ الحزمةِ، أهيَ بوّابةٌ؟)] مرتَّباً. يرفعُ عندَ العُطلِ."""
    out: list[tuple[str, bool]] = []
    for d in packages_with_test(root):   # الجردُ من pnpm-workspace.yaml لا من نمطٍ بيدٍ
        verdict = _gate_by_semantics(root, d)
        if verdict is None:
            gate = True  # خارجَ الدلالةِ: يُسلسَلُ بسببٍ لا يُسكَتُ عنهُ
        else:
            gate = verdict
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
