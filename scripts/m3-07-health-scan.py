#!/usr/bin/env python3
"""M3-07 Runbook Drill — Health scan of all published Render services."""
import urllib.request, json, time, concurrent.futures, sys

SERVICES = [
    ("wasla-audit", "https://wasla-audit.onrender.com"),
    ("wasla-dispatch", "https://wasla-dispatch.onrender.com"),
    ("wasla-customers", "https://wasla-customers.onrender.com"),
    ("wasla-matching", "https://wasla-matching.onrender.com"),
    ("wasla-delivery", "https://wasla-delivery.onrender.com"),
    ("wasla-geography", "https://wasla-geography.onrender.com"),
    ("wasla-search", "https://wasla-search.onrender.com"),
    ("wasla-customer-bot", "https://wasla-customer-bot.onrender.com"),
    ("wasla-partner-bot", "https://wasla-partner-bot.onrender.com"),
    ("wasla-negotiations", "https://wasla-negotiations.onrender.com"),
    ("wasla-drivers", "https://wasla-drivers.onrender.com"),
    ("wasla-reputation", "https://wasla-reputation.onrender.com"),
    ("wasla-orders", "https://wasla-orders.onrender.com"),
    ("wasla-driver-bot", "https://wasla-driver-bot.onrender.com"),
    ("wasla-marketplace", "https://wasla-marketplace.onrender.com"),
    ("wasla-identity", "https://wasla-identity.onrender.com"),
    ("wasla-subscriptions", "https://wasla-subscriptions.onrender.com"),
]

def check_service(args):
    name, url = args
    health_url = f"{url}/health"
    start = time.time()
    try:
        req = urllib.request.Request(health_url, headers={"User-Agent": "WASLA-M3-07-Drill/1.0"})
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read().decode("utf-8", errors="replace")[:500]
            elapsed = time.time() - start
            return name, resp.status, body, elapsed
    except Exception as e:
        elapsed = time.time() - start
        return name, "ERR", str(e)[:300], elapsed

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=17) as executor:
    futures = {executor.submit(check_service, svc): svc for svc in SERVICES}
    for future in concurrent.futures.as_completed(futures):
        name, status, body, elapsed = future.result()
        results.append((name, status, body, elapsed))
        if status == 200:
            print(f"OK   {name:25s} | HTTP {status} | {elapsed:.1f}s | {body[:120]}")
        else:
            print(f"ERR  {name:25s} | {status} | {elapsed:.1f}s | {body[:150]}")

results.sort(key=lambda x: x[0])
ok = sum(1 for _, s, _, _ in results if s == 200)
print(f"\n---SUMMARY: {ok}/{len(results)} healthy---")

# Save full results
output = []
for name, status, body, elapsed in results:
    output.append({"service": name, "http_status": status, "body": body, "elapsed_seconds": round(elapsed, 1)})
with open("/home/user/workspace/m3-07-health-scan.json", "w") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)
print("Full results saved to m3-07-health-scan.json")
