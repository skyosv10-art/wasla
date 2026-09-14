#!/usr/bin/env python3
"""يقرأُ صفوفَ سجلِّ تدقيقِ أحكامِ CI — قارئٌ واحدٌ لا اثنانِ (درسُ M0-38 §4-ب).

الأنماطُ:
  rows                  → `بصمةٌ<TAB>تصنيفٌ` لكلِّ صفٍّ.
  real-with-conclusion  → بصماتُ الصفوفِ المُصنَّفةِ `real` التي نُقِلَت نتيجتُها.
"""
import re
import sys

SHA = re.compile(r"^`?([0-9a-f]{7,40})`?$")
CONCLUSION = re.compile(r"success|failure|cancelled|timed_out")


def rows(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 3:
                continue
            m = SHA.match(cells[0])
            if not m:
                continue
            yield m.group(1), cells[2].strip("`"), line


def main(path: str, mode: str) -> int:
    if mode not in ("rows", "real-with-conclusion"):
        print(f"unknown mode: {mode}", file=sys.stderr)
        return 2
    for sha, cls, line in rows(path):
        if mode == "rows":
            print(f"{sha}\t{cls}")
        elif cls == "real" and CONCLUSION.search(line):
            print(sha)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: audit_rows.py <audit.md> <rows|real-with-conclusion>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1], sys.argv[2]))
