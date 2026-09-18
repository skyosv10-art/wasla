# ADR-037: Outbox Monotonic Sequence Number

**Status:** Proposed · **Date:** 2026-09-18 · **Decider:** @uxxxu (agent:perplexity-computer)

## Context

Seven outbox tables across as many services lack a monotonic counter for event ordering:

| Service | Table | Primary Key | Current sort |
| --- | --- | --- | --- |
| marketplace | `marketplace_outbox` | `UUID` | `created_at` (via `clock_timestamp()`) → `outbox_id` |
| subscriptions | `subscription_outbox` | `UUID` (`event_id`) | `occurred_at` → `event_id` |
| dispatch | `dispatch_outbox` | `UUID` (`event_id`) | `occurred_at` → `event_id` |
| matching | `matching_outbox` | `UUID` (`event_id`) | `occurred_at` → `event_id` |
| negotiations | `negotiation_outbox` | `UUID` (`id`) | `occurred_at` → `id` |
| orders | `order_outbox` | `UUID` (`event_id`) | `event_id` only |
| reputation | `reputation_outbox` | `UUID` (`id`) | `occurred_at` → `id` |

When two events are written in the **same transaction**, `now()` returns the transaction-start timestamp for every row — so timestamps tie, and ordering falls to the random UUID. A relay consumer may then read `inventory_adjusted` before `product_created`, or `order_assigned` before `order_created`.

**RISK-0012** was opened 2026-08-29 after the first real-PostgreSQL integration run of the marketplace service proved this defect empirically. The workaround (`clock_timestamp()` in marketplace alone) is microsecond-precise but not a proof: two inserts within the same microsecond would still tie. The risk was left open pending a unified shape change — which is the owner's decision. The program owner has now delegated full executive authority.

## Decision

Add a `sequence_number BIGINT GENERATED ALWAYS AS IDENTITY` column to each of the seven outbox tables. Order the unpublished-claim query by `sequence_number ASC` as the **sole** sort key — not `occurred_at`, not `created_at`, not the UUID.

### Why a column, not a changed primary key

Six of the seven tables use a UUID primary key that is also the event id consumed downstream (the seventh, `marketplace_outbox`, uses a UUID `outbox_id`). Changing the primary key type would break every relay consumer and every integration test that reads `event_id` / `outbox_id`. A separate IDENTITY column is additive: existing rows get backfilled, new rows get a strictly increasing number, and the UUID stays as the stable event identity.

### Why IDENTITY and not a separate SEQUENCE

`GENERATED ALWAYS AS IDENTITY` is the SQL-standard column-attached sequence. It cannot be dropped independently of the column, it is owned by exactly one table, and it does not need a `nextval()` call in application code — the database assigns it. A standalone `CREATE SEQUENCE` would require application code to call `nextval()` in every `INSERT`, which is exactly the kind of implicit ordering the original `now()` default created.

### Why `sequence_number` as the sole sort key

`occurred_at` is the time the event *happened* in the domain, not the time the row was *written*. A delayed transaction can write an event whose `occurred_at` is in the past, which would mis-order it relative to already-published events. `sequence_number` is the time the row *entered the outbox* — which is what a relay consumer needs: the order in which events became durable.

The UUID primary key remains as the stable event identity for idempotency / dedup, but it is no longer a sort key.

## Consequences

- **Schema migration required** on all seven services. The `ALTER TABLE … ADD COLUMN sequence_number BIGINT GENERATED ALWAYS AS IDENTITY` is non-destructive and backfills existing rows.
- **Index change**: the `ix_*_outbox_unpublished` partial indexes move from `(occurred_at) WHERE published_at IS NULL` to `(sequence_number) WHERE published_at IS NULL`.
- **Contract SQL** (`contracts/schema.sql`) for all seven services gains the new column and the new index.
- **Drizzle schema mirrors** gain the column.
- **Repository / outbox-store code** in all seven services changes its `ORDER BY` to `sequence_number ASC`.
- **`RISK-0012` closes** with this ADR as the mitigating decision.
- The `clock_timestamp()` workaround in `services/marketplace/src/db/outbox.ts` is removed — `sequence_number` is the proof, not a timestamp.

## Scope

This ADR covers the seven services listed above. `delivery_outbox`, `customer_outbox`, `driver_outbox`, `geo_outbox`, `identity_outbox`, and `search_outbox` already use `BIGSERIAL` primary keys and are not in scope.

## Alternatives considered

- **Keep `clock_timestamp()` and add a test that two inserts in one transaction get distinct timestamps.** Rejected: the test would pass until the day two inserts land in the same microsecond, at which point it would silently start passing on luck. A proof by monotonic counter does not depend on clock resolution.
- **Use `occurred_at` with `now()` but add `event_id` as a tiebreaker.** Rejected: `now()` is constant within a transaction, so every event in one transaction would tie on `occurred_at` and fall to the random UUID — the original defect.
- **Change primary keys to `BIGSERIAL`.** Rejected: breaks the UUID-as-event-id contract that relay consumers and idempotency tables depend on.
