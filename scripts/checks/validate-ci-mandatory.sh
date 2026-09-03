#!/usr/bin/env bash
# validate-ci-mandatory.sh — «CI مانعٌ لا مُجمِّل»: أربعةُ أبوابٍ. (M0-04)
#
# ── ما يحرس ولماذا كلُّ بابٍ بابٌ ──────────────────────────────────────
# 1) **مدخلٌ واحدٌ مستدعىً:** `.gitlab-ci.yml` يستدعي `scripts/verify.sh` في وظيفةٍ
#    ليست `allow_failure`. بغيرِه يبقى الأمرُ الموحَّدُ حبراً: موجودٌ ولا يجري.
# 2) **لا كتلةَ إلزامٍ مضمَّنةٌ في YAML:** لا `for f in README.md …` ولا
#    `for d in apps …` داخلَ `.gitlab-ci.yml`. القائمةُ في
#    `lib/required-artifacts.sh` وحدَها؛ وهذا البابُ يمنع رجوعَ النسخةِ الثانيةِ
#    التي كان فرقُها 12 عنصراً (M0-04).
# 3) **لا `allow_failure` صامتٌ:** كلُّ وظيفةٍ `allow_failure: true` يجب أن يكون
#    اسمُها مُعلَناً في كتلةِ §4 من `docs/00-rules/VERIFY_COMMAND.md`. فالاستثناءُ
#    المكتوبُ في YAML وحدَه لا يراه إلّا مَن يقرأ YAML.
# 4) **لا حارسَ يتيمٌ:** كلُّ `scripts/checks/*.sh` يجب أن يكون قابلاً للوصولِ
#    من `scripts/verify.sh` مباشرةً أو عبرَ سلسلةِ استدعاءٍ، إلّا ما يُعلَن في
#    كتلةِ §5 من الوثيقة. العيبُ المقيسُ: `find-existing-work.sh` لم تستدعِه
#    وظيفةُ CI واحدةٌ.
#
# ── ولمَ صارَ يقرأ مصدرَين (M0-22C) ──────────────────────────────────────
# كانَ يقرأ `.gitlab-ci.yml` **وحدَه**، و`.gitlab-ci.yml` لا يجري منذ 2026-08-25.
# فكانَ الحارسُ يحرسُ ملفّاً ميتاً ويتركُ الحيَّ: نصُّ `ADR-023` §7 «`ci.yml` غيرُ
# محروسٍ من تعطيلِ فحصٍ فيه — ثغرةٌ مُعلَنةٌ باقيةٌ»، وصدرُ `ci.yml` نفسِه «لو
# حُذفت منه وظيفةُ `verify` غداً لَما أسقطَ ذلك بوّابةً». وهو نفسُ عطبِ
# `RISK-0016` في عدَّادِ الأساسِ. فالأبوابُ 1..3 تُقاسُ الآنَ على **الملفَّين**،
# وكلُّ رسالةِ رفضٍ تُسمّي مصدرَها فلا يُخلَطُ عطبُ ملفٍّ بعطبِ آخرَ.
#
# ولغةُ المصدرَين مختلفةٌ فالقياسُ مختلفٌ لا مُترجَمٌ حرفاً:
#   • GitLab: وظيفةٌ في العمودِ الأوّلِ · `allow_failure: true` · `script:`
#   • GitHub: وظيفةٌ تحتَ `jobs:` · `continue-on-error: true` (وظيفةً وخطوةً) ·
#     `run:` · **و`if:` على وظيفةٍ تُقنِّعُها كما يُقنِّعُها `allow_failure`** —
#     فوظيفةٌ لا تعملُ إلّا بشرطٍ ليست بوّابةً مانعةً، وهذا بابٌ لا نظيرَ له في
#     GitLab وأُضيفَ لأنّ الخطرَ حقيقيٌّ لا لأنّ التماثلَ جميلٌ.
#
# وحدُّه المُعلَن: يقرأ النصوصَ ولا يشغّل خطَّ CI، ولا يسأل GitLab عن
# `only_allow_merge_if_pipeline_succeeds` (فحصُ البوّابةِ 8 يسأل إن توفّر توكن).
# فهو يُثبت أنّ **الإعدادَ مُتّسقٌ**، لا أنّ الخطَّ جرى.
#
#   bash scripts/checks/validate-ci-mandatory.sh            # المستودعُ نفسُه
#   bash scripts/checks/validate-ci-mandatory.sh /tmp/root  # جذرٌ صريحٌ (للاختبار)
#
# ووسيطُ الجذرِ موجودٌ ليُختبرَ الحارسُ على جذورٍ صناعيّةٍ، فلا يُشوَّهُ
# `.gitlab-ci.yml` الحقيقيُّ في اختبارٍ أبداً (سابقةُ M0-12).
#
# المرجع: docs/00-rules/VERIFY_COMMAND.md §4 §5 §7 · M0-04

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "$HERE/../.." && pwd)}"
cd "$ROOT" || exit 1

CI_FILE=".gitlab-ci.yml"
GH_FILE=".github/workflows/ci.yml"
DOC="docs/00-rules/VERIFY_COMMAND.md"
VERIFY="scripts/verify.sh"

GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
PROBLEMS=()

for f in "$CI_FILE" "$GH_FILE" "$DOC" "$VERIFY"; do
  [[ -f "$f" ]] || { printf '%s✗ ملفٌّ لازمٌ مفقودٌ: %s%s\n' "$RED" "$f" "$RST"; exit 1; }
done

# ── قراءةُ الكتلتَين المُعلَنتَين من الوثيقة ─────────────────────────────
# كتلةٌ = أوّلُ ```text بعدَ نصٍّ مرجعيٍّ. المرجعُ نصٌّ عربيٌّ في العنوانِ نفسِه،
# فإن غُيِّر العنوانُ سقطَ الفحصُ صراحةً ولم يمرَّ بقائمةٍ فارغةٍ صامتة.
read_block() { # read_block <مرساة>
  python3 - "$DOC" "$1" <<'PY'
import sys, re
doc, anchor = sys.argv[1], sys.argv[2]
text = open(doc, encoding="utf-8").read()
i = text.find(anchor)
if i < 0:
    sys.exit("MISSING_ANCHOR")
m = re.search(r"```text\n(.*?)```", text[i:], re.S)
if not m:
    sys.exit("MISSING_BLOCK")
for line in m.group(1).splitlines():
    line = line.strip()
    if line and not line.startswith("#"):
        print(line)
PY
}

ALLOWED_FAILING="$(read_block "## 4. وظائفُ CI المسموحُ لها بالإخفاق")" || {
  printf '%s✗ لم أجد كتلةَ §4 المُعلَنةَ في %s%s\n' "$RED" "$DOC" "$RST"; exit 1; }
NON_GATES="$(read_block "## 5. سكربتاتُ استكشافٍ لا بوّابات")" || {
  printf '%s✗ لم أجد كتلةَ §5 المُعلَنةَ في %s%s\n' "$RED" "$DOC" "$RST"; exit 1; }

# ── قارئُ الملفِّ الحيِّ: وظيفةٌ في كلِّ سطرٍ ─────────────────────────────
# يطبع لكلِّ وظيفةٍ: الاسمُ|يستدعي verify|مُقنَّعةٌ|سببُ التقنيعِ
# والتقنيعُ ثلاثةٌ لا واحدٌ: `continue-on-error` على الوظيفةِ · على خطوةٍ فيها ·
# و`if:` على الوظيفةِ. وكلُّها تُنتِجُ وظيفةً لا يَنفُذُ حكمُها، فتُعَدُّ سواءً.
GH_JOBS="$(python3 - "$GH_FILE" <<'PY'
import sys, yaml

with open(sys.argv[1], encoding="utf-8") as fh:
    wf = yaml.safe_load(fh)

jobs = (wf or {}).get("jobs")
if not isinstance(jobs, dict) or not jobs:
    sys.exit("NO_JOBS")


def truthy(v):
    return v is True or (isinstance(v, str) and v.strip().lower() == "true")


for name, job in jobs.items():
    if not isinstance(job, dict):
        continue
    steps = job.get("steps") or []
    runs_verify = any(
        isinstance(st, dict) and "scripts/verify.sh" in str(st.get("run", ""))
        for st in steps
    )
    masks = []
    if truthy(job.get("continue-on-error")):
        masks.append("continue-on-error")
    if any(isinstance(st, dict) and truthy(st.get("continue-on-error")) for st in steps):
        masks.append("continue-on-error-fi-khutwa")
    if job.get("if") is not None:
        masks.append("if-shartiyy")
    print("%s|%s|%s|%s" % (
        name,
        "true" if runs_verify else "false",
        "true" if masks else "false",
        ",".join(masks),
    ))
PY
)" || { printf '%s✗ لم أقرأ وظائفَ %s — الملفُ الحيُّ لا يُقاس%s\n' "$RED" "$GH_FILE" "$RST"; exit 1; }

# ── البابُ 1: verify.sh مُستدعىً من وظيفةٍ ليست allow_failure ────────────
JOB_OF_VERIFY="$(python3 - "$CI_FILE" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
# كتلةُ الوظيفةِ: من اسمٍ في العمودِ الأوّلِ إلى الاسمِ التالي.
jobs = re.split(r"\n(?=[A-Za-z_.][\w.-]*:\n)", text)
for j in jobs:
    name = j.split(":", 1)[0].strip()
    if "scripts/verify.sh" in j:
        print("%s|%s" % (name, "true" if re.search(r"^\s*allow_failure:\s*true", j, re.M) else "false"))
PY
)"
if [[ -z "$JOB_OF_VERIFY" ]]; then
  PROBLEMS+=("البابُ 1: لا وظيفةَ CI تستدعي $VERIFY — الأمرُ الموحَّدُ لا يجري في الخطّ.")
else
  while IFS='|' read -r jname jaf; do
    [[ -z "$jname" ]] && continue
    if [[ "$jaf" == "true" ]]; then
      PROBLEMS+=("البابُ 1: الوظيفةُ «$jname» تستدعي $VERIFY لكنّها allow_failure — لا تُسقِط شيئاً.")
    fi
  done <<< "$JOB_OF_VERIFY"
fi

GH_VERIFY_OK=false
while IFS='|' read -r gname gver gmask greason; do
  [[ -z "$gname" ]] && continue
  [[ "$gver" == "true" ]] || continue
  if [[ "$gmask" == "true" ]]; then
    PROBLEMS+=("البابُ 1 ($GH_FILE): الوظيفةُ «$gname» تستدعي $VERIFY وهي مُقنَّعةٌ ($greason) — لا تُسقِط شيئاً.")
  else
    GH_VERIFY_OK=true
  fi
done <<< "$GH_JOBS"
if [[ "$GH_VERIFY_OK" != true ]]; then
  PROBLEMS+=("البابُ 1 ($GH_FILE): لا وظيفةَ مانعةً تستدعي $VERIFY في الملفِّ الحيِّ — الأمرُ الموحَّدُ لا يجري حيثُ يجري الخطُّ.")
fi

# ── البابُ 2: لا كتلةَ إلزامٍ مضمَّنةٌ في YAML ────────────────────────────
INLINE="$(grep -nE 'for [fd] in .*(README\.md|CODEOWNERS|apps |services |docs/00-rules/)' "$CI_FILE" || true)"
if [[ -n "$INLINE" ]]; then
  while IFS= read -r line; do
    PROBLEMS+=("البابُ 2 ($CI_FILE): كتلةُ إلزامٍ مضمَّنةٌ — ${line%%:*}: نسخةٌ ثانيةٌ من القائمة.")
  done <<< "$INLINE"
fi

GH_INLINE="$(grep -nE 'for [fd] in .*(README\.md|CODEOWNERS|apps |services |docs/00-rules/)' "$GH_FILE" || true)"
if [[ -n "$GH_INLINE" ]]; then
  while IFS= read -r line; do
    PROBLEMS+=("البابُ 2 ($GH_FILE): كتلةُ إلزامٍ مضمَّنةٌ — ${line%%:*}: نسخةٌ ثانيةٌ من القائمة.")
  done <<< "$GH_INLINE"
fi

# ── البابُ 3: كلُّ allow_failure مُعلَنٌ في §4 ───────────────────────────
AF_JOBS="$(python3 - "$CI_FILE" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
for j in re.split(r"\n(?=[A-Za-z_.][\w.-]*:\n)", text):
    name = j.split(":", 1)[0].strip()
    if not re.match(r"^[A-Za-z_.][\w.-]*$", name):
        continue
    if re.search(r"^\s*allow_failure:\s*true", j, re.M):
        print(name)
PY
)"
while IFS= read -r j; do
  [[ -z "$j" ]] && continue
  if ! grep -Fxq "$j" <<< "$ALLOWED_FAILING"; then
    PROBLEMS+=("البابُ 3 ($CI_FILE): الوظيفةُ «$j» بـallow_failure وليست مُعلَنةً في $DOC §4.")
  fi
done <<< "$AF_JOBS"

while IFS='|' read -r gname gver gmask greason; do
  [[ -z "$gname" ]] && continue
  [[ "$gmask" == "true" ]] || continue
  if ! grep -Fxq "$gname" <<< "$ALLOWED_FAILING"; then
    PROBLEMS+=("البابُ 3 ($GH_FILE): الوظيفةُ «$gname» مُقنَّعةٌ ($greason) وليست مُعلَنةً في $DOC §4.")
  fi
done <<< "$GH_JOBS"

# ── البابُ 4: لا حارسَ يتيمٌ خارجَ الأمرِ الموحَّد ────────────────────────
# إغلاقٌ متعدٍّ: نبدأ بـverify.sh ونتبع كلَّ استدعاءٍ لسكربتٍ داخلَه، وهكذا.
REACHABLE="$(python3 - "$VERIFY" <<'PY'
import re, os, sys
seen, stack = set(), [sys.argv[1]]
while stack:
    f = stack.pop()
    if f in seen or not os.path.isfile(f):
        continue
    seen.add(f)
    text = open(f, encoding="utf-8", errors="replace").read()
    for ref in re.findall(r"scripts/[\w./-]+\.(?:sh|py)", text):
        if ref not in seen:
            stack.append(ref)
for f in sorted(seen):
    print(f)
PY
)"
for g in scripts/checks/*.sh; do
  base="$(basename "$g")"
  grep -Fxq "$base" <<< "$NON_GATES" && continue
  grep -Fxq "$g" <<< "$REACHABLE" && continue
  PROBLEMS+=("البابُ 4: الحارسُ «$g» لا يُوصَل إليه من $VERIFY ولا هو مُعلَنٌ في $DOC §5.")
done

# ── الحصاد ──────────────────────────────────────────────────────────────
if ((${#PROBLEMS[@]})); then
  printf '%s✗ CI ليس مانعاً — %d مشكلةً:%s\n' "$RED" "${#PROBLEMS[@]}" "$RST"
  for p in "${PROBLEMS[@]}"; do printf '  ✗ %s\n' "$p"; done
  printf '%s  المرجع: %s §4 §5 §7 (M0-04)%s\n' "$DIM" "$DOC" "$RST"
  exit 1
fi

N_AF="$(grep -c . <<< "$ALLOWED_FAILING" || true)"
N_NG="$(grep -c . <<< "$NON_GATES" || true)"
N_GH="$(grep -c . <<< "$GH_JOBS" || true)"
printf '%s✓ CI مانعٌ في إعدادِه:%s مصدرانِ مقيسانِ (%s + %s بـ%s وظيفةٍ) · مدخلٌ موحَّدٌ مُستدعَى في كلَيهما · لا كتلةَ إلزامٍ مضمَّنةً · %s استثناءَ إخفاقٍ مُعلَناً · %s سكربتَ استكشافٍ مُعلَناً.\n' \
  "$GRN" "$RST" "$CI_FILE" "$GH_FILE" "$N_GH" "$N_AF" "$N_NG"
printf '%s  ولا يشمل هذا رفضَ الدمجِ عندَ إخفاقِ الخطّ (only_allow_merge_if_pipeline_succeeds) — %s §7.%s\n' \
  "$DIM" "$DOC" "$RST"
exit 0
