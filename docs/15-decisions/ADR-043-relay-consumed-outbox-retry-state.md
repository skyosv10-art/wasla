# ADR-043: Relay-consumed outbox retry state belongs in the consumer, not the producer

**Status:** Accepted
**Date:** 2026-09-20
**Decider:** Perplexity Computer (autonomous technical authority)
**Supersedes:** None
**Related:** ADR-042 (outbox delivery mechanism), M2-07 gap G3

## Context

Two outbox tables — `dispatch_outbox` and `marketplace_outbox` — have no producer-side drain. Their rows are pulled by relay consumers in other service boundaries:

| Producer table | Consumer service | Consumer ledger |
|---|---|---|
| `dispatch_outbox` | delivery | `delivery_relay_consumed_events` |
| `marketplace_outbox` | search | `search_relay_consumed_events` |
| `marketplace_outbox` | delivery | `delivery_inventory_relay_consumed_events` |

G3 (M2-07 inventory §10) originally measured 10 outbox tables lacking `attempts`/`last_error` columns. Waves 1–2 (CLM-0245, CLM-0246) closed 8 of 10 by adding producer-side `attempts`/`last_error` to tables that have a producer-side drain adapter. The remaining 2 were deliberately excluded because neither producing service has a drain adapter at all.

## Decision

**Producer retry columns are not applicable for relay-consumed outboxes.** Retry and error state for `dispatch_outbox` and `marketplace_outbox` lives in the consumer's relay ledger, not in the producer table.

## Rationale

1. **No producer-side writer.** Neither `services/dispatch` nor `services/marketplace` has an outbox drain. Nothing in the producing service ever marks a row published or failed. Adding `attempts`/`last_error` columns would create columns with no writer — they would always read `0`/`NULL`.

2. **Marketplace has two consumers.** `marketplace_outbox` is read by both the search relay and the delivery inventory relay. A single producer-side `attempts` column would be ambiguous: which consumer's attempts does it track? The answer is both, separately, in their own ledgers.

3. **Consumer ledgers already exist and are durable.** All three relay consumers have `*_relay_consumed_events` tables with `consumed_status`, `attempt_count`, `last_error`, and `consumed_at`. Failed attempts increment `attempt_count` and write `last_error`. After `maxAttempts`, the row is `poisoned` (dead-lettered). This is the complete retry/error lifecycle, owned by the consumer.

4. **Least duplicated truth sources.** The user's execution directive requires choosing the path with "least duplicated truth sources." Adding producer-side retry columns would duplicate the consumer's ledger state, creating two sources of truth for the same fact.

5. **ADR-042 precedent.** The shared outbox delivery contract (ADR-042) already separates the concern: drain adapters belong to the producing service, relay consumers belong to the consuming service. Retry state follows the same boundary.

## Consequences

- G3 is closed by design, not by migration. No columns are added to `dispatch_outbox` or `marketplace_outbox`.
- If a future drain adapter is added to `dispatch` or `marketplace`, it should add producer-side `attempts`/`last_error` at that point, following the G3 wave 1/2 pattern.
- The consumer ledgers are the system of record for retry state of relay-consumed outbox events.

## Evidence

Measured from the tree on `main` at `218a812` (2026-09-20):

- `delivery_relay_consumed_events`: `attempt_count INTEGER NOT NULL CHECK (>= 1)`, `last_error TEXT`, `consumed_status TEXT NOT NULL CHECK IN (...)` — includes `poisoned` status. [schema.sql §delivery]
- `delivery_inventory_relay_consumed_events`: same columns. [schema.sql §delivery]
- `search_relay_consumed_events`: `attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (>= 0)`, `last_error TEXT`, `consumed_status` including `poisoned`. [schema.sql §search]
- Relay code: `services/delivery/src/relay.ts` marks consumed events with `attempt_count` increment and `last_error` on failure; `services/search/src/relay.ts` does the same. Both dead-letter after `maxAttempts`.
