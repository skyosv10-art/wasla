# CLM-0418 — api-types.ts drift (§24-H)

**Date:** 2026-09-30 · **Authority:** written mandate "MASTER REPAIR & MERGE", 2026-09-30

## Measured before the fix (main `bc5de79`)

Each package's own `generate` command was run into a temp file and diffed against the committed `src/api-types.ts`.

| package | result |
|---|---|
| channel, reputation | in sync |
| customer, dispatch, driver, geography, marketplace, matching, negotiation, order, support | drift (30–250 differing lines) |
| identity | `generate` path `../../services/…` resolves outside the repo (missing spec) |
| subscription | generator fails: 22 unresolved `$ref` (`AuthUnauthorized`/`AuthForbidden`) |
| delivery, search | hand-authored (header says so); `generate` would overwrite them |
| billing | no `api-types.ts` |

## Root causes and fixes

1. **Identity path.** Fixed to `../../../services/identity/contracts/api.openapi.yml`.
2. **Subscriptions OpenAPI.** The two response components were pasted inside `paths./subscriptions/plans.get.responses`, where they were invalid keys. They are moved to `components.responses`. Every `$ref` already pointed there, so no operation changes shape.
3. **Stale generated files.** The 11 files were regenerated with the pinned `openapi-typescript`.
4. **Nothing stopped drift before.** Each generated package now has `src/__tests__/api-types-drift.test.ts`. It runs the package's own `generate` command into a temp file and requires byte equality with the committed file.
   - Negative check: reverting `order/src/api-types.ts` makes that test fail (1 failed).
5. **The overwrite trap.** `generate` in `contracts-delivery` and `contracts-search` now exits 1 with an explanation, so it can no longer overwrite the hand-authored file.

## Verified locally

- `pnpm -r typecheck`: rc 0 across the workspace.
- Contract packages: all 16 suites green, including the 13 new drift tests.
- `services/subscriptions`: 229/229 tests.

## Not claimed

- No ADR. This is not a contract change: the OpenAPI response components are moved to where their `$ref`s already pointed.
