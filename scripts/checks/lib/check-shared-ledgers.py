#!/usr/bin/env python3
"""check-shared-ledgers.py — قائمةُ السجلاتِ المشتركةِ واحدةٌ في ثلاثةِ مواضع.

الموضعُ الأوّل:  SHARED_LEDGERS   في scripts/checks/validate-work-claims.sh
الموضعُ الثاني: LEDGER_ONLY_PATHS في scripts/checks/require-doc-update.sh
الموضعُ الثالث: كتلةُ «مسارات مستثناة من فحص التقاطع» في docs/16-progress/WORK_CLAIMS.md

لماذا يلزم حارسٌ لهذا (M0-12): كانت الثلاثةُ بثلاثِ قوائمَ مختلفة — المدقِّقُ يستثني
WORK_INDEX ولا يستثني MASTER_PROGRESS، والوثيقةُ تفعل العكس، والثالثُ يستثني الخمسةَ.
فمَن قرأ الوثيقةَ وحدَّث MASTER_PROGRESS.md رُفض دفعُه بتقاطعٍ لا ذنبَ له فيه. والانحرافُ
لا يُكتشف بالقراءةِ لأنّ كلَّ موضعٍ صحيحٌ وحدَه؛ لا يُكتشف إلّا بمقارنةِ الثلاثةِ معاً.

الخروج 0 إن تطابقت الثلاثةُ، و1 مع بيانِ الفرقِ إن اختلفت.
"""

import re
import sys
from pathlib import Path

VALIDATE = "scripts/checks/validate-work-claims.sh"
REQUIRE = "scripts/checks/require-doc-update.sh"
DOC = "docs/16-progress/WORK_CLAIMS.md"


def read(root: Path, rel: str) -> str:
    p = root / rel
    if not p.is_file():
        sys.exit(f"✗ الملف غير موجود: {rel}")
    return p.read_text(encoding="utf-8")


def from_validate(text: str) -> set[str]:
    m = re.search(r"^SHARED_LEDGERS=\(\n(.*?)^\)", text, re.S | re.M)
    if not m:
        sys.exit(f"✗ لم أجد المصفوف SHARED_LEDGERS=( … ) في {VALIDATE}")
    return set(re.findall(r'"([^"]+)"', m.group(1)))


def from_require(text: str) -> set[str]:
    m = re.search(r"^LEDGER_ONLY_PATHS='([^']+)'", text, re.M)
    if not m:
        sys.exit(f"✗ لم أجد LEDGER_ONLY_PATHS في {REQUIRE}")
    pattern = m.group(1)
    g = re.search(r"\^(docs/16-progress/)\(([^)]+)\)\$$", pattern)
    if not g:
        sys.exit(f"✗ صيغةُ LEDGER_ONLY_PATHS غيرُ متوقّعة: {pattern}")
    prefix, alts = g.group(1), g.group(2)
    return {prefix + a.replace("\\.", ".") for a in alts.split("|")}


def from_doc(text: str) -> set[str]:
    idx = text.find("مسارات مستثناة")
    if idx == -1:
        sys.exit(f"✗ لم أجد عنوان «مسارات مستثناة» في {DOC}")
    m = re.search(r"```text\n(.*?)```", text[idx:], re.S)
    if not m:
        sys.exit(f"✗ لم أجد كتلة ```text بعد عنوان «مسارات مستثناة» في {DOC}")
    return {ln.strip() for ln in m.group(1).splitlines() if ln.strip()}


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    sources = {
        VALIDATE: from_validate(read(root, VALIDATE)),
        REQUIRE: from_require(read(root, REQUIRE)),
        DOC: from_doc(read(root, DOC)),
    }

    union = set().union(*sources.values())
    if not union:
        sys.exit("✗ القوائم الثلاث فارغة — لا يمكن أن تكون هذه هي الحالة الصحيحة.")

    drift = {name: s for name, s in sources.items() if s != union}
    if not drift:
        print(f"✓ قائمة السجلات المشتركة متطابقة في المواضع الثلاثة ({len(union)} سجلاً):")
        for p in sorted(union):
            print(f"    {p}")
        return 0

    print("✗ انحراف في قائمة السجلات المشتركة بين المواضع الثلاثة:\n", file=sys.stderr)
    for name, s in sources.items():
        missing = sorted(union - s)
        mark = "✓" if not missing else "✗"
        print(f"  {mark} {name} — {len(s)} سجلاً", file=sys.stderr)
        for p in missing:
            print(f"      ناقص: {p}", file=sys.stderr)
    print(
        "\n  القائمة واحدة بحكم القاعدة. أضف الناقص في كل موضع، أو احذفه من الجميع."
        f"\n  المرجع: docs/00-rules/WORK_CLAIM_RULE.md",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
