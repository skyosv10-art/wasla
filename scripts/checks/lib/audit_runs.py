#!/usr/bin/env python3
"""يقرأُ جوابَ واجهةِ الأعمالِ: أيُّ سيرٍ لـ`WASLA CI`، وهل بدأتْ وظيفةٌ فعلاً.

قارئٌ واحدٌ لهذا التمييزِ — لا نسخةٌ في كلِّ حارسٍ (درسُ M0-38 §4-ب). ومعيارُ
«بدأَ فعلاً» حرفيٌّ: خطواتٌ مُنفَّذةٌ **أو** `runner_id` غيرُ صفرٍ. وسيرُ الحجبِ
يُعطي 31 وظيفةً كلُّها `failure` بـ`steps: []` و`runner_id: 0` — أي لم يجرِ شيءٌ.
"""
import json
import sys


def main(mode: str) -> int:
    data = json.load(sys.stdin)
    if mode == "run-id":
        runs = [r for r in data.get("workflow_runs", []) if r.get("name") == "WASLA CI"]
        print(runs[0]["id"] if runs else "")
        return 0
    if mode == "started":
        jobs = data.get("jobs", [])
        started = [j for j in jobs if (j.get("steps") or []) or (j.get("runner_id") or 0)]
        print("real" if started else "blackout")
        return 0
    print(f"unknown mode: {mode}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: audit_runs.py <run-id|started>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
