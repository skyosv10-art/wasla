# WASLA Migration Owner Inventory

**Last Updated:** 2026-09-18
**Related:** M2-05, ADR-005, ADR-024
**Machine-readable source:** [`infra/migrations/migration-owners.json`](../../infra/migrations/migration-owners.json)

## Overview

This inventory documents schema ownership and migration runner status for every WASLA service. It is the first step of M2-05 (unified migrations). The upgrade/repair drill and runner unification remain as next steps.

## Summary

- **13 services** with `contracts/schema.sql` — all have schema owners assigned
- **13 services** with `drizzle/meta/_journal.json` — all are "regulated" (منتظمة)
- **4 services** with `src/db/migrate.ts` (delivery, marketplace, search, subscriptions)
- **9 services** with migration runner MISSING (need `migrate.ts`)
- **4 services** with `migrate-cli.ts` (same 4 that have `migrate.ts`)

## Service Status

| Service | Schema Owner | Journal | Migrate Runner | Migrate CLI | Status |
|---|---|---|---|---|---|
| customers | @wasla/customers | 3 entries | no | no | RUNNER_MISSING |
| delivery | @wasla/delivery | 3 entries | yes | yes | RUNNER_PRESENT |
| dispatch | @wasla/dispatch | 3 entries | no | no | RUNNER_MISSING |
| drivers | @wasla/drivers | 3 entries | no | no | RUNNER_MISSING |
| geography | @wasla/geography | 3 entries | no | no | RUNNER_MISSING |
| identity | @wasla/identity | 3 entries | no | no | RUNNER_MISSING |
| marketplace | @wasla/marketplace | 3 entries | yes | yes | RUNNER_PRESENT |
| matching | @wasla/matching | 3 entries | no | no | RUNNER_MISSING |
| negotiations | @wasla/negotiations | 3 entries | no | no | RUNNER_MISSING |
| orders | @wasla/orders | 3 entries | no | no | RUNNER_MISSING |
| reputation | @wasla/reputation | 3 entries | no | no | RUNNER_MISSING |
| search | @wasla/search | 3 entries | yes | yes | RUNNER_PRESENT |
| subscriptions | @wasla/subscriptions | 3 entries | yes | yes | RUNNER_PRESENT |

## What is proven

- Every `services/*/contracts/schema.sql` has an assigned schema owner and migration owner
- Every service has a Drizzle journal (`drizzle/meta/_journal.json`) with 3 entries
- The 4 services with `migrate.ts` also have `migrate-cli.ts` — they can apply migrations independently
- The 9 services without `migrate.ts` have schema contracts but no migration runner

## What remains for M2-05

- **Runner unification:** 9 services need `migrate.ts` to match the pattern of delivery/marketplace/search/subscriptions
- **Upgrade/repair drill:** requires all runners present + PostgreSQL test database
- **Common entrypoint:** evaluate whether a shared migration runner is needed or each service keeps its own
