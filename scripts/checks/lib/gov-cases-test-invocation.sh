# shellcheck shell=bash
# حالاتُ حوكمةِ حارسِ استدعاءِ الاختباراتِ (M0-35) — تُستدعى من test-governance.sh.
#
# ولماذا ملفٌّ مستقلٌّ لا كتلةٌ في السويداءِ؟ لأنَّ الحالاتَ تحملُ **صيغةَ
# الاستدعاءِ عيّنةً بقصدٍ** (`pnpm -r … test`)، والحارسُ نفسُهُ يرفضُ تلكَ الصيغةَ.
# فلو كُتبَت في `test-governance.sh` لَوجبَ استثناءُ ذلكَ الملفِّ كلِّهِ من الحارسِ
# — وهوَ ملفٌّ ضخمٌ، فاستثناؤهُ يُنشئُ **بابَ التفافٍ** واسعاً. والملفُّ الصغيرُ
# المُستثنى بابٌ ضيّقٌ مقروءٌ.
#
# المتغيّراتُ الموروثةُ: `t` · `REPO_ROOT` · `PASS`/`FAIL`.

printf '\n\033[1m[س] مصدرُ استدعاءِ الاختباراتِ الواحدُ (M0-35)\033[0m\n'

TI_GUARD="$REPO_ROOT/scripts/checks/validate-test-invocation.sh"
TI_LIB="$REPO_ROOT/scripts/checks/lib"

# ── مَشهدٌ صناعيٌّ كاملٌ: لا يُشوَّهُ إعدادُ حزمةٍ حقيقيّةٍ أبداً ────────────
# تشويهُ الحقيقيِّ يجعلُ الحالةَ تكذبُ متى أُعيدَت تسميةُ الحزمةِ — وهوَ عينُ
# الخللِ الذي عولجَ في `M0-12`.
_ti_stage() { # _ti_stage <tag> <gate_excludes:1|0> <ddl_in_closure:1|0> [drop_test_script:1|0]
  local tag="$1" gate_excl="$2" ddl="$3" drop="${4:-0}"
  local S="/tmp/gov_ti_$tag"
  rm -rf "$S"; mkdir -p "$S/packages/gatepkg/src/__tests__" "$S/scripts/checks/lib"
  cp "$TI_LIB/test_groups.py" "$TI_LIB/audit_test_invocation.py" \
     "$TI_LIB/workspace_packages.py" "$TI_LIB/vitest_config_semantics.py" \
     "$S/scripts/checks/lib/"
  # مساحةُ العملِ تُعلَنُ كما تُعلَنُ في المستودعِ الحقيقيِّ — **بنمطٍ متداخلٍ**
  # (`packages/contracts/*`) لا بنمطٍ سطحيٍّ وحدَهُ، لأنَّ العطبَ الذي كُشِفَ في
  # 2026-09-14 كانَ **جرداً يعمى عن النمطِ المتداخلِ** فتسقطُ أربعَ عشرةَ حزمةً.
  cat > "$S/pnpm-workspace.yaml" <<'WS'
packages:
  - "packages/*"
  - "packages/contracts/*"
  - "services/*"
  - "bots/*"
WS
  cp "$REPO_ROOT/scripts/run-tests.sh" "$S/scripts/"
  cp "$TI_GUARD" "$S/scripts/checks/"
  printf '{"name":"root","scripts":{"test":"bash scripts/run-tests.sh"}}\n' > "$S/package.json"

  # حزمةُ بوّاباتٍ **ثابتةٌ** في كلِّ مَشهدٍ. ولمَ؟ لأنَّ الحارسَ يرفضُ شِقّاً
  # مُسلسَلاً فارغاً — وذاكَ رفضٌ صادقٌ في مستودعٍ فيهِ إحدى عشرةَ بوّابةً، لكنَّهُ
  # كانَ يُشعِلُ مَشاهدَ صناعيّةً تحملُ حزمةً واحدةً فتبدو الحالاتُ الموجبةُ فاشلةً
  # **لسببٍ من صنعِ الحزمةِ لا من عيبٍ في الحارسِ** — وهوَ عينُ ما عولجَ في M0-12.
  mkdir -p "$S/packages/serialpkg/src/__tests__"
  printf '{"name":"serialpkg","scripts":{"test":"vitest run"}}\n' > "$S/packages/serialpkg/package.json"
  printf 'export default { test: { include: ["src/__tests__/*.e2e.test.ts"] } };\n' \
    > "$S/packages/serialpkg/vitest.config.ts"
  printf 'import { it } from "vitest";\nit("g", () => {});\n' \
    > "$S/packages/serialpkg/src/__tests__/gate.e2e.test.ts"

  if (( drop )); then
    printf '{"name":"gatepkg","scripts":{"build":"tsc"}}\n' > "$S/packages/gatepkg/package.json"
  else
    printf '{"name":"gatepkg","scripts":{"test":"vitest run"}}\n' > "$S/packages/gatepkg/package.json"
  fi

  # الإعدادُ: يُضمِّنُ ملفَّ بوّابةٍ (فيُسلسَلُ) أو يستثنيهِ (فيُتوازى).
  if (( gate_excl )); then
    printf 'export default { test: { exclude: ["**/__tests__/*.{integration,e2e}.test.ts"] } };\n' \
      > "$S/packages/gatepkg/vitest.config.ts"
  else
    printf 'export default { test: { include: ["src/__tests__/*.e2e.test.ts"] } };\n' \
      > "$S/packages/gatepkg/vitest.config.ts"
  fi

  # مِرقاةٌ تُنفِّذُ DDL على وصلةٍ حقيقيّةٍ، يستوردُها اختبارٌ **غيرُ** بوّابةٍ —
  # فيجري في الشِّقِّ المتوازي ويُسقِطُ جداولَ غيرِهِ.
  if (( ddl )); then
    cat > "$S/packages/gatepkg/src/__tests__/harness.ts" <<'HARNESS'
import { Pool } from "pg";
export async function reset(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`DROP TABLE IF EXISTS widgets CASCADE`);
  await pool.query(`CREATE TABLE widgets (id text primary key)`);
}
HARNESS
    cat > "$S/packages/gatepkg/src/__tests__/unit.test.ts" <<'UNIT'
import { beforeAll, it } from "vitest";
import { reset } from "./harness.js";
beforeAll(reset);
it("x", () => {});
UNIT
  else
    printf 'import { it } from "vitest";\nit("x", () => {});\n' \
      > "$S/packages/gatepkg/src/__tests__/unit.test.ts"
  fi
  printf 'import { it } from "vitest";\nit("g", () => {});\n' \
    > "$S/packages/gatepkg/src/__tests__/gate.e2e.test.ts"
  printf '%s' "$S"
}

_ti() { ( cd "$1" && bash scripts/checks/validate-test-invocation.sh ); }

# (1) مرجعٌ موجبٌ — المستودعُ الحقيقيُّ نفسُهُ يجبُ أن يمرَّ. ولولا هذه الحالةُ لما
# دلَّتِ السلبيّاتُ بعدَها على شيءٍ: حارسٌ يرفضُ كلَّ شيءٍ «يكشفُ» السليمَ كالمعيبِ.
_ti_real() { ( cd "$REPO_ROOT" && bash scripts/checks/validate-test-invocation.sh ); }
t "يمرّ على المستودعِ الحقيقيِّ كما هو" pass _ti_real

# (2) **اختبارُ طفرةٍ على العطبِ المقيسِ نفسِهِ:** حزمةٌ تُنفِّذُ DDL على وصلةٍ
# حقيقيّةٍ في اختبارِها الافتراضيِّ وتقعُ في الشِّقِّ المتوازي → يجبُ أن تُرفَضَ.
# وهذه حالةُ `delivery-e2e`/`marketplace-e2e`/`search-e2e` بمعناها: 3/3 إخفاقاً
# متوازياً و3/3 نجاحاً مُسلسَلاً.
_ti_ddl_parallel() { _ti "$(_ti_stage ddlpar 1 1)"; }
t "يرفض حزمةً تُنفِّذُ DDL وهي في الشِّقِّ المتوازي" fail _ti_ddl_parallel

# (3) الحزمةُ نفسُها بعدَ أن صارَت بوّابةً مُسلسَلةً → تمرُّ. والفرقُ بين (2) و(3)
# **إعدادُ التسلسلِ وحدَهُ**: فما يُثبَتُ أنَّ الحارسَ يقيسُ العزلَ لا وجودَ DDL.
_ti_ddl_serial() { _ti "$(_ti_stage ddlser 0 1)"; }
t "يقبل الحزمةَ ذاتَها متى وقعَت في الشِّقِّ المُسلسَلِ" pass _ti_ddl_serial

# (4) حزمةٌ بلا DDL في المتوازي → تمرُّ. ولولا هذه الحالةُ لكانَ حارسٌ يُسلسِلُ
# المستودعَ كلَّهُ «ناجحاً» — وذاكَ طقسٌ يُطيلُ التحقّقَ بلا سباقٍ يمنعُهُ.
_ti_clean_parallel() { _ti "$(_ti_stage clean 1 0)"; }
t "يقبل حزمةً بلا DDL في الشِّقِّ المتوازي" pass _ti_clean_parallel

# (5) **الحزمةُ الساقطةُ:** مُشغِّلٌ مُطفَّرٌ يُسقِطُ حزمةً من الشِّقَّينِ. وهذا هوَ
# العطبُ الذي وُجدَ في `validate-launch-board.sh` قبلَ يومٍ: صفوفٌ تسقطُ صامتةً
# والحارسُ أخضرُ. فبلا هذه الحالةِ يكونُ «التسلسلُ» قد استُبدلَ بـ«لا اختبارَ».
_ti_dropped() {
  local S; S="$(_ti_stage dropped 1 0)"
  python3 - "$S/scripts/checks/lib/test_groups.py" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = '        out.append((d, gate))'
assert s.count(old) == 1, "مرساةُ الطفرةِ غيرُ موجودةٍ"
s = s.replace(old, '        if "gatepkg" in d:\n            continue\n' + old, 1)
io.open(p, "w", encoding="utf-8").write(s)
PY
  _ti "$S"
}
t "يكشف حزمةً لها test وسقطَت من الشِّقَّينِ (اختبارُ طفرة)" fail _ti_dropped

# (6) **الحزمةُ المُكرَّرةُ:** مُشغِّلٌ مُطفَّرٌ يُعلِنُها في الشِّقَّينِ معاً، فتُشغَّلُ
# مرّتَينِ وتُسابِقُ نفسَها — وهوَ فشلٌ يُقرأُ «تقلُّباً» لا خطأَ إعدادٍ.
_ti_double() {
  local S; S="$(_ti_stage double 1 0)"
  python3 - "$S/scripts/checks/lib/test_groups.py" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = '    return out'
assert s.count(old) == 1, "مرساةُ الطفرةِ غيرُ موجودةٍ"
s = s.replace(old, '    out += [(d, not g) for d, g in out]\n' + old, 1)
io.open(p, "w", encoding="utf-8").write(s)
PY
  _ti "$S"
}
t "يكشف حزمةً مُعلَنةً في الشِّقَّينِ معاً (اختبارُ طفرة)" fail _ti_double

# (7) **خَرْجٌ مقطوعٌ:** مُشتَقٌّ بلا وسمِ خِتامٍ. وبلا هذه الحالةِ كانَ أنبوبٌ
# يُقطَعُ في منتصفِهِ يُنتِجُ «صفرَ خُلْفٍ» فحارساً أخضرَ على لا شيءٍ — وهوَ نفسُ
# بابِ `RISK-0037`.
_ti_truncated() {
  local S; S="$(_ti_stage trunc 1 0)"
  python3 - "$S/scripts/checks/lib/test_groups.py" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = '    print("OK\\t%d" % len(rows))'
assert s.count(old) == 1, "مرساةُ الطفرةِ غيرُ موجودةٍ"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "    pass", 1))
PY
  _ti "$S"
}
t "يرفض خَرْجاً بلا وسمِ خِتامٍ ولا يقرؤهُ نجاحاً (اختبارُ طفرة)" fail _ti_truncated

# (8) **استدعاءٌ ثانٍ في سيرٍ:** سطرٌ تنفيذيٌّ يُعيدُ `pnpm -r run test` مباشرةً.
_ti_second_workflow() {
  local S; S="$(_ti_stage secwf 1 0)"
  mkdir -p "$S/.github/workflows"
  {
    printf 'jobs:\n  test:\n    steps:\n'
    printf '      - run: pnpm -r run '; printf 'test\n'
  } > "$S/.github/workflows/ci.yml"
  _ti "$S"
}
t "يرفض استدعاءً ثانياً في سيرٍ خارجَ المُشغِّلِ" fail _ti_second_workflow

# (8-ب) **والحالةُ نفسُها بلا `rg` في المسارِ** — وهذه ليست حالةً تخيُّليّةً:
# `rg` غيرُ مُثبَّتٍ على عاملِ GitHub، وكانَ المسحُ يبتلعُ «الأمرُ غيرُ موجودٍ»
# (`2>/dev/null || true`) فتخرجُ القائمةُ فارغةً **فيمرُّ البابُ الأوّلُ أخضرَ على لا
# شيءٍ**. وأوّلُ حكمٍ حقيقيٍّ من CI (سيرُ 34873584143) أسقطَ الحالةَ (8) هناكَ وهيَ
# خضراءُ هنا — أي **مُحلّيٌّ يُخالِفُ CI**، وهوَ عينُ ما أُنشئَ هذا الحارسُ لمنعِهِ.
# فالحالةُ تُثبِتُ أنَّ الحكمَ لا يتغيّرُ بغيابِ أداةٍ خارجَ مسارِ الثقةِ.
_ti_second_workflow_no_rg() {
  local S; S="$(_ti_stage secwfnorg 1 0)"
  mkdir -p "$S/.github/workflows" "$S/.norg"
  { printf 'jobs:\n  test:\n    steps:\n'
    printf '      - run: pnpm -r run '; printf 'test\n'
  } > "$S/.github/workflows/ci.yml"
  printf '#!/usr/bin/env bash\nexit 127\n' > "$S/.norg/rg"; chmod +x "$S/.norg/rg"
  ( cd "$S" && PATH="$S/.norg:$PATH" bash scripts/checks/validate-test-invocation.sh )
}
t "يرفض الاستدعاءَ الثانيَ ولو غابَ rg (حُكمٌ لا يتغيّرُ بأداةٍ خارجَ مسارِ الثقةِ)" fail _ti_second_workflow_no_rg

# (9) **استدعاءٌ ثانٍ في `package.json`:** حقلٌ لا سطرٌ — فحصٌ سطريٌّ وحدَهُ كانَ
# سيُفلِتُهُ لأنَّ السطرَ يبدأُ بـ`"test":` لا بـ`pnpm`.
_ti_second_script() {
  local S; S="$(_ti_stage secpj 1 0)"
  python3 - "$S/package.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["scripts"]["test:all"] = "pnpm -r run " + "test"
json.dump(d, open(p, "w", encoding="utf-8"))
PY
  _ti "$S"
}
t "يرفض استدعاءً ثانياً في scripts داخلَ package.json" fail _ti_second_script

# (10) **ذكرُ العبارةِ في تعليقٍ لا يُعدُّ استدعاءً:** ومنعُ ذكرِ العطبِ كانَ
# سيُعاقِبَ التوثيقَ ويُكافئَ الصمتَ، وذاكَ ضدُّ قانونِ التوثيقِ في المستودعِ.
_ti_comment_ok() {
  local S; S="$(_ti_stage cmt 1 0)"
  { printf '#!/usr/bin/env bash\n'
    printf '# كانَ هذا السكربتُ يستدعي pnpm -r run '; printf 'test مباشرةً.\n'
    printf 'bash scripts/run-tests.sh\n'
  } > "$S/scripts/legacy.sh"
  _ti "$S"
}
t "لا يعدّ ذكرَ الاستدعاءِ في تعليقٍ استدعاءً" pass _ti_comment_ok

# (11) **تعليقٌ يشرحُ DDL لا يُعدُّ تنفيذاً:** ثلاثُ خدماتٍ أُشعِلَت في أوّلِ صياغةٍ
# لأنَّ رأسَ `db/migrate.ts` **يشرحُ** `pool.query(ddl)` في تعليقٍ توثيقيٍّ.
_ti_doc_comment_ok() {
  local S; S="$(_ti_stage doccmt 1 0)"
  cat > "$S/packages/gatepkg/src/__tests__/notes.ts" <<'NOTES'
/**
 * يشرحُ هذا الرأسُ أنَّ المُهاجِرَ ينفّذُ `pool.query(ddl)` على نصٍّ فيهِ
 * `CREATE TABLE` و`DROP TABLE`، ويقرأُ `DATABASE_URL` من البيئةِ.
 */
export const SCHEMA_PATH = "contracts/schema.sql";
NOTES
  printf 'import { it } from "vitest";\nimport { SCHEMA_PATH } from "./notes.js";\nit("x", () => { void SCHEMA_PATH; });\n' \
    > "$S/packages/gatepkg/src/__tests__/unit.test.ts"
  _ti "$S"
}
t "لا يعدّ شرحَ DDL في تعليقٍ تنفيذاً لهُ" pass _ti_doc_comment_ok

# ── (13)/(14) جردُ مساحةِ العملِ — العطبُ الذي مرَّ أخضرَ ─────────────────────
# **مقيسٌ لا مُتخيَّلٌ (2026-09-14):** أوّلُ صياغةٍ لهذا الحارسِ ولمُشتَقِّ الشِّقَّينِ
# كتبَ كلٌّ منهما جردَهُ بيدِهِ بالنمطِ `{packages,services,bots}/*` — و
# `pnpm-workspace.yaml` يُعلِنُ `packages/contracts/*` أيضاً. فسقطَت **أربعَ عشرةَ
# حزمةً** من الشِّقَّينِ كليهما فلم تُشغَّلْ: من **48 حزمةً · 282 ملفّاً · 4591
# اختباراً** إلى **34 · 239 · 3991** — **600 اختباراً اختفَتْ والخلاصةُ خضراءُ**.
# **والحارسُ لم يُمسِكْهُ لأنَّهُ كانَ يقيسُ بالعطبِ نفسِهِ**: دعوى «الاتّحادُ = كلُّ
# حزمةٍ لها `test`» صادقةٌ حرفاً وكاذبةٌ معنىً حينَ يشتركُ الطرفانِ في خطأٍ واحدٍ.
# أمسكَهُ **الأساسُ** (`tests_passed` انحدرَ) لا الحارسُ. فهاتانِ الحالتانِ تُثبِتانِ
# أنَّهُ لا يعودُ.

_ti_nested_pkg() {
  local S; S="$(_ti_stage nested 1 0)"
  mkdir -p "$S/packages/contracts/widget/src/__tests__"
  printf '{"name":"@w/widget","scripts":{"test":"vitest run"}}\n' \
    > "$S/packages/contracts/widget/package.json"
  printf 'export default { test: { exclude: ["**/__tests__/*.{integration,e2e}.test.ts"] } };\n' \
    > "$S/packages/contracts/widget/vitest.config.ts"
  printf 'import { it } from "vitest";\nit("x", () => {});\n' \
    > "$S/packages/contracts/widget/src/__tests__/unit.test.ts"
  # يجبُ أن تظهرَ في شِقٍّ. ولا يكفي أن يمرَّ الحارسُ: يُقاسُ ظهورُها بالاسمِ،
  # وإلّا كانَ «أخضرُ» يعني «لم أرَها» كما كانَ يعني قبلَ الإصلاحِ.
  # ولا أنبوبَ يُغذّي `grep -q` هنا: يخرجُ `grep` عندَ أوّلِ تطابقٍ فيموتُ المُنتِجُ
  # بـSIGPIPE فتُقرَأُ حالةُ الأنبوبِ 141 «لا تطابق» — وهوَ `RISK-0037` بعينِهِ،
  # وحارسُ الأنابيبِ يرفضُ النمطَ. فالخَرْجُ يُحفَظُ ثمَّ يُقرَأُ بـherestring.
  local groups
  groups="$(python3 "$S/scripts/checks/lib/test_groups.py" "$S")" || return 1
  grep -qE "^(PARALLEL|SERIAL)$(printf '\t')packages/contracts/widget\$" <<< "$groups" \
    || return 1
  _ti "$S"
}
t "يُدرِجُ حزمةً في نمطٍ متداخلٍ (packages/contracts/*) في شِقٍّ" pass _ti_nested_pkg

_ti_shallow_inventory() {
  local S; S="$(_ti_stage shallow 1 0)"
  mkdir -p "$S/packages/contracts/widget/src/__tests__"
  printf '{"name":"@w/widget","scripts":{"test":"vitest run"}}\n' \
    > "$S/packages/contracts/widget/package.json"
  printf 'export default { test: { exclude: ["**/__tests__/*.{integration,e2e}.test.ts"] } };\n' \
    > "$S/packages/contracts/widget/vitest.config.ts"
  printf 'import { it } from "vitest";\nit("x", () => {});\n' \
    > "$S/packages/contracts/widget/src/__tests__/unit.test.ts"
  # طفرةٌ: تُعادُ الحالةُ الأصليّةُ — جردٌ سطحيٌّ مكتوبٌ بيدٍ يتجاهلُ
  # `pnpm-workspace.yaml`. و`pnpm` ما زالَ يرى الحزمةَ ⇒ فالمُصادِقُ الخارجيُّ
  # يُخفِقُ. لو أُزيلَ المُصادِقُ لعادَ الحارسُ يُوافِقُ نفسَهُ ومرَّت هذه الحالةُ.
  python3 - "$S/scripts/checks/lib/workspace_packages.py" <<'MUT'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = "    for pat in workspace_patterns(root):"
assert s.count(old) == 1
s = s.replace(old, '    for pat in ("packages/*", "services/*", "bots/*"):', 1)
io.open(p, "w", encoding="utf-8").write(s)
MUT
  _ti "$S"
}
t "يرفض جرداً سطحيّاً يُسقِطُ حزمَ النمطِ المتداخلِ (طفرة)" fail _ti_shallow_inventory

# ── (M0-42) حالاتُ سلامةِ الحارسِ نفسِهِ — عيوبٌ قِيسَتْ لا تُخُيِّلَتْ ──────
# ثلاثةُ عيوبٍ في هذا الحارسِ كُشِفَتْ **بالمِجَسِّ الصناعيِّ** قبلَ هذا
# الإصلاحِ (وثيقةُ `docs/12-testing/test-invocation-evidence/2026-09-16-m0-42.md`)
# ومرَّتْ كلُّها خضراءَ على أوّلِ صياغةٍ. فصارَ لكلٍّ منها حالةٌ تُثبِتُ العطبَ
# ثمَّ القتلَ:

# (15) **الحالةُ أ — طفرةُ العودةِ إلى المعيارِ النصّيِّ:** مَشهدٌ يحملُ وسمَ
# `{integration,e2e}` **في تعليقِ** الإعدادِ ونمطَ ضمٍّ يبتلِعُ ملفَّ
# بوّابةٍ — فالمعيارُ النصّيُّ (البحثُ عن الوسمِ في النصِّ كلِّهِ) يقولُ
# «ليست بوّابةً» فيُتوازى، والدلالةُ تقولُ «البوّابةُ تجري فعلاً». هذهِ
# الحالةُ **تُطفِرُ** محرِّكَ الدلالةِ عمداً إلى المعيارِ النصّيِّ القديمِ —
# فإن مرَّتِ الطفرةُ كانَ بابا الحارسِ (الاشتقاقُ والإغلاقُ) يُصادِقانِ
# النصَّ نفسَهُ من جديدٍ. والعطبُ الأصليُّ مُقاسٌ في وثيقةِ دليلِ M0-42:
# مرَّ أخضرَ على أوّلِ صياغةٍ.
_ti_stage_comment_scene() {
  local S; S="$(_ti_stage cmttag 1 0)"
  cat > "$S/packages/gatepkg/vitest.config.ts" <<'CFG'
// this package excludes {integration,e2e} gates from the default run
export default { test: { include: ["src/__tests__/*"] } };
CFG
  cat > "$S/packages/gatepkg/src/__tests__/harness.ts" <<'H'
import { Pool } from "pg";
export async function reset(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`DROP TABLE IF EXISTS widgets CASCADE`);
  await pool.query(`CREATE TABLE widgets (id text primary key)`);
}
H
  printf 'import { beforeAll, it } from "vitest";\nimport { reset } from "./harness.js";\nbeforeAll(reset);\nit("x", () => {});\n' \
    > "$S/packages/gatepkg/src/__tests__/unit.test.ts"
  printf 'import { it } from "vitest";\nit("g", () => {});\n' \
    > "$S/packages/gatepkg/src/__tests__/gate.e2e.test.ts"
  printf '%s' "$S"
}

_ti_comment_tag() {
  local S; S="$(_ti_stage_comment_scene)"
  # الطفرةُ: إعادةُ المعيارِ النصّيِّ القديمِ — الوسمُ في النصِّ كلِّهِ يُعفي
  # من البوّابةِ ولو كانَ في تعليقٍ، والضمُّ يُهمَلُ كلِّيّاً.
  python3 - "$S/scripts/checks/lib/vitest_config_semantics.py" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = "def gate_files_in_default_run(cfg_path: str, test_files: list[str]) -> list[str]:"
assert s.count(old) == 1, "anchor missing"
mut = (
    "def gate_files_in_default_run(cfg_path: str, test_files: list[str]) -> list[str]:\n"
    "    # MUTATION (M0-42 case 15): text rule — tag anywhere in the file text\n"
    "    with open(cfg_path, encoding='utf-8') as fh:\n"
    "        if '{integration,e2e}' in fh.read():\n"
    "            return []\n"
    "    return [f for f in test_files if f.endswith(GATE_SUFFIXES)]\n"
)
s = s.replace(old, mut, 1)
# and the companion door: _default_test_files uses runs_file; mutate it too
io.open(p, "w", encoding="utf-8").write(s)
PY
  python3 - "$S/scripts/checks/lib/audit_test_invocation.py" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = "    keep = [f for f, r in zip(files, rels) if vcs.runs_file(include, exclude, r, has_include)]"
assert s.count(old) == 1, "anchor missing"
s = s.replace(old, (
    "    with open(cfg, encoding='utf-8') as _fh:\n"
    "        _txt_rule = '{integration,e2e}' in _fh.read()\n"
    "    keep = [] if _txt_rule else files\n"
    "    if _txt_rule:\n"
    "        keep = [f for f in files if not f.replace(os.sep, '/').endswith(vcs.GATE_SUFFIXES)]\n"
), 1)
io.open(p, "w", encoding="utf-8").write(s)
PY
  _ti "$S"
}
t "يرفض العودةَ إلى المعيارِ النصّيِّ: وسمٌ في تعليقٍ لا يُعفي من البوّابةِ (M0-42)" fail _ti_comment_tag

# (15-ج) **المَشهدُ نفسُهُ بلا طفرةٍ يُسلسَلُ ويُخضِرُ:** الدلالةَ لا وجودَ DDL
# هوَ الحَكَمَ — فالإعدادُ يضمُّ ملفَّ بوّابةٍ ⇒ الحزمةُ تُسلسَلُ فلا سباقَ،
# والحارسُ يقبَلُها. ولولا هذه الحالةُ لحارسٍ يرفضُ كلَّ شيءٍ.
_ti_comment_scene_clean() { _ti "$(_ti_stage_comment_scene)"; }
t "يسلسِلُ مَشهدَ الوسمِ-في-تعليقٍ لأنَّ الضمَّ يبتلِعُ بوّابةً (M0-42 · اتجاهٌ معاكسٌ)" pass _ti_comment_scene_clean

# (15-ب) **الاستثناءُ الحقيقيُّ يُخضِرُ:** الواقفُ هنا هوَ **دلالةُ** الإعدادِ
# لا مجرَّدُ وجودِ DDL — فمَشهدُ الحالةِ (2) نفسُهُ (استثناءٌ حقيقيٌّ في
# `exclude` يُطابِقُ الملفَّ ⇒ متوازيةٌ) يجبَ أن يبقى مقبولاً، وإلّا كانَ
# الحارسُ يُسلسِلُ كلَّ شيءٍ «ناجحاً» — وهيَ الحالةُ (4).
_ti_comment_tag_fixed_shape() { _ti "$(_ti_stage cmtfix 1 0)"; }
t "يقبل الاستثناءَ الحقيقيَّ المُطابِقَ لموضِعِ الملفِّ (M0-42 · اتجاهٌ معاكسٌ)" pass _ti_comment_tag_fixed_shape

# (16) **الحالةُ ب — استدعاءٌ في مقطعٍ لا في بدايةِ سطرٍ:** `cd pkg && pnpm -r test`
# كانَ يمرُّ لأنَّ معيارَ المسحِ كانَ «بدايةَ السطرِ» لا «بدايةَ الأمرِ».
# و`npx pnpm -r test` بالمثلِ.
_ti_mid_segment() {
  local S; S="$(_ti_stage midseg 1 0)"
  printf '#!/usr/bin/env bash\ncd packages/gatepkg && pnpm -r test\n' > "$S/scripts/legacy.sh"
  _ti "$S"
}
t "يرفض استدعاءً ثانياً بعدَ cd … && (M0-42)" fail _ti_mid_segment

_ti_npx_wrapper() {
  local S; S="$(_ti_stage npxw 1 0)"
  printf '#!/usr/bin/env bash\nnpx pnpm -r test\n' > "$S/scripts/legacy.sh"
  _ti "$S"
}
t "يرفض استدعاءً ثانياً عبرَ npx (M0-42)" fail _ti_npx_wrapper

# (17) **الحالةُ ج — مُرشِّحٌ لا يُطابِقُ:** مُشغِّلٌ يشتقُّ حزمةً وهميّةً
# (اسمُها انجرفَ عن القرصِ) — و`pnpm -r --filter ./لا-شيء test` يخرجُ **0**
# برسالةٍ لا يقرؤها أحدٌ. بابُ المُرشِّحاتِ الجديدُ يرفضُها.
_ti_filter_drift() {
  local S; S="$(_ti_stage fdrift 1 0)"
  python3 - "$S/scripts/checks/lib/test_groups.py" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = "        out.append((d, gate))"
assert s.count(old) == 1, "anchor missing"
s = s.replace(old, old + "\n        out.append(('packages/ghost', True))", 1)
io.open(p, "w", encoding="utf-8").write(s)
PY
  _ti "$S"
}
t "يرفض مُرشِّحاً لا يُطابِقُ شيئاً — لا خضرةَ صامتةَ (M0-42)" fail _ti_filter_drift

# (12) **ثباتٌ:** 40 تشغيلاً بلا تقلّبٍ. وحارسُ سباقٍ **يتقلّبُ هوَ** أسوأُ من لا
# حارسٍ: يُقرأُ إزعاجاً فيُسكَتُ. والعددُ 40 كما في حرّاسِ `RISK-0037`.
_ti_stable() {
  local S ok=1; S="$(_ti_stage stable 1 0)"
  for _ in $(seq 1 40); do _ti "$S" >/dev/null 2>&1 || ok=0; done
  [[ "$ok" == 1 ]]
}
t "يقبلُ مَشهداً سليماً في 40 تشغيلاً بلا تقلّب" pass _ti_stable
