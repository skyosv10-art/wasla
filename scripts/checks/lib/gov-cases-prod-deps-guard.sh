# gov-cases-prod-deps-guard.sh — حالاتُ طفرةٍ للفحصِ 22 (استيرادُ الإنتاجِ من devDependencies · M0-43).
#
# تُستدعى من `scripts/checks/test-governance.sh` وهيَ تعملُ في نسخةِ `/tmp`
# (المتغيّرُ `$T`) لا في المستودعِ الأصلي. وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# ── القاعدةُ التي تفرضُها هذهِ الحالاتُ ────────────────────────────────────
# حارسٌ لم تُثبَتْ **عضّتُهُ** ليسَ حارساً بل زينةٌ خضراءُ. فلكلِّ بابٍ من أبوابِ
# هذا الفحصِ طفرةٌ واحدةٌ على الأقلِّ **يجبُ أن تُسقِطَهُ**، وطفرةٌ تُسقِطُهُ
# لا تكفي وحدَها: يُعادُ الأصلُ بعدَ كلِّ واحدةٍ ويُثبَتُ أنَّهُ يمرُّ — وإلّا
# فقد يكونُ الحارسُ ساقطاً دائماً لا عاضّاً.
#
# والقاعدةُ نفسُها لها **وجهٌ سالبٌ**: الاستثناءاتُ لا تُغطّي عيبًا حقيقيًّا.
# فحزمةُ ``*-e2e`` تستوردُ من ``devDependencies`` صحيحٌ، و``import type`` من
# ``peerDependencies`` صحيحٌ. فهاتانِ حالتانِ موجبتانِ **يجبُ أن تمرَّا** —
# وإلّا كانَ الحارسُ يُدينُ المشروعَ فيُشترى صمتُهُ بتعطيلِهِ.
#
# المرجع: docs/07-security/RISK_REGISTER.md (RISK-0043)

printf '\n\033[1m[ق] حارسُ استيرادِ الإنتاجِ من devDependencies (M0-43 · الفحصُ 22)\033[0m\n'

PDG=scripts/checks/validate-production-dependency-guard.sh

if [[ ! -f "$PDG" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$PDG"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

# نختارُ حزمةً إنتاجيّةً حقيقيّةً لها ``src/`` و``dependencies``.
# ``services/orders`` مناسبةٌ: لها ``src/`` و``dependencies`` و``devDependencies``.
PDG_PKG_DIR=services/orders
PDG_PKG_JSON="$PDG_PKG_DIR/package.json"
PDG_SRC="$PDG_PKG_DIR/src"
# ملفٌّ إنتاجيٌّ موجودٌ نُضيفُ إليهِ الاستيرادَ المسمومَ.
PDG_FILE="$PDG_SRC/index.ts"

if [[ ! -f "$PDG_FILE" ]]; then
  # نختارُ أوّلَ ملفٍّ إنتاجيٍّ متاحٍ.
  PDG_FILE="$(find "$PDG_SRC" -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' -not -path '*/__tests__/*' | head -1)"
fi

if [[ -z "$PDG_FILE" || ! -f "$PDG_FILE" ]]; then
  printf '  \033[33m⊘\033[0m لا ملفَّ إنتاجيٍّ متاحٌ في %s — تُخطّى الحالاتُ\n' "$PDG_SRC"
  return 0 2>/dev/null || exit 0
fi

PDG_BK=/tmp/pdg_backup
rm -rf "$PDG_BK"; mkdir -p "$PDG_BK"
cp "$PDG_FILE" "$PDG_BK/file"
cp "$PDG_PKG_JSON" "$PDG_BK/pkg"

_pdg_restore() {
  cp "$PDG_BK/file" "$PDG_FILE"
  cp "$PDG_BK/pkg" "$PDG_PKG_JSON"
}

# الأصلُ يمرُّ — وبلا هذا لا معنى لأيِّ إخفاقٍ بعدَه.
t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass bash "$PDG"

# ── البابُ 1: استيرادُ قيمةٍ من devDependencies يُسقِطُ الحارسَ ──────────────
# نُضيفُ استيرادَ قيمةٍ من حزمةٍ في ``devDependencies`` وحدَها. نختارُ ``vitest``
# لأنَّه شائعٌ في ``devDependencies`` ولا يُستورَدُ إنتاجيًّا.
PDG_DEVDEP_PKG=""
PDG_DEVDEP_VER=""
PDG_DEVDEP_INFO="$(python3 -c "
import json, sys
with open('$PDG_PKG_JSON') as f:
    data = json.load(f)
devdeps = data.get('devDependencies', {})
for name in ['vitest', '@types/node', 'typescript']:
    if name in devdeps:
        print(name)
        sys.exit(0)
sys.exit(1)
" 2>/dev/null)"
if [[ -n "$PDG_DEVDEP_INFO" ]]; then
  PDG_DEVDEP_PKG="$PDG_DEVDEP_INFO"
fi

if [[ -n "$PDG_DEVDEP_PKG" ]]; then
  # نُضيفُ استيرادَ قيمةٍ (لا نوعاً) في ملفٍّ إنتاجيٍّ.
  printf '\nimport { describe } from "%s";\n' "$PDG_DEVDEP_PKG" >> "$PDG_FILE"
  t "استيرادُ قيمةٍ من devDependencies في ملفٍّ إنتاجيٍّ يُسقِطُ الحارسَ" fail bash "$PDG"
  _pdg_restore
else
  printf '  \033[33m⊘\033[0m لا devDependency مناسبةٌ في %s — تُخطّى هذهِ الحالةُ\n' "$PDG_PKG_JSON"
fi

# ── البابُ 2: استيرادُ نوعٍ فقط (import type) من peerDependencies يمرُّ ───────
# ``import type`` يُمحى في زمنِ التحويلِ فلا يحتاجُ الحزمةَ في زمنِ التشغيلِ.
# نختارُ حزمةً ``service-auth`` التي لها ``peerDependencies`` اختياريّةٌ (``fastify``).
PDG_PEER_PKG_DIR=packages/service-auth
PDG_PEER_JSON="$PDG_PEER_PKG_DIR/package.json"
PDG_PEER_SRC="$PDG_PEER_PKG_DIR/src"

if [[ -f "$PDG_PEER_JSON" ]]; then
  PDG_PEER_FILE="$(find "$PDG_PEER_SRC" -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' -not -path '*/__tests__/*' | head -1)"
  if [[ -n "$PDG_PEER_FILE" ]]; then
    cp "$PDG_PEER_FILE" "$PDG_BK/peer_file"
    cp "$PDG_PEER_JSON" "$PDG_BK/peer_pkg"

    # نُضيفُ ``import type`` من حزمةٍ في ``peerDependencies`` — يجبُ أن يمرَّ.
    printf '\nimport type { FastifyInstance } from "fastify";\n' >> "$PDG_PEER_FILE"
    t "import type من peerDependencies اختياريّةٍ يمرُّ (ليس استيرادَ قيمةٍ)" pass bash "$PDG"

    # ── البابُ 3: استيرادُ قيمةٍ من peerDependencies يُسقِطُ الحارسَ ──────────
    # ``fastify`` في ``peerDependencies`` لا في ``dependencies``. فاستيرادُ
    # القيمةِ منهُ عيبٌ — الحزمةُ قد لا تُركَّبُ في الإنتاجِ.
    printf '\nimport Fastify from "fastify";\n' >> "$PDG_PEER_FILE"
    t "استيرادُ قيمةٍ من peerDependencies (لا dependencies) يُسقِطُ الحارسَ" fail bash "$PDG"

    cp "$PDG_BK/peer_file" "$PDG_PEER_FILE"
    cp "$PDG_BK/peer_pkg" "$PDG_PEER_JSON"
  else
    printf '  \033[33m⊘\033[0m لا ملفَّ إنتاجيٍّ متاحٌ في %s — تُخطّى حالاتُ peerDependencies\033[0m\n' "$PDG_PEER_SRC"
  fi
else
  printf '  \033[33m⊘\033[0m %s غيرُ موجودٍ — تُخطّى حالاتُ peerDependencies\033[0m\n' "$PDG_PEER_JSON"
fi

# ── البابُ 4: حزمةُ ``*-e2e`` تستوردُ من devDependencies وتمرُّ ──────────────
# حزمُ الاختبارِ لا تُنشرُ، فاستيرادُها من ``devDependencies`` صحيحٌ.
# نتحقَّقُ من أنَّ الحارسَ **لا يفحَصُها أصلًا**.
PDG_E2E_DIR=""
for d in packages/*-e2e; do
  if [[ -d "$d/src" ]]; then
    # نتحقَّقُ من وجودِ ملفٍّ إنتاجيٍّ متاحٍ.
    if [[ -n "$(find "$d/src" -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' -not -path '*/__tests__/*' 2>/dev/null | head -1)" ]]; then
      PDG_E2E_DIR="$d"
      break
    fi
  fi
done

if [[ -n "$PDG_E2E_DIR" ]]; then
  # نُضيفُ استيرادَ قيمةٍ من devDependencies في حزمةِ e2e — يجبُ أن يمرَّ.
  PDG_E2E_FILE="$(find "$PDG_E2E_DIR/src" -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' -not -path '*/__tests__/*' | head -1)"
  if [[ -n "$PDG_E2E_FILE" ]]; then
    cp "$PDG_E2E_FILE" "$PDG_BK/e2e_file"

    # نُضيفُ استيرادَ قيمةٍ من ``pg`` (شائعٌ في devDeps لحزمِ e2e).
    printf '\nimport { Pool } from "pg";\n' >> "$PDG_E2E_FILE"
    t "حزمةُ *-e2e تستوردُ من devDependencies وتمرُّ (ليست إنتاجيّةً)" pass bash "$PDG"

    cp "$PDG_BK/e2e_file" "$PDG_E2E_FILE"
  else
    printf '  \033[33m⊘\033[0m لا ملفَّ إنتاجيٍّ متاحٌ في %s — تُخطّى حالةُ e2e\033[0m\n' "$PDG_E2E_DIR"
  fi
else
  printf '  \033[33m⊘\033[0m لا حزمةَ *-e2e متاحةٌ — تُخطّى حالةُ e2e\033[0m\n'
fi

# ── البابُ 5: استيرادُ قيمةٍ متعددُ الأسطرِ من devDependencies يُسقِطُ الحارسَ ──
# ``import {\n  describe\n} from "vitest"`` يجبُ أن يُلتقَطَ كاستيرادِ قيمةٍ.
if [[ -n "$PDG_DEVDEP_PKG" ]]; then
  printf '\nimport {\n  describe,\n  it,\n  expect\n} from "%s";\n' "$PDG_DEVDEP_PKG" >> "$PDG_FILE"
  t "استيرادُ قيمةٍ متعددُ الأسطرِ من devDependencies يُسقِطُ الحارسَ" fail bash "$PDG"
  _pdg_restore
fi

# ── البابُ 6: استيرادُ نوعٍ متعددُ الأسطرِ من peerDependencies يمرُّ ──────────
# ``import type {\n  FastifyInstance\n} from "fastify"`` يجبُ أن يمرَّ.
if [[ -f "$PDG_PEER_JSON" && -n "$PDG_PEER_FILE" ]]; then
  cp "$PDG_PEER_FILE" "$PDG_BK/peer_file2"
  printf '\nimport type {\n  FastifyInstance,\n  FastifyRequest\n} from "fastify";\n' >> "$PDG_PEER_FILE"
  t "import type متعددُ الأسطرِ من peerDependencies اختياريّةٍ يمرُّ" pass bash "$PDG"
  cp "$PDG_BK/peer_file2" "$PDG_PEER_FILE"
fi

# ── البابُ 7: تصديرُ قيمةٍ من devDependencies يُسقِطُ الحارسَ ─────────────────
# ``export { x } from "vitest"`` إعادةُ تصديرِ قيمةٍ من devDependencies عيبٌ.
if [[ -n "$PDG_DEVDEP_PKG" ]]; then
  printf '\nexport { describe } from "%s";\n' "$PDG_DEVDEP_PKG" >> "$PDG_FILE"
  t "تصديرُ قيمةٍ من devDependencies يُسقِطُ الحارسَ" fail bash "$PDG"
  _pdg_restore
fi

# ── البابُ 7b: تصديرُ نوعٍ فقط (export { type X }) من devDependencies يمرُّ ──
# ``export { type X } from "vitest"`` يُمحى في زمنِ التحويلِ — لا يحتاجُ الحزمةَ.
if [[ -n "$PDG_DEVDEP_PKG" ]]; then
  printf '\nexport { type describe } from "%s";\n' "$PDG_DEVDEP_PKG" >> "$PDG_FILE"
  t "export { type X } من devDependencies يمرُّ (نوعٌ فقط يُمحى)" pass bash "$PDG"
  _pdg_restore
fi

# ── البابُ 8: حذفُ قارئِ مساحةِ العملِ يُسقِطُ الحارسَ ──────────────────────
# الحارسُ يعتمدُ على ``workspace_packages.py`` لجردِ الحزمِ. فلو حُذِفَ انكسرَ.
mv scripts/checks/lib/workspace_packages.py /tmp/pdg_wp_moved
t "حذفُ قارئِ مساحةِ العملِ (workspace_packages.py) يُسقِطُ الحارسَ" fail bash "$PDG"
mv /tmp/pdg_wp_moved scripts/checks/lib/workspace_packages.py
