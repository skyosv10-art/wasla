#!/usr/bin/env python3
"""CLM-0671 — يطبّقُ المعيارَ المعلَنَ مسبقًا على raw/rounds.tsv (قراءةٌ فقط).
الاستعمال: python3 analyse.py raw/rounds.tsv
إزالةُ التكرار على (job, started): GitHub ينسخُ المهامَّ غيرَ المعادةِ إلى المحاولةِ التاليةِ بمعرّفٍ جديدٍ ووقتِ بدءٍ نفسِه."""
import csv, sys, re, statistics as st
from collections import Counter
R = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
seen, U = set(), []
for r in R:
    k = (r['job'], r['started'])
    if k not in seen: seen.add(k); U.append(r)
def kb(s):
    m = re.search(r'\(([\d.]+) (kB|MB)/s\)', s)
    return None if not m else float(m.group(1)) * (1000 if m.group(2) == 'MB' else 1)
print("rows", len(R), "· unique job-attempts", len(U))
print("conclusions", dict(Counter(r['conclusion'] for r in U)), "· per job", dict(Counter(r['job'] for r in U)))
inst = [int(r['install_s']) for r in U if r['install_s'].isdigit()]
print("install_s median", st.median(inst), "min", min(inst), "max", max(inst))
b = [x for x in (kb(r['b_archives']) for r in U) if x]
print("B archive kB/s n", len(b), "min", min(b), "median", st.median(b))
az, slow = [], []
for r in U:
    m = re.search(r'kBps=([\d.]+) complete=(\w+)', r['probe'])
    if not m: print("NO PROBE LINE", r['attempt'], r['job']); continue
    v, c = float(m.group(1)), m.group(2); az.append(v)
    if v < 300 or c != 'yes': slow.append((r['attempt'], r['job'], r['started'], r['conclusion'], v, c, kb(r['b_archives'])))
print("azure probe kB/s n", len(az), "min", min(az), "median", st.median(az))
cancel = sum(1 for r in U if r['conclusion'] == 'cancelled')
print("criterion 1 — timeout cancellations:", cancel)
print("criterion 2 — azure slow while B succeeded:", sum(1 for s in slow if s[3] == 'success'))
for s in slow: print("  ", s)
verdict = "effective" if cancel == 0 and any(s[3] == 'success' for s in slow) else ("inconclusive" if cancel == 0 else "not effective")
print("VERDICT (pre-declared criterion):", verdict)
