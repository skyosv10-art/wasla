# M2-07 — Outbox / Tick / DLQ Inventory

**CLM-0231** · **Status:** Inventory complete · **Date:** 2026-09-19

This is the first deliverable of M2-07 (workers/outbox/ticks/DLQ). It is a
read-only code inventory of every outbox table, relay consumer, tick use case,
dead-letter mechanism, idempotency store, and checkpoint in the repository. No
code was changed.

## 1. Outbox Tables — 13 services

Every HTTP service writes domain events into its own outbox table in the same
transaction as the state change. The contract is `contracts/schema.sql` per
service — applied verbatim by `db:migrate` (CLM-0230).

| Service | Table | PK type | Sort key | `published_at` | `sequence_number` | `attempts` | `last_error` | `trace_id` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| customers | `customer_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✗ |
| delivery | `delivery_outbox` | `BIGSERIAL outbox_id` | `outbox_id` | ✓ | ✗ | ✗ | ✗ | ✓ |
| dispatch | `dispatch_outbox` | `UUID event_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✗ | ✗ | ✓ |
| drivers | `driver_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✗ |
| geography | `geo_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✗ |
| identity | `identity_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✗ |
| marketplace | `marketplace_outbox` | `UUID outbox_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✗ | ✗ | ✗ |
| matching | `matching_outbox` | `UUID event_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✗ | ✗ | ✓ |
| negotiations | `negotiation_outbox` | `UUID id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✓ | ✓ | ✓ |
| orders | `order_outbox` | `UUID event_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✗ | ✗ | ✓ |
| reputation | `reputation_outbox` | `UUID id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✓ | ✓ | ✓ |
| search | `search_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✗ |
| subscriptions | `subscription_outbox` | `UUID event_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✓ | ✓ | ✓ |

### Schema consistency gaps

1. **~~`sequence_number` missing on 6 tables~~** — **RESOLVED (CLM-0237, 2026-09-19).**
   `delivery_outbox` was already correct (index on `outbox_id`). For the other 5
   tables (`customer_outbox`, `driver_outbox`, `geo_outbox`, `identity_outbox`,
   `search_outbox`), the BIGSERIAL `id` is already a monotonic sequence
   (ADR-037 §Scope). The fix was to align the unpublished-events index and
   ORDER BY from `occurred_at` to `id`, so the query planner can use the index
   for the drain/replay path. No redundant `sequence_number` column was added.
2. **`attempts` / `last_error` present on 3 tables only** — `negotiation_outbox`,
   `reputation_outbox`, `subscription_outbox`. The other 10 have no in-table retry
   counter.
3. **`trace_id` missing on 5 tables** — `customer_outbox`, `driver_outbox`,
   `geo_outbox`, `marketplace_outbox`, `search_outbox`.

## 2. Relay Consumers — 3 services, 4 consumers

Relays consume another service's outbox, project into a read model or mirror,
and track progress via a checkpoint table.

| Consumer | Source outbox | Target | Checkpoint table | Consumed-events table | ADR |
| --- | --- | --- | --- | --- | --- |
| `search/src/relay.ts` | `marketplace_outbox` | `search_products` read model | `search_relay_checkpoint` | `search_relay_consumed_events` | ADR-025 |
| `delivery/src/relay.ts` | `dispatch_outbox` | `delivery_task` state mirror | `delivery_relay_checkpoint` | `delivery_relay_consumed_events` | ADR-026 §2.4 |
| `delivery/src/marketplace-inventory-relay.ts` | `marketplace_outbox` | `delivery_inventory_observations` | `delivery_inventory_relay_checkpoint` | `delivery_inventory_relay_consumed_events` | ADR-026 §2.3 |

### Relay reliability contract (uniform across all three)

| Property | Mechanism |
| --- | --- |
| **Idempotency** | Consumed-events table keyed by `event_id` / `outbox_id`; terminal status is a no-op on replay |
| **Ordering** | Per-aggregate watermark `(occurred_at, event_id)` or `sequence_number`; stale events → `skipped_stale` |
| **Retry** | Retryable failure leaves row `pending`; checkpoint does NOT advance; next poll retries |
| **Dead letter** | After `maxAttempts` → `poisoned` (terminal); checkpoint advances past it |
| **Checkpoint** | Last `(created_at, outbox_id)` or `(occurred_at, event_id)` that reached terminal status; relay-owned, never writes source `published_at` |
| **Replay** | `replayFrom(null)` resets checkpoint; idempotency makes applied events no-ops; `rebuildAll()` clears projection + checkpoint |
| **Version compat** | Only `event_version === "v1"` projected; else poisoned |
| **Observability** | Structured log line per event |

## 3. Dead-Letter / Poison Handling

### delivery — full DLQ lifecycle

| Module | Role |
| --- | --- |
| `domain/relay-dead-letters.ts` | Domain model for dead-lettered events |
| `domain/relay-acknowledgement.ts` | Acknowledge a poisoned event (three-field atomic: `acknowledged_at` + `acknowledged_by` + `acknowledgement_reason`) |
| `domain/relay-reprocess.ts` | Reprocess a poisoned event after acknowledgement |
| `infrastructure/relay-dead-letter-store.ts` | Postgres store for dead-letter rows |
| `infrastructure/relay-dead-letter-acknowledgement-store.ts` | Postgres store for acknowledgements |
| `infrastructure/relay-requeue-store.ts` | Requeue a poisoned event back to `pending` |
| `infrastructure/relay-advisory-lock.ts` | `FOR UPDATE SKIP LOCKED` advisory lock (prevents duplicate processing) |
| `drizzle/0003_relay_poisoned_acknowledgement.sql` | Migration: adds acknowledgement columns to `delivery_relay_consumed_events` |

The poisoned-acknowledgement constraint is enforced in the database: requeuing a
row back to `pending` **must** null out `acknowledged_at` / `acknowledged_by` /
`acknowledgement_reason` — a CHECK constraint refuses a live row that still
carries an acknowledgement.

### search — in-table poison

`search_relay_consumed_events.status` has a `'poisoned'` terminal state with
`last_error` and `attempt_count`. No separate dead-letter store, no
acknowledgement flow, no requeue. A poisoned event blocks the checkpoint from
advancing past it (the relay skips it on the next poll).

**Gap:** search has no DLQ lifecycle — no acknowledgement, no reprocess, no
requeue. A poisoned event is permanently terminal with no operator action
available. This is a known design asymmetry with delivery.

## 4. Tick Use Cases — 3 services

Ticks are time-driven use cases invoked by an external caller (HTTP route or
scheduler). No `setInterval` or `setTimeout` inside any service process.

| Service | Module | Route | What it does |
| --- | --- | --- | --- |
| dispatch | `use-cases/tick.ts` + `run-tick.ts` | `POST /dispatch/tick` | Expire offers → complete waves → escalate to community → exhaust jobs |
| negotiations | `use-cases/run-tick.ts` | `POST /negotiations/tick` | Expire rounds → expire threads → close budget-spent threads → retry hand-offs |
| reputation | `use-cases/run-tick.ts` + `outbound/drain-outbox.ts` | `POST /reputation/tick` | Recompute scores → evaluate fraud rules → drain outbox (publish events) |

### Tick idempotency

All three ticks are **idempotent by construction**: every step is "find what is
due, settle it." Running twice with the same clock reading does the work once
and reports zeroes the second time. There is no "last processed" cursor.

### Tick scheduling (external)

No service has an internal scheduler. Ticks are expected to be called by an
external scheduler (Render Cron Job, Kubernetes CronJob, etc.). This is a
**deployment-time concern** — not code.

## 5. Idempotency Tables — 8 services

| Service | Table | Key | Scope/Route | Response cached? |
| --- | --- | --- | --- | --- |
| delivery | `delivery_idempotency_keys` | `idempotency_key` | Route-closed (5 store-order routes) | ✓ status + body |
| dispatch | `dispatch_idempotency` | `idempotency_key` | — | ✗ (fingerprint only) |
| drivers | `driver_idempotency` | `idempotency_key` | — | ✗ (fingerprint only) |
| marketplace | `marketplace_idempotency` | `(route_key, idempotency_key)` | Route-key pattern | ✓ status + body |
| matching | `matching_idempotency` | `idempotency_key` | — | ✗ (fingerprint only) |
| negotiations | `negotiation_idempotency` | `idempotency_key` | Scope (6 operations) | ✓ status + body |
| reputation | `reputation_idempotency` | `idempotency_key` | Scope (4 operations) | ✓ status + body |
| subscriptions | `subscription_idempotency` | `idempotency_key` | Route-key | ✓ status + body |

**Gap:** 5 idempotency tables store only a payload fingerprint, not the response.
If the same request is replayed, the service cannot return the cached response —
it must reprocess. The 3 that cache the response (delivery, marketplace,
negotiations, reputation, subscriptions) can return the original response
directly.

## 6. Outbox Drain / Publisher — 1 service

Only `reputation` has a drain-outbox module (`outbound/drain-outbox.ts`). It
reads unpublished rows from `reputation_outbox`, delivers them (to an external
sink), and marks `published_at`. The drain uses `FOR UPDATE SKIP LOCKED` so two
concurrent instances never see the same row.

**Gap:** 8 services write to their outbox but have no drain/publisher:

| Service | Outbox table | Drain module |
| --- | --- | --- |
| customers | `customer_outbox` | ✗ |
| drivers | `driver_outbox` | ✗ |
| geography | `geo_outbox` | ✗ |
| identity | `identity_outbox` | ✗ |
| marketplace | `marketplace_outbox` | ✗ |
| matching | `matching_outbox` | ✗ |
| orders | `order_outbox` | ✗ |
| subscriptions | `subscription_outbox` | ✗ |

This is a **declared debt** — the reputation drain-outbox comments say: "حتى
الطور 08 كانت كل خدمة تكتب في صندوقها ولا أحد يصرّفه — دين مُعلَن." The
search and delivery relays consume *other* services' outboxes but do not drain
their own.

## 7. Consumed-Events Tables — 2 services

| Service | Table | Statuses | Poison supported? |
| --- | --- | --- | --- |
| delivery | `delivery_relay_consumed_events` | `pending`, `applied`, `skipped_stale`, `ignored`, `ignored_foreign`, `poisoned` | ✓ (with acknowledgement) |
| delivery | `delivery_inventory_relay_consumed_events` | Same as above | ✓ (with acknowledgement) |
| search | `search_relay_consumed_events` | `pending`, `applied`, `skipped`, `skipped_stale`, `ignored`, `poisoned` | ✓ (in-table, no acknowledgement) |

## 8. Checkpoint Tables — 2 services, 3 tables

| Service | Table | Keyed by |
| --- | --- | --- |
| delivery | `delivery_relay_checkpoint` | Per-`delivery_task` watermark |
| delivery | `delivery_inventory_relay_checkpoint` | Per-`(store, product)` sequence |
| search | `search_relay_checkpoint` | Single row (relay-owned offset) |

## 9. Channel-Postgres Outbox (package)

`packages/channel-postgres/src/outbox.ts` implements `OutboxPort` for the
channel domain. Events land in `channel_outbox`. No relay/drain consumer
exists for channel events — this is a **package-level outbox with no drain**.

## 10. Summary of Gaps

| # | Gap | Affected | Severity |
| --- | --- | --- | --- |
| G1 | 8 services have outbox but no drain/publisher | customers, drivers, geography, identity, marketplace, matching, orders, subscriptions | High — events written but never delivered |
| G2 | 6 outbox tables lack `sequence_number` | customers, delivery, drivers, geography, identity, search | Medium — same-transaction ordering not monotonic |
| G3 | 5 outbox tables lack `attempts` / `last_error` | customers, delivery, drivers, geography, identity, marketplace, matching, orders, search | Medium — no in-table retry tracking |
| G4 | 5 outbox tables lack `trace_id` | customers, drivers, geography, marketplace, search | Low — observability gap |
| G5 | Search has no DLQ lifecycle (no acknowledgement, no reprocess) | search | Medium — poisoned events are permanently terminal |
| G6 | 5 idempotency tables store fingerprint only, not response | dispatch, drivers, matching (3 of 8) | Low — replay reprocesses instead of returning cached response |
| G7 | Channel outbox has no drain | packages/channel-postgres | Low — package-level, not service-level |
| G8 | No tick scheduler exists in code | dispatch, negotiations, reputation | Expected — external scheduler is a deployment concern |

## 11. What M2-07's crash/retry/dedupe proof must cover

Based on this inventory, the M2-07 exit gate ("crash/retry/dedupe proof") must
demonstrate:

1. **Crash safety:** A relay crash mid-batch leaves consumed-events in `pending`
   (not `applied`); checkpoint does not advance; next poll retries. All three
   relays already guarantee this by design.
2. **Retry safety:** A retried event is idempotent — `applied` status is a
   no-op. A `poisoned` event is terminal and does not block the checkpoint.
3. **Dedupe safety:** `event_id` / `outbox_id` uniqueness in consumed-events
   tables prevents double-processing. `FOR UPDATE SKIP LOCKED` prevents
   duplicate claims across concurrent relay instances.
4. **DLQ lifecycle (delivery only):** A poisoned event can be acknowledged,
   reprocessed, or requeued — with database-enforced atomicity.
5. **Tick idempotency:** All three ticks are idempotent by construction — a
   duplicate tick does nothing.

### What is NOT yet proven

- No integration test runs a relay crash → recovery → verify-no-double-processing
  cycle against a real PostgreSQL (the upgrade drill from M2-05C is blocked).
- No test demonstrates concurrent relay instances with `SKIP LOCKED`.
- No test demonstrates the DLQ acknowledgement → requeue → reprocess cycle
  end-to-end (unit tests exist, but no integration proof).
- No tick has a crash-mid-tick recovery test (the tick is idempotent, but
  the proof is in the tests, not in a live crash scenario).

These are the next executable items once M2-05C (PostgreSQL upgrade drill) is
unblocked.
