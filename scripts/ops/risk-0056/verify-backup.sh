#!/usr/bin/env bash
# RISK-0056 · CLM-0413 — fail-closed backup verification (stages 2–6).
#
# Usage: verify-backup.sh <dump_file> <counts.json> <workdir>
# Env:   BACKUP_PASSPHRASE  GPG symmetric passphrase (never printed)
#        RESTORE_PORT       local port for the scratch postgres:17 (default 15434)
#
# Every stage must pass; the first failure exits non-zero with the stage name.
# There is no "warning" outcome and no manifest is consulted. The caller must
# treat a non-zero exit as "no migration".
#   2 nonempty   dump file exists and is > 0 bytes
#   3 list       pg_restore --list succeeds and lists every public table of counts.json
#   4 gpg        encrypt (AES256) → decrypt → byte-identical (cmp) + same sha256
#   5 restore    the DECRYPTED file restores into a fresh postgres:17 with
#                --exit-on-error --single-transaction, schema public only
#   6 compare    restored public base tables == counts.json tables (same set) and
#                every exact row count equal
# Output: stage names and PASS/FAIL, table and extension totals only.
set -euo pipefail

DUMP="${1:?dump file}"; COUNTS="${2:?counts.json}"; WORK="${3:?workdir}"
PORT="${RESTORE_PORT:-15434}"
CONTAINER="risk0056-verify-${PORT}"
fail() { echo "BACKUP-GUARD FAIL stage=$1 · $2"; exit 1; }
pass() { echo "BACKUP-GUARD PASS stage=$1 · $2"; }
[ -n "${BACKUP_PASSPHRASE:-}" ] || fail gpg "BACKUP_PASSPHRASE empty"
mkdir -p "$WORK"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -f "$WORK/enc.gpg" "$WORK/dec.dump"; }
trap cleanup EXIT

# 2 — non-empty
[ -f "$DUMP" ] || fail nonempty "dump file missing"
SIZE=$(stat -c%s "$DUMP")
[ "$SIZE" -gt 0 ] || fail nonempty "dump is 0 bytes"
pass nonempty "size>0"

# expected tables / extensions from the snapshot counts
python3 - "$COUNTS" "$WORK" <<'PY' || fail compare "counts.json unreadable"
import json, sys
c = json.load(open(sys.argv[1]))
assert c["schema"] == "public"
open(sys.argv[2] + "/expected-tables.txt", "w").write("".join(f"{t}\n" for t in sorted(c["tables"])))
open(sys.argv[2] + "/expected-ext.txt", "w").write("".join(f"{e}\n" for e in c["public_extensions"]))
PY
EXPECTED_N=$(wc -l < "$WORK/expected-tables.txt")
[ "$EXPECTED_N" -gt 0 ] || fail compare "snapshot has zero public tables — refusing to call that a backup"

# 3 — pg_restore --list, and every expected table has a TABLE entry in public
pg_restore --list "$DUMP" > "$WORK/toc.txt" 2>/dev/null || fail list "pg_restore --list failed"
awk '$4=="TABLE" && $5=="public" {print $6}' "$WORK/toc.txt" | sort -u > "$WORK/toc-tables.txt"
MISSING=$(comm -23 "$WORK/expected-tables.txt" "$WORK/toc-tables.txt" | wc -l)
[ "$MISSING" -eq 0 ] || fail list "${MISSING} public table(s) absent from the dump TOC"
pass list "toc lists all ${EXPECTED_N} public tables"

# 4 — GPG round-trip
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --output "$WORK/enc.gpg" "$DUMP" 2>/dev/null || fail gpg "encrypt failed"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt --output "$WORK/dec.dump" "$WORK/enc.gpg" 2>/dev/null || fail gpg "decrypt failed"
cmp -s "$DUMP" "$WORK/dec.dump" || fail gpg "decrypted bytes differ"
[ "$(sha256sum < "$DUMP")" = "$(sha256sum < "$WORK/dec.dump")" ] || fail gpg "sha256 differs"
pass gpg "AES256 round-trip byte-identical"

# 5 — restore the decrypted file, schema public only, exit on first error
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify -p "127.0.0.1:${PORT}:5432" postgres:17 >/dev/null
for _ in $(seq 1 60); do docker exec "$CONTAINER" pg_isready -U postgres -d verify >/dev/null 2>&1 && break; sleep 1; done
sleep 2
LOCAL="postgresql://postgres:verify@127.0.0.1:${PORT}/verify"
while read -r ext; do
  [ -n "$ext" ] || continue
  psql "$LOCAL" -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS \"${ext}\" WITH SCHEMA public" >/dev/null 2>&1 \
    || fail restore "public extension not available in vanilla postgres:17"
done < "$WORK/expected-ext.txt"
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --schema=public \
  --dbname="$LOCAL" "$WORK/dec.dump" > "$WORK/restore.log" 2>&1 || fail restore "pg_restore exited non-zero (first error aborts)"
pass restore "decrypted dump restored with --exit-on-error --single-transaction"

# 6 — compare table set and exact row counts
psql "$LOCAL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" \
  | sort -u > "$WORK/restored-tables.txt" || fail compare "cannot list restored tables"
cmp -s "$WORK/expected-tables.txt" "$WORK/restored-tables.txt" || fail compare "restored table set differs from snapshot"
BAD=0
while read -r t; do
  want=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tables"][sys.argv[2]])' "$COUNTS" "$t")
  got=$(psql "$LOCAL" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"${t//\"/\"\"}\"") || fail compare "count query failed"
  [[ "$got" =~ ^[0-9]+$ ]] || fail compare "non-numeric count"
  [ "$got" = "$want" ] || BAD=$((BAD + 1))
done < "$WORK/expected-tables.txt"
[ "$BAD" -eq 0 ] || fail compare "${BAD} table(s) with row-count mismatch"
pass compare "${EXPECTED_N}/${EXPECTED_N} tables · every row count equal"
echo "BACKUP-GUARD RESULT PASS"
