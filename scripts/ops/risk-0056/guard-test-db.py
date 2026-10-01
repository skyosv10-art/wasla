#!/usr/bin/env python3
"""RISK-0056 · CLM-0410 — refuse to run against anything but the TEST database.

Reads RISK0056_DB_URL from the environment. Prints ONLY the Supabase project
ref (the owner asked for it) and the host class; never the password, the user
string, or the full URL. Exits non-zero when:
  * the URL is missing or unparsable,
  * the project ref cannot be derived,
  * the URL mentions the production project ref anywhere.
In GitHub Actions the password and the full URL are additionally masked.
"""
import os
import sys
from urllib.parse import urlsplit, unquote

PRODUCTION_REFS = {"ppixaauyqoykrogwdxtv", "snlpxywskyqrjattbpgn"}  # current + retired production (CLM-0429)

url = os.environ.get("RISK0056_DB_URL", "")
if not url:
    print("::error::RISK0056_DB_URL is empty — SUPABASE_TEST_DB_URL secret missing")
    sys.exit(2)

parts = urlsplit(url)
in_actions = bool(os.environ.get("GITHUB_ACTIONS"))
if in_actions and parts.password:
    print(f"::add-mask::{unquote(parts.password)}")
    print(f"::add-mask::{parts.password}")

lowered = url.lower()
for ref in PRODUCTION_REFS:
    if ref in lowered:
        print("::error::connection string points at the PRODUCTION project — refusing to continue")
        sys.exit(1)

user = unquote(parts.username or "")
host = (parts.hostname or "").lower()
ref = None
if "." in user and host.endswith(".pooler.supabase.com"):
    ref = user.rsplit(".", 1)[1] or None  # Supavisor user form: <role>.<project_ref>
elif user.startswith("postgres.") and len(user) > len("postgres."):
    ref = user.split(".", 1)[1]
elif host.startswith("db.") and host.endswith(".supabase.co"):
    ref = host[3:-len(".supabase.co")]
if not ref:
    print("::error::cannot derive a Supabase project ref from the test URL — refusing (guard needs a ref to compare)")
    sys.exit(1)
if ref in PRODUCTION_REFS:
    print("::error::project ref equals PRODUCTION — refusing to continue")
    sys.exit(1)

host_class = "session-pooler" if host.endswith(".pooler.supabase.com") else ("direct" if host.endswith(".supabase.co") else "other")
print(f"test project ref: {ref}")
print(f"host class: {host_class} · port: {parts.port or 5432} · database: {parts.path.lstrip('/') or 'postgres'}")
print(f"production refs denied: {len(PRODUCTION_REFS)} · match: none")
out = os.environ.get("GITHUB_OUTPUT")
if out:
    with open(out, "a", encoding="utf-8") as fh:
        fh.write(f"project_ref={ref}\nhost_class={host_class}\n")
