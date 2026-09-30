#!/usr/bin/env python3
"""RISK-0056 · CLM-0411 — compare a production catalog snapshot with the
reference built from services/*/contracts/schema.sql (vanilla postgres:17).

Usage: compare-preflight.py <reference.json> <production.json> <out.json>
Offline: reads two JSON files, prints a summary, writes the full diff.
"""
import json
import re
import sys

SERVICES = "audit customers delivery dispatch drivers geography identity marketplace matching negotiations orders reputation search subscriptions".split()


def owner_map():
    owners = {}
    for svc in SERVICES:
        sql = re.sub(r"--[^\n]*", "", open(f"services/{svc}/contracts/schema.sql", encoding="utf-8").read())
        for m in re.finditer(r'CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?(?:public"?\.)?"?(\w+)"?', sql, re.I):
            owners[m.group(1)] = svc
    return owners


def keyed(items, key="name"):
    return {i[key]: i for i in items}


def diff_table(ref, prod):
    d = {}
    rc, pc = keyed(ref["columns"]), keyed(prod["columns"])
    fields = ("type", "not_null", "default", "identity", "generated")
    col = {
        "missing_in_production": sorted(set(rc) - set(pc)),
        "extra_in_production": sorted(set(pc) - set(rc)),
        "changed": {
            n: {f: {"expected": rc[n][f], "production": pc[n][f]} for f in fields if rc[n][f] != pc[n][f]}
            for n in sorted(set(rc) & set(pc))
            if any(rc[n][f] != pc[n][f] for f in fields)
        },
        "order_differs": [c["name"] for c in ref["columns"]] != [c["name"] for c in prod["columns"] if c["name"] in rc],
    }
    if any([col["missing_in_production"], col["extra_in_production"], col["changed"]]):
        d["columns"] = col
    for part in ("constraints", "indexes", "triggers"):
        r = {i["name"]: i["def"] for i in ref[part]}
        p = {i["name"]: i["def"] for i in prod[part]}
        x = {
            "missing_in_production": {n: r[n] for n in sorted(set(r) - set(p))},
            "extra_in_production": {n: p[n] for n in sorted(set(p) - set(r))},
            "changed": {n: {"expected": r[n], "production": p[n]} for n in sorted(set(r) & set(p)) if r[n] != p[n]},
        }
        if any(x.values()):
            d[part] = x
    return d


def main():
    ref = json.load(open(sys.argv[1], encoding="utf-8"))
    prod = json.load(open(sys.argv[2], encoding="utf-8"))
    owners = owner_map()
    expected = sorted(ref["tables"])
    result = {"expected_tables": len(expected), "identical": [], "different": {}, "missing": [], "per_service": {}}
    for t in expected:
        if t not in prod["tables"]:
            result["missing"].append(t)
            continue
        d = diff_table(ref["tables"][t], prod["tables"][t])
        if d:
            result["different"][t] = d
        else:
            result["identical"].append(t)
    result["production_only_public_tables"] = sorted(set(prod["tables"]) - set(ref["tables"]))
    result["existing_expected_tables_rows"] = {t: prod["tables"][t]["rows"] for t in expected if t in prod["tables"]}

    # name collisions for objects the migrations would create or replace
    prod_fn = {(f["name"], f["args"]): f["body_md5"] for f in prod["functions"]}
    result["function_collisions"] = [
        {"name": f["name"], "args": f["args"], "same_body": prod_fn[(f["name"], f["args"])] == f["body_md5"]}
        for f in ref["functions"] if (f["name"], f["args"]) in prod_fn and not f["name"].startswith(("gtrgm", "similarity", "word_similarity", "strict_word", "show_", "set_limit", "show_limit", "gin_", "trgm"))
    ]
    missing_set = set(result["missing"])
    ref_index_owner = {i["name"]: t for t, v in ref["tables"].items() for i in v["indexes"]}
    result["index_name_collisions"] = sorted(
        n for n in prod["index_names"] if n in ref_index_owner and ref_index_owner[n] in missing_set
    )
    result["sequence_collisions"] = sorted(
        s for s in ref["sequences"] if s in prod["sequences"] and not any(s.startswith(t + "_") for t in prod["tables"])
    )
    result["type_collisions"] = sorted({t["name"] for t in ref["types"]} & {t["name"] for t in prod["types"]})
    result["extensions"] = {
        "pg_trgm_installed": next((e for e in prod["extensions"] if e["name"] == "pg_trgm"), None),
        "pg_trgm_available": prod.get("available"),
    }
    result["can_create_in_public"] = prod.get("can_create_in_public")
    result["default_acl_public"] = prod.get("default_acl_public")
    result["event_triggers"] = prod.get("event_triggers")
    result["activity"] = prod.get("activity")
    result["read_only_proof"] = prod.get("read_only_proof")
    for svc in SERVICES:
        ts = [t for t in expected if owners.get(t) == svc]
        result["per_service"][svc] = {
            "expected": len(ts),
            "present": sum(1 for t in ts if t in prod["tables"]),
            "identical": sum(1 for t in ts if t in result["identical"]),
            "different": [t for t in ts if t in result["different"]],
            "missing": sum(1 for t in ts if t in missing_set),
        }
    json.dump(result, open(sys.argv[3], "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    print(f"expected={len(expected)} identical={len(result['identical'])} different={len(result['different'])} missing={len(result['missing'])}")
    for svc, s in result["per_service"].items():
        print(f"  {svc}: expected={s['expected']} present={s['present']} identical={s['identical']} different={s['different']} missing={s['missing']}")
    for t, d in result["different"].items():
        print(f"DIFF {t}: {json.dumps(d, ensure_ascii=False)}")
    print("production-only public tables:", result["production_only_public_tables"])
    print("rows in pre-existing expected tables:", result["existing_expected_tables_rows"])
    print("function collisions:", result["function_collisions"])
    print("index-name collisions:", result["index_name_collisions"])
    print("sequence collisions:", result["sequence_collisions"], "· type collisions:", result["type_collisions"])
    print("pg_trgm installed:", result["extensions"]["pg_trgm_installed"], "· available:", result["extensions"]["pg_trgm_available"])
    print("can CREATE in public:", result["can_create_in_public"])
    print("default ACL in public:", json.dumps(result["default_acl_public"], ensure_ascii=False))
    print("event triggers:", json.dumps(result["event_triggers"], ensure_ascii=False))
    print("activity:", json.dumps(result["activity"]))


if __name__ == "__main__":
    main()
