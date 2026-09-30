#!/usr/bin/env python3
"""§24-G · CLM-0415 — read-only /health probe of the 14 DB-backed Render services.

GET only, no credentials, no Render API, no configuration change. Each service is
tried up to 3 times with a 90 s timeout (free-tier cold start). A service is
healthy iff it answers HTTP 200 on /health. Exit 1 if any service is not.

Writes a JSON report (argv[1], default health-report.json) with the HTTP status,
elapsed time and the first 400 bytes of each body — the body is recorded, not
interpreted: a 200 that says `schema_missing` is reported as it is (RISK-0056),
it is not turned into a failure or a success by this script.
"""
import concurrent.futures
import json
import sys
import time
import urllib.error
import urllib.request

SERVICES = [
    "audit", "customers", "delivery", "dispatch", "drivers", "geography", "identity",
    "marketplace", "matching", "negotiations", "orders", "reputation", "search", "subscriptions",
]
ATTEMPTS = 3
TIMEOUT = 90


def probe(name: str) -> dict:
    url = f"https://wasla-{name}.onrender.com/health"
    last = {}
    for attempt in range(1, ATTEMPTS + 1):
        start = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "wasla-service-health/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read(400).decode("utf-8", errors="replace")
                last = {"service": name, "url": url, "http_status": resp.status, "attempt": attempt,
                        "elapsed_s": round(time.time() - start, 1), "body": body}
        except urllib.error.HTTPError as e:
            last = {"service": name, "url": url, "http_status": e.code, "attempt": attempt,
                    "elapsed_s": round(time.time() - start, 1),
                    "body": e.read(400).decode("utf-8", errors="replace")}
        except Exception as e:  # network error, timeout, TLS
            last = {"service": name, "url": url, "http_status": None, "attempt": attempt,
                    "elapsed_s": round(time.time() - start, 1), "error": str(e)[:300]}
        if last.get("http_status") == 200:
            return last
        time.sleep(5)
    return last


def main() -> int:
    out = sys.argv[1] if len(sys.argv) > 1 else "health-report.json"
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(SERVICES)) as pool:
        results = sorted(pool.map(probe, SERVICES), key=lambda r: r["service"])
    healthy = [r for r in results if r.get("http_status") == 200]
    report = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "healthy": len(healthy), "total": len(results), "results": results}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    for r in results:
        print(f"{'OK ' if r.get('http_status') == 200 else 'BAD'} {r['service']:14s} {r.get('http_status')} {r['elapsed_s']}s")
    print(f"healthy {len(healthy)}/{len(results)}")
    return 0 if len(healthy) == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
