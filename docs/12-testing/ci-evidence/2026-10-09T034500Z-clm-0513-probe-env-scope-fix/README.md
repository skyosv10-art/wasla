# CLM-0513 — probe workflow fix: GITHUB_ENV same-step scope (root cause of run 37877806604)

- **Work Item(s):** M6-18B
- **Author/Owner:** @skyosv10-art (agent:perplexity-computer)
- **Date:** 2026-10-09
- **Risk:** RISK-0060 (sev:high) — status stays `mitigating` in this PR

## 1. The defect, measured from the failed run

The first dispatch of `risk-0060-plaintext-probe.yml` after CLM-0512's merge — run
[37877806604](https://github.com/skyosv10-art/wasla/actions/runs/37877806604) (2026-10-09T03:07Z, 9 s) —
failed on:

```
line 36: PROBE_TARGET_REF: unbound variable
```

The parse step wrote `PROBE_TARGET_REF` / `PROBE_TARGET_HOST` / the two probe URLs to `GITHUB_ENV`
and then **the same step's bash** tried to read them. `GITHUB_ENV` values are exposed to the
**next** steps of a job, never the writing step. The target had parsed correctly
(`target: ref=ppixaauyqoykrogwdxtv host=aws-0-ap-south-1.pooler.supabase.com` is in the log) — the
failure is the step boundary, not the parse.

**What this run is NOT:** a probe verdict. No database connection was attempted — the failure
precedes both probes. RISK-0060's measurement remains unexecuted; nothing here is a claim about
production TLS behavior.

## 2. The fix (root cause, not symptom)

`.github/workflows/risk-0060-plaintext-probe.yml` split into two steps:

1. **Parse the target** — python reads `SUPABASE_DB_URL`, prints ONLY ref + host, writes the
   env (ref, host, and the two probe URLs with proper query merging) to `GITHUB_ENV`.
2. **Probe** — a *subsequent* step (where those values are actually in scope): the fail-closed
   ref check, Probe A (`sslmode=disable` must fail with SSL-required), Probe B
   (`sslmode=require` control), the JSON verdict, the artifact.

The probe logic, fail-closed checks and security properties are unchanged — only the step
boundary moved. The workflow name and the DECLARED inventory entry are unchanged (the
description stays accurate).

## 3. Verification

- YAML parses; both python heredocs compile (`ast.parse`) in the exact post-dedent form.
- Local governance + state-sync green.
- The verdict of the re-dispatch (post-merge) is read from the live API and recorded by the
  next claim; this PR claims no measurement.

## 4. Not claimed

No probe executed in this PR; RISK-0060 stays `mitigating` until the deliberate verdict is
recorded. The failed run 37877806604 stays readable and is not erased — it is the evidence that
caught the defect.
