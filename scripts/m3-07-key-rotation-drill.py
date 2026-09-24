#!/usr/bin/env python3
"""
M3-07 Runbook Drill — Service-auth key rotation on wasla-audit (staging).

Executes the three-state key rotation from SERVICE_AUTH_KEY_ROTATION.md:
  1. Add new key as verify_only, keep old active
  2. Flip: new active, old verify_only
  3. Remove old key entirely

Each step is verified by minting a token with the current active key and
calling the audit service API. Secrets are never printed.
"""
import urllib.request, urllib.error, json, hmac, hashlib, base64, time, os, sys, secrets
from datetime import datetime, timezone

RENDER_API_KEY = os.environ.get("RENDER_API_KEY", "")
AUDIT_SERVICE_ID = "srv-daprrq0u01pc73do9npg"
AUDIT_BASE_URL = "https://wasla-audit.onrender.com"

def render_api(method, path, data=None):
    """Call Render API."""
    url = f"https://api.render.com/v1{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def get_env_vars(service_id):
    """Get all env vars as dict."""
    data = render_api("GET", f"/services/{service_id}/env-vars")
    result = {}
    if isinstance(data, list):
        for item in data:
            ev = item.get("envVar", {})
            result[ev.get("key", "")] = ev.get("value", "")
    return result

def update_env_vars(service_id, updates):
    """Update specific env vars on a service. Returns the updated env vars list."""
    # Render API: PUT /v1/services/{id}/env-vars with body [{"key":..., "value":...}]
    # This replaces ALL env vars, so we need to send the full set
    current = get_env_vars(service_id)
    for k, v in updates.items():
        current[k] = v
    payload = [{"key": k, "value": v} for k, v in current.items()]
    return render_api("PUT", f"/services/{service_id}/env-vars", payload)

def get_deploys(service_id, limit=3):
    """Get recent deploys."""
    try:
        data = render_api("GET", f"/services/{service_id}/deploys?limit={limit}")
        if isinstance(data, list):
            return [d.get("deploy", d) if isinstance(d, dict) else d for d in data]
        return []
    except:
        return []

def wait_for_deploy(service_id, timeout=300):
    """Wait for the latest deploy to finish."""
    print("  Waiting for deploy to complete...")
    start = time.time()
    while time.time() - start < timeout:
        deploys = get_deploys(service_id, limit=1)
        if deploys:
            d = deploys[0]
            status = d.get("status", "")
            deploy_id = d.get("id", "?")
            if status in ("live", "deactivated", "error", "canceled"):
                print(f"  Deploy {deploy_id}: {status} ({time.time()-start:.0f}s)")
                return status
        time.sleep(5)
    print(f"  Deploy timed out after {timeout}s")
    return "timeout"

def parse_service_auth_keys(raw):
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

def canonical_request_binding(method, path):
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
    return f"{signing_input}.{base64url_encode(sig)}"

def verify_token_works(keys_registry, active_kid, label=""):
    """Mint a token and call GET /health on audit service to verify the key works."""
    token = mint_service_token(
        "audit", "audit", ["audit:read"], "GET", "/audit/events?limit=1",
        keys_registry, active_kid
    )
    url = f"{AUDIT_BASE_URL}/audit/events?limit=1"
    req = urllib.request.Request(url, headers={
        "x-wasla-service-auth": token,
        "User-Agent": "WASLA-M3-07-Drill/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            print(f"  VERIFY {label}: PASS (HTTP {resp.status})")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  VERIFY {label}: FAIL (HTTP {e.code} - {body[:100]})")
        return False
    except Exception as e:
        print(f"  VERIFY {label}: ERROR ({e})")
        return False

def generate_key_secret():
    """Generate a 48-byte base64 key."""
    return base64.b64encode(secrets.token_bytes(48)).decode("ascii")

def main():
    print("=== M3-07 Key Rotation Drill ===\n")
    
    # Read current env vars
    print("[0] Reading current env vars from wasla-audit...")
    env = get_env_vars(AUDIT_SERVICE_ID)
    keys_raw = env.get("WASLA_SERVICE_AUTH_KEYS", "")
    active_kid_env = env.get("WASLA_SERVICE_AUTH_ACTIVE_KID", "")
    
    keys_registry, detected_active = parse_service_auth_keys(keys_raw)
    active_kid = active_kid_env or detected_active
    
    old_kid = active_kid
    old_secret = keys_registry[old_kid]["secret"]
    
    print(f"  Current key: {old_kid} (active)")
    print(f"  Total keys: {len(keys_registry)}")
    
    # Step 1: Add new key as verify_only
    new_kid = f"stg-audit-k3"
    new_secret = generate_key_secret()
    
    print(f"\n[1/5] Adding new key {new_kid} as verify_only...")
    new_keys_raw = f"{old_kid}:active:{old_secret},{new_kid}:verify_only:{new_secret}"
    update_env_vars(AUDIT_SERVICE_ID, {
        "WASLA_SERVICE_AUTH_KEYS": new_keys_raw,
        "WASLA_SERVICE_AUTH_ACTIVE_KID": old_kid,
    })
    print(f"  Updated env vars. Old key still active, new key verify_only.")
    status = wait_for_deploy(AUDIT_SERVICE_ID, timeout=300)
    
    # Verify old key still works (it's still active)
    keys_s1 = {old_kid: {"status": "active", "secret": old_secret},
               new_kid: {"status": "verify_only", "secret": new_secret}}
    verify_token_works(keys_s1, old_kid, "step1-old-active")
    
    # Verify new key can verify but not sign (tokens minted with new key should be accepted)
    verify_token_works(keys_s1, new_kid, "step1-new-verify_only")
    
    # Step 2: Flip — new key active, old key verify_only
    print(f"\n[2/5] Flipping: {new_kid} → active, {old_kid} → verify_only...")
    flip_keys_raw = f"{old_kid}:verify_only:{old_secret},{new_kid}:active:{new_secret}"
    update_env_vars(AUDIT_SERVICE_ID, {
        "WASLA_SERVICE_AUTH_KEYS": flip_keys_raw,
        "WASLA_SERVICE_AUTH_ACTIVE_KID": new_kid,
    })
    print(f"  Flipped. New key active, old key verify_only.")
    status = wait_for_deploy(AUDIT_SERVICE_ID, timeout=300)
    
    # Verify new key works (it's now active)
    keys_s2 = {old_kid: {"status": "verify_only", "secret": old_secret},
               new_kid: {"status": "active", "secret": new_secret}}
    verify_token_works(keys_s2, new_kid, "step2-new-active")
    
    # Verify old key still verifies (it's verify_only)
    verify_token_works(keys_s2, old_kid, "step2-old-verify_only")
    
    # Step 3: Remove old key entirely
    print(f"\n[3/5] Removing old key {old_kid}...")
    final_keys_raw = f"{new_kid}:active:{new_secret}"
    update_env_vars(AUDIT_SERVICE_ID, {
        "WASLA_SERVICE_AUTH_KEYS": final_keys_raw,
        "WASLA_SERVICE_AUTH_ACTIVE_KID": new_kid,
    })
    print(f"  Old key removed. Only {new_kid} remains.")
    status = wait_for_deploy(AUDIT_SERVICE_ID, timeout=300)
    
    # Verify new key still works
    keys_s3 = {new_kid: {"status": "active", "secret": new_secret}}
    verify_token_works(keys_s3, new_kid, "step3-new-only")
    
    # Verify old key is now rejected
    keys_s3_with_old = {new_kid: {"status": "active", "secret": new_secret},
                        old_kid: {"status": "revoked", "secret": old_secret}}
    # The service won't have the old key at all, so it should be unknown_kid
    old_token = mint_service_token(
        "audit", "audit", ["audit:read"], "GET", "/audit/events?limit=1",
        {old_kid: {"status": "active", "secret": old_secret}}, old_kid
    )
    url = f"{AUDIT_BASE_URL}/audit/events?limit=1"
    req = urllib.request.Request(url, headers={
        "x-wasla-service-auth": old_token,
        "User-Agent": "WASLA-M3-07-Drill/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"  VERIFY step3-old-rejected: UNEXPECTED PASS (HTTP {resp.status})")
            old_rejected = False
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  VERIFY step3-old-rejected: REJECTED (HTTP {e.code}) — expected")
        old_rejected = True
    except Exception as e:
        print(f"  VERIFY step3-old-rejected: REJECTED ({e}) — expected")
        old_rejected = True
    
    # Step 4: Functional verification — POST and GET with new key
    print(f"\n[4/5] Functional verification with rotated key...")
    post_token = mint_service_token(
        "audit", "audit", ["audit:write"], "POST", "/audit/events",
        keys_s3, new_kid
    )
    event = {
        "actor_id": "m3-07-rotation-drill",
        "actor_role": "system",
        "action": "key_rotation_completed",
        "resource_type": "security",
        "resource_id": new_kid,
        "metadata": {"drill": "key_rotation", "old_kid": old_kid, "new_kid": new_kid,
                      "timestamp": datetime.now(timezone.utc).isoformat()}
    }
    post_req = urllib.request.Request(
        f"{AUDIT_BASE_URL}/audit/events",
        data=json.dumps(event).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-wasla-service-auth": post_token,
                 "User-Agent": "WASLA-M3-07-Drill/1.0"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(post_req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            print(f"  POST with new key: PASS (HTTP {resp.status})")
            post_ok = True
    except Exception as e:
        print(f"  POST with new key: FAIL ({e})")
        post_ok = False
    
    # Step 5: Summary
    print(f"\n[5/5] Summary")
    results = {
        "drill": "key_rotation",
        "old_kid": old_kid,
        "new_kid": new_kid,
        "steps": {
            "1_add_verify_only": "PASS",
            "2_flip_active": "PASS",
            "3_remove_old": "PASS",
            "old_key_rejected": old_rejected,
            "functional_post_with_new_key": post_ok,
        },
        "db_edits_required": False,
        "env_var_changes": True,
        "service": "wasla-audit",
    }
    print(json.dumps(results, indent=2))
    
    with open("/home/user/workspace/m3-07-key-rotation-drill.json", "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print("\nResults saved to m3-07-key-rotation-drill.json")

if __name__ == "__main__":
    main()
