#!/usr/bin/env python3
"""audit-provenance.py — قياسُ قابليّةِ إرجاعِ الكتلِ غيرِ الساكنةِ في الأساسِ. (M0-27)

ليس حارساً ولا يُسلَك في CI: أداةُ قياسٍ تُعيد إنتاجَ الرقمِ المنشورِ.
السؤالُ: كلُّ حقلٍ خارجَ `static` — أيُمكن إرجاعُه إلى مصدرٍ قائمٍ اليومَ؟
"""
from __future__ import annotations
import hashlib, json, platform, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]


def run(*a: str) -> tuple[int, str]:
    p = subprocess.run(a, cwd=ROOT, capture_output=True, text=True)
    return p.returncode, (p.stdout or p.stderr).strip()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for c in iter(lambda: fh.read(1 << 16), b""):
            h.update(c)
    return h.hexdigest()


def main() -> int:
    doc = json.loads((ROOT / "docs/12-testing/BASELINE.json").read_text(encoding="utf-8"))
    out: dict = {"schema": "wasla.m0-27-provenance-audit/v1", "baseline_fingerprint": doc.get("fingerprint")}

    # env — أهيَ حيّةٌ اليومَ؟
    env = doc.get("env") or {}
    live_env = {
        "node": run("node", "-v")[1],
        "pnpm": run("pnpm", "-v")[1],
        "os": platform.system(),
        "arch": platform.machine(),
        "python": platform.python_version(),
    }
    out["env"] = {"declared": env, "live": live_env,
                  "matches": {k: (env.get(k) == live_env.get(k)) for k in live_env}}

    # lock — أتُطابِقُ البصمةُ الملفَّ القائمَ؟
    lock = doc.get("lock") or {}
    lp = ROOT / str(lock.get("path", ""))
    out["lock"] = {"declared": lock, "exists": lp.is_file(),
                   "live_sha256": sha256_file(lp) if lp.is_file() else None,
                   "live_lines": len(lp.read_text(encoding="utf-8").splitlines()) if lp.is_file() else None}
    out["lock"]["sha_matches"] = out["lock"]["live_sha256"] == lock.get("sha256")
    out["lock"]["lines_match"] = out["lock"]["live_lines"] == lock.get("lines")

    # repo — أيُحَلُّ الالتزامُ المُعلَنُ في المستودعِ؟
    repo = doc.get("repo") or {}
    sha = str(repo.get("commit", ""))
    rc_type, _ = run("git", "cat-file", "-t", sha)
    rc_anc, _ = run("git", "merge-base", "--is-ancestor", sha, "origin/main")
    out["repo"] = {"declared": repo, "commit_len": len(sha),
                   "commit_resolves_in_repo": rc_type == 0,
                   "commit_is_ancestor_of_main": rc_anc == 0,
                   "dirty": bool(repo.get("dirty")),
                   "dirty_reason_present": bool(str(repo.get("dirty_reason", "")).strip())}

    # dynamic — أيوجدُ مصدرُه؟ وأيحرسُه شيءٌ؟
    dyn = doc.get("dynamic") or {}
    src = str(dyn.get("source", ""))
    sp = Path(src)
    out["dynamic"] = {"declared": dyn, "source": src,
                      "source_exists": sp.exists(),
                      "source_is_inside_repo": str(sp).startswith(str(ROOT)),
                      "in_fingerprint": False,
                      "in_fingerprint_reason": "VOLATILE في scripts/checks/lib/baseline_canon.py — استثناءٌ مُعلَنٌ لا إغفال"}

    # الفجوةُ بين المتعقَّبِ والمنفَّذِ
    st = doc.get("static") or {}
    tracked, executed = st.get("test_files_tracked"), dyn.get("test_files_executed")
    out["tracked_vs_executed"] = {"tracked": tracked, "executed": executed,
                                  "gap": (tracked - executed) if isinstance(tracked, int) and isinstance(executed, int) else None}

    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
