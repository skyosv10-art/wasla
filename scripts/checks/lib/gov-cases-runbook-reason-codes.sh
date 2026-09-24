# gov-cases-runbook-reason-codes.sh — حالاتُ طفرةٍ للفحصِ 25 (أسماءُ دليلِ التدويرِ تطابقُ الشفرة · M3-07).
#
# تُستدعى من `scripts/checks/test-governance.sh` في نسخةِ `/tmp` (`$T`)، وتعتمدُ على `t()`.
# كلُّ طفرةٍ تُثبِتُ أنّها طفرَت (ملفٌّ لم يتغيّرْ بايتٌ فيه يُسقِطُ الحالة) ثمّ يُعادُ الأصل.

printf '\n\033[1m[ع] أسماءُ دليلِ التدويرِ تطابقُ الشفرة (M3-07 · الفحصُ 25)\033[0m\n'

RR=scripts/checks/validate-runbook-reason-codes.sh
RR_DOC=docs/14-runbooks/SERVICE_AUTH_KEY_ROTATION.md
RR_SRC=packages/service-auth/src

if [[ ! -f "$RR" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$RR"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

RR_BK=/tmp/runbookreason_backup
rm -rf "$RR_BK"; mkdir -p "$RR_BK"
cp "$RR_DOC" "$RR_BK/doc"; cp -r "$RR_SRC" "$RR_BK/src"

_rr_mutated() {
  if cmp -s "$1" "$2"; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: %s لم يتغيّرْ بايتٌ فيهِ\n' "$1"
    ((FAIL++)); return 1
  fi
}

t "runbook-reason-codes ناجحٌ على المستودع" pass bash "$RR"

# طفرة 1: عودةُ الاسمِ القديمِ (العيبُ المقيسُ نفسُه) إلى جدولِ التشخيص.
sed -i 's/| `unknown_key` |/| `unknown_kid` |/' "$RR_DOC"
_rr_mutated "$RR_DOC" "$RR_BK/doc" && t "runbook-reason-codes يرفضُ unknown_kid في الدليل" fail bash "$RR"
cp "$RR_BK/doc" "$RR_DOC"

# طفرة 2: إعادةُ تسميةِ السببِ في كلِّ الشفرةِ الإنتاجيّةِ دونَ الدليل.
find "$RR_SRC" -name '*.ts' -not -path '*/__tests__/*' -exec sed -i 's/"revoked_key"/"key_revoked"/g' {} +
_rr_mutated "$RR_SRC/errors.ts" "$RR_BK/src/errors.ts" && t "runbook-reason-codes يرفضُ سببًا غابَ من الشفرة" fail bash "$RR"
rm -rf "$RR_SRC"; cp -r "$RR_BK/src" "$RR_SRC"

t "runbook-reason-codes ناجحٌ بعد الاستعادة" pass bash "$RR"
