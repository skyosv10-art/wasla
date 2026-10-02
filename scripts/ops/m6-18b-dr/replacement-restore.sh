#!/usr/bin/env bash
# M6-18B · CLM-0436: full restore of the STORED production backup artifact into a real
# replacement Supabase project (fail-closed).
#
# Usage: replacement-restore.sh <artifact_dir> <out_dir>
# Env:   BACKUP_PASSPHRASE      GPG passphrase (never printed)
#        DR_REPLACEMENT_DB_URL  session-mode URL of the replacement project (never printed;
#                               guard-replacement.py must pass first)
#        DRILL_T0_MS            epoch ms when the drill started (before the artifact download)
#
# The artifact is the one db-backup.yml uploaded from production ppixaauyqoykrogwdxtv.
# This script reads production through nothing: it uses only the artifact.
#
# Stages (the first failure exits non-zero):
#   1 manifest  exactly one manifest and one .gpg, and the manifest says restore_all_match=true
#   2 cipher    sha256(.gpg) == manifest.encrypted_sha256
#   3 decrypt   gpg decrypt, then sha256(dump) == manifest.dump_sha256
#   4 target    the replacement is reachable, and public holds only objects this role owns
#               (a fresh project, or a previous run of this drill, which is dropped first)
#   5 restore   pg_restore --schema=public --exit-on-error --single-transaction
#   6 compare   restored base tables == dump TOC == manifest, and total rows == manifest
#   7 platform  inventory of auth/storage/vault: rows in the source dump vs in the replacement
# Output: stage names, totals and timings only. No row data.
set -euo pipefail
ART="${1:?artifact dir}"; OUT="${2:?out dir}"
T0="${DRILL_T0_MS:?DRILL_T0_MS is required}"
: "${DR_REPLACEMENT_DB_URL:?DR_REPLACEMENT_DB_URL is required}"
fail() { echo "REPLACEMENT FAIL stage=$1 · $2"; exit 1; }
pass() { echo "REPLACEMENT PASS stage=$1 · $2"; }
ms() { echo $(( $(date +%s%N) / 1000000 )); }
[ -n "${BACKUP_PASSPHRASE:-}" ] || fail decrypt "BACKUP_PASSPHRASE empty"
mkdir -p "$OUT"; WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DB="$DR_REPLACEMENT_DB_URL"
q() { psql "$DB" -At -v ON_ERROR_STOP=1 -c "$1"; }

# 1: manifest
mapfile -t MANS < <(find "$ART" -type f -name backup-manifest.json)
mapfile -t ENCS < <(find "$ART" -type f -name 'wasla-db-*.dump.gpg')
[ "${#MANS[@]}" -eq 1 ] || fail manifest "expected 1 manifest, found ${#MANS[@]}"
[ "${#ENCS[@]}" -eq 1 ] || fail manifest "expected 1 encrypted dump, found ${#ENCS[@]}"
MAN="${MANS[0]}"; ENC="${ENCS[0]}"
read -r M_TS M_ENC M_DUMP M_TABLES M_ROWS M_OK < <(python3 - "$MAN" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print(m["timestamp"], m["encrypted_sha256"], m["dump_sha256"], m["public_tables"], m["public_rows_total"], str(m["restore_all_match"]).lower())
PY
) || fail manifest "manifest unreadable"
[ "$M_OK" = true ] || fail manifest "manifest restore_all_match is not true"
[ "$M_TABLES" -gt 0 ] || fail manifest "manifest lists zero public tables"
pass manifest "backup ${M_TS} · ${M_TABLES} tables · ${M_ROWS} rows"

# 2: ciphertext integrity
[ "$(sha256sum "$ENC" | cut -d' ' -f1)" = "$M_ENC" ] || fail cipher "encrypted sha256 differs from manifest"
pass cipher "encrypted sha256 matches manifest"
T_DL=$(ms)

# 3: decrypt
DUMP="$WORK/restore.dump"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt --output "$DUMP" "$ENC" 2>/dev/null || fail decrypt "gpg decrypt failed"
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$M_DUMP" ] || fail decrypt "dump sha256 differs from manifest"
pass decrypt "dump sha256 matches manifest"
pg_restore --list "$DUMP" > "$WORK/toc.txt" 2>/dev/null || fail decrypt "pg_restore --list failed"
awk '$4=="TABLE" && $5=="public" {print $6}' "$WORK/toc.txt" | sort -u > "$WORK/toc-tables.txt"
T_DEC=$(ms)

# 4: target state. Only objects owned by this role may exist in public; drop them
# (a previous run of this drill). Anything owned by another role → refuse.
ME=$(q "select current_user") || fail target "replacement not reachable"
FOREIGN=$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
  and pg_get_userbyid(c.relowner) <> current_user
  and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')")
[ "$FOREIGN" = 0 ] || fail target "public holds ${FOREIGN} relations owned by another role — not a drill target"
PRIOR=$(q "select count(*) from pg_tables where schemaname='public' and tableowner=current_user")
if [ "$PRIOR" != 0 ]; then
  psql "$DB" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL' || fail target "cannot drop the previous drill objects"
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS o FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND pg_get_userbyid(c.relowner)=current_user
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e') LOOP
    EXECUTE format('DROP TABLE IF EXISTS %s CASCADE', r.o);
  END LOOP;
  FOR r IN SELECT c.oid::regclass AS o FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='S' AND pg_get_userbyid(c.relowner)=current_user LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS %s CASCADE', r.o);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS o FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND pg_get_userbyid(p.proowner)=current_user
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e') LOOP
    EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', r.o);
  END LOOP;
  FOR r IN SELECT t.oid::regtype AS o FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
           WHERE n.nspname='public' AND t.typtype IN ('e','d','c') AND pg_get_userbyid(t.typowner)=current_user
             AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=t.typrelid AND c.relkind<>'c')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=t.oid AND d.deptype='e') LOOP
    EXECUTE format('DROP TYPE IF EXISTS %s CASCADE', r.o);
  END LOOP;
END $$;
SQL
fi
pass target "role ${ME} · previous drill tables dropped: ${PRIOR}"
T_TGT=$(ms)

# Extensions the dump expects in public must already exist (created by the project admin;
# this role cannot create extensions).
python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["public_extensions"]))' "$MAN" > "$WORK/ext.txt"
while read -r ext; do
  [ -n "$ext" ] || continue
  [ "$(q "select count(*) from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='${ext}' and n.nspname='public'")" = 1 ] \
    || fail restore "public extension ${ext} is not installed on the replacement"
done < "$WORK/ext.txt"

# 5: restore schema public
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --schema=public \
  --dbname="$DB" "$DUMP" > "$WORK/restore.log" 2>&1 || {
    sed -E 's#postgres(ql)?://[^ ]+#<url>#g' "$WORK/restore.log" | grep -m3 -E 'ERROR|error' || true
    fail restore "pg_restore exited non-zero (first error aborts, nothing committed)"
  }
pass restore "restored with --exit-on-error --single-transaction"
T_RES=$(ms)

# 6: compare against the TOC and the manifest
q "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" \
  | sort -u > "$WORK/restored-tables.txt" || fail compare "cannot list restored tables"
cmp -s "$WORK/toc-tables.txt" "$WORK/restored-tables.txt" || fail compare "restored table set differs from the dump TOC"
N=$(wc -l < "$WORK/restored-tables.txt")
[ "$N" -eq "$M_TABLES" ] || fail compare "restored ${N} tables, manifest says ${M_TABLES}"
ROWS=0
while read -r t; do
  c=$(q "SELECT count(*) FROM public.\"${t//\"/\"\"}\"") || fail compare "count query failed"
  [[ "$c" =~ ^[0-9]+$ ]] || fail compare "non-numeric count"
  ROWS=$((ROWS + c))
done < "$WORK/restored-tables.txt"
[ "$ROWS" -eq "$M_ROWS" ] || fail compare "restored ${ROWS} rows, manifest says ${M_ROWS}"
pass compare "${N}/${M_TABLES} tables · ${ROWS}/${M_ROWS} rows"
T_END=$(ms)

# The services connect as `postgres`; tables restored by this role must be usable by it.
q "GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres" >/dev/null \
  || fail compare "cannot grant the restored objects to postgres"

# 7: platform schemas. Counts the TABLE DATA entries in the dump, and the rows in the
# replacement. A row count is reported only where this role can read it.
python3 - "$WORK/toc.txt" > "$WORK/platform-toc.json" <<'PY'
import json,sys,collections
data=collections.Counter(); tables=collections.Counter()
for line in open(sys.argv[1]):
    if line.startswith(";"): continue
    f=line.split()
    if len(f)>=7 and f[3]=="TABLE" and f[4]=="DATA": data[f[5]]+=1
    elif len(f)>=6 and f[3]=="TABLE": tables[f[4]]+=1
print(json.dumps({s:{"tables":tables.get(s,0),"table_data_entries":data.get(s,0)} for s in ("auth","storage","vault","public")}))
PY
cnt() { q "select count(*) from $1" 2>/dev/null || echo "not-readable"; }
TGT_AUTH=$(cnt auth.users); TGT_BUCKETS=$(cnt storage.buckets); TGT_OBJECTS=$(cnt storage.objects); TGT_VAULT=$(cnt vault.secrets)
pass platform "toc $(cat "$WORK/platform-toc.json") · replacement auth.users=${TGT_AUTH} storage.buckets=${TGT_BUCKETS} storage.objects=${TGT_OBJECTS} vault.secrets=${TGT_VAULT}"

python3 - "$OUT/replacement.json" "$M_TS" "$N" "$ROWS" "$T0" "$T_DL" "$T_DEC" "$T_TGT" "$T_RES" "$T_END" "$PRIOR" \
  "$WORK/platform-toc.json" "$TGT_AUTH" "$TGT_BUCKETS" "$TGT_OBJECTS" "$TGT_VAULT" <<'PY'
import json,sys,datetime as d
(out,ts,n,rows,t0,tdl,tdec,ttgt,tres,tend,prior,ptoc,ta,tb,to,tv)=sys.argv[1:]
t0,tdl,tdec,ttgt,tres,tend=map(int,(t0,tdl,tdec,ttgt,tres,tend))
bt=d.datetime.strptime(ts,"%Y%m%dT%H%M%SZ").replace(tzinfo=d.timezone.utc)
start=d.datetime.fromtimestamp(t0/1000,d.timezone.utc)
r={"target":"replacement Supabase project pvyuhjadrygqqdoczmnd (free plan)",
   "source":"stored db-backup.yml artifact of production ppixaauyqoykrogwdxtv (no production connection)",
   "backup_timestamp":bt.isoformat(),"drill_started_at":start.isoformat(),
   "backup_age_at_drill_seconds":round((start-bt).total_seconds()),
   "previous_drill_tables_dropped":int(prior),
   "restored_public_tables":int(n),"restored_public_rows":int(rows),
   "seconds":{"download_and_integrity":round((tdl-t0)/1000,1),"decrypt":round((tdec-tdl)/1000,1),
              "target_prepare":round((ttgt-tdec)/1000,1),"restore":round((tres-ttgt)/1000,1),
              "compare":round((tend-tres)/1000,1),"total_data_restore_rto":round((tend-t0)/1000,1)},
   "platform":{"dump_toc":json.load(open(ptoc)),
               "replacement_rows":{"auth.users":ta,"storage.buckets":tb,"storage.objects":to,"vault.secrets":tv}},
   "result":"PASS"}
json.dump(r,open(out,"w"),indent=2); print(json.dumps(r))
PY
echo "REPLACEMENT RESULT PASS"
