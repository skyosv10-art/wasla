# gov-cases-app-api-routes.sh — حالاتُ طفرةٍ للفحصِ 24 (عقدُ المسارِ بين التطبيقِ والخدمةِ · M3-08).
#
# تُستدعى من `scripts/checks/test-governance.sh` وهيَ تعملُ في نسخةِ `/tmp`
# (المتغيّرُ `$T`) لا في المستودعِ الأصلي. وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# لكلِّ بابٍ طفرةٌ **يجبُ أن تُسقِطَهُ هوَ** (يُطابَقُ نصُّ البابِ في المُخرَجِ لا
# رمزُ الخروجِ وحدَهُ — فإخفاقُ البابِ 5 بعدَ كلِّ تعديلٍ للسجلِّ كانَ سيُخفي
# بابَ 3 ساقطاً دائماً)، ويُعادُ الأصلُ بعدَ كلِّ واحدةٍ ويُثبَتُ أنَّهُ يمرُّ.
# وكلُّ طفرةٍ تُثبِتُ أنَّها طفرَت: ملفٌّ لم يتغيّرْ بايتٌ فيهِ يُسقِطُ الحالةَ.
#
# المرجع: docs/12-testing/APP_API_ROUTES.md · M3-08

printf '\n\033[1m[ظ] عقدُ المسارِ بين التطبيقِ والخدمةِ (M3-08 · الفحصُ 24)\033[0m\n'

AR=scripts/checks/validate-app-api-routes.sh
AR_DOC=docs/12-testing/APP_API_ROUTES.md
AR_SVC=services/customers/src/http/app.ts
AR_PROBE=apps/customer-mini-app/src/zz-gov-probe.ts
AR_TEST_PROBE=apps/customer-mini-app/src/__tests__/zz-gov-probe.test.ts

if [[ ! -f "$AR" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$AR"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

AR_BK=/tmp/appapiroutes_backup
rm -rf "$AR_BK"; mkdir -p "$AR_BK"
cp "$AR_DOC" "$AR_BK/doc"
cp "$AR_SVC" "$AR_BK/svc"

_ar_restore() {
  cp "$AR_BK/doc" "$AR_DOC"
  cp "$AR_BK/svc" "$AR_SVC"
  rm -f "$AR_PROBE" "$AR_TEST_PROBE"
}

_ar_mutated() { # _ar_mutated <ملفٌّ> <نسخةُ الأصلِ>
  if cmp -s "$1" "$2"; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: %s لم يتغيّرْ بايتٌ فيهِ\n' "$1"
    ((FAIL++))
    return 1
  fi
  return 0
}

# tg <وصف> <نصُّ البابِ المتوقَّعِ في المُخرَجِ> — إخفاقٌ **من هذا البابِ** لا من غيرِه.
tg() {
  local desc="$1" gate="$2" out rc
  out="$(bash "$AR" 2>&1)"; rc=$?
  if (( rc != 0 )) && grep -q "✗.*${gate}" <<<"$out"; then
    printf '  \033[32m✓\033[0m %-58s (كما هو متوقع: fail · %s)\n' "$desc" "$gate"; ((PASS++))
  else
    printf '  \033[31m✗\033[0m %-58s متوقع fail من «%s» وجاء rc=%s\n' "$desc" "$gate" "$rc"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -8
    ((FAIL++))
  fi
}

_ar_edit_doc() { # _ar_edit_doc <python: s -> s>
  python3 - "$AR_DOC" "$1" <<'MUT'
import sys
p, expr = sys.argv[1], sys.argv[2]
s = open(p, encoding="utf-8").read()
s = eval(expr, {"s": s})
open(p, "w", encoding="utf-8").write(s)
MUT
}

t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass bash "$AR"

# ── البابُ 1: مسارٌ لا يُقرأ عجزٌ لا مرورٌ ─────────────────────────────────
printf 'import { apiClient } from "./api/client";\nexport const x = () => apiClient.get(makePath());\n' > "$AR_PROBE"
tg 'نداءٌ مسارُه نداءُ دالّةٍ لا نصٌّ يُسقِطُ البابَ 1' 'البابُ 1'
printf 'import { apiClient } from "./api/client";\nconst p = flag ? "/stores" : "/search/products";\nexport const x = () => apiClient.get(p);\n' > "$AR_PROBE"
tg 'ثابتٌ شرطيٌّ فرعاهُ مسارانِ مختلفانِ يُسقِطُ البابَ 1' 'البابُ 1'
_ar_restore

# ── البابُ 2: نداءٌ بلا مسارٍ ولا فجوةٍ مُسجَّلةٍ ─────────────────────────────
printf 'import { apiClient } from "./api/client";\nexport const x = () => apiClient.get(`/customers/${id}/wallet`);\n' > "$AR_PROBE"
tg 'نداءٌ لمسارٍ لا خدمةَ لهُ يُسقِطُ البابَ 2' 'البابُ 2'
printf 'import { apiClient } from "./api/client";\nexport const x = () => apiClient.del("/stores");\n' > "$AR_PROBE"
tg 'مسارٌ موجودٌ بطريقةٍ أخرى (DELETE لا GET) يُسقِطُ البابَ 2' 'البابُ 2'
printf 'export const x = () => fetch("/customers/abc/wallet", { method: "POST" });\n' > "$AR_PROBE"
tg 'نداءُ fetch خامٌ لمسارٍ لا خدمةَ لهُ يُسقِطُ البابَ 2' 'البابُ 2'
_ar_restore

# والتعليقُ ليسَ نداءً، والاختبارُ ليسَ شفرةَ إنتاجٍ.
printf '// apiClient.get("/customers/abc/wallet")\nexport const y = 1;\n' > "$AR_PROBE"
t 'نداءٌ في تعليقٍ لا يُقاسُ (يمرُّ)' pass bash "$AR"
mkdir -p "$(dirname "$AR_TEST_PROBE")"
printf 'import { apiClient } from "../api/client";\nexport const x = () => apiClient.get("/customers/abc/wallet");\n' > "$AR_TEST_PROBE"
rm -f "$AR_PROBE"
t 'نداءٌ في ملفِّ اختبارٍ لا يُقاسُ (يمرُّ)' pass bash "$AR"
_ar_restore

# وحذفُ مسارٍ من الخدمةِ — عينُ العطبِ الذي وُلِدَ الحارسُ لأجلِهِ.
sed -i 's#"/customers/:waslaPublicId/places/:placeId"#"/customers/:waslaPublicId/saved/:placeId"#' "$AR_SVC"
if _ar_mutated "$AR_SVC" "$AR_BK/svc"; then
  tg 'مسارُ خدمةٍ يناديهِ تطبيقٌ ثمَّ يُعادُ تسميتُهُ يُسقِطُ البابَ 2' 'البابُ 2'
fi
_ar_restore

# ── البابُ 3: لا فجوةَ ميتةً ──────────────────────────────────────────────
_ar_edit_doc 's.replace("| driver-mini-app | GET | /drivers/:id/jobs |", "| customer-mini-app | GET | /stores | M3-02 | طفرة |\n| driver-mini-app | GET | /drivers/:id/jobs |", 1)'
if _ar_mutated "$AR_DOC" "$AR_BK/doc"; then
  tg 'فجوةٌ مُسجَّلةٌ لمسارٍ قائمٍ في خدمةٍ يُسقِطُ البابَ 3' 'البابُ 3'
fi
_ar_restore
_ar_edit_doc 's.replace("| driver-mini-app | GET | /drivers/:id/jobs |", "| driver-mini-app | GET | /drivers/:id/ghost | M3-02 | طفرة |\n| driver-mini-app | GET | /drivers/:id/jobs |", 1)'
if _ar_mutated "$AR_DOC" "$AR_BK/doc"; then
  tg 'فجوةٌ مُسجَّلةٌ لمسارٍ لا يناديهِ أحدٌ يُسقِطُ البابَ 3' 'البابُ 3'
fi
_ar_restore

# ── البابُ 4: مالكُ الفجوةِ غيرُ مكتملٍ ──────────────────────────────────
M_DONE="$(grep -oE '^\| M[0-9]+-[0-9]+ \|[^|]*\|[^|]*\|[^|]*\| Completed \|' docs/16-progress/LAUNCH_EXECUTION_BOARD.md | head -1 | grep -oE 'M[0-9]+-[0-9]+' | head -1)"
_ar_edit_doc "s.replace('| /drivers/:id/jobs | M3-02 |', '| /drivers/:id/jobs | ${M_DONE} |', 1)"
if _ar_mutated "$AR_DOC" "$AR_BK/doc"; then
  tg "فجوةٌ يملكُها بندٌ Completed (${M_DONE}) تُسقِطُ البابَ 4" 'البابُ 4'
fi
_ar_restore
_ar_edit_doc 's.replace("| /drivers/:id/jobs | M3-02 |", "| /drivers/:id/jobs | M9-99 |", 1)'
if _ar_mutated "$AR_DOC" "$AR_BK/doc"; then
  tg 'فجوةٌ يملكُها بندٌ لا وجودَ لهُ في اللوحةِ تُسقِطُ البابَ 4' 'البابُ 4'
fi
_ar_restore

# ── البابُ 5: الأرقامُ المنشورةُ تُقاسُ ────────────────────────────────────
_ar_edit_doc '__import__("re").sub(r"MATCHED_CALL_SITES = \d+", "MATCHED_CALL_SITES = 999", s, count=1)'
if _ar_mutated "$AR_DOC" "$AR_BK/doc"; then
  tg 'رقمٌ منشورٌ يُخالِفُ القياسَ يُسقِطُ البابَ 5' 'البابُ 5'
fi
_ar_restore

t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (الاستعادةُ سليمةٌ)" pass bash "$AR"
rm -rf "$AR_BK"
