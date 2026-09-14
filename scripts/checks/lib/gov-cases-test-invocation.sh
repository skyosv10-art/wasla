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
  cp "$TI_LIB/test_groups.py" "$TI_LIB/audit_test_invocation.py" "$S/scripts/checks/lib/"
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

# (12) **ثباتٌ:** 40 تشغيلاً بلا تقلّبٍ. وحارسُ سباقٍ **يتقلّبُ هوَ** أسوأُ من لا
# حارسٍ: يُقرأُ إزعاجاً فيُسكَتُ. والعددُ 40 كما في حرّاسِ `RISK-0037`.
_ti_stable() {
  local S ok=1; S="$(_ti_stage stable 1 0)"
  for _ in $(seq 1 40); do _ti "$S" >/dev/null 2>&1 || ok=0; done
  [[ "$ok" == 1 ]]
}
t "يقبلُ مَشهداً سليماً في 40 تشغيلاً بلا تقلّب" pass _ti_stable
