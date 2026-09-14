"""جردُ حزمِ مساحةِ العملِ — مصدرُ حقيقةٍ واحدٌ هوَ `pnpm-workspace.yaml`. (M0-35)

**لمَ وُجِدَ هذا الملفُّ — عطبٌ مقيسٌ لا احتياطٌ:** أوّلُ تطبيقٍ لمُشتَقِّ الشِّقَّينِ
وللحارسِ كلاهما كتبَ جردَهُ بيدِهِ:

    _ROOTS = ("packages", "services", "bots")   # ثمَّ */package.json

وهذا **يُخالِفُ** `pnpm-workspace.yaml` الذي يُعلِنُ خمسةَ أنماطٍ فيها
`packages/contracts/*` و`apps/*`. فسقطت **أربعَ عشرةَ حزمةً** من الشِّقَّينِ كليهما،
فلم تُشغَّلْ أصلاً: `pnpm -r test` كانَ يُشغِّلُ **48 حزمةً · 282 ملفَّ اختبارٍ ·
4591 اختباراً**، وصارَ المُشتَقُّ يُشغِّلُ **34 حزمةً · 239 ملفّاً · 3991 اختباراً**
— **600 اختباراً اختفَتْ والخلاصةُ خضراءُ**.

**وهذا هوَ الغِشُّ الذي بُنيَ الحارسُ ليمنعَهُ، فوقعَ فيهِ الحارسُ نفسُهُ:** دعوى
«اتّحادُ الشِّقَّينِ = كلُّ حزمةٍ لها `test`» كانت **صادقةً حرفاً وكاذبةً معنىً**، لأنَّ
الطرفَينِ قاسا الجردَ **بالعطبِ نفسِهِ**. وقياسانِ يتَّفقانِ لأنَّهما يشتركانِ في
خطأٍ ليسا قياسَينِ.

**فالعلاجُ في الجذرِ طبقتانِ:**

1. **جردٌ واحدٌ** يُقرأُ من `pnpm-workspace.yaml` — لا يُكتَبُ نمطٌ بيدٍ في موضعَينِ.
2. **مُصادَقةٌ خارجيّةٌ** على ذلكَ الجردِ من `pnpm` نفسِهِ (`pnpm -r --depth -1 list
   --json`) — وهوَ **الحَكَمُ الفعليُّ** إذ هوَ مَن يُشغِّلُ الاختباراتِ. فلو أخطأَ
   قارئُنا نمطاً ثانيةً، **أخفقَ الحارسُ** ولم يوافِقْ نفسَهُ.

وجذرُ مساحةِ العملِ **يُستثنى** من الجردِ: `pnpm -r` لا يُشغِّلُ الجذرَ إلّا
بـ`--include-workspace-root`، و`scripts.test` في الجذرِ هوَ المُشغِّلُ نفسُهُ —
فإدراجُهُ استدعاءٌ لا نهائيٌّ.
"""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess

_PKG_LINE = re.compile(r"^\s*-\s*[\"']?([^\"'\s#]+)[\"']?\s*(?:#.*)?$")


def workspace_patterns(root: str = ".") -> list[str]:
    """أنماطُ مساحةِ العملِ كما أعلنَها `pnpm-workspace.yaml`. يرفعُ عندَ العُطلِ."""
    path = os.path.join(root, "pnpm-workspace.yaml")
    if not os.path.exists(path):
        raise RuntimeError("pnpm-workspace.yaml مفقودٌ — لا جردَ ممكناً")
    pats: list[str] = []
    in_packages = False
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if re.match(r"^packages\s*:", line):
                in_packages = True
                continue
            if in_packages:
                m = _PKG_LINE.match(line)
                if m:
                    pats.append(m.group(1))
                    continue
                if not line.startswith((" ", "\t", "-")):
                    in_packages = False
    if not pats:
        raise RuntimeError("pnpm-workspace.yaml لا يُعلِنُ نمطاً واحداً — لا جردَ ممكناً")
    return pats


def all_packages(root: str = ".") -> list[str]:
    """كلُّ حزمةٍ في مساحةِ العملِ (بلا الجذرِ)، مساراتٌ نسبيّةٌ مرتَّبةٌ."""
    found: set[str] = set()
    for pat in workspace_patterns(root):
        if pat.startswith("!"):
            continue
        for pj in glob.glob(os.path.join(root, pat, "package.json")):
            if "node_modules" in pj.split(os.sep):
                continue
            found.add(os.path.relpath(os.path.dirname(pj), root))
    return sorted(found)


def packages_with_test(root: str = ".") -> list[str]:
    """كلُّ حزمةٍ لها `scripts.test`. عطبُ قراءةٍ يُرفَعُ لا يُبتلَعُ."""
    out: list[str] = []
    for d in all_packages(root):
        with open(os.path.join(root, d, "package.json"), encoding="utf-8") as fh:
            data = json.load(fh)
        if "test" in (data.get("scripts") or {}):
            out.append(d)
    return out


def pnpm_packages(root: str = ".") -> list[str]:
    """جردُ `pnpm` نفسِهِ (بلا الجذرِ) — مُصادِقٌ خارجيٌّ لا نسخةٌ ثانيةٌ من قارئِنا.

    يُرفَعُ عندَ تعذُّرِ `pnpm`: مَن لا يملكُ `pnpm` لا يُشغِّلُ الاختباراتِ أصلاً،
    **فالتعذُّرُ إخفاقٌ لا تخطٍّ** — وإلّا صارَ الحارسُ يُصادِقُ نفسَهُ حينَ يغيبُ الحَكَمُ.
    """
    proc = subprocess.run(
        ["pnpm", "-r", "--depth", "-1", "list", "--json"],
        cwd=root,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(
            "تعذَّرَ جردُ pnpm (rc=%d) — لا مُصادِقَ خارجيَّ للجردِ: %s"
            % (proc.returncode, (proc.stderr or "").strip()[:200])
        )
    data = json.loads(proc.stdout)
    abs_root = os.path.abspath(root)
    out: set[str] = set()
    for entry in data:
        p = entry.get("path")
        if not p:
            continue
        rel = os.path.relpath(p, abs_root)
        if rel in (".", ""):
            continue
        out.add(rel)
    return sorted(out)
