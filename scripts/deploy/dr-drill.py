#!/usr/bin/env python3
"""dr-drill.py — live DR drill probes for M6-18B (CLM-0401).

Measures, never assumes. Each scenario writes raw timestamped probe lines.

  restart   <service> <svc-id>   Render restart; poll /health at 1 s.
  outage    <service> <svc-id>   Render suspend → confirm down → resume; poll.
  isolate   <down> <down-id> <observer>
                                  suspend <down>; poll observer's liveness and
                                  readiness; resume; poll until both recover.

RTO = first 200 on /health after recovery action − moment the outage began
      (first non-200 observed, or the action timestamp when none was seen).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
KEY = os.environ["RENDER_API_KEY"]


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def render(method: str, path: str) -> int:
    req = urllib.request.Request(API + path, data=b"" if method == "POST" else None, method=method)
    req.add_header("Authorization", f"Bearer {KEY}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def probe(url: str, timeout: float = 10) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read(300).decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(300).decode(errors="replace")
    except Exception as e:  # noqa: BLE001 — a failed probe is data, not a crash
        return 0, type(e).__name__


def log(f, **kw) -> None:
    kw = {"t": now().isoformat(), **kw}
    line = json.dumps(kw, ensure_ascii=False)
    print(line, flush=True)
    f.write(line + "\n")
    f.flush()


def poll_until(f, url: str, want_ok: bool, limit_s: int, tag: str) -> dt.datetime | None:
    end = time.time() + limit_s
    while time.time() < end:
        code, body = probe(url)
        log(f, probe=tag, url=url, code=code, body=body[:120])
        if (code == 200) == want_ok:
            return now()
        time.sleep(1)
    return None


def main() -> int:
    mode, out = sys.argv[1], sys.argv[-1]
    with open(out, "a") as f:
        if mode == "restart":
            name, sid = sys.argv[2], sys.argv[3]
            url = f"https://{name}.onrender.com/health"
            base = probe(url)
            log(f, event="baseline", code=base[0])
            t0 = now(); render("POST", f"/services/{sid}/restart"); log(f, event="restart_requested")
            # watch for any non-200 for up to 180 s, then for recovery
            first_bad = None
            end = time.time() + 180
            while time.time() < end:
                code, body = probe(url)
                log(f, probe="health", code=code, body=body[:80])
                if code != 200 and first_bad is None:
                    first_bad = now()
                if first_bad is not None and code == 200:
                    break
                time.sleep(1)
            back = now()
            log(f, event="result", scenario="restart", action_at=t0.isoformat(),
                first_non_200=first_bad.isoformat() if first_bad else None,
                recovered_at=back.isoformat() if first_bad else None,
                observed_downtime_s=round((back - first_bad).total_seconds(), 1) if first_bad else 0.0)
        elif mode == "outage":
            name, sid = sys.argv[2], sys.argv[3]
            url = f"https://{name}.onrender.com/health"
            log(f, event="baseline", code=probe(url)[0])
            t_down = now(); render("POST", f"/services/{sid}/suspend"); log(f, event="suspend_requested")
            down_seen = poll_until(f, url, want_ok=False, limit_s=300, tag="await_down")
            log(f, event="down_confirmed", at=down_seen.isoformat() if down_seen else None)
            time.sleep(10)
            t_resume = now(); render("POST", f"/services/{sid}/resume"); log(f, event="resume_requested")
            up = poll_until(f, url, want_ok=True, limit_s=1200, tag="await_up")
            log(f, event="result", scenario="outage", suspend_at=t_down.isoformat(),
                down_confirmed_at=down_seen.isoformat() if down_seen else None,
                resume_at=t_resume.isoformat(), recovered_at=up.isoformat() if up else None,
                rto_from_resume_s=round((up - t_resume).total_seconds(), 1) if up else None,
                total_outage_s=round((up - down_seen).total_seconds(), 1) if (up and down_seen) else None)
        elif mode == "isolate":
            down, down_id, obs = sys.argv[2], sys.argv[3], sys.argv[4]
            live = f"https://{obs}.onrender.com/health"
            ready = f"https://{obs}.onrender.com/{obs.removeprefix('wasla-')}/ready"
            dep = f"https://{down}.onrender.com/health"
            log(f, event="baseline", dep=probe(dep)[0], obs_live=probe(live)[0], obs_ready=probe(ready, 30)[1][:200])
            render("POST", f"/services/{down_id}/suspend"); log(f, event="dependency_suspend_requested")
            poll_until(f, dep, want_ok=False, limit_s=300, tag="dep_await_down")
            for _ in range(6):
                log(f, probe="observer_during_outage", live=probe(live)[0], ready=probe(ready, 30)[1][:200])
                time.sleep(10)
            t_resume = now(); render("POST", f"/services/{down_id}/resume"); log(f, event="dependency_resume_requested")
            up = poll_until(f, dep, want_ok=True, limit_s=1200, tag="dep_await_up")
            log(f, probe="observer_after_recovery", live=probe(live)[0], ready=probe(ready, 30)[1][:200])
            log(f, event="result", scenario="isolate",
                dep_rto_from_resume_s=round((up - t_resume).total_seconds(), 1) if up else None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
