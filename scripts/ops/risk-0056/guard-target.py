#!/usr/bin/env python3
"""RISK-0056 · CLM-0420 — target guard for apply.sh. Prints the project ref and
host class only; never the password, user string or URL.

  local       host must be 127.0.0.1/localhost/::1 (fresh CI PostgreSQL); a Supabase host is refused.
  test        project ref must NOT be production (guard-test-db.py runs first too).
  production  project ref MUST be the production ref — a TEST URL in the production
              environment is refused as firmly as the reverse.
All targets: the transaction pooler (port 6543) is refused, because a session-level
SET lock_timeout is not pinned there.
"""
import os
import sys
from urllib.parse import unquote, urlsplit

PRODUCTION_REF = "snlpxywskyqrjattbpgn"  # already public in this repository
TEST_REF = "obeptvwpvqbduwkahorq"

target = sys.argv[1] if len(sys.argv) > 1 else ""
url = os.environ.get("RISK0056_DB_URL", "")
if not url:
    print("::error::RISK0056_DB_URL is empty"); sys.exit(2)
p = urlsplit(url)
if os.environ.get("GITHUB_ACTIONS") and p.password:
    print(f"::add-mask::{unquote(p.password)}"); print(f"::add-mask::{p.password}")
host = (p.hostname or "").lower()
user = unquote(p.username or "")
port = p.port or 5432
if port == 6543:
    print("::error::transaction pooler (6543) — session-level SET is not pinned there; refusing"); sys.exit(1)
ref = None
if user.startswith("postgres.") and len(user) > 9:
    ref = user.split(".", 1)[1]
elif host.startswith("db.") and host.endswith(".supabase.co"):
    ref = host[3:-len(".supabase.co")]

if target == "local":
    if host not in ("127.0.0.1", "localhost", "::1") or "supabase" in url.lower():
        print("::error::target=local requires a loopback PostgreSQL"); sys.exit(1)
    print(f"target local · port {port}")
elif target == "test":
    if ref is None or ref == PRODUCTION_REF or PRODUCTION_REF in url.lower():
        print("::error::target=test refused (no ref, or production ref)"); sys.exit(1)
    print(f"target test · project ref {ref} · port {port}")
elif target == "production":
    if ref != PRODUCTION_REF:
        print(f"::error::target=production but project ref is {ref!r} — refusing (wrong secret in the environment?)"); sys.exit(1)
    print(f"target production · project ref {ref} · port {port}")
else:
    print(f"::error::unknown target {target!r}"); sys.exit(2)
