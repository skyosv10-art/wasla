#!/usr/bin/env python3
"""يقرأُ جوابَ واجهةِ الأعمالِ: أيُّ سيرٍ لـ`WASLA CI`، وهل بدأتْ وظيفةٌ فعلاً.

قارئٌ واحدٌ لهذا التمييزِ — لا نسخةٌ في كلِّ حارسٍ (درسُ M0-38 §4-ب). ومعيارُ
«بدأَ فعلاً» حرفيٌّ: خطواتٌ مُنفَّذةٌ **أو** `runner_id` غيرُ صفرٍ. وسيرُ الحجبِ
يُعطي 31 وظيفةً كلُّها `failure` بـ`steps: []` و`runner_id: 0` — أي لم يجرِ شيءٌ.
"""
import json
import re
import sys

FULL_SHA = re.compile(r"[0-9a-f]{40}")


def run_lookup(full: str, raw: str) -> str:
    """CLM-0663 — يصنّفُ جوابًا واحدًا لـ`actions/runs?head_sha=<FULL>` ثلاثةَ أصنافٍ لا تختلط:

    `found\t<id>`  سيرُ `WASLA CI` للبصمةِ الكاملةِ نفسِها (لا لبصمةٍ أخرى).
    `empty`        JSON صالحٌ بقائمةِ `workflow_runs` لا سيرَ فيها لـ`WASLA CI` — لقطةٌ لا حكم.
    `invalid\t<…>` ليسَ JSON، أو بلا قائمةِ `workflow_runs`، أو فيهِ سيرٌ لبصمةٍ أخرى
                   (جوابٌ عن سؤالٍ آخر) — تعذُّرُ قياسٍ لا «لا حكم».
    ونصٌّ فارغٌ ليسَ مجموعةً فارغة: يُصنَّفُ `invalid`.
    """
    if not raw.strip():
        return "invalid\tجوابٌ بلا نصّ"
    try:
        data = json.loads(raw)
    except ValueError:
        return "invalid\tليسَ JSON"
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        return "invalid\tلا قائمةَ workflow_runs"
    runs = [r for r in data["workflow_runs"] if isinstance(r, dict)]
    if any(r.get("head_sha") != full for r in runs):
        return "invalid\tسيرٌ لبصمةٍ غيرِ المسؤولة"
    ci = [r for r in runs if r.get("name") == "WASLA CI"]
    if not ci:
        return "empty"
    rid = ci[0].get("id")
    if not isinstance(rid, int) or isinstance(rid, bool) or rid <= 0:
        return "invalid\tمعرِّفُ سيرٍ غيرُ صالح"
    return f"found\t{rid}"


def main(mode: str, arg: str = "") -> int:
    if mode == "run-lookup":
        if not FULL_SHA.fullmatch(arg):
            print(f"run-lookup needs a full 40-hex sha, got: {arg!r}", file=sys.stderr)
            return 2
        print(run_lookup(arg, sys.stdin.read()))
        return 0
    data = json.load(sys.stdin)
    if mode == "started":
        jobs = data.get("jobs", [])
        started = [j for j in jobs if (j.get("steps") or []) or (j.get("runner_id") or 0)]
        print("real" if started else "blackout")
        return 0
    print(f"unknown mode: {mode}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        print("usage: audit_runs.py <run-lookup FULL_SHA|started>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(*sys.argv[1:]))
