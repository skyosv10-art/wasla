#!/usr/bin/env python3
"""CLM-0670 — جمعٌ قابلٌ لإعادةِ التشغيلِ لقياساتِ «Install Playwright browsers» في مهامِّ e2e الثلاث.

قراءةٌ فقط من واجهةِ GitHub عبرَ `gh` (لا يكتبُ شيئًا في المستودعِ البعيدِ ولا يعيدُ تشغيلَ أيِّ مهمّة).

الاستعمال (من أيِّ مكانٍ، بـ gh مُصادَقٍ):
    python3 collect.py OUTDIR [--runs 100] [--repo skyosv10-art/wasla]

يكتبُ:
    OUTDIR/jobs.tsv     — سطرٌ لكلِّ محاولةِ مهمّةِ e2e فعليّةٍ (المحاولاتُ المنقولةُ من محاولةٍ سابقةٍ تُستبعَد)
    OUTDIR/SUMMARY.txt  — توزيعاتٌ وتصنيفٌ: بطيءٌ/سريعٌ × سرعةُ apt × نتيجةُ خطوةِ الاختبار
"""
import argparse, collections, datetime, json, re, statistics, subprocess, sys, time

E2E = ("customer-mini-app-e2e", "driver-mini-app-e2e", "admin-portal-e2e")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def gh(path, raw=False):
    cmd = ["gh", "api"] + (["--allow-escape-sequences"] if raw else []) + [path]
    # أخطاءُ الخادمِ العابرةُ (5xx) تُعادُ حتى 4 مرّاتٍ بتأخيرٍ متزايدٍ؛ غيرُها يفشلُ فورًا.
    for attempt in range(5):
        out = subprocess.run(cmd, capture_output=True, text=True)
        if out.returncode == 0 or not re.search(r"HTTP 5\d\d", out.stderr) or attempt == 4:
            break
        time.sleep(2 ** attempt)
    if out.returncode != 0:
        raise RuntimeError(f"gh api {path}: {out.stderr.strip()[:200]}")
    return out.stdout if raw else json.loads(out.stdout)


def ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def secs(step):
    a, b = ts(step.get("started_at")), ts(step.get("completed_at"))
    return int((b - a).total_seconds()) if a and b else None


def to_kbps(rate):
    m = re.match(r"([0-9.]+) ([kM])B/s", rate)
    if not m:
        return None
    v = float(m.group(1))
    return v * 1000 if m.group(2) == "M" else v


def parse_log(log):
    log = ANSI.sub("", log)
    sect = log[log.find("Run npx playwright install"):] if "Run npx playwright install" in log else ""
    fetched = re.findall(r"Fetched ([0-9.]+ [kM]B) in ([^(]+)\(([^)]+)\)", sect)
    need = re.findall(r"Need to get ([0-9.]+ [kM]B)", sect)
    # فهرسُ apt هوَ أوّلُ «Fetched»، وحزمُ .deb هيَ الثاني (إن وُجِد).
    idx = fetched[0] if fetched else None
    arc = fetched[1] if len(fetched) > 1 else None
    hosts = sorted(set(re.findall(r"Get:\d+ (https?://[^/ ]+)", sect)))
    cdn_start = re.search(r"(\d\d:\d\d:\d\d\.\d+)Z Downloading Chrome for Testing", sect)
    cdn_end = re.findall(r"(\d\d:\d\d:\d\d\.\d+)Z Chrome Headless Shell [^\n]* downloaded", sect)
    cdn_s = None
    if cdn_start and cdn_end:
        f = lambda t: datetime.datetime.strptime(t[:15], "%H:%M:%S.%f")
        cdn_s = round((f(cdn_end[-1]) - f(cdn_start.group(1))).total_seconds(), 1)
    # سطورُ جلبِ حزمِ .deb: «Get:N <url> <suite> <arch> <pkg> <arch|all> <ver> [size]»
    debs = re.findall(r"^(\S+)Z Get:(\d+) \S+ \S+ (?:amd64|all) (\S+) (?:amd64|all) \S+ \[", sect, re.M)
    last_get = f"{debs[-1][0][11:19]}Z Get:{debs[-1][1]} {debs[-1][2]} ({len(debs)} .deb fetches started)" if debs else ""
    first_get = f"{debs[0][0][11:19]}Z" if debs else ""
    err = re.findall(r"^\S+Z E: ([^\n]+)", sect, re.M)[:2]
    image = re.search(r"Version: (\d{8}\.\d+)", log)
    pwv = re.search(r"playwright build v(\d+)|Chrome for Testing ([0-9.]+)", sect)
    return {
        "apt_need": need[0] if need else "",
        "apt_index": f"{idx[0]} in {idx[1].strip()} ({idx[2]})" if idx else "",
        "apt_archives": f"{arc[0]} in {arc[1].strip()} ({arc[2]})" if arc else "",
        "apt_archives_kbps": to_kbps(arc[2]) if arc else None,
        "apt_index_kbps": to_kbps(idx[2]) if idx else None,
        "apt_hosts": ",".join(hosts),
        "apt_deb_first_get": first_get,
        "apt_deb_last_get": last_get,
        "cdn_s": cdn_s,
        "apt_errors": " | ".join(err),
        "image": image.group(1) if image else "",
        "chrome": (pwv.group(2) or pwv.group(1)) if pwv else "",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--runs", type=int, default=100)
    ap.add_argument("--repo", default="skyosv10-art/wasla")
    a = ap.parse_args()
    R = a.repo
    wf = [w for w in gh(f"repos/{R}/actions/workflows")["workflows"] if w["name"] == "WASLA CI"][0]["id"]
    runs = gh(f"repos/{R}/actions/workflows/{wf}/runs?per_page={min(a.runs,100)}")["workflow_runs"]
    cols = ["run", "attempt", "run_created", "event", "head_sha", "job", "job_id", "job_conclusion",
            "job_s", "install_s", "install_conclusion", "test_s", "test_conclusion", "apt_need", "apt_index",
            "apt_archives", "apt_archives_kbps", "apt_index_kbps", "apt_hosts", "apt_deb_first_get", "apt_deb_last_get", "cdn_s", "apt_errors", "image", "chrome"]
    rows = []; seen = set()
    for r in runs:
        for att in range(1, r["run_attempt"] + 1):
            for j in gh(f"repos/{R}/actions/runs/{r['id']}/attempts/{att}/jobs?per_page=100")["jobs"]:
                key = (r["id"], j["name"], j["started_at"])
                if j["name"] not in E2E or key in seen:
                    continue  # GitHub ينسخُ المهمّةَ التي لم يُعَدْ تشغيلُها إلى المحاولةِ اللاحقةِ بمعرّفٍ جديدٍ و started_at نفسِهِ — تُعَدُّ مرّةً واحدة
                seen.add(key)
                st = {s["name"]: s for s in j["steps"]}
                ins, tst = st.get("Install Playwright browsers", {}), st.get("Run E2E + accessibility tests", {})
                try:
                    p = parse_log(gh(f"repos/{R}/actions/jobs/{j['id']}/logs", raw=True))
                except RuntimeError as e:
                    p = {k: "" for k in cols}; p["apt_errors"] = f"log unavailable: {e}"
                js = ts(j["completed_at"]) - ts(j["started_at"]) if j["started_at"] and j["completed_at"] else None
                rows.append({"run": r["id"], "attempt": att, "run_created": r["created_at"], "event": r["event"],
                             "head_sha": r["head_sha"][:8], "job": j["name"], "job_id": j["id"],
                             "job_conclusion": j["conclusion"], "job_s": int(js.total_seconds()) if js else "",
                             "install_s": secs(ins) if ins else "", "install_conclusion": ins.get("conclusion", ""),
                             "test_s": secs(tst) if tst else "", "test_conclusion": tst.get("conclusion", ""), **p})
    with open(f"{a.outdir}/jobs.tsv", "w", encoding="utf-8") as f:
        f.write("\t".join(cols) + "\n")
        for x in rows:
            f.write("\t".join("" if x.get(c) is None else str(x.get(c)) for c in cols) + "\n")

    out = []
    w = out.append
    w(f"# SUMMARY · collected {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%dT%H:%M:%SZ} · repo {R}")
    w(f"job-attempts: {len(rows)} · runs: {len({x['run'] for x in rows})} · span: "
      f"{min(x['run_created'] for x in rows)} → {max(x['run_created'] for x in rows)}")
    ins = sorted(x["install_s"] for x in rows if isinstance(x["install_s"], int))
    q = lambda v, p: v[min(len(v) - 1, int(len(v) * p))]
    w(f"install seconds: n={len(ins)} median={statistics.median(ins)} p90={q(ins,.9)} p99={q(ins,.99)} max={ins[-1]}")
    slow = [x for x in rows if isinstance(x["install_s"], int) and x["install_s"] >= 300]
    fast = [x for x in rows if isinstance(x["install_s"], int) and x["install_s"] < 300]
    w(f"slow (install ≥ 300 s): {len(slow)} · fast: {len(fast)}")
    byday = collections.defaultdict(lambda: [0, 0])
    for x in rows:
        if isinstance(x["install_s"], int):
            d = x["run_created"][:10]; byday[d][1] += 1; byday[d][0] += x["install_s"] >= 300
    w("slow/total by day: " + " · ".join(f"{d} {s}/{t}" for d, (s, t) in sorted(byday.items())))
    first = min((x["run_created"] for x in slow), default="-")
    w(f"first slow job-attempt: {first}")

    def dist(name, v):
        v = sorted(v)
        return f"{name}: n={len(v)}" + (f" min={v[0]:.1f} median={statistics.median(v):.1f} max={v[-1]:.1f}" if v else "")
    for lab, grp in (("slow", slow), ("fast", fast)):
        w(f"\n## {lab}")
        w("  " + dist("apt .deb archives kB/s", [x["apt_archives_kbps"] for x in grp if x["apt_archives_kbps"]]))
        w("  " + dist("apt index kB/s", [x["apt_index_kbps"] for x in grp if x["apt_index_kbps"]]))
        w("  " + dist("CDN chrome download s", [x["cdn_s"] for x in grp if x["cdn_s"] is not None]))
        w("  images: " + str(dict(collections.Counter(x["image"] for x in grp))))
        w("  apt hosts: " + str(dict(collections.Counter(x["apt_hosts"] for x in grp))))
        w("  job_conclusion × install × test: " + str(dict(collections.Counter(
            (x["job_conclusion"], x["install_conclusion"], x["test_conclusion"] or "-") for x in grp))))
    tests = sorted(x["test_s"] for x in rows if x["test_conclusion"] == "success" and isinstance(x["test_s"], int))
    w("\n" + dist("test step seconds (successful)", tests))
    w("\n## non-success job-attempts (all)")
    for x in sorted(rows, key=lambda x: x["run_created"]):
        if x["job_conclusion"] != "success":
            w(f"  {x['run_created']} run {x['run']} a{x['attempt']} {x['event']} {x['job']} job {x['job_id']}: "
              f"{x['job_conclusion']} · install {x['install_s']}s {x['install_conclusion']} · test {x['test_s']}s "
              f"{x['test_conclusion'] or '-'} · apt {x['apt_archives'] or ('NOT FINISHED — .deb fetch ' + x['apt_deb_first_get'] + ' → last ' + x['apt_deb_last_get'] + ' of ' + x['apt_need'])} · {x['apt_errors'] or ''}")
    w("\n## reruns: same run, later attempt, same job")
    att = collections.defaultdict(dict)
    for x in rows:
        att[(x["run"], x["job"])][x["attempt"]] = x
    for (run, job), d in sorted(att.items()):
        if len(d) > 1:
            w(f"  run {run} {job}: " + " → ".join(f"a{k} {v['job_conclusion']} install {v['install_s']}s apt {v['apt_archives'] or '-'}"
                                               for k, v in sorted(d.items())))
    # تزامنُ البطءِ داخلَ المحاولةِ نفسِها: كم مهمّةً من الثلاثِ بطيئةٌ معًا؟
    per = collections.defaultdict(list)
    for x in rows:
        if isinstance(x["install_s"], int):
            per[(x["run"], x["attempt"])].append(x["install_s"] >= 300)
    co = collections.Counter(sum(v) for v in per.values() if any(v))
    w("\n## concurrent slowness within one run-attempt (number of slow e2e jobs among those run): " + str(dict(co)))
    open(f"{a.outdir}/SUMMARY.txt", "w", encoding="utf-8").write("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    sys.exit(main())
