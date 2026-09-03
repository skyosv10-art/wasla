#!/usr/bin/env bash
# test-ci-evidence.sh — حزمةُ اختبارِ مستخرِجِ دليلِ CI (M0-22D).
#
# ── لماذا حزمةٌ مستقلّةٌ ────────────────────────────────────────────────
# `ci-evidence.sh` هو الحارسُ الذي يمنعُ الكذبةَ الأخطرَ في هذا المستودعِ:
# **قراءةُ تشغيلٍ لم يبدأ حكماً على الشفرةِ**. وحارسٌ بلا اختبارٍ يرفضُ فعلاً هو
# زينةٌ. وحالُ «ستٌّ وعشرون وظيفةً `failed` ولا واحدةَ بدأت» **لا تُصطنَعُ على واجهةٍ
# حيّةٍ** — فتُصطنَعُ خاماً محفوظاً، وهو ما يُتيحُه `CI_EVIDENCE_FIXTURE`.
#
# ── ما تفعله ───────────────────────────────────────────────────────────
# لكلِّ حالةٍ: تبني مسرحاً مؤقّتاً، تنسخُ السكربتَ إليه (بطفرةٍ أو بلا)، تُشغِّلُه
# على خامٍ مُصطنَعٍ، ثمَّ تقرأُ `verdict.json` وتُطابقُ `verdict` و`reason`.
#
# وطبقتانِ لا طبقةٌ:
#   1) **حالاتُ الصحّةِ** — الحكمُ الصحيحُ على خامٍ معلومٍ.
#   2) **الطفراتُ على السكربتِ نفسِه** — تُعطَبُ القاعدةُ فيجبُ أن **تُخفِقَ**
#      حالةٌ واحدةٌ على الأقلِّ. وطفرةٌ لا تُخفِقُ حالةً = فحصٌ لا يقيسُ شيئاً.
#
#   bash scripts/checks/test-ci-evidence.sh
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
REPO_ROOT="$PWD"
SCRIPT="scripts/ci-evidence.sh"

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RST=$'\033[0m'
PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

# ── خامٌ مُصطنَعٌ ─────────────────────────────────────────────────────────
_gh_job() { # _gh_job <name> <status> <conclusion> <started_at|null> <with_steps:0|1>
  local steps="[]"
  (( $5 == 1 )) && steps='[{"name":"run","conclusion":"'"$3"'"}]'
  local started="null"
  [[ "$4" != "null" ]] && started="\"$4\""
  printf '{"name":"%s","status":"%s","conclusion":%s,"started_at":%s,"steps":%s}' \
    "$1" "$2" "$( [[ "$3" == "null" ]] && echo null || echo "\"$3\"" )" "$started" "$steps"
}

make_fixture() { # make_fixture <dir> <provider> <case>
  local dir="$1" provider="$2" case="$3"
  mkdir -p "$dir"
  if [[ "$provider" == "github" ]]; then
    echo '{"id":999,"status":"completed","conclusion":"failure"}' > "$dir/run.raw.json"
    case "$case" in
      all_success)
        printf '{"total_count":2,"jobs":[%s,%s]}' \
          "$(_gh_job verify completed success 2026-09-03T08:00:00Z 1)" \
          "$(_gh_job test completed success 2026-09-03T08:01:00Z 1)" > "$dir/jobs.raw.json" ;;
      started_and_failed)
        printf '{"total_count":2,"jobs":[%s,%s]}' \
          "$(_gh_job verify completed failure 2026-09-03T08:00:00Z 1)" \
          "$(_gh_job test completed success 2026-09-03T08:01:00Z 1)" > "$dir/jobs.raw.json" ;;
      never_started)
        # حالُ الحصّةِ المنفَدةِ بلغةِ GitHub: خلاصةٌ `failure` وصفرُ خطواتٍ.
        printf '{"total_count":2,"jobs":[%s,%s]}' \
          "$(_gh_job verify completed failure 2026-09-03T08:00:00Z 0)" \
          "$(_gh_job test completed failure 2026-09-03T08:00:00Z 0)" > "$dir/jobs.raw.json" ;;
      incomplete)
        printf '{"total_count":2,"jobs":[%s,%s]}' \
          "$(_gh_job verify completed success 2026-09-03T08:00:00Z 1)" \
          "$(_gh_job test queued null null 0)" > "$dir/jobs.raw.json" ;;
      skipped_ok)
        printf '{"total_count":2,"jobs":[%s,%s]}' \
          "$(_gh_job verify completed success 2026-09-03T08:00:00Z 1)" \
          "$(_gh_job matrix completed skipped null 0)" > "$dir/jobs.raw.json" ;;
      no_jobs)
        echo '{"total_count":0,"jobs":[]}' > "$dir/jobs.raw.json" ;;
      garbage)
        echo 'not json at all' > "$dir/jobs.raw.json" ;;
    esac
  else
    echo '{"id":888,"status":"failed"}' > "$dir/run.raw.json"
    case "$case" in
      all_success)
        echo '[{"name":"verify","status":"success","started_at":"2026-08-01T00:00:00Z"},{"name":"test","status":"success","started_at":"2026-08-01T00:01:00Z"}]' > "$dir/jobs.raw.json" ;;
      started_and_failed)
        echo '[{"name":"verify","status":"failed","started_at":"2026-08-01T00:00:00Z"},{"name":"test","status":"success","started_at":"2026-08-01T00:01:00Z"}]' > "$dir/jobs.raw.json" ;;
      never_started)
        echo '[{"name":"verify","status":"failed","started_at":null,"failure_reason":"ci_quota_exceeded"},{"name":"test","status":"failed","started_at":null,"failure_reason":"ci_quota_exceeded"}]' > "$dir/jobs.raw.json" ;;
      no_jobs)
        echo '[]' > "$dir/jobs.raw.json" ;;
    esac
  fi
}

# ── تشغيلُ حالةٍ ────────────────────────────────────────────────────────
run_case() { # run_case <mutant|-> <provider> <case> <expect_verdict> <expect_reason>
  local mutant="$1" provider="$2" case="$3" ev="$4" er="$5"
  local stage="$TMPROOT/stage-$RANDOM$RANDOM"
  mkdir -p "$stage/scripts" "$stage/docs/12-testing"
  cp "$REPO_ROOT/$SCRIPT" "$stage/scripts/ci-evidence.sh"

  case "$mutant" in
    -) : ;;
    order)
      # تقديمُ فحصِ الإخفاقِ على فحصِ «لم تبدأ» — الخلطُ ذاتُه الذي يمنعُه السكربت.
      python3 - "$stage/scripts/ci-evidence.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
a = 'elif not started_jobs:\n    verdict = "NOT VERIFIED"\n    reason = (reasons.most_common(1)[0][0] if reasons else "job_did_not_start")\n'
b = 'elif any(j["failed"] for j in jobs):\n    verdict, reason = "FAILED", "job_started_and_failed"\n'
assert a in s and b in s, "mutant `order`: نمطٌ غير موجودٍ"
s = s.replace(a, "@@A@@").replace(b, "@@B@@").replace("@@A@@", b).replace("@@B@@", a)
open(p, "w", encoding="utf-8").write(s)
PY
      ;;
    steps)
      # الاعتمادُ على started_at وحدَه في GitHub — وهو حقلٌ يُكتَبُ لوظيفةٍ لم تُنفِّذ خطوةً.
      python3 - "$stage/scripts/ci-evidence.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
a = 'did_start = bool(started) and bool(steps) and concl != "skipped"'
assert a in s, "mutant `steps`: نمطٌ غير موجودٍ"
open(p, "w", encoding="utf-8").write(s.replace(a, "did_start = bool(started)"))
PY
      ;;
    complete)
      # إسقاطُ فحصِ الاكتمالِ — فيُحكَمُ على تشغيلٍ ما زالَ يجري.
      python3 - "$stage/scripts/ci-evidence.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
a = 'elif not all(j["complete"] for j in jobs):\n    verdict, reason = "NOT VERIFIED", "incomplete_run"\n'
assert a in s, "mutant `complete`: نمطٌ غير موجودٍ"
open(p, "w", encoding="utf-8").write(s.replace(a, ""))
PY
      ;;
    failed_nostart)
      # إسقاطُ شرطِ «بدأت» من تعريفِ الإخفاقِ — وحدَه لا يكفي لقلبِ الحكمِ (انظر §4).
      python3 - "$stage/scripts/ci-evidence.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
a = '"failed": did_start and concl == "failure",'
assert a in s, "mutant `failed_nostart`: نمطٌ غير موجودٍ"
open(p, "w", encoding="utf-8").write(s.replace(a, '"failed": concl == "failure",'))
PY
      ;;
    order_failed)
      # الطفرةُ المُميتةُ: تُعطَبُ الحارسانِ معاً — الترتيبُ وتعريفُ الإخفاقِ.
      python3 - "$stage/scripts/ci-evidence.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
a = 'elif not started_jobs:\n    verdict = "NOT VERIFIED"\n    reason = (reasons.most_common(1)[0][0] if reasons else "job_did_not_start")\n'
b = 'elif any(j["failed"] for j in jobs):\n    verdict, reason = "FAILED", "job_started_and_failed"\n'
c = '"failed": did_start and concl == "failure",'
d = '"failed": did_start and status == "failed",'
for x in (a, b, c, d):
    assert x in s, "mutant `order_failed`: نمطٌ غير موجودٍ"
s = s.replace(a, "@@A@@").replace(b, "@@B@@").replace("@@A@@", b).replace("@@B@@", a)
s = s.replace(c, '"failed": concl == "failure",').replace(d, '"failed": status == "failed",')
open(p, "w", encoding="utf-8").write(s)
PY
      ;;
    complete_else)
      # الطفرةُ المُميتةُ الثانيةُ: يُسقَطُ فحصُ الاكتمالِ **و**يُصيَّرُ المجهولُ نجاحاً.
      python3 - "$stage/scripts/ci-evidence.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
a = 'elif not all(j["complete"] for j in jobs):\n    verdict, reason = "NOT VERIFIED", "incomplete_run"\n'
b = 'else:\n    verdict, reason = "NOT VERIFIED", "incomplete_run"\n'
assert a in s and b in s, "mutant `complete_else`: نمطٌ غير موجودٍ"
s = s.replace(a, "").replace(b, 'else:\n    verdict, reason = "PASSED", "all_jobs_succeeded"\n')
open(p, "w", encoding="utf-8").write(s)
PY
      ;;
    *) printf '%s✗ طفرةٌ غيرُ معروفةٍ: %s%s\n' "$RED" "$mutant" "$RST"; return 2 ;;
  esac

  local fx="$stage/fixture"
  make_fixture "$fx" "$provider" "$case"

  ( cd "$stage" && CI_EVIDENCE_PROVIDER="$provider" CI_EVIDENCE_FIXTURE="$fx" \
      bash scripts/ci-evidence.sh main ) > "$stage/out.log" 2>&1
  local rc=$?

  local vj
  vj="$(find "$stage/docs/12-testing/ci-evidence" -name verdict.json 2>/dev/null | head -1)"
  local gv gr
  if [[ -n "$vj" ]]; then
    gv="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["verdict"])' "$vj" 2>/dev/null)"
    gr="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["reason"])' "$vj" 2>/dev/null)"
  else
    gv="<no-verdict>"; gr="rc=$rc"
  fi

  local label="[$provider/$case]"
  [[ "$mutant" != "-" ]] && label="[طفرة:$mutant · $provider/$case]"

  # QUIET=1: تُقرأُ النتيجةُ ولا يُلمَسُ العدَّادُ — يستعملُه expect_fail كي لا يُحسَبَ
  # قتلُ الطفرةِ إخفاقاً في الحزمةِ. وبلا هذا كانَ العدَّادُ يقولُ «4 فاشلاً» بينما
  # كلُّ سطرٍ أخضرُ — رقمٌ يكذبُ على قارئِه.
  if [[ "$gv" == "$ev" && "$gr" == "$er" ]]; then
    if [[ "${QUIET:-0}" != "1" ]]; then
      printf '  %s✓%s %-46s %s ⇒ %s\n' "$GRN" "$RST" "$label" "$gv" "$gr"
      PASS=$((PASS + 1))
    fi
    return 0
  fi
  if [[ "${QUIET:-0}" != "1" ]]; then
    printf '  %s✗%s %-46s المتوقَّع «%s / %s» والمقروءُ «%s / %s»\n' \
      "$RED" "$RST" "$label" "$ev" "$er" "$gv" "$gr"
    printf '%s    %s%s\n' "$DIM" "$(tail -2 "$stage/out.log" | tr '\n' ' ')" "$RST"
    FAIL=$((FAIL + 1))
  fi
  return 1
}

# طفرةٌ يجبُ أن تُخفِقَ: نجاحُها = القاعدةُ لا تُقاس.
expect_fail() { # expect_fail <mutant> <provider> <case> <ev> <er>
  if QUIET=1 run_case "$@" > /dev/null 2>&1; then
    printf '  %s✗%s [طفرة:%s · %s/%s] %sنجحت الطفرةُ — فالقاعدةُ غيرُ مقيسةٍ%s\n' \
      "$RED" "$RST" "$1" "$2" "$3" "$BOLD" "$RST"
    FAIL=$((FAIL + 1))
  else
    printf '  %s✓%s [طفرة:%-9s · %s/%s] رُفِضت كما يجب\n' "$GRN" "$RST" "$1" "$2" "$3"
    PASS=$((PASS + 1))
  fi
}

printf '%s╔══════════════════════════════════════════════════════════╗%s\n' "$BOLD" "$RST"
printf '%s║  حزمةُ اختبارِ دليلِ CI — ترفض فعلاً لا شكلاً (M0-22D)     ║%s\n' "$BOLD" "$RST"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n\n' "$BOLD" "$RST"

printf '%s──── 1) حالاتُ الصحّةِ — GitHub (المُزوِّدُ الحيُّ) ────%s\n' "$DIM" "$RST"
run_case - github all_success        PASSED         all_jobs_succeeded
run_case - github started_and_failed FAILED         job_started_and_failed
run_case - github never_started      "NOT VERIFIED" failure
run_case - github incomplete         "NOT VERIFIED" incomplete_run
run_case - github skipped_ok         PASSED         all_jobs_succeeded
run_case - github no_jobs            "NOT VERIFIED" no_jobs_readable
run_case - github garbage            "NOT VERIFIED" no_jobs_readable

printf '\n%s──── 2) حالاتُ الصحّةِ — GitLab (المسارُ التاريخيُّ يبقى مقيساً) ────%s\n' "$DIM" "$RST"
run_case - gitlab all_success        PASSED         all_jobs_succeeded
run_case - gitlab started_and_failed FAILED         job_started_and_failed
run_case - gitlab never_started      "NOT VERIFIED" ci_quota_exceeded
run_case - gitlab no_jobs            "NOT VERIFIED" no_jobs_readable

printf '\n%s──── 3) طفراتٌ على السكربتِ — يجبُ أن تُخفِقَ ────%s\n' "$DIM" "$RST"
expect_fail steps         github never_started "NOT VERIFIED" failure
expect_fail order_failed  github never_started "NOT VERIFIED" failure
expect_fail order_failed  gitlab never_started "NOT VERIFIED" ci_quota_exceeded
expect_fail complete_else github incomplete    "NOT VERIFIED" incomplete_run

# ── 4) طفراتٌ صمدَ لها السكربتُ بحارسٍ ثانٍ ─────────────────────────────
# وهذه **ليست** حالاتِ نجاحٍ مُجمَّلةً: كلُّ واحدةٍ منها طفرةٌ حقيقيّةٌ أُدخِلت
# ولم تقلب الحكمَ، **لأنّ القاعدةَ محروسةٌ مرّتَينِ لا مرّةً**:
#   • `order` وحدَها لا تكفي لأنّ `failed` نفسُه يشترطُ `did_start`.
#   • `failed_nostart` وحدَها لا تكفي لأنّ فحصَ «لم تبدأ» يسبقُها في الترتيبِ.
#   • `complete` وحدَها لا تكفي لأنّ الفرعَ الأخيرَ (`else`) يُصيِّرُ المجهولَ NOT VERIFIED.
# فتُسجَّلُ **طفراتٍ مكافئةً** صريحةً، وتُقاسُ الفتكُ بالطفرتَينِ المركَّبتَينِ في §3.
# وإخفاءُ هذا القسمِ كانَ يُغري بأربعِ «طفراتٍ ناجحةٍ» كاذبةٍ في العدَّادِ.
printf '\n%s──── 4) طفراتٌ مكافئةٌ — صمدَ لها السكربتُ بحارسٍ ثانٍ (مُعلَنةٌ لا مُخفاةٌ) ────%s\n' "$DIM" "$RST"
run_case order         github never_started "NOT VERIFIED" failure
run_case failed_nostart github never_started "NOT VERIFIED" failure
run_case complete      github incomplete    "NOT VERIFIED" incomplete_run

printf '\n%s════════════════════════════════════════════════════════════%s\n' "$BOLD" "$RST"
if (( FAIL == 0 )); then
  printf '%s✓ حزمةُ دليلِ CI: %d ناجحاً · 0 فاشلٍ.%s\n' "$GRN" "$PASS" "$RST"
  exit 0
fi
printf '%s✗ حزمةُ دليلِ CI: %d ناجحاً · %d فاشلاً.%s\n' "$RED" "$PASS" "$FAIL" "$RST"
exit 1
