#!/usr/bin/env python3
"""
M3-07 Runbook Drill — Audit event append/read via the service API.

Reads WASLA_SERVICE_AUTH_KEYS and WASLA_SERVICE_AUTH_ACTIVE_KID from the
wasla-audit Render service, mints a wsvc3 service-auth token locally,
then POSTs an audit event and GETs it back. Secrets are never printed.
"""
import urllib.request, urllib.error, json, hmac, hashlib, base64, time, os, sys

RENDER_API_KEY = os.environ.get("RENDER_API_KEY", "")
AUDIT_SERVICE_ID = "srv-daprrq0u01pc73do9npg"
AUDIT_BASE_URL = "https://wasla-audit.onrender.com"

def get_render_env_vars(service_id, keys_needed):
    """Fetch only the named env vars from Render. Returns dict of key->value."""
    url = f"https://api.render.com/v1/services/{service_id}/env-vars"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    result = {}
    if isinstance(data, list):
        for item in data:
            ev = item.get("envVar", {})
            key = ev.get("key", "")
            if key in keys_needed:
                result[key] = ev.get("value", "")
    return result

def parse_service_auth_keys(raw):
    """Parse WASLA_SERVICE_AUTH_KEYS format: k1:active:<secret>,k2:verify_only:<secret>"""
    keys = {}
    active_kid = None
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        segments = part.split(":", 2)
        if len(segments) != 3:
            continue
        kid, status, secret = segments
        keys[kid] = {"status": status, "secret": secret}
        if status == "active":
            active_kid = kid
    return keys, active_kid

def base64url_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def base64url_decode(s):
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)

def canonical_request_binding(method, path):
    """Canonicalize: METHOD uppercase, path trimmed, query sorted."""
    upper = method.strip().upper()
    sep = path.find("?")
    if sep < 0:
        raw_path = path
        raw_query = ""
    else:
        raw_path = path[:sep]
        raw_query = path[sep+1:]
    trimmed = raw_path.rstrip("/") if len(raw_path) > 1 else raw_path
    if trimmed == "":
        trimmed = "/"
    if raw_query:
        from urllib.parse import parse_qsl, urlencode
        pairs = parse_qsl(raw_query, keep_blank_values=True)
        pairs.sort()
        query = urlencode(pairs)
        return f"{upper} {trimmed}?{query}"
    return f"{upper} {trimmed}"

def mint_service_token(service_name, audience, scopes, method, path, keys_registry, active_kid, ttl=60):
    """Mint a wsvc3 service-auth token."""
    now = int(time.time())
    jti = base64url_encode(os.urandom(16))
    
    binding = canonical_request_binding(method, path)
    
    payload = {
        "kid": active_kid,
        "svc": service_name,
        "aud": audience,
        "scp": list(scopes),
        "iat": now,
        "exp": now + ttl,
        "req": binding,
        "jti": jti,
    }
    
    encoded_payload = base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    
    active_key = keys_registry.get(active_kid, {})
    secret = active_key.get("secret", "")
    
    signing_input = f"wsvc3.{encoded_payload}"
    sig = hmac.new(secret.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256).digest()
    encoded_sig = base64url_encode(sig)
    
    return f"{signing_input}.{encoded_sig}"

def main():
    print("=== M3-07 Audit Event Drill ===\n")
    
    # Step 1: Get service-auth keys from Render
    print("[1/4] Reading service-auth env vars from Render (wasla-audit)...")
    env_vars = get_render_env_vars(AUDIT_SERVICE_ID, {"WASLA_SERVICE_AUTH_KEYS", "WASLA_SERVICE_AUTH_ACTIVE_KID"})
    
    if "WASLA_SERVICE_AUTH_KEYS" not in env_vars:
        print(f"ERROR: WASLA_SERVICE_AUTH_KEYS not found. Available keys: {list(env_vars.keys())}")
        sys.exit(1)
    
    keys_raw = env_vars["WASLA_SERVICE_AUTH_KEYS"]
    active_kid_env = env_vars.get("WASLA_SERVICE_AUTH_ACTIVE_KID", "")
    
    keys_registry, detected_active = parse_service_auth_keys(keys_raw)
    active_kid = active_kid_env or detected_active
    
    if not active_kid or active_kid not in keys_registry:
        print(f"ERROR: No active key found. Keys: {list(keys_registry.keys())}")
        sys.exit(1)
    
    print(f"  Keys found: {list(keys_registry.keys())}")
    print(f"  Active KID: {active_kid}")
    print(f"  Key statuses: { {k: v['status'] for k, v in keys_registry.items()} }")
    
    # Step 2: Mint a token for POST /audit/events
    print("\n[2/4] Minting service-auth token for POST /audit/events...")
    post_token = mint_service_token(
        service_name="audit",
        audience="audit",
        scopes=["audit:write"],
        method="POST",
        path="/audit/events",
        keys_registry=keys_registry,
        active_kid=active_kid,
    )
    print(f"  Token minted (first 20 chars): {post_token[:20]}...")
    
    # Step 3: POST an audit event
    print("\n[3/4] POSTing audit event...")
    event_payload = {
        "actor_id": "m3-07-drill",
        "actor_role": "system",
        "action": "runbook_drill",
        "resource_type": "operational",
        "resource_id": "m3-07",
        "metadata": {
            "drill": "supportable_operations",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "m3-07-runbook-drill"
        }
    }
    
    post_url = f"{AUDIT_BASE_URL}/audit/events"
    post_data = json.dumps(event_payload).encode("utf-8")
    post_req = urllib.request.Request(post_url, data=post_data, headers={
        "Content-Type": "application/json",
        "x-wasla-service-auth": post_token,
        "User-Agent": "WASLA-M3-07-Drill/1.0",
    }, method="POST")
    
    try:
        with urllib.request.urlopen(post_req, timeout=30) as resp:
            post_body = resp.read().decode("utf-8")
            print(f"  POST status: {resp.status}")
            print(f"  Response: {post_body[:500]}")
            post_result = json.loads(post_body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  POST FAILED: HTTP {e.code} - {body[:500]}")
        post_result = None
    except Exception as e:
        print(f"  POST ERROR: {e}")
        post_result = None
    
    # Step 4: GET audit events to read back
    print("\n[4/4] GETting audit events to verify...")
    get_path = "/audit/events?action=runbook_drill&limit=5"
    get_token = mint_service_token(
        service_name="audit",
        audience="audit",
        scopes=["audit:read"],
        method="GET",
        path=get_path,
        keys_registry=keys_registry,
        active_kid=active_kid,
    )
    
    get_url = f"{AUDIT_BASE_URL}{get_path}"
    get_req = urllib.request.Request(get_url, headers={
        "x-wasla-service-auth": get_token,
        "User-Agent": "WASLA-M3-07-Drill/1.0",
    }, method="GET")
    
    try:
        with urllib.request.urlopen(get_req, timeout=30) as resp:
            get_body = resp.read().decode("utf-8")
            print(f"  GET status: {resp.status}")
            result = json.loads(get_body)
            print(f"  Events found: {len(result.get('events', result.get('data', [])))}")
            events = result.get("events", result.get("data", []))
            for ev in events[:3]:
                print(f"    - type={ev.get('event_type','?')} | actor={ev.get('actor_public_id','?')} | resource={ev.get('resource_id','?')}")
            get_result = result
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  GET FAILED: HTTP {e.code} - {body[:500]}")
        get_result = None
    except Exception as e:
        print(f"  GET ERROR: {e}")
        get_result = None
    
    # Summary
    print("\n=== DRILL SUMMARY ===")
    post_ok = post_result is not None
    get_ok = get_result is not None
    print(f"Audit event POST: {'PASS' if post_ok else 'FAIL'}")
    print(f"Audit event GET:  {'PASS' if get_ok else 'FAIL'}")
    print(f"DB edits required: NONE (append-only via API)")
    
    # Save results
    output = {
        "drill": "audit_event_append_read",
        "post_status": "PASS" if post_ok else "FAIL",
        "get_status": "PASS" if get_ok else "FAIL",
        "post_response": post_result,
        "get_response": get_result,
        "keys_found": list(keys_registry.keys()),
        "active_kid": active_kid,
        "db_edits_required": False,
    }
    with open("/home/user/workspace/m3-07-audit-drill.json", "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults saved to m3-07-audit-drill.json")

if __name__ == "__main__":
    from datetime import datetime, timezone
    main()
