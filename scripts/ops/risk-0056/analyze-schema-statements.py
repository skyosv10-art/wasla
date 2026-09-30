#!/usr/bin/env python3
"""RISK-0056 · CLM-0411 — static, offline inventory of every statement in
services/<svc>/contracts/schema.sql for the 14 deployed DB services.

No database connection. Splits each file into top-level statements (respecting
quotes, dollar-quoted bodies and comments), classifies each one, and records
its target object and whether it is guarded (IF NOT EXISTS / IF EXISTS /
ON CONFLICT / OR REPLACE).

Usage: analyze-schema-statements.py <out.json> <out.md>
"""
import json
import re
import sys

SERVICES = "audit customers delivery dispatch drivers geography identity marketplace matching negotiations orders reputation search subscriptions".split()


def split_statements(sql: str):
    out, buf, i, n = [], [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j
            continue
        if sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and sql[j + 1 : j + 2] == "'":
                    j += 2
                    continue
                if sql[j] == "'":
                    break
                j += 1
            buf.append(sql[i : j + 1])
            i = j + 1
            continue
        m = re.match(r"\$[A-Za-z_]*\$", sql[i:])
        if m:
            tag = m.group(0)
            j = sql.find(tag, i + len(tag))
            j = n if j < 0 else j + len(tag)
            buf.append(sql[i:j])
            i = j
            continue
        if c == ";":
            s = "".join(buf).strip()
            if s:
                out.append(s)
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    s = "".join(buf).strip()
    if s:
        out.append(s)
    return out


def classify(stmt: str):
    s = " ".join(stmt.split())
    u = s.upper()
    ident = r'"?([A-Za-z0-9_]+)"?(?:\."?([A-Za-z0-9_]+)"?)?'

    def name(m, g=1):
        a, b = m.group(g), m.group(g + 1)
        return b or a

    rules = [
        (r"^BEGIN$", "BEGIN", None),
        (r"^COMMIT$", "COMMIT", None),
        (r"^CREATE EXTENSION (IF NOT EXISTS )?" + ident, "CREATE EXTENSION", 2),
        (r"^CREATE TABLE (IF NOT EXISTS )?" + ident, "CREATE TABLE", 2),
        (r"^CREATE (UNIQUE )?INDEX (CONCURRENTLY )?(IF NOT EXISTS )?" + ident + r" ON " + ident, "CREATE INDEX", 4),
        (r"^CREATE SEQUENCE (IF NOT EXISTS )?" + ident, "CREATE SEQUENCE", 2),
        (r"^CREATE (OR REPLACE )?FUNCTION " + ident, "CREATE FUNCTION", 2),
        (r"^CREATE (OR REPLACE )?TRIGGER " + ident + r".* ON " + ident, "CREATE TRIGGER", 2),
        (r"^DROP TRIGGER (IF EXISTS )?" + ident + r" ON " + ident, "DROP TRIGGER", 2),
        (r"^DROP INDEX (IF EXISTS )?" + ident, "DROP INDEX", 2),
        (r"^ALTER TABLE (IF EXISTS )?(ONLY )?" + ident, "ALTER TABLE", 3),
        (r"^INSERT INTO " + ident, "INSERT", 1),
        (r"^COMMENT ON", "COMMENT", None),
        (r"^DO ", "DO BLOCK", None),
    ]
    for pat, kind, g in rules:
        m = re.match(pat, s, re.I)
        if m:
            target = name(m, g) if g else None
            extra = {}
            if kind == "CREATE INDEX":
                extra["table"] = m.group(7) or m.group(6)
                extra["unique"] = bool(m.group(1))
            if kind in ("CREATE TRIGGER", "DROP TRIGGER"):
                tail = re.findall(r" ON " + ident, s, re.I)
                if tail:
                    extra["table"] = tail[-1][1] or tail[-1][0]
            if kind == "ALTER TABLE":
                sub = re.sub(r"^ALTER TABLE (IF EXISTS )?(ONLY )?\S+\s*", "", s, flags=re.I)
                extra["action"] = sub[:160]
            if kind == "INSERT":
                extra["on_conflict"] = (re.search(r"ON CONFLICT[^;]*", s, re.I) or [None])[0]
                extra["rows"] = max(1, len(re.findall(r"\)\s*,\s*\(", s.split(" VALUES ", 1)[-1])) + 1) if " VALUES " in u else None
            guarded = bool(re.search(r"IF NOT EXISTS|IF EXISTS|OR REPLACE|ON CONFLICT", u))
            return {"kind": kind, "target": target, "guarded": guarded, **extra}
    return {"kind": "OTHER", "target": None, "guarded": False, "text": s[:200]}


def main():
    out_json, out_md = sys.argv[1], sys.argv[2]
    report = {}
    for svc in SERVICES:
        sql = open(f"services/{svc}/contracts/schema.sql", encoding="utf-8").read()
        stmts = [classify(s) | {"n": i + 1} for i, s in enumerate(split_statements(sql))]
        report[svc] = stmts
    json.dump(report, open(out_json, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    lines = ["# Statement inventory — services/*/contracts/schema.sql (offline, generated)", ""]
    lines.append("| Service | Statements | CREATE TABLE | CREATE INDEX (unique) | ALTER TABLE | FUNCTION | TRIGGER (drop/create) | DROP INDEX | INSERT (seed) | EXTENSION | Unguarded |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for svc, st in report.items():
        k = lambda x: sum(1 for s in st if s["kind"] == x)
        uniq = sum(1 for s in st if s["kind"] == "CREATE INDEX" and s.get("unique"))
        ung = [s for s in st if not s["guarded"] and s["kind"] not in ("BEGIN", "COMMIT", "COMMENT")]
        lines.append(
            f"| {svc} | {len(st)} | {k('CREATE TABLE')} | {k('CREATE INDEX')} ({uniq}) | {k('ALTER TABLE')} | {k('CREATE FUNCTION')} | "
            f"{k('DROP TRIGGER')}/{k('CREATE TRIGGER')} | {k('DROP INDEX')} | {k('INSERT')} | {k('CREATE EXTENSION')} | {len(ung)} |"
        )
    lines += ["", "## Every non-CREATE-TABLE / non-CREATE-INDEX statement", ""]
    lines.append("| Service | # | Kind | Target | Guarded | Detail |")
    lines.append("|---|---|---|---|---|---|")
    for svc, st in report.items():
        for s in st:
            if s["kind"] in ("CREATE TABLE", "CREATE INDEX", "BEGIN", "COMMIT"):
                continue
            detail = s.get("action") or s.get("on_conflict") or s.get("table") or s.get("text") or ""
            detail = str(detail).replace("|", "\\|")
            lines.append(f"| {svc} | {s['n']} | {s['kind']} | {s['target'] or ''} | {'yes' if s['guarded'] else '**no**'} | {detail} |")
    lines += ["", "## Unguarded statements (would error or re-run without an existence guard)", ""]
    for svc, st in report.items():
        for s in st:
            if not s["guarded"] and s["kind"] not in ("BEGIN", "COMMIT", "COMMENT"):
                lines.append(f"- {svc} #{s['n']} {s['kind']} {s['target'] or ''} {s.get('table') or ''} {s.get('text') or ''}".rstrip())
    open(out_md, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"services={len(report)} statements={sum(len(v) for v in report.values())}")


if __name__ == "__main__":
    main()
