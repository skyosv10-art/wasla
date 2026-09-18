# WASLA Migration Owner Inventory

**Last Updated:** 2026-09-18
**Related:** M2-05, ADR-005, ADR-024
**Machine-readable source:** [`infra/migrations/migration-owners.json`](../../infra/migrations/migration-owners.json)

## Overview

This inventory documents schema ownership and migration runner status for every WASLA service. It is the first step of M2-05 (unified migrations). The upgrade/repair drill and runner unification remain as next steps.

## Summary

- **13 services** with `contracts/schema.sql` — all have schema owners assigned
- **13 services** with `drizzle/meta/_journal.json` — all are "regulated" (منتظمة)
- **13 services** with `src/db/migrate.ts` (all services now have migration runners)
- **13 services** with `src/db/migrate-cli.ts` (all services have CLI entrypoints)
- **0 services** with migration runner MISSING

## Service Status

| Service | Schema Owner | Journal | Migrate Runner | Migrate CLI | Status |
|---|---|---|---|---|---|
| customers | @wasla/customers | 3 entries | yes | yes | RUNNER_PRESENT |
| delivery | @wasla/delivery | 3 entries | yes | yes | RUNNER_PRESENT |
| dispatch | @wasla/dispatch | 3 entries | yes | yes | RUNNER_PRESENT |
| drivers | @wasla/drivers | 3 entries | yes | yes | RUNNER_PRESENT |
| geography | @wasla/geography | 3 entries | yes | yes | RUNNER_PRESENT |
| identity | @wasla/identity | 3 entries | yes | yes | RUNNER_PRESENT |
| marketplace | @wasla/marketplace | 3 entries | yes | yes | RUNNER_PRESENT |
| matching | @wasla/matching | 3 entries | yes | yes | RUNNER_PRESENT |
| negotiations | @wasla/negotiations | 3 entries | yes | yes | RUNNER_PRESENT |
| orders | @wasla/orders | 3 entries | yes | yes | RUNNER_PRESENT |
| reputation | @wasla/reputation | 3 entries | yes | yes | RUNNER_PRESENT |
| search | @wasla/search | 3 entries | yes | yes | RUNNER_PRESENT |
| subscriptions | @wasla/subscriptions | 3 entries | yes | yes | RUNNER_PRESENT |

## What is proven

- Every `services/*/contracts/schema.sql` has an assigned schema owner and migration owner
- Every service has a Drizzle journal (`drizzle/meta/_journal.json`) with 3 entries
- All 13 services now have `migrate.ts` and `migrate-cli.ts` — migration runners are unified
- The runner pattern follows the established design: `pool.query(readSchemaContract())` via `pg` directly

## What remains for M2-05

- **Upgrade/repair drill:** requires PostgreSQL test database to verify migration apply + rollback
- **Common entrypoint evaluation:** all services now follow the same pattern, but no shared runner exists yet
