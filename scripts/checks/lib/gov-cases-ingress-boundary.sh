#!/usr/bin/env bash
# gov-cases-ingress-boundary.sh — حالاتُ طفرةٍ للبابِ 10 من الفحصِ 12
# (**إقفالُ جردِ حدودِ الدخولِ** · `M1-04` الموجةُ الثامنة · `CLM-0196`).
#
# لا تُشغَّلُ وحدَها: تُستدعى من `scripts/checks/test-governance.sh` بعدَ أن يُعرَّفَ
# فيه `_sac_root` و`_sac` و`t` — فالجذرُ الصناعيُّ نفسُهُ مصدرُ حقيقةٍ واحدٌ لكلِّ
# أبوابِ هذا الحارسِ، ولا يُبنى جذرٌ موازٍ لبابٍ واحدٍ.
#
# **وكلُّ حالةٍ هنا تُثبِتُ أنَّها طفرتْ فعلاً قبلَ أن تُقاسَ** (`_ib_assert_mut`):
# طفرةٌ لا تُغيِّرُ بايتاً واحداً تُنتِجُ «أحمرَ» صادقَ الشكلِ كاذبَ المعنى —
# فتُقاسُ العضّةُ على عملٍ لم يحدثْ.

# _ib_assert_mut <ملفٌّ> <نسخةٌ قبلَ الطفرةِ> <وصفٌ>
_ib_assert_mut() {
  local f="$1" before="$2" label="$3"
  if cmp -s "$f" "$before"; then
    printf '  \033[31m✗\033[0m طفرةٌ لم تُغيِّرْ بايتاً (الحالةُ تقيسُ لا شيءَ): %s\n' "$label"
    ((FAIL++))
    return 1
  fi
  return 0
}

_ib_snapshot() { # _ib_snapshot <root> <file-rel> → مسارُ النسخةِ
  local snap; snap="$(mktemp)"
  cp "$1/$2" "$snap"
  printf '%s\n' "$snap"
}

# جذرٌ فيهِ حدُّ دخولٍ **غيرُ مفروضٍ** مُعلَنٌ صفّاً صادقاً: أساسُ الحالاتِ.
_ib_root() { # _ib_root <tag>
  local R; R="$(_sac_root "ib_$1")"
  mkdir -p "$R/services/billing/src/http"
  cat > "$R/services/billing/src/http/app.ts" <<'TS'
export function buildApp(deps) {
  const app = Fastify();
  app.get("/health", async () => ({ ok: true }));
  app.get("/billing/:waslaPublicId/invoices", async (req) => deps.list(req.params));
  app.post("/billing/:waslaPublicId/invoices", async (req) => deps.create(req.params));
  return app;
}
TS
  python3 - "$R" <<'PY'
import pathlib, sys
m = pathlib.Path(sys.argv[1]) / "docs/07-security/SERVICE_AUTH_ENFORCEMENT.md"
s = m.read_text()
row = "| `billing` | 3 | `services/billing/src/http/app.ts` | ساكتٌ | `RISK-9001` · `M1-04` |\n"
old = "TOTAL_ROUTES: 0"
assert s.count(old) == 1
s = s.replace("|---|---|---|---|---|\n", "|---|---|---|---|---|\n" + row, 1)
s = s.replace(old, "TOTAL_ROUTES: 3", 1)
m.write_text(s)
PY
  printf '%s\n' "$R"
}

_ib_ledger() { printf '%s/docs/07-security/SERVICE_AUTH_ENFORCEMENT.md' "$1"; }

printf '\n\033[1m[م] البابُ 10: إقفالُ جردِ حدودِ الدخولِ (M1-04 الموجةُ الثامنة)\033[0m\n'

# 10-٠) الأساسُ: حدٌّ غيرُ مفروضٍ مُعلَنٌ بعددِهِ المقيسِ وخطرٍ مفتوحٍ ومالكٍ يمرّ
IB_OK="$(_ib_root ok)"
t "حدٌّ غيرُ مفروضٍ مُعلَنٌ بعددِهِ المقيسِ وخطرٍ مفتوحٍ يمرّ" pass _sac "$IB_OK"

# 10-أ) الدَّينُ لا ينمو بصمتٍ: حدُّ دخولٍ بلا هويّةٍ ولا صفَّ لهُ في الجردِ.
#       وهذا **عينُ العطبِ** الذي أنشأَ البابَ: خمسةُ حدودٍ إنتاجيّةٍ مرَّتْ
#       سنةَ عملٍ بلا سؤالٍ لأنَّ الأبوابَ 1–9 تنطلقُ من إعلانٍ.
IB_SILENT="$(_ib_root silent)"
_IB_S="$(_ib_snapshot "$IB_SILENT" docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)"
python3 - "$IB_SILENT" <<'PY'
import pathlib, sys, re
m = pathlib.Path(sys.argv[1]) / "docs/07-security/SERVICE_AUTH_ENFORCEMENT.md"
s = m.read_text()
n = re.sub(r"^\| `billing` \|.*\n", "", s, flags=re.M).replace("TOTAL_ROUTES: 3", "TOTAL_ROUTES: 0")
assert n != s
m.write_text(n)
PY
_ib_assert_mut "$(_ib_ledger "$IB_SILENT")" "$_IB_S" "حذفُ صفِّ الحدِّ غيرِ المفروضِ" \
  && t "حدُّ دخولٍ لا يفرضُ هويّةً ولا صفَّ لهُ في الجردِ يُسقِط" fail _sac "$IB_SILENT"

# 10-ب) الجردُ لا يتقادمُ: الحدُّ صارَ يفرضُ والصفُّ باقٍ (إعلانٌ ميتٌ)
IB_DEAD="$(_ib_root dead)"
_IB_D="$(_ib_snapshot "$IB_DEAD" services/billing/src/http/app.ts)"
printf 'registerServiceIdentity(app, wiring);\n' >> "$IB_DEAD/services/billing/src/http/app.ts"
_ib_assert_mut "$IB_DEAD/services/billing/src/http/app.ts" "$_IB_D" "إضافةُ الإنفاذِ إلى الحدِّ" \
  && t "حدٌّ صارَ مفروضاً وصفُّهُ باقٍ في الجردِ يُسقِط (إعلانٌ ميتٌ)" fail _sac "$IB_DEAD"

# ومسارُ العلاجِ الصحيحُ يمرُّ: يفرضُ في شفرتِهِ **و**خرجَ من الجردِ.
# (وملفُّ الهويّةِ في موضعِهِ ليسَ شرطَ هذا البابِ بل شرطُ البابِ 6 على الحدِّ
#  **المُعلَنِ** في السّجلِّ — وهذا الحدُّ لا يُعلِنُ نفسَهُ مفروضاً هناك.)
IB_FIXED="$(_ib_root fixed)"
printf 'registerServiceIdentity(app, wiring);\n' >> "$IB_FIXED/services/billing/src/http/app.ts"
python3 - "$IB_FIXED" <<'PY'
import pathlib, sys, re
m = pathlib.Path(sys.argv[1]) / "docs/07-security/SERVICE_AUTH_ENFORCEMENT.md"
s = m.read_text()
n = re.sub(r"^\| `billing` \|.*\n", "", s, flags=re.M).replace("TOTAL_ROUTES: 3", "TOTAL_ROUTES: 0")
assert n != s
m.write_text(n)
PY
t "حدٌّ فرضَ الهويّةَ وخرجَ من الجردِ يمرّ (مسارُ العلاجِ)" pass _sac "$IB_FIXED"

# وصفٌّ لحدٍّ لا ملفَّ لهُ على القرصِ: جردٌ يُوهِمُ بحراسةِ ما لا وجودَ لهُ
IB_GHOST="$(_ib_root ghost)"
_IB_G="$(_ib_snapshot "$IB_GHOST" docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)"
python3 - "$IB_GHOST" <<'PY'
import pathlib, sys
m = pathlib.Path(sys.argv[1]) / "docs/07-security/SERVICE_AUTH_ENFORCEMENT.md"
s = m.read_text()
row = "| `ghostsvc` | 4 | `services/ghostsvc/src/http/app.ts` | ساكتٌ | `RISK-9001` · `M1-04` |\n"
s = s.replace("TOTAL_ROUTES: 3", row + "\nTOTAL_ROUTES: 3", 1)
m.write_text(s)
PY
_ib_assert_mut "$(_ib_ledger "$IB_GHOST")" "$_IB_G" "إضافةُ صفٍّ لحدٍّ غيرِ موجودٍ" \
  && t "صفٌّ في الجردِ لحدٍّ لا ملفَّ لهُ على القرصِ يُسقِط" fail _sac "$IB_GHOST"

# 10-ج) الرقمُ مُشتَقٌّ لا مكتوبٌ باليدِ: مسارٌ رابعٌ يُضافُ والعددُ لم يُقَسْ
IB_COUNT="$(_ib_root count)"
_IB_C="$(_ib_snapshot "$IB_COUNT" services/billing/src/http/app.ts)"
python3 - "$IB_COUNT" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "services/billing/src/http/app.ts"
s = p.read_text()
add = '  app.delete("/billing/:waslaPublicId/invoices/:id", async (req) => req.params);\n'
p.write_text(s.replace("  return app;\n", add + "  return app;\n", 1))
PY
_ib_assert_mut "$IB_COUNT/services/billing/src/http/app.ts" "$_IB_C" "إضافةُ مسارٍ رابعٍ" \
  && t "مسارٌ يُضافُ إلى حدٍّ غيرِ مفروضٍ والعددُ المُعلَنُ لم يُقَسْ يُسقِط" fail _sac "$IB_COUNT"

# ومجموعُ الجردِ محروسٌ كذلكَ: تصحيحُ الصفِّ وحدَهُ لا يكفي
IB_TOTAL="$(_ib_root total)"
_IB_T="$(_ib_snapshot "$IB_TOTAL" docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)"
sed -i 's|TOTAL_ROUTES: 3|TOTAL_ROUTES: 9|' "$(_ib_ledger "$IB_TOTAL")"
_ib_assert_mut "$(_ib_ledger "$IB_TOTAL")" "$_IB_T" "تحريفُ سطرِ المجموعِ" \
  && t "مجموعُ الجردِ لا يُطابِقُ المقيسَ يُسقِط" fail _sac "$IB_TOTAL"

IB_NOTOTAL="$(_ib_root nototal)"
_IB_NT="$(_ib_snapshot "$IB_NOTOTAL" docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)"
sed -i '/TOTAL_ROUTES: 3/d' "$(_ib_ledger "$IB_NOTOTAL")"
_ib_assert_mut "$(_ib_ledger "$IB_NOTOTAL")" "$_IB_NT" "حذفُ سطرِ المجموعِ" \
  && t "جردٌ بلا سطرِ مجموعٍ يُسقِط (فحذفُ صفٍّ لا يمرُّ بلا أثرٍ)" fail _sac "$IB_NOTOTAL"

# 10-د) لا دَينَ بلا مالكٍ: خطرٌ مُقفَلٌ · معرِّفٌ بلا سطرِ إعلانٍ · بلا خطرٍ · بلا بوّابةٍ
IB_CLOSED="$(_ib_root closedrisk)"
_IB_CL="$(_ib_snapshot "$IB_CLOSED" docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)"
sed -i 's|`RISK-9001` · `M1-04`|`RISK-9002` · `M1-04`|' "$(_ib_ledger "$IB_CLOSED")"
_ib_assert_mut "$(_ib_ledger "$IB_CLOSED")" "$_IB_CL" "إحالةُ الصفِّ إلى خطرٍ مُقفَلٍ" \
  && t "صفُّ دَينٍ يُحيلُ إلى خطرٍ مُقفَلٍ يُسقِط" fail _sac "$IB_CLOSED"

IB_NORISK="$(_ib_root norisk)"
_IB_NR="$(_ib_snapshot "$IB_NORISK" docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)"
sed -i 's|`RISK-9001` · `M1-04`|`RISK-9999` · `M1-04`|' "$(_ib_ledger "$IB_NORISK")"
_ib_assert_mut "$(_ib_ledger "$IB_NORISK")" "$_IB_NR" "إحالةُ الصفِّ إلى خطرٍ بلا سطرِ إعلانٍ" \
  && t "صفُّ دَينٍ يُحيلُ إلى خطرٍ لا سطرَ إعلانٍ لهُ يُسقِط" fail _sac "$IB_NORISK"

IB_NOGATE="$(_ib_root nogate)"
_IB_NG="$(_ib_snapshot "$IB_NOGATE" docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)"
sed -i 's|`RISK-9001` · `M1-04`|`RISK-9001` · بلا مالكٍ|' "$(_ib_ledger "$IB_NOGATE")"
_ib_assert_mut "$(_ib_ledger "$IB_NOGATE")" "$_IB_NG" "حذفُ مرجعِ البوّابةِ المالكةِ" \
  && t "صفُّ دَينٍ بلا مرجعِ البوّابةِ المالكةِ (M1-04) يُسقِط" fail _sac "$IB_NOGATE"

# وحذفُ الكتلةِ لا يُسكِتُ البابَ، وحذفُ مِلفِّ منطقِ البابِ لا يُتخطّى بهِ البابُ
IB_NOBLOCK="$(_ib_root noblock)"
_IB_NB="$(_ib_snapshot "$IB_NOBLOCK" docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)"
python3 - "$IB_NOBLOCK" <<'PY'
import pathlib, sys, re
m = pathlib.Path(sys.argv[1]) / "docs/07-security/SERVICE_AUTH_ENFORCEMENT.md"
s = m.read_text()
n = re.sub(r"<!-- unenforced-ingress:begin -->.*?<!-- unenforced-ingress:end -->", "", s, flags=re.S)
assert n != s
m.write_text(n)
PY
_ib_assert_mut "$(_ib_ledger "$IB_NOBLOCK")" "$_IB_NB" "حذفُ كتلةِ الجردِ" \
  && t "حذفُ كتلةِ جردِ حدودِ الدخولِ يُسقِط" fail _sac "$IB_NOBLOCK"

IB_NOLIB="$(_ib_root nolib)"
rm -f "$IB_NOLIB/scripts/checks/lib/ingress_boundary_gate.sh"
t "حذفُ مِلفِّ منطقِ البابِ 10 يُسقِط (لا يُشترى الأخضرُ بفقدِ بابٍ)" fail _sac "$IB_NOLIB"

# وحدٌّ في `packages/` مرئيٌّ كحدودِ `services/`: بصرُ البابِ لا يقفُ على مجلَّدٍ
IB_PKG="$(_ib_root pkgboundary)"
mkdir -p "$IB_PKG/packages/edge-runtime/src/http"
cat > "$IB_PKG/packages/edge-runtime/src/http/app.ts" <<'TS'
export function buildEdgeApp() {
  const app = Fastify();
  app.post("/edge/webhook", async () => ({ ok: true }));
  return app;
}
TS
t "حدُّ دخولٍ في packages/ بلا هويّةٍ ولا صفٍّ يُسقِط (بصرٌ لا يقفُ على مجلَّدٍ)" fail _sac "$IB_PKG"
