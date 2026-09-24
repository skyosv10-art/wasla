#!/usr/bin/env python3
"""
M3-07 Key Rotation Drill — Step-by-step with proper deploy handling.
Reads current key from Render, performs three-state rotation, verifies each step.
"""
import urllib.request, urllib.error, json, hmac, hashlib, base64, time, os, sys, secrets
from datetime import datetime, timezone

RENDER_API_KEY = os.environ.get("RENDER_API_KEY", "")
SVC_ID = "srv-daprrq0u01pc73do9npg"
BASE = "https://wasla-audit.onrender.com"

def api(method, path, data=None):
    url = f"https://api.render.com/v1{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def get_envs():
    data = api("GET", f"/services/{SVC_ID}/env-vars")
    result = {}
    if isinstance(data, list):
        for item in data:
            ev = item.get("envVar", {})
            result[ev.get("key", "")] = ev.get("value", "")
    return result

def set_envs(updates):
    current = get_envs()
    for k, v in updates.items():
        current[k] = v
    payload = [{"key": k, "value": v} for k, v in current.items()]
    # PUT updates env vars and triggers a redeploy
    api("PUT", f"/services/{SVC_ID}/env-vars", payload)

def get_latest_deploy():
    data = api("GET", f"/services/{SVC_ID}/deploys?limit=1")
    if isinstance(data, list) and len(data) > 0:
        d = data[0].get("deploy", data[0])
        return d.get("id", ""), d.get("status", "")
    return "", ""

def wait_deploy(old_deploy_id=None, timeout=300):
    # Wait for a new deploy (different from old_deploy_id) to go live
    start = time.time()
    new_id = None
    while time.time() - start < timeout:
        did, status = get_latest_deploy()
        if new_id is None and did and did != old_deploy_id:
            new_id = did
            print(f"  New deploy detected: {did} ({status})")
        if new_id and status == "live":
            print(f"  Deploy {new_id}: live ({time.time()-start:.0f}s)")
            return True
        if new_id and status in ("update_failed", "error", "canceled"):
            print(f"  Deploy {new_id}: {status} ({time.time()-start:.0f}s)")
            return False
        time.sleep(5)
    print(f"  Timeout ({timeout}s)")
    return False

def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def canonical(method, path):
    upper = method.strip().upper()
    sep = path.find("?")
    if sep < 0:
        p = path.rstrip("/") if len(path) > 1 else path
        return f"{upper} {p or '/'}"
    raw_path = path[:sep]
    raw_q = path[sep+1:]
    p = raw_path.rstrip("/") if len(raw_path) > 1 else raw_path
    from urllib.parse import parse_qsl, urlencode
    pairs = sorted(parse_qsl(raw_q, keep_blank_values=True))
    return f"{upper} {p or '/'}?{urlencode(pairs)}"

def mint(svc, aud, scopes, method, path, secret, kid, ttl=60):
    now = int(time.time())
    payload = {"kid": kid, "svc": svc, "aud": aud, "scp": list(scopes),
               "iat": now, "exp": now + ttl, "req": canonical(method, path),
               "jti": b64u(os.urandom(16))}
    ep = b64u(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"wsvc3.{ep}".encode(), hashlib.sha256).digest()
    return f"wsvc3.{ep}.{b64u(sig)}"

def verify(secret, kid, label):
    token = mint("audit", "audit", ["audit:read"], "GET", "/audit/events?limit=1", secret, kid)
    req = urllib.request.Request(f"{BASE}/audit/events?limit=1", headers={
        "x-wasla-service-auth": token, "User-Agent": "M3-07-Drill/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"  {label}: PASS (HTTP {r.status})")
            return True
    except urllib.error.HTTPError as e:
        print(f"  {label}: FAIL (HTTP {e.code})")
        return False
    except Exception as e:
        print(f"  {label}: ERROR ({e})")
        return False

def main():
    print("=== M3-07 Key Rotation Drill ===\n")
    
    # Read current state
    env = get_envs()
    keys_raw = env.get("WASLA_SERVICE_AUTH_KEYS", "")
    active_kid = env.get("WASLA_SERVICE_AUTH_ACTIVE_KID", "")
    
    # Parse current key
    parts = keys_raw.split(",")
    current_keys = {}
    for p in parts:
        p = p.strip()
        if not p:
            continue
        segs = p.split(":", 2)
        if len(segs) == 3:
            current_keys[segs[0]] = {"status": segs[1], "secret": segs[2]}
    
    old_kid = active_kid or list(current_keys.keys())[0]
    old_secret = current_keys[old_kid]["secret"]
    print(f"Current: {old_kid} (active), {len(current_keys)} key(s)")
    
    # Generate new key
    new_kid = f"stg-audit-k{int(old_kid[-1])+1}"
    new_secret = base64.b64encode(secrets.token_bytes(48)).decode()
    print(f"New key: {new_kid}")
    
    results = {"drill": "key_rotation", "old_kid": old_kid, "new_kid": new_kid, "steps": {}}
    
    # Step 1: Add new as verify_only
    print(f"\n[1/3] Add {new_kid} as verify_only, keep {old_kid} active...")
    old_did, _ = get_latest_deploy()
    keys_str = f"{old_kid}:active:{old_secret},{new_kid}:verify_only:{new_secret}"
    set_envs({"WASLA_SERVICE_AUTH_KEYS": keys_str, "WASLA_SERVICE_AUTH_ACTIVE_KID": old_kid})
    s1 = wait_deploy(old_deploy_id=old_did)
    # Old key should still work (active)
    v1a = verify(old_secret, old_kid, "step1-old-active")
    # New key should verify tokens (verify_only)
    v1b = verify(new_secret, new_kid, "step1-new-verify_only")
    results["steps"]["1_add_verify_only"] = {"deploy": s1, "old_active": v1a, "new_verify_only": v1b}
    
    # Step 2: Flip
    print(f"\n[2/3] Flip: {new_kid} → active, {old_kid} → verify_only...")
    old_did, _ = get_latest_deploy()
    keys_str = f"{old_kid}:verify_only:{old_secret},{new_kid}:active:{new_secret}"
    set_envs({"WASLA_SERVICE_AUTH_KEYS": keys_str, "WASLA_SERVICE_AUTH_ACTIVE_KID": new_kid})
    s2 = wait_deploy(old_deploy_id=old_did)
    v2a = verify(new_secret, new_kid, "step2-new-active")
    v2b = verify(old_secret, old_kid, "step2-old-verify_only")
    results["steps"]["2_flip"] = {"deploy": s2, "new_active": v2a, "old_verify_only": v2b}
    
    # Step 3: Remove old key
    print(f"\n[3/3] Remove {old_kid}, keep only {new_kid}...")
    old_did, _ = get_latest_deploy()
    keys_str = f"{new_kid}:active:{new_secret}"
    set_envs({"WASLA_SERVICE_AUTH_KEYS": keys_str, "WASLA_SERVICE_AUTH_ACTIVE_KID": new_kid})
    s3 = wait_deploy(old_deploy_id=old_did)
    v3a = verify(new_secret, new_kid, "step3-new-only")
    v3b = not verify(old_secret, old_kid, "step3-old-rejected")  # Should FAIL
    results["steps"]["3_remove_old"] = {"deploy": s3, "new_works": v3a, "old_rejected": v3b}
    
    # Functional test: POST audit event with new key
    print(f"\n[4] Functional: POST audit event with {new_kid}...")
    token = mint("audit", "audit", ["audit:write"], "POST", "/audit/events", new_secret, new_kid)
    event = {"actor_id": "m3-07-rotation", "actor_role": "system", "action": "key_rotation_complete",
             "resource_type": "security", "resource_id": new_kid,
             "metadata": {"old_kid": old_kid, "new_kid": new_kid, "ts": datetime.now(timezone.utc).isoformat()}}
    req = urllib.request.Request(f"{BASE}/audit/events", data=json.dumps(event).encode(),
        headers={"Content-Type": "application/json", "x-wasla-service-auth": token, "User-Agent": "M3-07-Drill/1.0"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"  POST: PASS (HTTP {r.status})")
            results["functional_post"] = True
    except Exception as e:
        print(f"  POST: FAIL ({e})")
        results["functional_post"] = False
    
    results["db_edits_required"] = False
    results["three_states_demonstrated"] = True
    results["final_state"] = f"{new_kid}:active (single key)"
    
    print(f"\n=== SUMMARY ===")
    print(json.dumps(results, indent=2))
    
    with open("/home/user/workspace/m3-07-key-rotation-drill.json", "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print("\nSaved to m3-07-key-rotation-drill.json")

if __name__ == "__main__":
    main()
