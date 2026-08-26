#!/usr/bin/env bash
# validate-work-claims.sh — منع تكرار العمل بين جهتين عبر حجز النطاق.
# القاعدة: docs/00-rules/WORK_CLAIM_RULE.md · السجل: docs/16-progress/WORK_CLAIMS.md
#
# الاستخدام:
#   bash scripts/checks/validate-work-claims.sh [OLD_REF] [NEW_REF]
# بلا وسائط: يتحقق من سلامة السجل فقط (بنية + تقاطع + انتهاء)، بلا فحص الملفات المُعدّلة.
#
# fail-closed: أي خطأ غير متوقع = رفض.
set -euo pipefail

CLAIMS="docs/16-progress/WORK_CLAIMS.md"
BOARD="docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
MAX_TTL_DAYS=14

# سجلات مشتركة يكتب فيها الجميع بحكم القاعدة — مستثناة من فحص التقاطع والاحتواء.
#
# هذه القائمة **واحدة في ثلاثة مواضع** ويجب أن تبقى متطابقة حرفاً بحرف:
#   1) هذا المصفوف
#   2) LEDGER_ONLY_PATHS في scripts/checks/require-doc-update.sh
#   3) كتلة «مسارات مستثناة من فحص التقاطع» في docs/16-progress/WORK_CLAIMS.md
# قبل M0-12 كانت الثلاثةُ بثلاثِ قوائم: هذا المصفوف يستثني WORK_INDEX ولا يستثني
# MASTER_PROGRESS، والوثيقةُ تفعل العكس، و`require-doc-update.sh` يستثني الخمسةَ.
# فمَن اتَّبع الوثيقةَ وحدَّث MASTER_PROGRESS.md رُفض دفعُه بتقاطعٍ لا ذنبَ له فيه.
# القرار (مالك البرنامج · M0-12): الخمسةُ كلُّها مستثناة، لأنّ القاعدةَ نفسَها تُلزم
# الجميعَ بتحديثها، ومنعُ ما تُلزم به يعني منعَ الالتزام بالقاعدة.
SHARED_LEDGERS=(
  "docs/16-progress/TASK_LOG.md"
  "docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
  "docs/16-progress/WORK_CLAIMS.md"
  "docs/16-progress/WORK_INDEX.md"
  "docs/16-progress/MASTER_PROGRESS.md"
)

# المسارات التي تُوجب حجزاً (نفس تعريف require-doc-update.sh)
MEANINGFUL='^(apps/|bots/|services/|packages/|infra/|scripts/|\.gitlab-ci\.yml$|package\.json$|pnpm-lock\.yaml$|README\.md$|CONTRIBUTING\.md$|SECURITY\.md$)'

fail() { printf '\n\033[31m✗ رفض حجز العمل:\033[0m %s\n' "$1" >&2; exit 1; }
info() { printf '  %s\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }

[[ -f "$CLAIMS" ]] || fail "السجل غير موجود: $CLAIMS — راجع docs/00-rules/WORK_CLAIM_RULE.md"
[[ -f "$BOARD"  ]] || fail "اللوحة غير موجودة: $BOARD"

printf '\n\033[1m=== فحص حجوزات العمل ===\033[0m\n'

TODAY="$(date -u +%Y-%m-%d)"

# ── استخراج الحجوزات النشطة ─────────────────────────────────────────────
# صيغة الصف: | CLM-#### | Work Item | Owner | Branch | Scope Paths | Started | Expires | Status |
ACTIVE_TSV="$(mktemp)"; trap 'rm -f "$ACTIVE_TSV"' EXIT
awk -F'|' '
  /^\| *CLM-[0-9]+ *\|/ {
    for (i = 2; i <= NF; i++) { gsub(/^[ \t]+|[ \t]+$/, "", $i) }
    if (NF < 9) next
    if ($9 != "Active") next
    print $2 "\t" $3 "\t" $4 "\t" $5 "\t" $6 "\t" $7 "\t" $8
  }
' "$CLAIMS" > "$ACTIVE_TSV"

ACTIVE_COUNT="$(wc -l < "$ACTIVE_TSV" | tr -d ' ')"
info "حجوزات نشطة: $ACTIVE_COUNT"

# ── 1) سلامة كل سطر نشط ─────────────────────────────────────────────────
seen_items=""
while IFS=$'\t' read -r cid item owner branch scope started expires; do
  [[ -n "${cid:-}" ]] || continue

  # 2) عنصر عمل صالح وموجود في اللوحة
  [[ "$item" =~ ^M[0-9]+-[0-9A-Za-z]+$ ]] \
    || fail "$cid: عنصر العمل «$item» لا يطابق الصيغة M<رقم>-<معرّف> (مثل M5-12)."
  grep -qE "^\| *${item} *\|" "$BOARD" \
    || fail "$cid: عنصر العمل «$item» غير موجود في $BOARD — أضف الصف قبل الحجز."

  # 6) مالك بشري
  [[ -n "$owner" && "$owner" != "—" ]] || fail "$cid: عمود المالك فارغ. لا حجز بلا مالك."
  [[ "$owner" == @* ]] || fail "$cid: المالك «$owner» يجب أن يبدأ بـ@ (وللوكيل: '@handle (agent:<name>)')."

  [[ -n "$branch" && "$branch" != "—" ]] || fail "$cid: عمود الفرع فارغ."
  [[ -n "$scope"  && "$scope"  != "—" ]] || fail "$cid: عمود مسارات النطاق فارغ."

  # 5) التاريخ والمهلة
  [[ "$started" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "$cid: تاريخ البدء «$started» ليس YYYY-MM-DD."
  [[ "$expires" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "$cid: تاريخ الانتهاء «$expires» ليس YYYY-MM-DD."
  s_ep="$(date -u -d "$started" +%s 2>/dev/null || fail "$cid: تاريخ بدء غير صالح: $started")"
  e_ep="$(date -u -d "$expires" +%s 2>/dev/null || fail "$cid: تاريخ انتهاء غير صالح: $expires")"
  t_ep="$(date -u -d "$TODAY"   +%s)"
  (( e_ep > s_ep )) || fail "$cid: تاريخ الانتهاء ليس بعد تاريخ البدء."
  ttl=$(( (e_ep - s_ep) / 86400 ))
  (( ttl <= MAX_TTL_DAYS )) || fail "$cid: المهلة $ttl يوماً تتجاوز الحد الأقصى $MAX_TTL_DAYS يوماً. قسّم العمل."
  (( e_ep >= t_ep )) || fail "$cid: الحجز منتهٍ ($expires < $TODAY). حرّره أو مدّده بإدخال في TASK_LOG.md."

  # 1-مكرر) حجز مزدوج لنفس عنصر العمل
  case " $seen_items " in
    *" $item "*) fail "$cid: عنصر العمل «$item» محجوز مرتين في وقت واحد. جهتان على نفس العنصر = تكرار." ;;
  esac
  seen_items="$seen_items $item"
done < "$ACTIVE_TSV"
ok "بنية الحجوزات النشطة صالحة (عنصر عمل موجود · مالك · فرع · نطاق · مهلة ≤ ${MAX_TTL_DAYS}د)."

# ── 4) تقاطع النطاقات بين مالكين مختلفين ────────────────────────────────
is_shared() {
  local p="$1"
  for l in "${SHARED_LEDGERS[@]}"; do [[ "$p" == "$l" ]] && return 0; done
  return 1
}
overlaps() { # بادئة مسار: أحدهما يحتوي الآخر
  local a="$1" b="$2"
  [[ "$a" == "$b" ]] && return 0
  [[ "$a" == */ && "$b" == "$a"* ]] && return 0
  [[ "$b" == */ && "$a" == "$b"* ]] && return 0
  return 1
}

mapfile -t ROWS < "$ACTIVE_TSV"
for ((i = 0; i < ${#ROWS[@]}; i++)); do
  IFS=$'\t' read -r ci _ oi _ si _ _ <<< "${ROWS[i]}"
  for ((j = i + 1; j < ${#ROWS[@]}; j++)); do
    IFS=$'\t' read -r cj _ oj _ sj _ _ <<< "${ROWS[j]}"
    [[ "$oi" == "$oj" ]] && continue   # نفس المالك: مسؤوليته
    IFS=',' read -r -a PI <<< "$si"
    IFS=',' read -r -a PJ <<< "$sj"
    for pi in "${PI[@]}"; do
      pi="$(echo "$pi" | xargs)"; [[ -n "$pi" ]] || continue
      is_shared "$pi" && continue
      for pj in "${PJ[@]}"; do
        pj="$(echo "$pj" | xargs)"; [[ -n "$pj" ]] || continue
        is_shared "$pj" && continue
        if overlaps "$pi" "$pj"; then
          fail "تقاطع نطاقات: $ci ($oi · $pi) ✕ $cj ($oj · $pj).
     جهتان تعملان في نفس المسار. نسّقا، أو قسّما العنصر إلى عنصرين متسلسلين.
     راجع docs/00-rules/WORK_CLAIM_RULE.md §8"
        fi
      done
    done
  done
done
ok "لا تقاطع في النطاقات بين مالكين مختلفين."

# ── 3) احتواء الملفات المُعدّلة داخل النطاق المحجوز ──────────────────────
if [[ $# -lt 2 ]]; then
  printf '\n\033[33mملاحظة:\033[0m لم تُمرَّر مراجع git — تحقّقتُ من سلامة السجل فقط، بلا فحص الملفات المُعدّلة.\n'
  ok "فحص حجوزات العمل انتهى (وضع السجل فقط)."
  exit 0
fi

OLD_REF="$1"; NEW_REF="$2"
command -v git >/dev/null 2>&1 || fail "git غير متاح، ولا يمكن فحص الملفات المُعدّلة."
git rev-parse --git-dir >/dev/null 2>&1 || fail "لا مستودع git هنا، ولا يمكن فحص الملفات المُعدّلة."

CHANGED="$(git diff --name-only "$OLD_REF" "$NEW_REF" -- 2>/dev/null || true)"
[[ -n "$CHANGED" ]] || { ok "لا ملفات مُعدّلة بين $OLD_REF و$NEW_REF."; exit 0; }

MEANINGFUL_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E "$MEANINGFUL" || true)"
if [[ -z "$MEANINGFUL_CHANGED" ]]; then
  ok "لا تغييرات ذات معنى تُوجب حجزاً."
  exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
[[ -n "$BRANCH" && "$BRANCH" != "HEAD" ]] || fail "لا يمكن تحديد الفرع الحالي (HEAD منفصل). الحجز يرتبط بفرع مُسمّى."

MY_SCOPES=""; MY_CID=""
while IFS=$'\t' read -r cid _ _ branch scope _ _; do
  [[ "$branch" == "$BRANCH" ]] || continue
  MY_CID="$cid"; MY_SCOPES="$scope"; break
done < "$ACTIVE_TSV"

[[ -n "$MY_CID" ]] || fail "لا حجز نشط للفرع «$BRANCH».
     أضف سطراً في $CLAIMS قبل الدفع، وشغّل قبله:
       bash scripts/checks/find-existing-work.sh \"<المجال>\"
     راجع docs/00-rules/WORK_CLAIM_RULE.md"

info "الحجز المطابق: $MY_CID (الفرع $BRANCH)"

IFS=',' read -r -a MS <<< "$MY_SCOPES"
OUTSIDE=""
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  is_shared "$f" && continue
  inside=0
  for p in "${MS[@]}"; do
    p="$(echo "$p" | xargs)"; [[ -n "$p" ]] || continue
    if [[ "$p" == */ ]]; then [[ "$f" == "$p"* ]] && { inside=1; break; }
    else [[ "$f" == "$p" ]] && { inside=1; break; }; fi
  done
  (( inside )) || OUTSIDE="$OUTSIDE
     - $f"
done <<< "$MEANINGFUL_CHANGED"

[[ -z "$OUTSIDE" ]] || fail "ملفات مُعدّلة خارج نطاق الحجز $MY_CID:$OUTSIDE

     النطاق المحجوز: $MY_SCOPES
     إمّا تُخرج هذه الملفات من الـMR، أو تُنشئ حجزاً ثانياً لعنصر عمل ثانٍ.
     لا يُوسَّع سطر حجز قائم بعد بدء الكتابة — WORK_CLAIM_RULE.md §6"

ok "كل الملفات المُعدّلة داخل النطاق المحجوز."
printf '\n\033[32m✓ فحص حجوزات العمل: نجح.\033[0m\n'
