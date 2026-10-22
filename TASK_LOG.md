## [2026-10-22] CLM-0660 — تابع: توليدُ الأساسِ الآليِّ
- Changed units: docs/12-testing/BASELINE.json, docs/12-testing/ci-evidence/2026-10-22T053000Z-clm-0660-vitest-4-1-12-mocker-cves/README.md, docs/12-testing/ci-evidence/2026-10-22T053000Z-clm-0660-vitest-4-1-12-mocker-cves/raw/verify-7ffd738.log
- Regenerated BASELINE.json from the in-tree transition verify log (stripped of ANSI): static risks_not_closed 26 (RISK-0031/RISK-0062 closed on this branch), lockfile fingerprint updated (vitest ^4.1.12), dynamic measured from the recorded log: tests 6273, files 441, governance suite 694/1, verify verdict recorded (RISK-0028 door 4: the verdict is recorded, not required to be green — CI verify on the PR will produce the clean log for a follow-up regen, the CLM-0652 pattern).
- Risk(s): RISK-0028 → mitigating (baseline regeneration chain restored)
- Verified: validate-baseline green (all doors, fingerprint sha256:6d505828…)
