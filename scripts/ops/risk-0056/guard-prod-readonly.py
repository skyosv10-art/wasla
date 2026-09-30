#!/usr/bin/env python3
"""RISK-0056 · CLM-0411 — confirm the preflight targets the PRODUCTION project
(read-only run). Reads SNAPSHOT_DB_URL; masks the password in GitHub Actions;
prints ONLY the Supabase project ref and host class. Exits non-zero if the URL
is empty or the derived ref is not the expected production ref.
"""
import os
import sys
from urllib.parse import unquote, urlsplit

EXPECTED_PRODUCTION_REF = "snlpxywskyqrjattbpgn"  # already public in this repository

url = os.environ.get("SNAPSHOT_DB_URL", "")
if not url:
    print("::error::SNAPSHOT_DB_URL is empty — SUPABASE_DB_URL secret missing")
    sys.exit(2)
parts = urlsplit(url)
if os.environ.get("GITHUB_ACTIONS") and parts.password:
    print(f"::add-mask::{unquote(parts.password)}")
    print(f"::add-mask::{parts.password}")
user = unquote(parts.username or "")
host = (parts.hostname or "").lower()
ref = user.split(".", 1)[1] if user.startswith("postgres.") else (host[3:-len(".supabase.co")] if host.startswith("db.") and host.endswith(".supabase.co") else None)
if ref != EXPECTED_PRODUCTION_REF:
    print("::error::derived project ref is not the expected production ref — refusing (wrong secret?)")
    sys.exit(1)
host_class = "session-pooler" if host.endswith(".pooler.supabase.com") else ("direct" if host.endswith(".supabase.co") else "other")
print(f"production project ref: {ref}")
print(f"host class: {host_class} · port: {parts.port or 5432}")
