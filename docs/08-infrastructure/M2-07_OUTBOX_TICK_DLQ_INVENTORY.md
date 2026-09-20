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
| customers | `customer_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✓ (G4) |
| delivery | `delivery_outbox` | `BIGSERIAL outbox_id` | `outbox_id` | ✓ | ✗ | ✗ | ✗ | ✓ |
| dispatch | `dispatch_outbox` | `UUID event_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✗ | ✗ | ✓ |
| drivers | `driver_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✓ (G4) |
| geography | `geo_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✓ (G4) |
| identity | `identity_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✓ (G4) |
| marketplace | `marketplace_outbox` | `UUID outbox_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✗ | ✗ | ✓ (G4) |
| matching | `matching_outbox` | `UUID event_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✗ | ✗ | ✓ |
| negotiations | `negotiation_outbox` | `UUID id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✓ | ✓ | ✓ |
| orders | `order_outbox` | `UUID event_id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✗ | ✗ | ✓ |
| reputation | `reputation_outbox` | `UUID id` | `sequence_number` | ✓ | ✓ (ADR-037) | ✓ | ✓ | ✓ |
| search | `search_outbox` | `BIGSERIAL id` | `id` | ✓ | ✗ | ✗ | ✗ | ✓ (G4) |
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
3. **~~`trace_id` missing on 5 tables~~** — **RESOLVED (CLM-0250, 2026-09-20).**
   `trace_id TEXT` added to all 6 tables that lacked it: `customer_outbox`,
   `driver_outbox`, `geo_outbox`, `identity_outbox`, `marketplace_outbox`,
   `search_outbox`. (Originally published as "5"; `identity_outbox` was also
   missing.) All 13 outbox tables now have `trace_id`. See §10.8.

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

> **Re-measured 2026-09-19 (`CLM-0238`).** The counts and affected-service lists
> below were re-derived directly from the 13 `services/*/contracts/schema.sql`
> files and from a repository-wide scan for exported drain functions and relay
> consumers. Four rows as originally published did not match the code; the
> corrected values are given here and the original claim is kept beside each one
> so the correction is by addition, not erasure. **G2 is closed, and G1 was closed on 2026-09-20** (see §10.1); the remaining
> six rows are open debt.

| # | Gap | Affected | Severity |
| --- | --- | --- | --- |
| ~~G1~~ | ~~**9 of 13 outbox tables have no delivery mechanism at all**~~ — **RESOLVED (`CLM-0241`+`CLM-0242`+`CLM-0243`; PRs #287 / #289 / #291; squashes `50d2cc4` / `99e7172` / `674e743`).** All 13 outbox tables now have a delivery mechanism: 9 thin drain adapters against the shared `packages/outbox/` contract (ADR-042) plus the 4 mechanisms that already existed. Re-measured 2026-09-20 on `main` at `fac0c66`, from the tree — not from reports | customers, delivery, drivers, geography, identity, matching, negotiations, orders, search | — closed; see §10.1 |
| ~~G2~~ | ~~6 outbox tables lack `sequence_number`~~ — **RESOLVED (`CLM-0237`, PR #279, squash `a08645f`)** | customers, delivery, drivers, geography, identity, search | — closed; see §1 item 1 |
| G3 | ~~**10 outbox tables lack `attempts` / `last_error`**~~ — **CLOSED by design (ADR-043, CLM-0253): 8 of 10 closed by migration (waves 1–2); the remaining 2 (`dispatch_outbox` and `marketplace_outbox`) are relay-consumed outboxes with no producer-side drain. Retry state lives in the consumer's relay ledger (`delivery_relay_consumed_events`, `search_relay_consumed_events`, `delivery_inventory_relay_consumed_events`), each with `attempt_count`, `last_error`, `consumed_status` including `poisoned`. Producer columns would have no writer and would duplicate consumer truth.** | ~~all~~ | — closed; see §10.10 |
| ~~G4~~ | ~~**6 outbox tables lack `trace_id`**~~ — **RESOLVED (`CLM-0250`): `trace_id TEXT` added to all 6 tables (customer_outbox, driver_outbox, geo_outbox, identity_outbox, marketplace_outbox, search_outbox) via per-service migrations. Drain adapters now `SELECT trace_id` and return it via `OutboxRecord.traceId`. Marketplace relay path (`PostgresMarketplaceEventSource` → `relay.ts`) selects and propagates `trace_id` in every `RelayLogEntry`.** | ~~customers, drivers, geography, identity, marketplace, search~~ | — closed; see §10.8 |
| G5 | ~~Search has no DLQ lifecycle (no acknowledgement, no reprocess)~~ — **closed for the eye, the hand and the record (`CLM-0247` · `CLM-0248` · `CLM-0249`).** Wave 1 shipped `GET /search/relay/dead-letters` (the eye, §10.5); wave 2 shipped `POST …/requeue` (the hand, §10.6); wave 3 shipped `POST …/acknowledgement` (the record, §10.7), which writes an all-or-none triple in migration `0003` and splits the metric into `total_poisoned` (reality) and `total_unacknowledged_poisoned` (what the verdict judges). **What is still NOT claimed:** no tick scheduler runs any of this on a timer — that is `G8`, a pre-declared gap, so every wave here is operator-driven. | search | Low — a poisoned row is measured, alerted, recoverable **and** dispositionable with a named acknowledger and a written reason; the residual risk is that nothing polls on a schedule (`G8`) |
| ~~G6~~ | ~~**3 of 8 idempotency tables store fingerprint only, not response**~~ — **RESOLVED (`CLM-0252`): `response_status` (nullable INTEGER) and `response_body` (nullable JSONB) added to `dispatch_idempotency`, `driver_idempotency`, and `matching_idempotency` via per-service migrations. CHECK constraint enforces both-or-neither. Port `IdempotencyStore.find()` returns `IdempotencyRecord` with `payloadFingerprint` + `recordedResponse` (nullable for legacy rows). `remember()` now stores the response. `classifyIdempotency`/`classifyReplay` return `{ kind: "replay", response }` on cache hit. Legacy rows (pre-G6) fall back to reprocessing.** | ~~dispatch, drivers, matching~~ | — closed; see §10.9 |
| G7 | Channel outbox has no drain | packages/channel-postgres | Low — package-level, not service-level |
| G8 | No tick scheduler exists in code | dispatch, negotiations, reputation | Expected — external scheduler is a deployment concern |

### 10.5 G5 wave 1 — the poisoned rows are measured (`CLM-0247`)

> Measured from the tree and from a real PostgreSQL run, per this inventory's
> own truth rule. **This is not a lifecycle claim.**

`services/search/src/relay.ts` marks an event `status = 'poisoned'` after
`maxAttempts` and **advances the checkpoint past it** — correct, because one bad
event must not stop the whole catalogue from indexing, but it meant the loss was
*silent*: the row sat in `search_relay_consumed_events` and nothing ever asked.

Wave 1 closes the measurement half only:

| Shipped | Where |
| --- | --- |
| Verdict domain (thresholds `1` / `10` / `86400s` — the same numbers delivery publishes) | `services/search/src/domain/relay-dead-letters.ts` |
| Single-snapshot read-only query over the ledger | `services/search/src/infrastructure/relay-dead-letter-store.ts` |
| `GET /search/relay/dead-letters`, scope `search:relay-dead-letters:read` | `services/search/src/http/app.ts` · documented in [`SEARCH_HTTP.md` §6](../04-api/SEARCH_HTTP.md) |
| Wired in the production composition root (not an optional port) | `services/search/src/http/server.ts` |
| 7 unit + 6 real-PostgreSQL integration cases | `services/search/src/__tests__/relay-dead-letters{,.integration}.test.ts` |

Two limits are **published, not hidden**: the verdict's age is measured from
`consumed_at` (the search ledger has no `updated_at`, so it is the age of the
*first attempt*, and the response says so in `alert.age_measured_from`), and
`alert.gates_readiness` is `false` — a poisoned row pages a human, it does not
pull search replicas out of routing.

The read is proven side-effect free by fingerprinting the ledger before and
after the call, rather than asserting it in a comment.

### 10.6 G5 wave 2 — the poisoned rows can be requeued (`CLM-0248`)

> Measured from the tree and from a real PostgreSQL run, per this inventory's
> own truth rule. **This is still not a full lifecycle claim** — see the limits
> below and wave 3.

Wave 1 gave the operator an eye. An eye without a hand is the worst operational
state there is: an alert that rings on something nobody can act on gets silenced,
and after it is silenced the *new* poisoned rows are invisible too.

Two things were measured in `services/search/src/relay.ts` before a line was
written, and they are why the route has the shape it has:

1. **`poisoned` is terminal, so the existing `replayFrom` does not requeue these
   rows.** `isTerminal(status)` is literally `status !== "pending"`, and step 1
   short-circuits a terminal row (*"duplicate delivery — already terminal"*)
   without a single attempt. Rewinding the checkpoint alone re-reads the row and
   re-reports `poisoned`.
2. **Lifting the row alone requeues nothing either**, because the checkpoint was
   deliberately advanced past it when it was poisoned. A row lifted to `pending`
   with the checkpoint still ahead of it is never read *and* drops out of wave
   1's measurement — the loss becomes **more hidden than before**.

So the action is two moves in one transaction, or nothing.

| Shipped | Where |
| --- | --- |
| Pure decision (`not_found` vs `not_poisoned` vs `requeued`) | `services/search/src/domain/relay-requeue.ts` |
| Both moves in one transaction, ledger row locked `FOR UPDATE` | `services/search/src/infrastructure/relay-requeue-store.ts` |
| `POST /search/relay/dead-letters/{ledger}/{outbox_id}/requeue`, scope `search:relay-dead-letters:requeue` | `services/search/src/http/app.ts` · documented in [`SEARCH_HTTP.md` §7](../04-api/SEARCH_HTTP.md) |
| Wired in the production composition root (not an optional port) | `services/search/src/http/server.ts` |
| 10 unit + 6 real-PostgreSQL integration cases | `services/search/src/__tests__/relay-requeue{,.integration}.test.ts` |

Limits **published, not hidden** — each one is in the response body, not only here:

| Limit | Published as | Why it is a limit and not a defect |
| --- | --- | --- |
| The rewind is to zero | `rewind_cost: "full_rescan_from_zero"` | The ledger has no `occurred_at`, so there is no *precise* rewind without copying a third field that becomes a duplicated source of truth. The rescan is reads only — idempotency makes every terminal row a no-op. |
| The rewind is a **row deletion**, not a written zero | `rewind_method: "checkpoint_row_deleted"` | `getCheckpoint` returns `null` when the row is absent and `readAfter(null)` already reads from the beginning, so deletion *is* the rewind — with one source of truth instead of a second copy of the zero sentinel. |
| It does not promise success | HTTP `202`, `outcome: "requeued"` | A row poisoned for a fixed reason will be poisoned again. The word is «requeued», never «reprocessed» or «recovered»: a caller who reads «fixed» closes the incident. |
| A row that exhausted its attempts gets **one** attempt | `evidence_preserved` | `attempt_count` and `last_error` are the only record of *why* it was poisoned, and the ledger keeps no history, so they are not reset — the relay computes `attempt = attempt_count + 1` and will re-poison with a *new* reason. Clearing them would make every rescue attempt erase the evidence. |
| `consumed_at` is not refreshed | `evidence_preserved` | It is what wave 1 measures the age of the loss from; touching it would **zero the age of a still-unresolved loss** and lift a week-old broken row out of the critical-age threshold without fixing anything. |
| No advisory lock, unlike delivery's requeue | §10.6 (here) | The search relay has no session lock of its own. Inventing a key here would produce a **decorative** lock the other side never takes — reassuring and unenforcing, which is worse than no lock. The ledger row itself is locked `FOR UPDATE`; racing a live relay cycle is a declared limit. |
| Does not gate readiness | `gates_readiness: false` | One bad event must not become a search outage. |

There is deliberately **no idempotency key**: the action is naturally
idempotent, because a second call finds the row `pending` and is answered `409`.

### 10.7 G5 wave 3 — the poisoned rows can be acknowledged (`CLM-0249`)

> Measured from the tree and from a real PostgreSQL run, per this inventory's own
> truth rule. This closes `G5` **as written** (eye + hand + record). It does not
> close `G8`: nothing here runs on a timer.

Wave 1 gave an eye, wave 2 a hand. Both leave one state unhandled: a row whose
cause still stands. Requeueing it re-poisons it; leaving it keeps `warning`
alight forever, and the only remaining operator move is to silence the signal —
after which the **next** loss is invisible too. That is how a measurement becomes
worse than no measurement.

The disposition is therefore **an added witness, never a deleted row**.

| Shipped | Where |
| --- | --- |
| Triple columns + four CHECKs + partial index, forward and down | `services/search/drizzle/0003_relay_acknowledgement{,.down}.sql` · `contracts/schema.sql` §5 · `src/db/schema.ts` |
| Pure normalisation (trim-then-measure), acknowledger composition, and the three-way decision | `services/search/src/domain/relay-acknowledgement.ts` |
| `SELECT … FOR UPDATE` + write, rollback on every non-write outcome | `services/search/src/infrastructure/relay-acknowledgement-store.ts` |
| Requeue now **clears** the triple in the same statement | `services/search/src/infrastructure/relay-requeue-store.ts` |
| Metric split + new verdict reason `all_poisoned_acknowledged` | `services/search/src/domain/relay-dead-letters.ts` · `infrastructure/relay-dead-letter-store.ts` |
| `POST /search/relay/dead-letters/{ledger}/{outbox_id}/acknowledgement`, scope `search:relay-dead-letters:acknowledge` | `services/search/src/http/app.ts` · documented in [`SEARCH_HTTP.md` §8](../04-api/SEARCH_HTTP.md) |
| Wired in the production composition root, sharing the pool | `services/search/src/http/server.ts` · `packages/search-e2e/src/harness.ts` |
| 14 unit + 7 real-PostgreSQL integration cases | `services/search/src/__tests__/relay-acknowledgement{,.integration}.test.ts` |

Decisions that are **not** copies of delivery's wave, each measured first:

| Decision | Why |
| --- | --- |
| Age is measured from `consumed_at`, so `oldest_unacknowledged_poisoned_at` is a `min(consumed_at) FILTER (…)` | The search ledger has **no `updated_at`** (delivery's has one). Adding one for this wave would have been a second source of truth for a timestamp nobody else reads. The limit is published in the response as `age_measured_from`. |
| No advisory lock (same as wave 2) | Same reason: the search relay holds no session lock, so a lock here would be decorative. The row is locked `FOR UPDATE`. |
| `already_acknowledged` answers `200`, not `409` | The caller did not err and the state they wanted holds. The response carries the **first** record, so the second caller sees who preceded them instead of assuming the disposition is theirs. |
| The row keeps `status = 'poisoned'` — no sixth status | A new status would drop the row out of every query that counts poisoned rows, which is the hiding this wave exists to prevent. |
| `ck_…_ack_poisoned_only` exists so that **requeue must clear the triple** | Without it, a requeued row could carry "handled" into a live state, be re-poisoned later, and read as already-dispositioned — invisible in the verdict forever. The database refuses that shape, and the integration test proves the refusal with a direct `UPDATE` (`23514`), i.e. bypassing the adapter. |

Limits **declared, not implied**: an acknowledgement never expires (no `snooze`
was implemented, and its absence is written rather than left to be assumed), it
fixes nothing by itself, and no notification leaves the service when one is
written — there is no notifier in this boundary at all (`G8`).

### 10.1 G1 closure — re-measured 2026-09-20 on `main` at `fac0c66`

> Measured from the tree, per the inventory's own truth rule. Neither this
> section nor the adapters it lists are a production proof: the adapters are
> exercised by integration tests against real PostgreSQL, and `EventSinkPort`
> is **not** yet wired to a real message broker. G1 as written ("no delivery
> mechanism at all") is closed; delivery to an external broker is separate debt
> and is tracked in §10.2.

```
rg -n "export class \\w*OutboxStore|export (async )?function drain\\w*" services --glob '!**/__tests__/**'
ls services/*/src/outbox/*outbox-store.ts
```

| Outbox table | Mechanism | Location | Wave |
| --- | --- | --- | --- |
| `customer_outbox` | drain adapter | `services/customers/src/outbox/customer-outbox-store.ts` | 1 (`CLM-0241`) |
| `driver_outbox` | drain adapter | `services/drivers/src/outbox/driver-outbox-store.ts` | 2 (`CLM-0242`) |
| `geo_outbox` | drain adapter | `services/geography/src/outbox/geo-outbox-store.ts` | 2 (`CLM-0242`) |
| `identity_outbox` | drain adapter | `services/identity/src/outbox/identity-outbox-store.ts` | 2 (`CLM-0242`) |
| `delivery_outbox` | drain adapter | `services/delivery/src/outbox/delivery-outbox-store.ts` | 3 (`CLM-0243`) |
| `matching_outbox` | drain adapter | `services/matching/src/outbox/matching-outbox-store.ts` | 3 (`CLM-0243`) |
| `negotiation_outbox` | drain adapter (implements `recordDeliveryFailure`) | `services/negotiations/src/outbox/negotiation-outbox-store.ts` | 3 (`CLM-0243`) |
| `order_outbox` | drain adapter | `services/orders/src/outbox/order-outbox-store.ts` | 3 (`CLM-0243`) |
| `search_outbox` | drain adapter | `services/search/src/outbox/search-outbox-store.ts` | 3 (`CLM-0243`) |
| `reputation_outbox` | own drain (pre-existing) | `services/reputation/src/outbound/drain-outbox.ts:140` | — |
| `subscription_outbox` | own drain (pre-existing) | `services/subscriptions/src/app/events.ts:278` | — |
| `dispatch_outbox` | relay consumer (pre-existing) | `services/delivery/src/relay.ts` | — |
| `marketplace_outbox` | relay consumer ×2 (pre-existing) | `services/search/src/relay.ts` · `services/delivery/src/marketplace-inventory-relay.ts` | — |

**13 of 13.** Test evidence: 4 integration tests per adapter against real
PostgreSQL (wave 1: 4 + 6 unit · wave 2: 12 · wave 3: 20), all green under the
`db-integration` matrix and under `db-integration-shared` (all suites on one
database, so cross-suite isolation is checked too).

### 10.2 What G1's closure does **not** claim

| Claim | Status |
| --- | --- |
| Every outbox table can be drained through one audited contract | ✅ measured above |
| Drain semantics (ordering, locking, failure recording) are test-proven on real PostgreSQL | ✅ 36 integration tests + 6 unit tests |
| Events actually reach a message broker in a deployed environment | ⚪ **NOT VERIFIED** — `EventSinkPort` has no production implementation; see ADR-042 §"ما بعد الموجات" |
| A scheduler invokes the drains periodically | ⚪ **NOT VERIFIED** — G8; external scheduler is a deployment concern (M2-02 / M2-09) |

### How the corrected values were measured

| Claim | Command / evidence |
| --- | --- |
| Drain functions | `rg "export (async )?function drain\w*" services --glob '!**/__tests__/**'` → exactly two hits: `services/reputation/src/outbound/drain-outbox.ts:140`, `services/subscriptions/src/app/events.ts:278` |
| Relay consumers | `services/search/src/relay.ts` reads `marketplace_outbox`; `services/delivery/src/relay.ts` reads `dispatch_outbox`; `services/delivery/src/marketplace-inventory-relay.ts` reads `marketplace_outbox` |
| `attempts` / `last_error` / `trace_id` | per-table `CREATE TABLE …_outbox` block of each `services/*/contracts/schema.sql`; present only on `negotiation_outbox`, `reputation_outbox`, `subscription_outbox` for `attempts`/`last_error` |

**The four delivery mechanisms that do exist**, so the 9 in G1 are the complement
of this set, not of the drain list alone:

| Outbox table | Mechanism | Location |
| --- | --- | --- |
| `reputation_outbox` | own drain | `services/reputation/src/outbound/drain-outbox.ts:140` |
| `subscription_outbox` | own drain | `services/subscriptions/src/app/events.ts:278` |
| `dispatch_outbox` | relay consumer | `services/delivery/src/relay.ts` |
| `marketplace_outbox` | relay consumer ×2 | `services/search/src/relay.ts` · `services/delivery/src/marketplace-inventory-relay.ts` |


### 10.3 G3 wave 1 — `attempts` / `last_error` on 5 outbox tables (`CLM-0245`)

> Measured from the tree, not from a report. Wave 1 adds the two retry-tracking
> columns to the five tables whose drain adapters were the thinnest, and makes
> `OutboxDrainStore.recordDeliveryFailure` — optional in the shared contract —
> **implemented** for each of them, so a failed delivery is now durable in the
> row instead of living only in the in-memory `DrainReport.failed`.

```
rg -n "attempts" services/*/contracts/schema.sql
rg -n "recordDeliveryFailure" services/*/src/outbox/*-outbox-store.ts
```

| Outbox table | Contract SQL | Migration | `recordDeliveryFailure` | Wave |
| --- | --- | --- | --- | --- |
| `customer_outbox` | `services/customers/contracts/schema.sql` | `drizzle/0002_outbox_retry_tracking.sql` | implemented | 1 (`CLM-0245`) |
| `driver_outbox` | `services/drivers/contracts/schema.sql` | `drizzle/0002_outbox_retry_tracking.sql` | implemented | 1 (`CLM-0245`) |
| `geo_outbox` | `services/geography/contracts/schema.sql` | `drizzle/0002_outbox_retry_tracking.sql` | implemented | 1 (`CLM-0245`) |
| `identity_outbox` | `services/identity/contracts/schema.sql` | `drizzle/0002_outbox_retry_tracking.sql` | implemented | 1 (`CLM-0245`) |
| `delivery_outbox` | `services/delivery/contracts/schema.sql` | `drizzle/0004_outbox_retry_tracking.sql` | implemented | 1 (`CLM-0245`) |
| `negotiation_outbox` | — (already had both columns) | — | implemented before `CLM-0245` | — |

**Semantics enforced by the migration and the adapters** (identical in all five):

- `attempts INTEGER NOT NULL DEFAULT 0` — incremented on **both** paths:
  `recordDeliveryFailure` (`attempts + 1`, `last_error = <reason, 500 chars>`)
  and `markPublished` (`attempts + 1`, `last_error = NULL`). So `attempts` is a
  count of delivery attempts, not of failures, and a successful publish clears
  the stale error text instead of leaving a lie in the row.
- `last_error TEXT` — nullable; `NULL` means "no failure since the last success".
- Both migrations carry `@wasla-upgrade-proof: all-non-baseline` and ship a
  matching `.down.sql`, so the existing reversibility and
  upgrade-with-data suites cover them without a new bespoke test.

**What is NOT claimed.** No retry *scheduler* and no backoff: nothing reads
`attempts` to decide when to retry, and nothing quarantines a row after N
failures. G3 is about the *record*, not the policy; the policy stays in G8
(no tick scheduler) and in the DLQ rows (G5). The 5 remaining tables
(dispatch, marketplace, matching, orders, search) keep the pre-`CLM-0245`
behaviour: the failure is reported in `DrainReport.failed` and is lost when the
process exits.

**Evidence.** One integration test per service against real PostgreSQL —
`persists attempts and last_error on delivery failure (G3)` in
`services/<svc>/src/__tests__/outbox-drain.integration.test.ts` — asserting
`attempts = 1` + `last_error` set + `published_at IS NULL` after a failed
drain, then `attempts = 2` + `last_error IS NULL` + `published_at` set after a
successful one, and that `claimUnpublished` returns the real `attempts` value.
25 tests green (5 × 5) plus the migration reversibility and upgrade-with-data
suites for all five services.


### 10.4 G3 wave 2 — three more tables, and why the last two are different (`CLM-0246`)

Wave 2 closes `matching_outbox`, `order_outbox` and `search_outbox` exactly as
wave 1 closed the first five: two columns in the contract SQL and the Drizzle
schema, one reversible migration per service (`0002_outbox_retry_tracking`,
`@wasla-upgrade-proof: all-non-baseline`), `recordDeliveryFailure` implemented,
`markPublished` incrementing `attempts` and clearing `last_error`, and one
integration test per service against real PostgreSQL. Measured after the change:
**11 of 13 outbox tables now record delivery attempts in the row.**

```
rg -n "attempts" services/*/contracts/schema.sql
rg -n "recordDeliveryFailure" services/*/src/outbox/*-outbox-store.ts
```

| Outbox table | Migration | `recordDeliveryFailure` | Wave |
| --- | --- | --- | --- |
| `matching_outbox` | `services/matching/drizzle/0002_outbox_retry_tracking.sql` | implemented | 2 (`CLM-0246`) |
| `order_outbox` | `services/orders/drizzle/0002_outbox_retry_tracking.sql` | implemented | 2 (`CLM-0246`) |
| `search_outbox` | `services/search/drizzle/0002_outbox_retry_tracking.sql` | implemented | 2 (`CLM-0246`) |

**Why `dispatch_outbox` and `marketplace_outbox` are NOT in this wave** —
measured, not assumed:

```
rg -ln "dispatch_outbox|marketplace_outbox" services --glob '!**/__tests__/**' --glob '!**/contracts/**'
ls services/dispatch/src/outbox/ services/marketplace/src/outbox/   # neither exists
```

Neither table has a producer-side drain adapter. They are **pulled** by relay
consumers in other services (`services/delivery/src/relay.ts`,
`services/delivery/src/marketplace-inventory-relay.ts`,
`services/search/src/relay.ts`), and nothing in the producing service ever marks
one of their rows published or failed. Adding `attempts`/`last_error` there would
ship two columns with **no writer** — code whose existence is not use, which the
governance rules forbid reading as progress. Their retry state already lives on
the consumer side (`*_relay_checkpoint`, `*_relay_consumed_events`, and in
`delivery` a full DLQ lifecycle, §4.23–4.27). Closing G3 for these two therefore
needs a decision about **where the record belongs** — producer row vs consumer
checkpoint — not another mechanical migration, so it stays open and is stated
here rather than silently dropped.

### 10.8 G4 closure — `trace_id` on all 6 remaining outbox tables (`CLM-0250`)

**Measured from the tree** on 2026-09-20. The 6 outbox tables that lacked
`trace_id` now have it:

| Service | Table | Migration | Adapter SELECT | `OutboxRecord.traceId` |
| --- | --- | --- | --- | --- |
| customers | `customer_outbox` | `0003_outbox_trace_id.sql` | ✓ | row value or `null` |
| drivers | `driver_outbox` | `0003_outbox_trace_id.sql` | ✓ | row value or `null` |
| geography | `geo_outbox` | `0003_outbox_trace_id.sql` | ✓ | row value or `null` |
| identity | `identity_outbox` | `0003_outbox_trace_id.sql` | ✓ | row value or `null` |
| search | `search_outbox` | `0004_outbox_trace_id.sql` | ✓ | row value or `null` |
| marketplace | `marketplace_outbox` | `0002_outbox_trace_id.sql` | n/a — relay-consumed | see below |

`delivery_outbox` already had `trace_id` (it was the reference pattern). The
remaining 6 are now aligned.

**Marketplace relay path:** `marketplace_outbox` has no producer-side drain
(same as G3 — see §10.4), but it is relay-consumed by the search service.
`PostgresMarketplaceEventSource.readAfter()` now `SELECT trace_id` and the
`MarketplaceOutboxRow` type carries it. The relay propagates it into every
`RelayLogEntry` — so the trace context written by the marketplace producer
survives the relay hop and appears in search's structured logs.

**What this does NOT claim:**
- No producer-side code was changed to write `trace_id` values. The column is
  nullable and defaults to `NULL`. Producers that already write trace context
  (e.g. delivery) continue to do so; producers that don't yet write it will
  store `NULL` until they are updated — which is a separate, per-service
  concern outside M2-07's scope.
- `marketplace_outbox` and `dispatch_outbox` still have no producer-side drain
  (G3 §10.4) — this is about the column existing and the relay reading it, not
  about a drain being added.

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

> **Superseded 2026-09-19 (`CLM-0238`).** This section was written while M2-05C
> was still blocked. Three of its four bullets were discharged by `CLM-0233`
> ([`M2-07_CRASH_RETRY_DEDUPE_PROOF.md`](../12-testing/M2-07_CRASH_RETRY_DEDUPE_PROOF.md)),
> whose three integration tests live in
> `services/delivery/src/__tests__/relay-concurrent-dedupe.integration.test.ts`
> and run under the `db-integration (delivery)` CI job. The original text is kept
> struck through so the correction is by addition.

- ~~No integration test runs a relay crash → recovery → verify-no-double-processing
  cycle against a real PostgreSQL (the upgrade drill from M2-05C is blocked).~~
  **Discharged** — `crash mid-batch: a relay that fails after claiming leaves
  events in pending — next poll retries` (test 2 of 3).
- ~~No test demonstrates concurrent relay instances with `SKIP LOCKED`.~~
  **Discharged** — `two concurrent relay instances claim disjoint event sets —
  no double-processing` (test 1 of 3).
- ~~No test demonstrates the DLQ acknowledgement → requeue → reprocess cycle
  end-to-end (unit tests exist, but no integration proof).~~ **Partly open** —
  dedupe is proven by `dedupe: event_id uniqueness is enforced — duplicate
  insert is rejected` (test 3 of 3), but the full acknowledge → requeue →
  reprocess cycle still has no end-to-end integration proof. Tracked as part of
  G5 for `search`; `delivery` has the lifecycle but not the integration proof.
- **Still open** — no tick has a crash-mid-tick recovery test (the tick is
  idempotent by construction, but the proof is in unit tests, not in a live
  crash scenario). Relates to G8.

M2-05C is no longer blocking: the upgrade/repair drill was completed under
`CLM-0232` against Supabase pooler PostgreSQL 17.6.

### 10.10 G3 closure — relay-consumed outbox retry state (ADR-043, CLM-0253)

G3 is closed by design, not by migration. The two remaining outbox tables —
`dispatch_outbox` and `marketplace_outbox` — have no producer-side drain. Their
rows are pulled by relay consumers in other service boundaries, and retry/error
state lives in the consumer's relay ledger.

**ADR-043** documents the decision: producer retry columns are not applicable
for relay-consumed outboxes. Measured from the tree on `main` at `218a812`:

| Producer table | Consumer | Consumer ledger | `attempt_count` | `last_error` | `poisoned` |
|---|---|---|---|---|---|
| `dispatch_outbox` | delivery | `delivery_relay_consumed_events` | ✅ | ✅ | ✅ |
| `marketplace_outbox` | search | `search_relay_consumed_events` | ✅ | ✅ | ✅ |
| `marketplace_outbox` | delivery | `delivery_inventory_relay_consumed_events` | ✅ | ✅ | ✅ |

All three consumer ledgers have `attempt_count`, `last_error`, and
`consumed_status` (including `poisoned`). The retry/error lifecycle is complete
and owned by the consumer.
