# CLM-0445 · RISK-0059 post-merge evidence — partners in the scenario 2 fleet

- **Work item:** M6-18B · **Risk:** RISK-0059
- **Date:** 2026-10-03 · **Branch:** `fix/clm-0445-risk-0059-scenario2-fleet-partners`
- **Authority:** the owner's written authorisation of 2026-09-30 — "MASTER REPAIR & MERGE".

## What changed

CLM-0444 (merged to main as `f167e8b` via PR #592, correction PR #593 → `b34d6a6`) classified all 10 partners routes with a `serviceIdentity` config:
- `GET /partners/health` and `GET /partners/ready`: `OPEN`
- 8 operations: `scoped()` with `partners:*` scopes

The scenario 2 fleet harness (`scripts/ops/m6-18b-dr/scenario2-db-unavailable.mts`) had excluded partners with the reason "RISK-0059: does not boot under enforced service identity". That exclusion is lifted: partners is now a regular fleet member.

The `dr-replacement-restore.yml` push trigger includes this branch so the workflow runs on push.

## CI verdict

The `dr-replacement-restore.yml` workflow run on this branch (run `37104525069`):

### Job `scenario2`: PASS

The E4 fleet experiment now starts **17/17 services** (up from 16 + 1 excluded), with partners:
- booting under enforced service identity,
- health 503 during the DB outage (via `attachDatabaseHealth`),
- health 200 after the DB returns,
- no crash.

RISK-0059 is closed by this evidence: partners boots and passes the scenario 2 fleet test under enforced service identity.
