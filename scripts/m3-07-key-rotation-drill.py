#!/usr/bin/env python3
"""
M3-07 — تمرينُ تدويرِ مفاتيحِ هويّةِ الخدمةِ على wasla-audit المنشورة (Render staging).

ينفِّذ دليلَ docs/14-runbooks/SERVICE_AUTH_KEY_ROTATION.md بحالاتِه الثلاث،
ويتحقّق بعد كلِّ نشرٍ بنداءاتٍ حقيقيّةٍ على POST /audit/events.

    probe : الحالةُ المنشورةُ الآن (أيُّ مفتاحٍ يُقبَل؟) — بلا تعديل
    s1    : OLD:active + NEW:verify_only · ACTIVE=OLD   (إدخالُ المفتاحِ الجديدِ للتحقّقِ فقط)
    s2    : NEW:active + OLD:verify_only · ACTIVE=NEW   (قلبُ التوقيع)
    s3    : NEW:active + OLD:revoked      · ACTIVE=NEW   (سحبُ القديمِ باسمِه)

الأسرارُ لا تُطبَع ولا تُكتَب في المستودع: تُحفَظ في ملفٍّ محليٍّ خارجَ الشجرةِ
(M3_07_KEYFILE، صلاحيّة 600). ملاحظتانِ تشغيليّتانِ اكتُشِفتا بالقياس:
  1) PUT /env-vars على Render لا يُعيد النشرَ — يلزمُ POST /deploys صريحًا.
  2) السجلُّ يرفض معرِّفًا مكرَّرًا فيفشل الإقلاعُ (fail-closed) ويبقى النشرُ السابقُ حيًّا.

الاستعمال:
    RENDER_API_KEY=... M3_07_KEYFILE=/path/outside/repo.json \
      python3 scripts/m3-07-key-rotation-drill.py all|probe,s1,s2,overlap,s3[@DEPLOY_ID] OLD_KID NEW_KID
"""
import base64, hashlib, hmac, json, os, secrets, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone

SERVICE_ID = "srv-daprrq0u01pc73do9npg"
BASE = "https://wasla-audit.onrender.com"
API = "https://api.render.com/v1"
KEY_VARS = ("WASLA_SERVICE_AUTH_KEYS", "WASLA_SERVICE_AUTH_ACTIVE_KID")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def render(method, path, body=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "Authorization": f"Bearer {os.environ['RENDER_API_KEY']}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def mint(kid, secret, method, path, scopes):
    t = int(time.time())
    payload = {"kid": kid, "svc": "audit", "aud": "audit", "scp": scopes, "iat": t,
               "exp": t + 60, "req": f"{method} {path}", "jti": b64u(os.urandom(16))}
    enc = b64u(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"wsvc3.{enc}".encode(), hashlib.sha256).digest()
    return f"wsvc3.{enc}.{b64u(sig)}"


def try_key(kid, secret, label):
    """نداءٌ حقيقيٌّ: POST /audit/events موقَّعٌ بالمفتاح. يُعيد (HTTP, سبب)."""
    token = mint(kid, secret or "x" * 64, "POST", "/audit/events", ["audit:write"])
    body = json.dumps({"actor_id": "m3-07-drill", "actor_role": "system",
                       "action": "key_rotation_drill", "resource_type": "operational",
                       "resource_id": "m3-07", "metadata": {"kid": kid, "step": label, "at": now()}}).encode()
    req = urllib.request.Request(f"{BASE}/audit/events", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "x-wasla-service-auth": token})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, "accepted"
    except urllib.error.HTTPError as e:
        txt = e.read().decode(errors="replace")[:200]
        return e.code, txt


def load_keys():
    p = os.environ["M3_07_KEYFILE"]
    return json.load(open(p)) if os.path.exists(p) else {}


def save_keys(k):
    p = os.environ["M3_07_KEYFILE"]
    with open(p, "w") as f:
        json.dump(k, f)
    os.chmod(p, 0o600)


def current_env():
    return {d["envVar"]["key"]: d["envVar"]["value"] for d in render("GET", f"/services/{SERVICE_ID}/env-vars?limit=100")}


def apply_state(entries, active):
    """entries: [(kid,status,secret)] — يستبدل المجموعةَ كاملةً محافظًا على بقيّةِ المتغيّرات."""
    kids = [e[0] for e in entries]
    assert len(kids) == len(set(kids)), "معرِّفٌ مكرَّر — كان سببَ فشلِ الإقلاعِ في المحاولةِ الأولى"
    env = current_env()
    env["WASLA_SERVICE_AUTH_KEYS"] = ",".join(f"{k}:{s}:{sec}" for k, s, sec in entries)
    env["WASLA_SERVICE_AUTH_ACTIVE_KID"] = active
    render("PUT", f"/services/{SERVICE_ID}/env-vars", [{"key": k, "value": v} for k, v in env.items()])
    dep_id = render("POST", f"/services/{SERVICE_ID}/deploys", {"clearCache": "do_not_clear"})["id"]
    return dep_id, wait_deploy(dep_id)


def wait_deploy(dep_id):
    deadline = time.time() + 900
    status = "?"
    while time.time() < deadline:
        time.sleep(15)
        status = render("GET", f"/services/{SERVICE_ID}/deploys/{dep_id}")["status"]
        if status in ("live", "build_failed", "update_failed", "canceled", "deactivated"):
            break
    return status


def main():
    mode, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
    keys = load_keys()
    if new not in keys:
        keys[new] = secrets.token_hex(32)
        save_keys(keys)
    log = []

    def check(step, expect):
        res = {}
        for kid, want in expect.items():
            code, why = try_key(kid, keys.get(kid), step)
            res[kid] = {"http": code, "expect": want, "ok": code == want, "detail": why if code != 201 else "accepted"}
        return res

    def run(step, entries, active, expect, existing=None):
        # existing: نشرٌ أُطلِق لهذه الحالةِ مسبقًا (استئنافٌ بلا إعادةِ PUT/نشر)
        dep, st = (existing, wait_deploy(existing)) if existing else apply_state(entries, active)
        rec = {"step": step, "at": now(), "deploy": dep, "deploy_status": st,
               "keys": [f"{k}:{s}" for k, s, _ in entries], "active": active}
        rec["checks"] = check(step, expect) if st == "live" else {}
        log.append(rec)
        print(json.dumps(rec, ensure_ascii=False), flush=True)
        return st == "live" and all(c["ok"] for c in rec["checks"].values())

    # mode: خطواتٌ مفصولةٌ بفواصل — probe · s1[@dep] · s2[@dep] · overlap · s3[@dep] · all
    steps = ["probe", "s1", "s2", "overlap", "s3"] if mode == "all" else mode.split(",")
    states = {
        "s1": ([(old, "active", keys[old]), (new, "verify_only", keys[new])], old, {old: 201, new: 201}),
        "s2": ([(new, "active", keys[new]), (old, "verify_only", keys[old])], new, {old: 201, new: 201}),
        "s3": ([(new, "active", keys[new]), (old, "revoked", "")], new, {old: 401, new: 201}),
    }
    ok = True
    for st in steps:
        name, _, dep = st.partition("@")
        if name == "probe":
            rec = {"step": "probe", "at": now(), "checks": check("probe", {old: 201, new: 401})}
            log.append(rec)
            print(json.dumps(rec, ensure_ascii=False), flush=True)
        elif name == "overlap":
            # نافذةُ التداخلِ الدنيا في الدليل §2.2(4): 300s عمرُ رمزٍ + 60s انزياح
            print(json.dumps({"step": "overlap", "at": now(), "seconds": 360}), flush=True)
            time.sleep(360)
        elif ok:
            ok = run(name, *states[name], existing=dep or None)
    out = os.environ.get("M3_07_OUT")
    if out:
        json.dump(log, open(out, "w"), ensure_ascii=False, indent=2)
    print("RESULT", "PASS" if ok else "FAIL", flush=True)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
