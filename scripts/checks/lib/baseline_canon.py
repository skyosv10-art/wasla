#!/usr/bin/env python3
"""baseline_canon.py — القانونُ الواحدُ لبصمةِ الأساس. (M0-08)

لماذا ملفٌّ مشتركٌ لا دالّتانِ متشابهتان؟ لأنّ **المولِّدَ** (`scripts/baseline.sh`)
و**الحارسَ** (`scripts/checks/validate-baseline.sh`) لو حسبَ كلٌّ منهما البصمةَ
بطريقتِه لانحرفا يوماً، فيصير الحارسُ يُصدِّق أساساً لا يُنتِجه المولِّدُ أو يرفض
أساساً سليماً — وكلا الوجهَين يُفقِد الثقةَ. فالقانونُ هنا **واحدٌ يُستدعى مرَّتين**.

القاعدةُ في سطر: **البصمةُ تُحسَب على ما يجب أن يتكرَّر، لا على ما لا يمكن أن
يتكرَّر.** فالوقتُ ومدّةُ التشغيلِ وإصداراتُ البيئةِ تتغيَّر بلا أن يتغيَّر
المستودعُ، فإدخالُها في البصمةِ يجعل «قابلَ التكرار» مستحيلاً بالتعريف. أمّا
العدّاداتُ الساكنةُ وبصمةُ ملفِّ القفلِ فتتغيَّر **فقط** إذا تغيَّر المستودعُ.

الحقولُ المُبصَّمةُ: `schema` · `lock.sha256` · كلُّ `static`.
الحقولُ المُستثناةُ صراحةً: `generated_at` · `duration_ms` · `env` · `repo` ·
`dynamic` · `fingerprint` نفسُها.

المرجع: docs/12-testing/BASELINE_FORMAT.md · M0-08
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

SCHEMA = "wasla.baseline/v1"

# ما يدخل البصمةَ (والترتيبُ هنا لا يهمّ: القانونُ يُرتِّب المفاتيحَ قبلَ التجزئة)
FINGERPRINTED = ("schema", "lock.sha256", "static")

# ما لا يدخلها بقرارٍ مُعلَنٍ — لا بإغفال
VOLATILE = ("generated_at", "duration_ms", "env", "repo", "dynamic", "fingerprint")

REQUIRED_STATIC = (
    "packages",
    "packages_with_typecheck",
    "packages_with_test",
    "test_files_tracked",
    "ci_jobs",
    "ci_allow_failure",
    "governance_checks",
    "risks_not_closed",
)

REQUIRED_TOP = ("schema", "generated_at", "generator", "repo", "env", "lock",
                "static", "dynamic", "fingerprint", "reference")


def canonical_subset(doc: dict[str, Any]) -> dict[str, Any]:
    """يُخرِج **الجزءَ المُبصَّمَ وحدَه** من وثيقةِ أساسٍ كاملةٍ."""
    return {
        "schema": doc.get("schema"),
        "lock_sha256": (doc.get("lock") or {}).get("sha256"),
        "static": doc.get("static") or {},
    }


def fingerprint(doc: dict[str, Any]) -> str:
    """`sha256:<hex>` لـ JSON قانونيٍّ (مفاتيحُ مُرتَّبةٌ · بلا فراغٍ زائدٍ · UTF-8)."""
    payload = json.dumps(
        canonical_subset(doc),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


if __name__ == "__main__":  # bash يستدعيه: python3 baseline_canon.py <ملف>
    import sys

    with open(sys.argv[1], encoding="utf-8") as fh:
        print(fingerprint(json.load(fh)))
