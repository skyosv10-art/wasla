#!/usr/bin/env bash
# db-backup · CLM-0415 · RISK-0055 — one backup, fail-closed from the first
# byte to the uploaded ciphertext.
#
# Usage: bash scripts/ops/db-backup/backup.sh <out_dir>
# Env:   BACKUP_SOURCE_DB_URL  source database (never printed)
#        BACKUP_PASSPHRASE     GPG symmetric passphrase (never printed)
#        RESTORE_PORT          scratch postgres:17 port (default 15434)
#
# The SAME script is what the scheduled production workflow (db-backup.yml)
# and the TEST-only proof (db-backup-proof.yml) run, so the proof exercises
# the production code path, not a copy of it.
#
# Why it replaces the steps in db-backup.yml at bc5de79 (defects measured in
# CLM-0413 r2 §3.1, confirmed by scheduled run 36663646254):
#   (a) manifest read RESTORE_ALL_MATCH / RESTORE_DURATION / RESTORED_TABLES
#       but the step wrote lower-case keys → always false / 0 / 0.
#   (b)(c) row- and table-count mismatches were warnings, the job passed.
#   (d) `pg_restore … || true` swallowed every restore error.
#   (e) `… 2>/dev/null || echo ERROR` on both sides → ERROR = ERROR "match".
#   (f) source rows were counted from the live DB after the dump.
#   (g) `skip_restore_test` input skipped verification entirely.
# Here: counts and dump come from ONE exported snapshot (snapshot-dump.mjs);
# the ciphertext that is uploaded is decrypted back and byte-compared; the
# decrypted bytes are what gets restored (--exit-on-error --single-transaction)
# and compared table-by-table (verify-backup.sh). Any failure → exit ≠ 0 and
# no manifest, no artifact. There is no "warning" outcome and no skip switch.
#
# Scope (declared, not hidden): the dump is the full database (all schemas);
# the restore proof covers schema `public` — the one the 14 services write.
# Supabase platform schemas (auth, storage, vault, …) cannot be restored into
# vanilla postgres and are NOT verified here.
set -euo pipefail

OUT="${1:?out dir}"
: "${BACKUP_SOURCE_DB_URL:?BACKUP_SOURCE_DB_URL is required}"
[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "::error::BACKUP_PASSPHRASE is empty — refusing"; exit 1; }

TS=$(date -u +%Y%m%dT%H%M%SZ)
WORK="$OUT/work"
DUMP="$WORK/wasla-db-${TS}.dump"
COUNTS="$WORK/counts.json"
ENC="$OUT/wasla-db-${TS}.dump.gpg"
BACK="$WORK/from-artifact.dump"
mkdir -p "$WORK"
# The unencrypted dump never outlives this script, pass or fail.
trap 'rm -rf "$WORK"' EXIT

ms() { date +%s%3N; }

# 1 — dump + exact counts from one snapshot (read only on the source)
t0=$(ms)
node scripts/ops/risk-0056/snapshot-dump.mjs "$DUMP" "$COUNTS"
t1=$(ms)

# encrypt → this is the file that will be uploaded
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --compress-algo none --output "$ENC" "$DUMP" 2>/dev/null \
  || { echo "BACKUP FAIL stage=encrypt"; exit 1; }
t2=$(ms)

# decrypt the UPLOAD file itself and require identical bytes
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt --output "$BACK" "$ENC" 2>/dev/null \
  || { echo "BACKUP FAIL stage=artifact-decrypt"; exit 1; }
cmp -s "$DUMP" "$BACK" || { echo "BACKUP FAIL stage=artifact-decrypt · bytes differ"; exit 1; }
echo "BACKUP PASS stage=artifact-decrypt · uploaded ciphertext decrypts to the dump byte-for-byte"

# 2–6 — restore the bytes recovered from the artifact and compare exactly
t3=$(ms)
bash scripts/ops/risk-0056/verify-backup.sh "$BACK" "$COUNTS" "$WORK/verify"
t4=$(ms)

python3 - "$COUNTS" "$ENC" "$DUMP" "$TS" "$t0" "$t1" "$t2" "$t3" "$t4" "$OUT/backup-manifest.json" <<'PY'
import hashlib, json, os, sys
counts_f, enc, dump, ts, t0, t1, t2, t3, t4, out = sys.argv[1:]
t0, t1, t2, t3, t4 = map(int, (t0, t1, t2, t3, t4))
c = json.load(open(counts_f))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
m = {
    "timestamp": ts,
    "dump_file": os.path.basename(dump),
    "dump_size_bytes": os.path.getsize(dump),
    "dump_sha256": sha(dump),
    "encrypted_file": os.path.basename(enc),
    "encrypted_size_bytes": os.path.getsize(enc),
    "encrypted_sha256": sha(enc),
    "snapshot_consistent": True,
    "verified_schema": "public",
    "public_tables": len(c["tables"]),
    "public_rows_total": sum(int(v) for v in c["tables"].values()),
    "public_extensions": c["public_extensions"],
    "restore_all_match": True,
    "guard": "PASS — every stage (nonempty, list, gpg, restore, compare) and artifact-decrypt",
    "dump_seconds": round((t1 - t0) / 1000, 1),
    "encrypt_seconds": round((t2 - t1) / 1000, 1),
    "verify_restore_seconds": round((t4 - t3) / 1000, 1),
    "not_verified": "non-public schemas (Supabase auth/storage/vault) are in the dump but not restore-tested",
    "rpo_note": "Scheduled every 6 h — holds only if every scheduled run succeeds. Not PITR.",
    "rto_note": "verify_restore_seconds is a runner-local restore of schema public; production RTO is not measured here.",
}
json.dump(m, open(out, "w"), indent=2)
print(json.dumps({k: m[k] for k in ("public_tables", "public_rows_total", "restore_all_match", "dump_seconds", "verify_restore_seconds")}))
PY

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "encrypted_file=$ENC"; echo "timestamp=$TS"; } >> "$GITHUB_OUTPUT"
fi
echo "BACKUP RESULT PASS · ${ENC##*/}"
