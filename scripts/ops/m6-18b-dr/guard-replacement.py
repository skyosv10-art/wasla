#!/usr/bin/env python3
"""M6-18B · CLM-0436: target guard for the replacement-project restore.

Reads DR_REPLACEMENT_DB_URL and prints only the project ref, the host class and the
port. It never prints the password, the user string or the URL.

The guard refuses:
  - any ref other than the replacement project REPLACEMENT_REF;
  - the production ref, the retired production ref and the TEST ref, by name, even
    when they appear anywhere in the URL;
  - the transaction pooler (port 6543), because pg_restore --single-transaction needs a
    session.
"""
import os
import sys
from urllib.parse import unquote, urlsplit

# The replacement project created for the DR drill (CLM-0436, 2026-10-02, free plan, $0).
REPLACEMENT_REF = "pvyuhjadrygqqdoczmnd"
# Never restore into these projects.
FORBIDDEN_REFS = {
    "ppixaauyqoykrogwdxtv": "production",
    "snlpxywskyqrjattbpgn": "retired production",
    "obeptvwpvqbduwkahorq": "TEST",
}

url = os.environ.get("DR_REPLACEMENT_DB_URL", "")
if not url:
    print("::error::DR_REPLACEMENT_DB_URL is empty")
    sys.exit(2)
p = urlsplit(url)
if os.environ.get("GITHUB_ACTIONS") and p.password:
    print(f"::add-mask::{unquote(p.password)}")
    print(f"::add-mask::{p.password}")
for ref, label in FORBIDDEN_REFS.items():
    if ref in url.lower():
        print(f"::error::the URL names the {label} project — refusing")
        sys.exit(1)
host = (p.hostname or "").lower()
user = unquote(p.username or "")
port = p.port or 5432
if port == 6543:
    print("::error::transaction pooler (6543) — a single-transaction restore needs a session; refusing")
    sys.exit(1)
ref = None
if "." in user and host.endswith(".pooler.supabase.com"):
    ref = user.rsplit(".", 1)[1] or None
elif host.startswith("db.") and host.endswith(".supabase.co"):
    ref = host[3:-len(".supabase.co")]
if ref != REPLACEMENT_REF:
    print(f"::error::project ref is {ref!r}, expected the replacement {REPLACEMENT_REF} — refusing")
    sys.exit(1)
host_class = "supavisor-session" if host.endswith(".pooler.supabase.com") else "direct"
print(f"target replacement · project ref {ref} · host {host_class} · port {port}")
