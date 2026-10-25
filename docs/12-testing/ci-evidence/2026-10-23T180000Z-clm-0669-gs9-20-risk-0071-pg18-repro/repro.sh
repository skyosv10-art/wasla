#!/usr/bin/env bash
# CLM-0669 — إعادةُ إنتاجٍ قابلةٌ لإعادةِ التشغيلِ لـ G-S9.20 (RISK-0070) و RISK-0071 على PostgreSQL محلّيٍّ.
#
# الاستعمال (من جذرِ المستودعِ، بعدَ `pnpm install --frozen-lockfile`):
#   WASLA_LOCAL_PG_URL=postgresql://postgres@localhost:55432 \
#     bash docs/12-testing/ci-evidence/2026-10-23T180000Z-clm-0669-gs9-20-risk-0071-pg18-repro/repro.sh [OUTDIR]
#
# المتغيّرات: N_FIXED (افتراضيًّا 20) · N_MUT (افتراضيًّا 10).
#
# ما يفعلُهُ (قراءةٌ وكتابةٌ على قاعدةٍ محلّيةٍ مؤقّتةٍ فقط — يرفضُ Supabase):
#   0. يسجّلُ البيئةَ (SHA · إصدارُ الخادمِ · الترميزُ · standard_conforming_strings · Node/pnpm/vitest).
#   1. شوطُ تكاملِ البحثِ الكاملُ كما في CI (`run-integration-local.sh '^int:search$'`).
#   2. G-S9.20: ملفُّ relay-concurrent-dedupe N_FIXED مرّةً بالقفلِ، ثمّ N_MUT مرّةً بطفرةِ L
#      (pg_advisory_lock/unlock → SELECT بلا قفلٍ)، ويسجّلُ حالةَ كلِّ حالةِ اختبارٍ في كلِّ تشغيلٍ
#      ونصَّ الخرقِ الحرفيَّ.
#   3. RISK-0071: search-index-reader (تكامل) و store-search (وحدة) على الشيفرةِ كما هيَ، ثمّ كلُّ
#      طفرةٍ (A · B · C) وحدَها على الملفّينِ.
#   4. تكافؤُ الطفرةِ B: مقارنةٌ شاملةٌ في SQL على مجالٍ محدودٍ، مع ضابطٍ سالبٍ (`ESCAPE ''`) يُثبتُ
#      أنّ المقارنةَ حسّاسةٌ.
# كلُّ طفرةٍ تُطبَّقُ باستبدالٍ نصّيٍّ يتحقّقُ من عددِ المواضعِ، وتُستعادُ الشيفرةُ بـ `git checkout`
# في كلِّ خروجٍ (trap). يرفضُ البدءَ إن كانت services/search معدَّلةً محلّيًّا.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)" || exit 2
cd "$ROOT" || exit 2
PG="${WASLA_LOCAL_PG_URL:-}"
[[ -n "$PG" ]] || { echo "error: WASLA_LOCAL_PG_URL is not set — nothing measured." >&2; exit 2; }
case "$PG" in *supabase.co*|*supabase.com*|*pooler.supabase*) echo "error: refusing Supabase URL." >&2; exit 2 ;; esac
PG="${PG%/}"
git diff --quiet -- services/search || { echo "error: services/search has local changes — refusing (mutations must start from the committed tree)." >&2; exit 2; }

OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT/logs"
N_FIXED="${N_FIXED:-20}"; N_MUT="${N_MUT:-10}"
DB=wasla_search_clm0669
PKG=@wasla/search-service
MUTATED=(services/search/src/infrastructure/projection-store.ts
         services/search/src/infrastructure/search-index-reader.ts
         services/search/src/domain/store-search.ts)
restore() { git checkout -q -- "${MUTATED[@]}"; }
trap restore EXIT

mutate() { # file old new expected_count
  python3 - "$@" <<'PY' || { echo "error: mutation did not apply as declared" >&2; exit 3; }
import sys
f, old, new, n = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
s = open(f, encoding="utf-8").read()
c = s.count(old)
assert c == n, f"{f}: expected {n} occurrence(s) of {old!r}, found {c}"
open(f, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

freshdb() { psql "$PG/postgres" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -qc "CREATE DATABASE $DB" >/dev/null; }

# run_vitest LABEL CONFIG_FLAG FILE → يكتبُ سطرًا لكلِّ حالةٍ: LABEL<TAB>status<TAB>name<TAB>failure
run_vitest() {
  local label="$1" cfg="$2" file="$3" json="$OUT/logs/$1.json"
  freshdb
  # shellcheck disable=SC2086
  env DATABASE_URL="$PG/$DB" pnpm --filter "$PKG" exec vitest run $cfg "$file" \
      --reporter=default --reporter=json --outputFile.json="$json" > "$OUT/logs/$label.log" 2>&1
  python3 - "$label" "$json" "$OUT/logs/$label.log" <<'PY'
import json, sys, re
label, path, logpath = sys.argv[1], sys.argv[2], sys.argv[3]
# تقريرُ JSON يختصرُ المصفوفاتِ؛ تفاصيلُ الجولاتِ تُقرأُ من المخرَجِ النصّيِّ الكاملِ.
log = re.sub(r"\x1b\[[0-9;]*m", "", open(logpath, encoding="utf-8", errors="replace").read()).replace('\\"', '"')
rounds = sorted(set(re.findall(r"round \d+: rows=\[.*?\] docs=\d+", log)))
try:
    r = json.load(open(path, encoding="utf-8"))
except Exception as e:
    print(f"{label}\tERROR\t(no json report: {e})\t"); sys.exit(0)
for f in r["testResults"]:
    for a in f["assertionResults"]:
        msg = " ".join(a.get("failureMessages") or [])
        msg = re.sub(r"\x1b\[[0-9;]*m", "", msg)
        first = msg.split("\n")[0][:220]
        extra = " · ".join(rounds) if ("amplified" in a["title"] and msg) else ""
        detail = (first + (" · " + extra if extra else "")) if msg else ""
        print(f"{label}\t{a['status']}\t{a['title']}\t{detail}")
PY
}

{
  echo "# البيئة · $(date -u +%FT%TZ)"
  echo "git HEAD: $(git rev-parse HEAD)"
  echo "services/search tree: $(git rev-parse HEAD:services/search)"
  psql "$PG/postgres" -Atc "select 'server_version: '||current_setting('server_version')" \
       -c "select 'server_encoding: '||current_setting('server_encoding')" \
       -c "select 'lc_collate: '||datcollate||' · lc_ctype: '||datctype from pg_database where datname='postgres'" \
       -c "select 'standard_conforming_strings: '||current_setting('standard_conforming_strings')" \
       -c "select 'max_connections: '||current_setting('max_connections')"
  echo "node: $(node -v) · pnpm: $(pnpm -v) · vitest: $(pnpm --filter "$PKG" exec vitest --version 2>/dev/null | tail -1)"
  echo "N_FIXED=$N_FIXED · N_MUT=$N_MUT"
} > "$OUT/env.txt"
cat "$OUT/env.txt"

echo "== 1. شوطُ تكاملِ البحثِ الكاملُ ==" | tee "$OUT/search-leg.txt"
WASLA_LOCAL_PG_LOGDIR="$OUT/logs" bash scripts/ci/run-integration-local.sh '^int:search$' 2>&1 | tee -a "$OUT/search-leg.txt"

RELAY=src/__tests__/relay-concurrent-dedupe.integration.test.ts
ICFG="--config vitest.integration.config.ts"
: > "$OUT/relay-runs.tsv"
echo "== 2. G-S9.20 بالقفلِ ×$N_FIXED =="
for i in $(seq 1 "$N_FIXED"); do run_vitest "relay-fixed-$i" "$ICFG" "$RELAY" >> "$OUT/relay-runs.tsv"; done
echo "== 2. G-S9.20 طفرةُ L (بلا قفلٍ) ×$N_MUT =="
mutate services/search/src/infrastructure/projection-store.ts \
  'SELECT pg_advisory_lock($1, hashtext($2))' 'SELECT $1::int, hashtext($2)' 1
mutate services/search/src/infrastructure/projection-store.ts \
  'SELECT pg_advisory_unlock($1, hashtext($2))' 'SELECT $1::int, hashtext($2)' 1
for i in $(seq 1 "$N_MUT"); do run_vitest "relay-mutL-$i" "$ICFG" "$RELAY" >> "$OUT/relay-runs.tsv"; done
restore

READER=src/__tests__/search-index-reader.integration.test.ts
UNIT=src/__tests__/store-search.test.ts
: > "$OUT/reader-mutants.tsv"
reader_pair() { run_vitest "$1-int" "$ICFG" "$READER" >> "$OUT/reader-mutants.tsv"; run_vitest "$1-unit" "" "$UNIT" >> "$OUT/reader-mutants.tsv"; }
echo "== 3. RISK-0071 الشيفرةُ كما هيَ =="
reader_pair baseline
echo "== 3. الطفرةُ A — بلا escapeLike (\$2 = q الخام) =="
mutate services/search/src/infrastructure/search-index-reader.ts \
  'const params: string[] = [query.q, escapeLike(query.q)];' 'const params: string[] = [query.q, query.q];' 1
reader_pair mutA; restore
echo "== 3. الطفرةُ B — حذفُ ESCAPE '\\' الصريحِ من المسندَين =="
mutate services/search/src/infrastructure/search-index-reader.ts " || '%' ESCAPE '\\\\'\"" " || '%'\"" 2
reader_pair mutB; restore
echo "== 3. الطفرةُ C — escapeLike لا يهرّبُ الشرطةَ العكسيّةَ =="
mutate services/search/src/domain/store-search.ts 's.replace(/[\\%_]/g' 's.replace(/[%_]/g' 1
reader_pair mutC; restore

echo "== 4. تكافؤُ الطفرةِ B في SQL ==" | tee "$OUT/sql-equivalence.txt"
freshdb
psql "$PG/$DB" -v ON_ERROR_STOP=1 -At >> "$OUT/sql-equivalence.txt" 2>&1 <<'SQL'
SELECT 'standard_conforming_strings='||current_setting('standard_conforming_strings');
-- الأبجديةُ {a, b, %, _, \} · الموضوعُ s بطولِ 0..3 · الاستعلامُ q بطولِ 1..3
-- e = escapeLike(q) نفسُها: كلُّ \ و% و_ تُسبَقُ بـ\ (الشرطةُ أوّلًا كما في الشيفرة).
WITH RECURSIVE alpha(c) AS (VALUES ('a'),('b'),('%'),('_'),(E'\\')),
w(s, n) AS (SELECT ''::text, 0 UNION ALL SELECT w.s || alpha.c, n + 1 FROM w, alpha WHERE n < 3),
subj AS (SELECT s FROM w),
qs AS (SELECT s AS q, regexp_replace(s, E'([\\\\%_])', E'\\\\\\1', 'g') AS e FROM w WHERE n >= 1),
grid AS (
  SELECT s, q, e,
         (s ILIKE '%' || e || '%')              AS no_clause,
         (s ILIKE '%' || e || '%' ESCAPE E'\\') AS with_clause,
         (s ILIKE '%' || e || '%' ESCAPE '')    AS escape_disabled,
         (strpos(lower(s), lower(q)) > 0)       AS literal_contains
  FROM subj, qs)
SELECT 'pairs=' || count(*)
    || ' · mismatch(no_clause vs ESCAPE ''\'')=' || count(*) FILTER (WHERE no_clause IS DISTINCT FROM with_clause)
    || ' · mismatch(with_clause vs literal containment)=' || count(*) FILTER (WHERE with_clause IS DISTINCT FROM literal_contains)
    || ' · control mismatch(ESCAPE '''' vs literal containment)=' || count(*) FILTER (WHERE escape_disabled IS DISTINCT FROM literal_contains)
FROM grid;
SELECT 'spot: s=''a\xb'' · q=''a%b'' · e=''a\%b'' → no_clause=' || (E'a\\xb' ILIKE '%' || E'a\\%b' || '%')::text
    || ' · with_clause=' || (E'a\\xb' ILIKE '%' || E'a\\%b' || '%' ESCAPE E'\\')::text
    || ' · escape_disabled(control)=' || (E'a\\xb' ILIKE '%' || E'a\\%b' || '%' ESCAPE '')::text;
SQL
cat "$OUT/sql-equivalence.txt"

python3 - "$OUT" > "$OUT/SUMMARY.txt" <<'PY'
import sys, collections, re
out = sys.argv[1]
def load(name):
    rows = []
    for line in open(f"{out}/{name}", encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) >= 3: rows.append((p[0], p[1], p[2], p[3] if len(p) > 3 else ""))
    return rows
print("# SUMMARY")
print(open(f"{out}/env.txt", encoding="utf-8").read().strip())
print("\n## G-S9.20 — per variant, per test: runs passed / runs")
rows = load("relay-runs.tsv")
for variant in ("relay-fixed", "relay-mutL"):
    per = collections.defaultdict(lambda: [0, 0]); runs = set(); bad_runs = set()
    for lab, st, name, _ in rows:
        if not lab.startswith(variant + "-"): continue
        runs.add(lab); per[name][1] += 1; per[name][0] += st == "passed"
        if st != "passed": bad_runs.add(lab)
    print(f"{variant}: runs={len(runs)} · runs fully green={len(runs) - len(bad_runs)}")
    for n, (p, t) in per.items(): print(f"   {p}/{t}  {n}")
print("\n## G-S9.20 — every violation message under mutant L (verbatim, first line + round detail)")
for lab, st, name, msg in rows:
    if lab.startswith("relay-mutL-") and st != "passed": print(f"   {lab} · {name[:70]} · {msg}")
print("\n## G-S9.20 — violating rounds under mutant L, classified (invariant: rows == 5 · none pending · docs == 1)")
kinds = collections.Counter(); runs_with = collections.Counter()
for lab, st, name, msg in rows:
    if not (lab.startswith("relay-mutL-") and "amplified" in name and st != "passed"): continue
    for rnd, body, docs in re.findall(r"round (\d+): rows=(\[.*?\]) docs=(\d+)", msg):
        n = body.count('"status"'); pend = body.count('"status":"pending"')
        errs = sorted(set(re.findall(r'unique constraint \\+"([a-z_]+)', body)))
        k = f"rows={n} · pending={pend} · docs={docs} · constraint={','.join(errs) or '-'}"
        kinds[k] += 1; runs_with[lab] += 1
print(f"   violating rounds: {sum(kinds.values())} across {len(runs_with)} runs")
for k, v in kinds.most_common(): print(f"   {v}× {k}")
print("\n## RISK-0071 — passed/total per label")
rows = load("reader-mutants.tsv")
c = collections.OrderedDict()
for lab, st, name, msg in rows:
    c.setdefault(lab, [0, 0, []]); c[lab][1] += 1
    if st == "passed": c[lab][0] += 1
    else: c[lab][2].append(name)
for lab, (p, t, failed) in c.items():
    print(f"{lab}: {p}/{t} passed" + ("" if not failed else " · failed: " + " | ".join(failed)))
print("\n## SQL equivalence")
print(open(f"{out}/sql-equivalence.txt", encoding="utf-8").read().strip())
PY
cat "$OUT/SUMMARY.txt"
