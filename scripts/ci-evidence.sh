#!/usr/bin/env bash
# ci-evidence.sh — استخراجُ دليلِ تشغيلِ CI وتسجيلُه كما هو (M1-03 · الفجوةُ الرابعة).
#
# ── لماذا يوجد هذا السكربت ─────────────────────────────────────────────
# قِيسَ في 2026-08-31: خطُّ الأنابيبِ `2803320544` فيه **ستٌّ وعشرون وظيفةً كلُّها
# `failed`**، وسببُ الإخفاقِ في كلِّ واحدةٍ `ci_quota_exceeded`، و`started_at = null`.
# أي أنّ **لا وظيفةَ بدأت أصلاً**. ومَن قرأَ الحالةَ `failed` وحدَها استنتجَ أنّ
# الاختباراتَ سقطت — وهو استنتاجٌ كاذبٌ تماماً: لم يُشغَّل اختبارٌ واحد.
#
# فالخلطُ هنا ليس خلطَ ألفاظٍ بل خلطُ **ثلاثِ حالاتٍ لا حالتَين**:
#
#   • `PASSED`        — بدأت الوظيفةُ وانتهت بنجاحٍ.
#   • `FAILED`        — بدأت الوظيفةُ وانتهت بإخفاقٍ. ← دليلٌ على عيبٍ في الشفرة.
#   • `NOT VERIFIED`  — **لم تبدأ**. ← لا دليلَ على شيءٍ إطلاقاً.
#
# وهذا السكربتُ يمنعُ الخلطَ بقاعدةٍ واحدةٍ لا استثناءَ لها:
#
#   **`started_at == null` ⇒ `NOT VERIFIED` + السببُ، ولا يُكتَبُ `PASS` ولا `FAIL`.**
#
# ── ما يفعله ───────────────────────────────────────────────────────────
# يسألُ واجهةَ GitLab عن آخرِ خطِّ أنابيبٍ للمرجعِ المطلوب، ويحفظُ **الخامَ كما جاء**
# (خطُّ الأنابيبِ + كلُّ وظائفِه) ثمَّ يكتبُ حكماً مقروءاً بجانبِه. الخامُ يُحفَظُ قبلَ
# الحكمِ لأنّ الحكمَ رأيٌ والخامُ دليلٌ: مَن شكَّ في الحكمِ يقرأُ الخام.
#
#   bash scripts/ci-evidence.sh                    # آخرُ خطٍّ على main
#   bash scripts/ci-evidence.sh <ref>              # مرجعٌ آخر
#   CI_EVIDENCE_PIPELINE=2803320544 bash scripts/ci-evidence.sh   # خطٌّ بعينِه
#
# ── الاستيثاق ──────────────────────────────────────────────────────────
# لا يُقرأُ سرٌّ في هذا الملفِّ ولا يُكتَب. إمّا أن يُمرَّرَ `GITLAB_TOKEN` في البيئةِ،
# وإمّا أن يُشغَّلَ داخلَ وسيطٍ يُدخِلُ الاستيثاقَ للمضيفِ `gitlab.com`. وإن تعذَّرَ
# الوصولُ فالنتيجةُ `NOT VERIFIED` بسببٍ `api_unreachable` — **لا إخفاق**: جهلُنا
# بحالِ CI ليس دليلاً على إخفاقِ CI.
#
# المرجع: docs/12-testing/M1-03_GATE.md §13 · docs/07-security/RISK_REGISTER.md RISK-0001
set -uo pipefail

cd "$(dirname "$0")/.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

PROJECT_ID="${CI_EVIDENCE_PROJECT_ID:-85566384}"
REF="${1:-main}"
API="https://gitlab.com/api/v4"
OUT_ROOT="docs/12-testing/ci-evidence"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="$OUT_ROOT/$STAMP"
mkdir -p "$OUT"

BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'

_curl() { # _curl <path>
  local url="$API/$1"
  if [[ -n "${GITLAB_TOKEN:-}" ]]; then
    curl -sS --max-time 45 -H "PRIVATE-TOKEN: $GITLAB_TOKEN" "$url"
  else
    curl -sS --max-time 45 "$url"
  fi
}

printf '%s╔══════════════════════════════════════════════════════════╗%s\n' "$BOLD" "$RST"
printf '%s║  دليلُ تشغيلِ CI — استخراجٌ وتسجيلٌ بلا تجميل            ║%s\n' "$BOLD" "$RST"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "$BOLD" "$RST"
printf '  المشروع: %s · المرجع: %s · الوقت: %s\n\n' "$PROJECT_ID" "$REF" "$STAMP"

# ── 1) الخامُ أوّلاً ─────────────────────────────────────────────────────
if [[ -n "${CI_EVIDENCE_PIPELINE:-}" ]]; then
  _curl "projects/$PROJECT_ID/pipelines/$CI_EVIDENCE_PIPELINE" > "$OUT/pipeline.raw.json" 2>"$OUT/pipeline.err"
else
  _curl "projects/$PROJECT_ID/pipelines?ref=$REF&per_page=1" > "$OUT/pipelines.raw.json" 2>"$OUT/pipeline.err"
fi

PIPELINE_ID="$(
  python3 - "$OUT" "${CI_EVIDENCE_PIPELINE:-}" <<'PY' 2>/dev/null
import json, os, sys
out, forced = sys.argv[1], sys.argv[2]
if forced:
    print(forced); raise SystemExit
p = os.path.join(out, "pipelines.raw.json")
try:
    data = json.load(open(p, encoding="utf-8"))
except Exception:
    raise SystemExit
if isinstance(data, list) and data:
    print(data[0].get("id", ""))
PY
)"

if [[ -z "$PIPELINE_ID" ]]; then
  # لا خطَّ أنابيبٍ مقروءٌ: جهلٌ لا إخفاق.
  cat > "$OUT/VERDICT.md" <<EOF
# دليلُ CI — $STAMP

- **المشروع:** $PROJECT_ID · **المرجع:** \`$REF\`
- **النتيجة:** \`CI = NOT VERIFIED\`
- **السبب:** \`api_unreachable_or_no_pipeline\`
- **started_at:** \`null\`
- **الخام:** \`pipelines.raw.json\` · \`pipeline.err\`

لم يُقرأ خطُّ أنابيبٍ. وهذا **ليس** \`FAIL\`: لا دليلَ على إخفاقٍ ولا على نجاحٍ.
EOF
  printf '%s⚪ CI = NOT VERIFIED · السبب: api_unreachable_or_no_pipeline%s\n' "$YLW" "$RST"
  printf '  الدليلُ الخام: %s\n' "$OUT"
  exit 0
fi

_curl "projects/$PROJECT_ID/pipelines/$PIPELINE_ID" > "$OUT/pipeline.raw.json" 2>>"$OUT/pipeline.err"
_curl "projects/$PROJECT_ID/pipelines/$PIPELINE_ID/jobs?per_page=100" > "$OUT/jobs.raw.json" 2>>"$OUT/pipeline.err"

# ── 2) الحكمُ بعدَ الخام ──────────────────────────────────────────────────
python3 - "$OUT" "$PIPELINE_ID" "$REF" "$PROJECT_ID" "$STAMP" <<'PY'
import json, os, sys
from collections import Counter

out, pid, ref, project, stamp = sys.argv[1:6]

def load(name):
    try:
        return json.load(open(os.path.join(out, name), encoding="utf-8"))
    except Exception:
        return None

pipeline = load("pipeline.raw.json") or {}
jobs = load("jobs.raw.json")
jobs = jobs if isinstance(jobs, list) else []

started = [j for j in jobs if j.get("started_at")]
statuses = Counter(j.get("status") for j in jobs)
reasons = Counter(j.get("failure_reason") for j in jobs if j.get("failure_reason"))

# القاعدةُ الواحدةُ: لا وظيفةَ بدأت ⇒ NOT VERIFIED، لا PASS ولا FAIL.
if not jobs:
    verdict, reason = "NOT VERIFIED", "no_jobs_readable"
elif not started:
    verdict = "NOT VERIFIED"
    reason = (reasons.most_common(1)[0][0] if reasons else "job_did_not_start")
elif any(j.get("status") == "failed" and j.get("started_at") for j in jobs):
    verdict, reason = "FAILED", "job_started_and_failed"
elif all(j.get("status") == "success" for j in jobs):
    verdict, reason = "PASSED", "all_jobs_succeeded"
else:
    verdict, reason = "NOT VERIFIED", "incomplete_run"

first_started = min((j["started_at"] for j in started), default=None)

lines = [
    f"# دليلُ CI — {stamp}",
    "",
    f"- **المشروع:** {project} · **المرجع:** `{ref}` · **خطُّ الأنابيب:** [{pid}](https://gitlab.com/uxxxu/wasla/-/pipelines/{pid})",
    f"- **حالةُ الخطِّ كما جاءت:** `{pipeline.get('status')}`",
    f"- **عددُ الوظائف:** {len(jobs)} · **بدأت فعلاً:** {len(started)}",
    f"- **توزيعُ الحالات:** " + (", ".join(f"`{k}`={v}" for k, v in statuses.items()) or "—"),
    f"- **أسبابُ الإخفاق:** " + (", ".join(f"`{k}`={v}" for k, v in reasons.items()) or "—"),
    f"- **أوّلُ `started_at`:** `{first_started or 'null'}`",
    "",
    f"## النتيجة: `CI = {verdict}`",
    "",
    f"- **السبب:** `{reason}`",
    f"- **started_at:** `{first_started or 'null'}`",
    f"- **الخام:** `pipeline.raw.json` · `jobs.raw.json`",
    "",
]

if verdict == "NOT VERIFIED":
    lines += [
        "**لم يُشغَّل شيءٌ.** فهذا ليس `PASS` ولا `FAIL`: الوظائفُ لم تبدأ، فلا دليلَ",
        "على صحّةِ الشفرةِ ولا على عيبِها من هذا الخطّ. وكلُّ دليلٍ في هذه الدفعةِ",
        "**محلّيٌّ**، وهذا مُعلَنٌ في `docs/12-testing/M1-03_GATE.md` §13 و`RISK-0001`.",
    ]
elif verdict == "FAILED":
    lines += ["**بدأت وظيفةٌ وسقطت.** هذا دليلٌ على عيبٍ يُقرأ في سِجلِّ الوظيفةِ نفسِها."]
else:
    lines += ["**بدأت كلُّ الوظائفِ ونجحت.** هذا أوّلُ دليلٍ غيرِ محلّيٍّ في المستودع."]

open(os.path.join(out, "VERDICT.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

# ملفٌّ يقرأُه سكربتٌ لا إنسانٌ.
json.dump(
    {
        "schema": "wasla.ci-evidence/v1",
        "collected_at": stamp,
        "project_id": project,
        "ref": ref,
        "pipeline_id": pid,
        "pipeline_status": pipeline.get("status"),
        "jobs_total": len(jobs),
        "jobs_started": len(started),
        "started_at": first_started,
        "verdict": verdict,
        "reason": reason,
        "job_statuses": dict(statuses),
        "failure_reasons": dict(reasons),
    },
    open(os.path.join(out, "verdict.json"), "w", encoding="utf-8"),
    ensure_ascii=False,
    indent=2,
)
print(f"{verdict}\t{reason}\t{first_started or 'null'}")
PY
RC=$?

if (( RC != 0 )); then
  printf '%s✗ تعذَّرَ تحليلُ الخام. الخامُ محفوظٌ في %s%s\n' "$RED" "$OUT" "$RST"
  exit 1
fi

VERDICT="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["verdict"])' "$OUT/verdict.json" 2>/dev/null)"
case "$VERDICT" in
  PASSED) printf '\n%s✓ CI = PASSED%s\n' "$GRN" "$RST" ;;
  FAILED) printf '\n%s✗ CI = FAILED (بدأت الوظيفةُ وسقطت)%s\n' "$RED" "$RST" ;;
  *)      printf '\n%s⚪ CI = NOT VERIFIED (لم تبدأ الوظائف) — وليس PASS ولا FAIL%s\n' "$YLW" "$RST" ;;
esac
printf '  الدليلُ: %s/VERDICT.md · الخام: %s/{pipeline,jobs}.raw.json\n' "$OUT" "$OUT"
printf '  آخرُ دليلٍ يُحال إليه من: docs/12-testing/M1-03_GATE.md §13\n'
exit 0
