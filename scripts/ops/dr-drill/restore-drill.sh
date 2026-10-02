#!/usr/bin/env bash
# M6-18B · CLM-0430 — restore drill from a STORED backup artifact (fail-closed).
#
# Usage: restore-drill.sh <artifact_dir> <out_dir>
# Env:   BACKUP_PASSPHRASE  GPG passphrase (never printed)
#        DRILL_T0_MS        epoch ms when the drill started (before the artifact download)
#        RESTORE_PORT       scratch postgres:17 port (default 15435)
#
# The artifact is the one db-backup.yml uploaded (wasla-db-*.dump.gpg + backup-manifest.json).
# It is the bytes a real recovery would use. Stages (first failure exits non-zero):
#   1 manifest   exactly one manifest + one .gpg; manifest says restore_all_match=true
#   2 cipher     sha256(.gpg) == manifest.encrypted_sha256
#   3 decrypt    gpg decrypt; sha256(dump) == manifest.dump_sha256
#   4 restore    into a fresh postgres:17, schema public, --exit-on-error --single-transaction
#   5 compare    restored public base tables == TOC table set == manifest.public_tables,
#                and total rows == manifest.public_rows_total
# Nothing here connects to production. Output: stage names, totals, timings only.
set -euo pipefail
ART="${1:?artifact dir}"; OUT="${2:?out dir}"
PORT="${RESTORE_PORT:-15435}"; CONTAINER="dr-drill-${PORT}"
T0="${DRILL_T0_MS:?DRILL_T0_MS is required}"
fail() { echo "DRILL FAIL stage=$1 · $2"; exit 1; }
pass() { echo "DRILL PASS stage=$1 · $2"; }
ms() { date +%s%3N; }
[ -n "${BACKUP_PASSPHRASE:-}" ] || fail decrypt "BACKUP_PASSPHRASE empty"
mkdir -p "$OUT"; WORK="$(mktemp -d)"
rm_container() { if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then docker rm -f "$CONTAINER" >/dev/null; fi; }
cleanup() { rm_container; rm -rf "$WORK"; }
trap cleanup EXIT

# 1 — manifest
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

# 2 — ciphertext integrity
[ "$(sha256sum "$ENC" | cut -d' ' -f1)" = "$M_ENC" ] || fail cipher "encrypted sha256 differs from manifest"
pass cipher "encrypted sha256 matches manifest"
T_DL=$(ms)

# 3 — decrypt
DUMP="$WORK/restore.dump"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt --output "$DUMP" "$ENC" 2>/dev/null || fail decrypt "gpg decrypt failed"
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$M_DUMP" ] || fail decrypt "dump sha256 differs from manifest"
pass decrypt "dump sha256 matches manifest"
T_DEC=$(ms)

# 4 — restore into a fresh postgres:17
pg_restore --list "$DUMP" > "$WORK/toc.txt" 2>/dev/null || fail restore "pg_restore --list failed"
awk '$4=="TABLE" && $5=="public" {print $6}' "$WORK/toc.txt" | sort -u > "$WORK/toc-tables.txt"
rm_container
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill -p "127.0.0.1:${PORT}:5432" postgres:17 >/dev/null
READY=0
for _ in $(seq 1 60); do docker exec "$CONTAINER" pg_isready -U postgres -d drill >/dev/null 2>&1 && { READY=1; break; }; sleep 1; done
[ "$READY" -eq 1 ] || fail restore "scratch postgres:17 not ready"
sleep 2
LOCAL="postgresql://postgres:drill@127.0.0.1:${PORT}/drill"
python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["public_extensions"]))' "$MAN" > "$WORK/ext.txt" \
  || fail restore "manifest public_extensions unreadable"
while read -r ext; do
  [ -n "$ext" ] || continue
  psql "$LOCAL" -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS \"${ext}\" WITH SCHEMA public" >/dev/null 2>&1 \
    || fail restore "public extension ${ext} not available in vanilla postgres:17"
done < "$WORK/ext.txt"
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --schema=public \
  --dbname="$LOCAL" "$DUMP" > "$WORK/restore.log" 2>&1 || fail restore "pg_restore exited non-zero (first error aborts)"
pass restore "restored with --exit-on-error --single-transaction"
T_RES=$(ms)

# 5 — compare against the TOC and the manifest
psql "$LOCAL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" \
  | sort -u > "$WORK/restored-tables.txt" || fail compare "cannot list restored tables"
cmp -s "$WORK/toc-tables.txt" "$WORK/restored-tables.txt" || fail compare "restored table set differs from the dump TOC"
N=$(wc -l < "$WORK/restored-tables.txt")
[ "$N" -eq "$M_TABLES" ] || fail compare "restored ${N} tables, manifest says ${M_TABLES}"
ROWS=0
while read -r t; do
  c=$(psql "$LOCAL" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"${t//\"/\"\"}\"") || fail compare "count query failed"
  [[ "$c" =~ ^[0-9]+$ ]] || fail compare "non-numeric count"
  ROWS=$((ROWS + c))
done < "$WORK/restored-tables.txt"
[ "$ROWS" -eq "$M_ROWS" ] || fail compare "restored ${ROWS} rows, manifest says ${M_ROWS}"
pass compare "${N}/${M_TABLES} tables · ${ROWS}/${M_ROWS} rows"
T_END=$(ms)

python3 - "$OUT/drill.json" "$M_TS" "$N" "$ROWS" "$T0" "$T_DL" "$T_DEC" "$T_RES" "$T_END" <<'PY'
import json,sys,datetime as d
out,ts,n,rows,t0,tdl,tdec,tres,tend=sys.argv[1:]; t0,tdl,tdec,tres,tend=map(int,(t0,tdl,tdec,tres,tend))
bt=d.datetime.strptime(ts,"%Y%m%dT%H%M%SZ").replace(tzinfo=d.timezone.utc)
start=d.datetime.fromtimestamp(t0/1000,d.timezone.utc)
r={"backup_timestamp":bt.isoformat(),"drill_started_at":start.isoformat(),
   "backup_age_at_drill_seconds":round((start-bt).total_seconds()),
   "restored_public_tables":int(n),"restored_public_rows":int(rows),
   "seconds":{"download_and_integrity":round((tdl-t0)/1000,1),"decrypt":round((tdec-tdl)/1000,1),
              "restore":round((tres-tdec)/1000,1),"compare":round((tend-tres)/1000,1),
              "total_data_restore_rto":round((tend-t0)/1000,1)},
   "result":"PASS",
   "scope_note":"Restore of schema public into an isolated postgres:17 from the stored artifact. Nothing connected to production. Service-level recovery (repointing Render) is not part of this timing."}
json.dump(r,open(out,"w"),indent=2); print(json.dumps(r))
PY
echo "DRILL RESULT PASS"
