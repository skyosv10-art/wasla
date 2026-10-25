# gov-cases-edge-wiring.sh — حالاتُ طفرةٍ للحارسِ 29 (edge-wiring-guard · D6 · CLM-0691).
#
# تُستدعى من `scripts/checks/test-governance.sh` وتعملُ في نسخةِ `/tmp` (`$T`).
#
# عقدُ كلِّ طفرةٍ (`_ew_door`): الحارسُ 29 نفسُهُ يُستدعى مباشرةً، ويجبُ أن:
#   1. يخرجَ برمزٍ غيرِ صفريٍّ،
#   2. ويطبعَ سطرَ إخفاقِهِ (`✗ edge-wiring-guard`)،
#   3. ويطبعَ رمزَ البابِ المستهدَفِ بعينِهِ (`[EW-…]`)،
#   4. ولا يطبعَ رمزَ البابِ المستبعَدِ إن سُمِّيَ (عزلُ السببِ: الطفرةُ تُسقِطُ
#      البابَ المقصودَ لا بابًا مجاورًا مصادفةً).
# فإسقاطُ اختبارٍ آخرَ أو رمزُ خروجٍ وحدَه لا يكفي.
#
# وتجاورُها ضوابطُ موجبةٌ (`_ew_pass`): الشجرةُ النظيفةُ تُمرِّرُ الحارسَ — كي لا
# يكونَ البابُ جدارًا أعمى يرفضُ كلَّ شيءٍ فيبدو صارمًا وهو لا يقيس.
# كلُّ التشويهاتِ في نسخةِ `/tmp` وحدَها وتُستعادُ بعدَ كلِّ حالةٍ؛ المستودعُ الحقيقيُّ
# لا يُمسُّ.
#
# المرجع: RENDER_TEST_ENVIRONMENT_PLAN (T1) · ADR-069 · CLM-0661 (D6) · CLM-0691.

printf '\n\033[1m[د] ترطيبُ حدِّ القناةِ في المدخلِ (D6 · CLM-0691 · الحارسُ 29)\033[0m\n'

EW=scripts/checks/validate-edge-wiring.sh
EW_MAIN="bots/customer-bot/src/main.ts"
EW_CUST_EDGE="bots/customer-bot/src/edge.ts"
EW_DRV_EDGE="bots/driver-bot/src/edge.ts"

if [[ ! -f "$EW" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضَّةُ حارسٍ غائبٍ\n' "$EW"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

EW_BK=/tmp/edge_wiring_backup
rm -rf "$EW_BK"; mkdir -p "$EW_BK"
for _f in "$EW_MAIN" "$EW_CUST_EDGE" "$EW_DRV_EDGE"; do
  cp "$_f" "$EW_BK/$(echo "$_f" | tr / _)"
done

_ew_restore() {
  for _f in "$EW_MAIN" "$EW_CUST_EDGE" "$EW_DRV_EDGE"; do
    cp "$EW_BK/$(echo "$_f" | tr / _)" "$_f"
  done
}

# _ew_door <وصف> <رمز متوقع> [رمز مستبعد] — الطفرةُ مُطبَّقةٌ سلفًا.
_ew_door() {
  local desc="$1" want="$2" exclude="${3:-}"
  local out rc
  out="$(bash "$EW" 2>&1)"; rc=$?
  if [[ $rc -ne 0 && "$out" == *"✗ edge-wiring-guard"* && "$out" == *"$want"* && ( -z "$exclude" || "$out" != *"$exclude"* ) ]]; then
    printf '  \033[32m✓\033[0m %s\n' "$desc"
    ((PASS++))
  else
    printf '  \033[31m✗\033[0m %s — رمزُ الخروجِ %s والمطلوبُ %s\n' "$desc" "$rc" "$want"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -8
    ((FAIL++))
  fi
}

# _ew_pass <وصف> — ضابطٌ موجبٌ: الشجرةُ النظيفةُ تُمرِّرُ الحارسَ.
_ew_pass() {
  local desc="$1" out rc
  out="$(bash "$EW" 2>&1)"; rc=$?
  if [[ $rc -eq 0 && "$out" == *"✓ edge-wiring-guard"* ]]; then
    printf '  \033[32m✓\033[0m %s\n' "$desc"
    ((PASS++))
  else
    printf '  \033[31m✗\033[0m %s — رمزُ الخروجِ %s\n' "$desc" "$rc"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -8
    ((FAIL++))
  fi
}

# M1: عودةُ المدخلِ إلى بناءٍ من غيرِ الحدِّ (عيبُ السلفِ) — يُسقِطُ البابَينِ معًا
#     لأنَّ الاستيرادَ والتمريرَ كلاهما يختفي، لكنَّ الحارسَ يذكرُ كلًّا برمزِهِ.
python3 - "$EW_MAIN" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")
s = s.replace('import { BOT } from "./server.js";\nimport { buildAppWithEdge } from "./edge.js";',
              'import { BOT, buildApp } from "./server.js";')
s = s.replace("void runBotApp(BOT, buildAppWithEdge);", "void runBotApp(BOT, () => buildApp());")
p.write_text(s, encoding="utf-8")
PY
_ew_door "الطفرةُ M1: مدخلٌ بلا حدٍّ (بناءٌ من server.js مباشرةً) تُسقِطُ [EW-MAIN-IMPORT] و[EW-MAIN-LAUNCH]" "[EW-MAIN-IMPORT]"
out="$(bash "$EW" 2>&1)"
if [[ "$out" == *"[EW-MAIN-LAUNCH]"* ]]; then printf '  \033[32m✓\033[0m الطفرةُ M1 تُسقِطُ [EW-MAIN-LAUNCH] أيضًا (التمريرُ لا الاستيرادَ وحده)\n'; ((PASS++)); else printf '  \033[31m✗\033[0m M1 لم تُسقِطِ [EW-MAIN-LAUNCH]\n'; ((FAIL++)); fi
_ew_restore

# M2: مسارُ قائمةٍ يحلُّ إلى غائبٍ — البابُ المحلولُ [EW-ALLOWLIST-URL] وحدهُ
#     لا [EW-ALLOWLIST-JSON] (عزلُ السببِ: الغائبُ لا يُقرأُ أصلًا).
python3 - "$EW_CUST_EDGE" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")
s = s.replace('"../../../packages/channel-edge/allowlist/customer-mini-app.json"',
              '"../../../packages/channel-edge/allowlist/absent-file.json"')
p.write_text(s, encoding="utf-8")
PY
_ew_door "الطفرةُ M2: allowlistUrl يحلُّ إلى غائبٍ فتُسقِطُ [EW-ALLOWLIST-URL]" "[EW-ALLOWLIST-URL]" "[EW-ALLOWLIST-JSON]"
_ew_restore

# M3: ملفُّ قائمةٍ موجودٌ لكنهُ ليسَ JSON — البابُ [EW-ALLOWLIST-JSON] وحدهُ.
python3 - <<'PY'
from pathlib import Path
p = Path("packages/channel-edge/allowlist/customer-mini-app.json")
p.write_text("{not-json", encoding="utf-8")
PY
_ew_door "الطفرةُ M3: قائمةٌ ليست JSON فتُسقِطُ [EW-ALLOWLIST-JSON]" "[EW-ALLOWLIST-JSON]" "[EW-ALLOWLIST-URL]"
_ew_restore
# استعادةُ ملفِّ القائمةِ المُشوَّهِ من git في نسخةِ /tmp — لا يمسُّ المستودعَ الحقيقيَّ
git checkout -q -- packages/channel-edge/allowlist/customer-mini-app.json

# M4: حذفُ وحدةِ حدِّ السائقِ — إخفاقٌ مغلقٌ [EW-READ] لا نجاحٌ صامتٌ.
mv "$EW_DRV_EDGE" /tmp/edge_wiring_driver_edge.bak
_ew_door "الطفرةُ M4: وحدةُ حدٍّ مفقودةٌ تُسقِطُ [EW-READ] (فشلٌ مغلقٌ لا تخطٍّ)" "[EW-READ]"
mv /tmp/edge_wiring_driver_edge.bak "$EW_DRV_EDGE"

# ضابطٌ موجبٌ: الشجرةُ النظيفةُ تُمرِّرُ الحارسَ.
_ew_pass "الشجرةُ النظيفةُ تُمرِّرُ الحارسَ (لا جدارًا أعمى)"

rm -rf "$EW_BK"
