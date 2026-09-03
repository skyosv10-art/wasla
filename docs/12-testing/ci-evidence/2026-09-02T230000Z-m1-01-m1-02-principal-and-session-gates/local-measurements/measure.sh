#!/usr/bin/env bash
# قياسُ بوّابتَي M1-01 و M1-02 بالطفرةِ لا بقراءةِ الشفرة.
#
# القاعدةُ: كلُّ جولةٍ **طفرةٌ واحدةٌ** ثمّ **استعادةٌ فوريّةٌ** للملفِّ قبلَ
# الجولةِ التالية. ولا يُلتزَم شيءٌ إلّا وشجرةُ الشفرةِ نظيفةٌ — يُتحقَّق منه
# بـ`git diff --stat` في آخرِ السطر.
#
# التشغيل: bash docs/12-testing/ci-evidence/<هذا المجلَّد>/local-measurements/measure.sh
# من جذرِ المستودعِ بعدَ `pnpm install --frozen-lockfile`.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SCOPE=(--filter ./packages/auth-sdk --filter ./packages/telegram-adapter --filter ./services/identity)

run_suite() { # $1 = اسمُ ملفِّ الخرج
  pnpm "${SCOPE[@]}" test >"$OUT/$1" 2>&1
  echo "exit_code=$?" >>"$OUT/$1"
}

mutate() { # $1 = الملفّ · $2 = النصُّ القديم · $3 = النصُّ الجديد
  python3 - "$1" "$2" "$3" <<'PY'
import sys, pathlib
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
text = p.read_text(encoding="utf-8")
count = text.count(old)
if count != 1:
    sys.exit(f"MUTATION TARGET NOT UNIQUE in {path}: found {count}")
p.write_text(text.replace(old, new), encoding="utf-8")
PY
}

restore() { git checkout -- "$1"; }

round() { # $1 = المعرّف · $2 = الملفّ · $3 = القديم · $4 = الجديد
  echo "=== $1"
  mutate "$2" "$3" "$4" || { echo "SKIP $1 — target not unique"; return 1; }
  run_suite "$1.raw.txt"
  restore "$2"
}

# ─────────────────────────── الأساسُ النظيف ───────────────────────────
git diff --stat >"$OUT/tree-before.raw.txt"
run_suite "base.raw.txt"

AUTHZ=packages/auth-sdk/src/authorize.ts
DESC=packages/auth-sdk/src/describe.ts
PARSE=packages/auth-sdk/src/parse.ts
INIT=packages/telegram-adapter/src/init-data.ts
SESSD=services/identity/src/domain/session.ts
SESSU=services/identity/src/use-cases/session.ts

# ─────────────────────────── M1-01 · أربعُ طفراتٍ ───────────────────────────
round mut-m1-01a "$AUTHZ" \
  'return Date.parse(principal.expiresAt) < now.getTime();' \
  'return Date.parse(principal.expiresAt) <= now.getTime();'

round mut-m1-01b "$DESC" \
  '        publicId: principal.waslaPublicId,
        scopeCount: principal.scopes.length,' \
  '        publicId: principal.waslaPublicId,
        internalUuid: principal.internalUuid,
        scopeCount: principal.scopes.length,'

round mut-m1-01c "$PARSE" \
  '      if (reason !== "no_credentials" && reason !== "unverified_credentials") {' \
  '      if (false) {'

round mut-m1-01d "$AUTHZ" \
  '  if (isAnonymousPrincipal(principal)) {
    throw new AuthenticationError(
      AuthErrorCode.UNAUTHENTICATED,' \
  '  if (false) {
    throw new AuthenticationError(
      AuthErrorCode.UNAUTHENTICATED,'

# ─────────────────────────── M1-02 · ستُّ طفراتٍ ───────────────────────────
round mut-m1-02a "$INIT" \
  '  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);' \
  '  if (a.length !== b.length) return false;
  return true;'

round mut-m1-02b "$INIT" \
  '  if (ageSeconds > maxAge) throw new InitDataError(InitDataRejection.Expired);' \
  '  if (ageSeconds >= maxAge) throw new InitDataError(InitDataRejection.Expired);'

round mut-m1-02c "$INIT" \
  '  if (ageSeconds < -skew) throw new InitDataError(InitDataRejection.FromTheFuture);' \
  '  if (false) throw new InitDataError(InitDataRejection.FromTheFuture);'

round mut-m1-02d "$INIT" \
  '    if (out.has(key)) throw new InitDataError(InitDataRejection.Malformed);' \
  '    if (false) throw new InitDataError(InitDataRejection.Malformed);'

round mut-m1-02e "$SESSD" \
  '  if (session.revokedAt !== null) return SessionInvalidity.Revoked;' \
  '  if (now.getTime() >= Date.parse(session.expiresAt)) return SessionInvalidity.Expired;
  if (session.revokedAt !== null) return SessionInvalidity.Revoked;'

round mut-m1-02f "$SESSD" \
  '  if (now.getTime() >= Date.parse(session.expiresAt)) return SessionInvalidity.Expired;
  return null;' \
  '  if (now.getTime() > Date.parse(session.expiresAt)) return SessionInvalidity.Expired;
  return null;'

round mut-m1-02g "$SESSU" \
  '  if (!/^[0-9a-f]{64}$/.test(request.initDataFingerprint)) {' \
  '  if (false) {'

# ─────────────────────── الشجرةُ بعدَ القياسِ يجب أن تكون نظيفةً ───────────────────────
git diff --stat -- packages services >"$OUT/tree-after.raw.txt"
echo "--- tree-after ---"
cat "$OUT/tree-after.raw.txt"
