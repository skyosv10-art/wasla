# M2-07 Outbox Sequence Parity — Evidence (CLM-0237)

**Date:** 2026-09-19
**Claim:** CLM-0237
**Branch:** `feat/m2-07-outbox-sequence-parity`
**Work Item:** M2-07 (crash/retry/dedupe)

## Problem

The M2-07 outbox inventory identified 6 outbox tables that lacked the
`sequence_number` column mandated by ADR-037 for monotonic ordering:

| Service | Table | PK type | Old sort key |
| --- | --- | --- | --- |
| customers | `customer_outbox` | `BIGSERIAL id` | `occurred_at` |
| delivery | `delivery_outbox` | `BIGSERIAL outbox_id` | `outbox_id` |
| drivers | `driver_outbox` | `BIGSERIAL id` | `occurred_at` |
| geography | `geo_outbox` | `BIGSERIAL id` | `occurred_at` |
| identity | `identity_outbox` | `BIGSERIAL id` | `occurred_at` |
| search | `search_outbox` | `BIGSERIAL id` | `occurred_at` |

ADR-037 explicitly states these 6 tables are "not in scope" because they
already have `BIGSERIAL` primary keys, which are monotonic sequences.
The real gap was that the unpublished-events index and ORDER BY used
`occurred_at` (non-monotonic within a same-transaction batch) instead
of the BIGSERIAL `id`/`outbox_id`.

## Solution

Aligned the index and ORDER BY to use the existing BIGSERIAL PK, which
is already a monotonic sequence. No redundant `sequence_number` column
was added — that would duplicate the existing identity column.

### Changes per service

**Delivery** — Already correct. Index on `outbox_id` (the BIGSERIAL PK).
No changes needed.

**Customers** — Changed `ix_customer_outbox_unpublished` from
`(occurred_at)` to `(id)`. Repository code already used
`.orderBy(asc(customerOutbox.id))` — no code change needed.

**Drivers** — Changed `ix_driver_outbox_unpublished` from `(occurred_at)`
to `(id)`. Changed repository ORDER BY from
`.orderBy(asc(driverOutbox.occurredAt), asc(driverOutbox.id))` to
`.orderBy(asc(driverOutbox.id))`.

**Geography** — Changed `ix_geo_outbox_unpublished` from `(occurred_at)`
to `(id)`. Repository code already used `.orderBy(asc(geoOutbox.id))` —
no code change needed.

**Identity** — Changed `ix_identity_outbox_unpublished` from
`(occurred_at)` to `(id)`. Repository code already used
`.orderBy(asc(identityOutbox.id))` — no code change needed.

**Search** — Changed `ix_search_outbox_unpublished` from `(occurred_at)`
to `(id)`. No drain code reads from `search_outbox` — no code change
needed.

## Files Changed

| File | Change |
| --- | --- |
| `services/customers/contracts/schema.sql` | Index: `(occurred_at)` → `(id)` |
| `services/customers/src/infrastructure/drizzle/schema.ts` | Index: `.on(table.occurredAt)` → `.on(table.id)` |
| `services/customers/drizzle/0001_outbox_index_pk.sql` | New migration |
| `services/drivers/contracts/schema.sql` | Index: `(occurred_at)` → `(id)` |
| `services/drivers/src/infrastructure/drizzle/schema.ts` | Index: `.on(table.occurredAt)` → `.on(table.id)` |
| `services/drivers/src/infrastructure/drizzle/repository.ts` | ORDER BY: `(occurredAt, id)` → `(id)` |
| `services/drivers/drizzle/0001_outbox_index_pk.sql` | New migration |
| `services/geography/contracts/schema.sql` | Index: `(occurred_at)` → `(id)` |
| `services/geography/src/infrastructure/drizzle/schema.ts` | Index: `.on(table.occurredAt)` → `.on(table.id)` |
| `services/geography/drizzle/0001_outbox_index_pk.sql` | New migration |
| `services/identity/contracts/schema.sql` | Index: `(occurred_at)` → `(id)` |
| `services/identity/src/infrastructure/drizzle/schema.ts` | Index: `.on(table.occurredAt)` → `.on(table.id)` |
| `services/identity/drizzle/0001_outbox_index_pk.sql` | New migration |
| `services/search/contracts/schema.sql` | Index: `(occurred_at)` → `(id)` |
| `services/search/src/db/schema.ts` | Index: `.on(table.occurredAt)` → `.on(table.id)` |
| `services/search/drizzle/0001_outbox_index_pk.sql` | New migration |
| `docs/08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md` | G2 marked resolved, sort keys updated |

## Verification

### Schema-drift tests

All schema-drift tests pass (contract SQL ↔ Drizzle schema):

- `services/customers/src/__tests__/schema-drift.test.ts` — 17 tests ✅
- `services/drivers/src/__tests__/schema-drift.test.ts` — 28 tests ✅
- `services/search/src/__tests__/schema-drift.test.ts` — 19 tests ✅

(geography and identity have no schema-drift tests)

### Full test suites

- `services/customers` — 133 tests passed ✅
- `services/drivers` — 209 tests passed ✅
- `services/search` — 97 tests passed ✅

## Migration Pattern

Each migration follows the ADR-037 pattern:

```sql
DROP INDEX IF EXISTS "ix_<table>_unpublished";
CREATE INDEX "ix_<table>_unpublished" ON "<table>" USING btree ("id") WHERE "published_at" IS NULL;
```

The `DROP INDEX IF EXISTS` ensures the migration is idempotent.
