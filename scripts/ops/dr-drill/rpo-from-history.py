#!/usr/bin/env python3
"""M6-18B · CLM-0430 — measured RPO from the real history of db-backup.yml on main.

RPO for this mitigation = the longest time production data was NOT covered by a newer
successful, restore-verified backup. It is measured from the GitHub Actions run history
(what actually ran), not from the cron expression (what was asked for).

Usage: rpo-from-history.py <out.json> [days=7]
Env:   GH_TOKEN, GITHUB_REPOSITORY (read-only `actions: read`)
Fails (exit 1) if the window has no successful backup.
"""
import datetime as dt, json, os, subprocess, sys

out = sys.argv[1]; days = int(sys.argv[2]) if len(sys.argv) > 2 else 7
repo = os.environ["GITHUB_REPOSITORY"]
now = dt.datetime.now(dt.timezone.utc); since = now - dt.timedelta(days=days)
raw = subprocess.run(
    ["gh", "api", "--paginate", f"repos/{repo}/actions/workflows/db-backup.yml/runs?branch=main&per_page=100",
     "--jq", ".workflow_runs[] | [.id, .event, .status, .conclusion, .run_started_at, .updated_at] | @tsv"],
    check=True, capture_output=True, text=True).stdout
p = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
runs = []
for line in raw.splitlines():
    rid, ev, st, concl, start, upd = line.split("\t")
    if st != "completed" or p(start) < since:
        continue
    runs.append({"id": int(rid), "event": ev, "conclusion": concl, "started": p(start), "finished": p(upd)})
runs.sort(key=lambda r: r["started"])
ok = [r for r in runs if r["conclusion"] == "success"]
if not ok:
    print(f"RPO FAIL · no successful db-backup run on main in the last {days} days"); sys.exit(1)
# a backup's recovery point is when its dump was taken ≈ run start (dump is the first data step)
pts = [r["started"] for r in ok]
gaps = [(b - a).total_seconds() for a, b in zip(pts, pts[1:])]
gaps.append((now - pts[-1]).total_seconds())   # the gap still open right now
sched = [r for r in runs if r["event"] == "schedule"]
delays = []
for r in sched:  # cron '0 0/6 * * *' → nominal slot = start floored to 6h
    s = r["started"]; slot = s.replace(hour=s.hour - s.hour % 6, minute=0, second=0, microsecond=0)
    delays.append((s - slot).total_seconds())
h = lambda x: round(x / 3600, 2)
res = {
    "window_days": days, "measured_at": now.isoformat(),
    "runs_completed": len(runs), "runs_success": len(ok),
    "runs_failed": [{"id": r["id"], "at": r["started"].isoformat()} for r in runs if r["conclusion"] != "success"],
    "cron_nominal_interval_hours": 6,
    "scheduled_start_delay_hours": {"min": h(min(delays)) if delays else None, "max": h(max(delays)) if delays else None},
    "rpo_worst_gap_hours": h(max(gaps)), "rpo_median_gap_hours": h(sorted(gaps)[len(gaps) // 2]),
    "rpo_current_open_gap_hours": h(gaps[-1]),
    "latest_success": {"id": ok[-1]["id"], "started": ok[-1]["started"].isoformat()},
    "adr_052_t1_rpo_minutes": 5,
    "meets_adr_052_t1": max(gaps) <= 300,
}
json.dump(res, open(out, "w"), indent=2); print(json.dumps(res))
print(f"RPO MEASURED · worst {res['rpo_worst_gap_hours']} h · median {res['rpo_median_gap_hours']} h · "
      f"ADR-052 T1 5 min met: {res['meets_adr_052_t1']}")
