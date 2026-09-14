#!/usr/bin/env python3
"""يقرأُ من لوحةِ التنفيذِ سطورَ «دعوى الجهلِ بحكمِ CI» وحالةَ إشارتِها إلى سجلِّ التدقيقِ.

مصدرٌ واحدٌ لهذا التمييزِ (M0-40): «NOT VERIFIED» على اللوحةِ ليست جنساً واحداً —
منها ما هوَ عن طبقةِ الإنتاجِ، ومنها عن سلطةِ الدمجِ، وهذانِ لا يُقابَلانِ بواجهةِ
الأعمالِ. والمُلزَمُ دعوى الجهلِ بحكمِ CI وحدَها، وعلامتُها صريحةٌ في السطرِ نفسِهِ.

المخرَجُ: أسطرٌ `رقمُ السطرِ<TAB>البندُ<TAB>linked|unlinked`.
"""
import sys

MARKERS = (
    "account_billing_blocked",
    "JOB DID NOT START",
    "Job did not start",
    "Jobs Started: 0",
    "صفرِ خطواتٍ",
)


def main(path: str) -> int:
    with open(path, encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            if "NOT VERIFIED" not in line:
                continue
            if not any(m in line for m in MARKERS):
                continue
            item = line.split("|")[1].strip() if line.startswith("|") else "(سطرٌ نصّيٌّ)"
            linked = "CI_VERDICT_AUDIT.md" in line
            print(f"{n}\t{item}\t{'linked' if linked else 'unlinked'}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: claim_lines.py <board.md>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
