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
# ── مُزوِّدانِ، والحيُّ هو المُفترَض (M0-22D) ─────────────────────────────
# وُلِدَ هذا السكربتُ يسألُ GitLab وحدَه. ثمَّ هُجِرَ مشروعُ GitLab في 2026-08-25
# (`ci_quota_exceeded`) وانتقلَ الخطُّ إلى GitHub Actions في `M0-21`، **فبقيَ
# السكربتُ يسألُ ميّتاً**: القاعدةُ التي وُلِدَ لأجلِها صارت غيرَ مؤتمَتةٍ على
# المصدرِ الذي يجري فعلاً، وكلُّ استخراجِ دليلٍ من GitHub جرى يدوياً. وهذه ثغرةٌ
# **مُعلَنةٌ** في `docs/15-decisions/ADR-023-…` §7.6 ومُقيَّدةٌ بـ`RISK-0018`.
#
# فالآنَ مُزوِّدانِ، والمُفترَضُ هو الحيُّ:
#
#   CI_EVIDENCE_PROVIDER=github  (المُفترَض) — واجهةُ api.github.com
#   CI_EVIDENCE_PROVIDER=gitlab            — المسارُ التاريخيُّ، **يبقى ولا يُحذَف**
#
# ولا يُحذَفُ مسارُ GitLab لأنّ أدلّةَ ما قبلَ الانتقالِ تُقرأُ به، وحذفُه إتلافُ
# دليلٍ سابقٍ — وهو ممنوعٌ بنصِّ قواعدِ الأدلّةِ لا بالرأي.
#
# ── ما يفعله ───────────────────────────────────────────────────────────
# يسألُ الواجهةَ عن آخرِ تشغيلٍ للمرجعِ المطلوب، ويحفظُ **الخامَ كما جاء**
# (التشغيلُ + كلُّ وظائفِه) ثمَّ يكتبُ حكماً مقروءاً بجانبِه. الخامُ يُحفَظُ قبلَ
# الحكمِ لأنّ الحكمَ رأيٌ والخامُ دليلٌ: مَن شكَّ في الحكمِ يقرأُ الخام.
#
#   bash scripts/ci-evidence.sh                    # آخرُ تشغيلٍ على main
#   bash scripts/ci-evidence.sh <ref>              # مرجعٌ آخر
#   CI_EVIDENCE_RUN=33731869192 bash scripts/ci-evidence.sh        # تشغيلٌ بعينِه
#   CI_EVIDENCE_PIPELINE=2803320544 CI_EVIDENCE_PROVIDER=gitlab bash scripts/ci-evidence.sh
#   CI_EVIDENCE_FIXTURE=<dir> bash scripts/ci-evidence.sh          # خامٌ محفوظٌ، بلا شبكةٍ
#
# ووضعُ الخامِ المحفوظِ ليس رفاهيةً: هو ما يجعلُ **حالاتِ الحدِّ قابلةً للاختبارِ
# بلا شبكةٍ** — «كلُّ الوظائفِ failure ولا واحدةَ بدأت» حالٌ لا تُصطنَعُ على واجهةٍ
# حيّةٍ، وهي بالضبطِ الحالُ التي وُلِدَ السكربتُ لأجلِها. يُقرأُ منه
# `run.raw.json` و`jobs.raw.json`. والحزمةُ: `scripts/checks/test-ci-evidence.sh`.
#
# ── الاستيثاق ──────────────────────────────────────────────────────────
# لا يُقرأُ سرٌّ في هذا الملفِّ ولا يُكتَب. إمّا أن يُمرَّرَ `GITHUB_TOKEN` (أو
# `GITLAB_TOKEN` للمسارِ التاريخيِّ) في البيئةِ، وإمّا أن يُشغَّلَ داخلَ وسيطٍ
# يُدخِلُ الاستيثاقَ للمضيفِ. وإن تعذَّرَ الوصولُ فالنتيجةُ `NOT VERIFIED` بسببٍ
# `api_unreachable` — **لا إخفاق**: جهلُنا بحالِ CI ليس دليلاً على إخفاقِ CI.
#
# ── حدٌّ مُعلَنٌ على مُزوِّدِ GitHub ─────────────────────────────────────────
# GitHub **لا يُصدِرُ حقلاً نظيراً لـ`failure_reason`**. فسببُ «لم تبدأ» يُشتَقُّ من
# `conclusion` وخلوِّ `steps`، ولا يُقرأُ حرفاً كما يُقرأُ `ci_quota_exceeded` في
# GitLab. والقاعدةُ نفسُها لا تتغيَّرُ: ما لم يبدأ لا يُكتَبُ `PASS` ولا `FAIL`.
#
# المرجع: docs/12-testing/M1-03_GATE.md §13 · docs/12-testing/M0-22D_GATE.md
#         docs/07-security/RISK_REGISTER.md RISK-0001 · RISK-0018
set -uo pipefail

cd "$(dirname "$0")/.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

PROVIDER="${CI_EVIDENCE_PROVIDER:-github}"
REF="${1:-main}"
GH_REPO="${CI_EVIDENCE_REPO:-skyosv10-art/wasla}"
GH_API="https://api.github.com"
GL_PROJECT_ID="${CI_EVIDENCE_PROJECT_ID:-85566384}"
GL_API="https://gitlab.com/api/v4"
OUT_ROOT="docs/12-testing/ci-evidence"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="$OUT_ROOT/$STAMP"
mkdir -p "$OUT"

BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'

case "$PROVIDER" in
  github|gitlab) : ;;
  *) printf '%s✗ مُزوِّدٌ غيرُ معروفٍ: %s (المسموحُ: github | gitlab)%s\n' "$RED" "$PROVIDER" "$RST"; exit 2 ;;
esac

_curl() { # _curl <full-url> <header-name> <token>
  local url="$1" hdr="$2" tok="$3"
  if [[ -n "$tok" ]]; then
    curl -sS --connect-timeout 15 --max-time 60 -H "$hdr: $tok" "$url"
  else
    curl -sS --connect-timeout 15 --max-time 60 "$url"
  fi
}

_gh() { _curl "$GH_API/$1" "Authorization" "${GITHUB_TOKEN:+Bearer $GITHUB_TOKEN}"; }
_gl() { _curl "$GL_API/$1" "PRIVATE-TOKEN" "${GITLAB_TOKEN:-}"; }

printf '%s╔══════════════════════════════════════════════════════════╗%s\n' "$BOLD" "$RST"
printf '%s║  دليلُ تشغيلِ CI — استخراجٌ وتسجيلٌ بلا تجميل            ║%s\n' "$BOLD" "$RST"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "$BOLD" "$RST"
if [[ "$PROVIDER" == "github" ]]; then
  printf '  المُزوِّد: %s · المستودع: %s · المرجع: %s · الوقت: %s\n\n' "$PROVIDER" "$GH_REPO" "$REF" "$STAMP"
  SUBJECT="$GH_REPO"
else
  printf '  المُزوِّد: %s · المشروع: %s · المرجع: %s · الوقت: %s\n\n' "$PROVIDER" "$GL_PROJECT_ID" "$REF" "$STAMP"
  SUBJECT="$GL_PROJECT_ID"
fi

RUN_ID=""

# ── 0) خامٌ محفوظٌ: يُنسَخُ ولا تُسألُ شبكةٌ ──────────────────────────────
if [[ -n "${CI_EVIDENCE_FIXTURE:-}" ]]; then
  if [[ ! -d "$CI_EVIDENCE_FIXTURE" ]]; then
    printf '%s✗ مجلَّدُ الخامِ غيرُ موجودٍ: %s%s\n' "$RED" "$CI_EVIDENCE_FIXTURE" "$RST"; exit 2
  fi
  cp "$CI_EVIDENCE_FIXTURE"/*.json "$OUT/" 2>/dev/null || true
  RUN_ID="$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1],encoding="utf-8")).get("id","") or "")
except Exception: print("")' "$OUT/run.raw.json" 2>/dev/null)"
  [[ -z "$RUN_ID" ]] && RUN_ID="fixture"
  printf '  (خامٌ محفوظٌ: %s — بلا شبكةٍ)\n' "$CI_EVIDENCE_FIXTURE"

# ── 1) الخامُ أوّلاً ─────────────────────────────────────────────────────
elif [[ "$PROVIDER" == "github" ]]; then
  if [[ -n "${CI_EVIDENCE_RUN:-}" ]]; then
    RUN_ID="$CI_EVIDENCE_RUN"
  else
    _gh "repos/$GH_REPO/actions/runs?branch=$REF&per_page=1" > "$OUT/runs.raw.json" 2>"$OUT/run.err"
    RUN_ID="$(python3 -c 'import json,sys
try: d=json.load(open(sys.argv[1],encoding="utf-8"))
except Exception: raise SystemExit
r=d.get("workflow_runs") or []
print(r[0]["id"] if r else "")' "$OUT/runs.raw.json" 2>/dev/null)"
  fi
  if [[ -n "$RUN_ID" ]]; then
    _gh "repos/$GH_REPO/actions/runs/$RUN_ID"                > "$OUT/run.raw.json"  2>>"$OUT/run.err"
    _gh "repos/$GH_REPO/actions/runs/$RUN_ID/jobs?per_page=100" > "$OUT/jobs.raw.json" 2>>"$OUT/run.err"
  fi
else
  if [[ -n "${CI_EVIDENCE_PIPELINE:-}" ]]; then
    RUN_ID="$CI_EVIDENCE_PIPELINE"
  else
    _gl "projects/$GL_PROJECT_ID/pipelines?ref=$REF&per_page=1" > "$OUT/runs.raw.json" 2>"$OUT/run.err"
    RUN_ID="$(python3 -c 'import json,sys
try: d=json.load(open(sys.argv[1],encoding="utf-8"))
except Exception: raise SystemExit
print(d[0]["id"] if isinstance(d,list) and d else "")' "$OUT/runs.raw.json" 2>/dev/null)"
  fi
  if [[ -n "$RUN_ID" ]]; then
    _gl "projects/$GL_PROJECT_ID/pipelines/$RUN_ID"                > "$OUT/run.raw.json"  2>>"$OUT/run.err"
    _gl "projects/$GL_PROJECT_ID/pipelines/$RUN_ID/jobs?per_page=100" > "$OUT/jobs.raw.json" 2>>"$OUT/run.err"
  fi
fi

if [[ -z "$RUN_ID" ]]; then
  # لا تشغيلَ مقروءٌ: جهلٌ لا إخفاق.
  cat > "$OUT/VERDICT.md" <<EOF
# دليلُ CI — $STAMP

- **المُزوِّد:** \`$PROVIDER\` · **الموضوع:** $SUBJECT · **المرجع:** \`$REF\`
- **النتيجة:** \`CI = NOT VERIFIED\`
- **السبب:** \`api_unreachable_or_no_run\`
- **started_at:** \`null\`
- **الخام:** \`runs.raw.json\` · \`run.err\`

لم يُقرأ تشغيلٌ. وهذا **ليس** \`FAIL\`: لا دليلَ على إخفاقٍ ولا على نجاحٍ.
EOF
  printf '{"schema":"wasla.ci-evidence/v2","verdict":"NOT VERIFIED","reason":"api_unreachable_or_no_run","provider":"%s","ref":"%s","started_at":null}\n' \
    "$PROVIDER" "$REF" > "$OUT/verdict.json"
  printf '%s⚪ CI = NOT VERIFIED · السبب: api_unreachable_or_no_run%s\n' "$YLW" "$RST"
  printf '  الدليلُ الخام: %s\n' "$OUT"
  exit 0
fi

# ── 2) الحكمُ بعدَ الخام ──────────────────────────────────────────────────
python3 - "$OUT" "$PROVIDER" "$RUN_ID" "$REF" "$SUBJECT" "$STAMP" <<'PY'
import json, os, sys
from collections import Counter

out, provider, run_id, ref, subject, stamp = sys.argv[1:7]


def load(name):
    try:
        return json.load(open(os.path.join(out, name), encoding="utf-8"))
    except Exception:
        return None


run = load("run.raw.json") or {}
raw_jobs = load("jobs.raw.json")

# ── تطبيعٌ: مُزوِّدانِ، وسجلٌّ واحدٌ يُحكَمُ عليه ──────────────────────────
# ولا يُخفى فرقُ المُزوِّدَينِ في التطبيعِ: يُكتَبُ `signal` في كلِّ سجلٍّ ليُقرأَ
# **من أين** جاءَ الحكمُ بأنّ الوظيفةَ لم تبدأ.
jobs = []
if provider == "github":
    items = (raw_jobs or {}).get("jobs") if isinstance(raw_jobs, dict) else None
    for j in items or []:
        steps = j.get("steps") or []
        concl = j.get("conclusion")
        status = j.get("status")
        started = j.get("started_at")
        # GitHub يكتبُ started_at حتّى لوظيفةٍ لم تُنفِّذ خطوةً، فلا يُعتمَدُ وحدَه.
        did_start = bool(started) and bool(steps) and concl != "skipped"
        signal = "started_at+steps"
        jobs.append({
            "name": j.get("name"), "status": status, "conclusion": concl,
            "started_at": started, "did_start": did_start, "signal": signal,
            "complete": status == "completed",
            "failed": did_start and concl == "failure",
            "success": concl == "success",
            "neutralized": concl in ("skipped", "cancelled", "neutral"),
            "reason": (concl or status or "unknown") if not did_start else None,
        })
else:
    for j in raw_jobs if isinstance(raw_jobs, list) else []:
        status = j.get("status")
        started = j.get("started_at")
        did_start = bool(started)
        jobs.append({
            "name": j.get("name"), "status": status, "conclusion": status,
            "started_at": started, "did_start": did_start, "signal": "started_at",
            "complete": status in ("success", "failed", "canceled", "skipped", "manual"),
            "failed": did_start and status == "failed",
            "success": status == "success",
            "neutralized": status in ("skipped", "manual", "canceled"),
            "reason": (j.get("failure_reason") or "job_did_not_start") if not did_start else None,
        })

started_jobs = [j for j in jobs if j["did_start"]]
statuses = Counter(j["conclusion"] or j["status"] for j in jobs)
reasons = Counter(j["reason"] for j in jobs if j["reason"])

# القاعدةُ الواحدةُ، وترتيبُها جزءٌ منها:
# لا وظيفةَ بدأت ⇒ NOT VERIFIED — **قبلَ** أيِّ نظرٍ في الإخفاقِ. فحالُ الحصّةِ
# المنفَدةِ تظهرُ `failure` في كلِّ وظيفةٍ، ولو قُدِّمَ فحصُ الإخفاقِ لكُتِبَ FAILED
# على تشغيلٍ لم يُنفِّذ سطراً — وهو الكذبُ ذاتُه الذي وُلِدَ السكربتُ لمنعِه.
if not jobs:
    verdict, reason = "NOT VERIFIED", "no_jobs_readable"
elif not started_jobs:
    verdict = "NOT VERIFIED"
    reason = (reasons.most_common(1)[0][0] if reasons else "job_did_not_start")
elif not all(j["complete"] for j in jobs):
    verdict, reason = "NOT VERIFIED", "incomplete_run"
elif any(j["failed"] for j in jobs):
    verdict, reason = "FAILED", "job_started_and_failed"
elif all(j["success"] or j["neutralized"] for j in jobs):
    verdict, reason = "PASSED", "all_jobs_succeeded"
else:
    verdict, reason = "NOT VERIFIED", "incomplete_run"

first_started = min((j["started_at"] for j in started_jobs), default=None)

if provider == "github":
    url = f"https://github.com/{subject}/actions/runs/{run_id}"
    run_status = f"{run.get('status')}/{run.get('conclusion')}"
    label = "التشغيل"
else:
    url = f"https://gitlab.com/uxxxu/wasla/-/pipelines/{run_id}"
    run_status = str(run.get("status"))
    label = "خطُّ الأنابيب"

not_started = [j for j in jobs if not j["did_start"]]

lines = [
    f"# دليلُ CI — {stamp}",
    "",
    f"- **المُزوِّد:** `{provider}` · **الموضوع:** {subject} · **المرجع:** `{ref}`",
    f"- **{label}:** [{run_id}]({url})",
    f"- **حالةُ التشغيلِ كما جاءت:** `{run_status}`",
    f"- **عددُ الوظائف:** {len(jobs)} · **بدأت فعلاً:** {len(started_jobs)}",
    "- **توزيعُ الحالات:** " + (", ".join(f"`{k}`={v}" for k, v in statuses.items()) or "—"),
    "- **أسبابُ ما لم يبدأ:** " + (", ".join(f"`{k}`={v}" for k, v in reasons.items()) or "—"),
    f"- **أوّلُ `started_at`:** `{first_started or 'null'}`",
    "",
    f"## النتيجة: `CI = {verdict}`",
    "",
    f"- **السبب:** `{reason}`",
    f"- **started_at:** `{first_started or 'null'}`",
    "- **الخام:** `run.raw.json` · `jobs.raw.json`",
    "",
]

if not_started:
    lines += [
        f"### وظائفُ لم تبدأ ({len(not_started)})",
        "",
        "| الوظيفةُ | الحالُ | الخلاصةُ | إشارةُ «لم تبدأ» |",
        "| --- | --- | --- | --- |",
    ] + [
        f"| `{j['name']}` | `{j['status']}` | `{j['conclusion']}` | `{j['signal']}` |"
        for j in not_started[:40]
    ] + [""]

if verdict == "NOT VERIFIED":
    lines += [
        "**لم يُشغَّل شيءٌ** (أو لم يكتمل). فهذا ليس `PASS` ولا `FAIL`: لا دليلَ",
        "على صحّةِ الشفرةِ ولا على عيبِها من هذا التشغيلِ. والمرجع:",
        "`docs/12-testing/M1-03_GATE.md` §13 · `RISK-0001`.",
    ]
elif verdict == "FAILED":
    lines += ["**بدأت وظيفةٌ وسقطت.** هذا دليلٌ على عيبٍ يُقرأ في سِجلِّ الوظيفةِ نفسِها."]
else:
    lines += ["**بدأت كلُّ الوظائفِ ونجحت.** هذا دليلٌ غيرُ محلّيٍّ."]

if provider == "github":
    lines += [
        "",
        "> **حدٌّ مُعلَنٌ:** GitHub لا يُصدِرُ حقلاً نظيراً لـ`failure_reason`، فسببُ",
        "> «لم تبدأ» **مُشتَقٌّ** من `conclusion` وخلوِّ `steps` لا مقروءٌ حرفاً.",
        "> والقاعدةُ نفسُها لا تتغيَّرُ: ما لم يبدأ لا يُكتَبُ له `PASS` ولا `FAIL`.",
    ]

open(os.path.join(out, "VERDICT.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

# ملفٌّ يقرأُه سكربتٌ لا إنسانٌ.
json.dump(
    {
        "schema": "wasla.ci-evidence/v2",
        "collected_at": stamp,
        "provider": provider,
        "subject": subject,
        "ref": ref,
        "run_id": run_id,
        "run_status": run_status,
        "run_url": url,
        "jobs_total": len(jobs),
        "jobs_started": len(started_jobs),
        "started_at": first_started,
        "verdict": verdict,
        "reason": reason,
        "job_statuses": dict(statuses),
        "not_started_reasons": dict(reasons),
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
printf '  الدليلُ: %s/VERDICT.md · الخام: %s/{run,jobs}.raw.json\n' "$OUT" "$OUT"
printf '  آخرُ دليلٍ يُحال إليه من: docs/12-testing/M1-03_GATE.md §13\n'
exit 0
