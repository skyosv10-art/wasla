# WASLA MARKET — Roadmap

**Repository:** `skyosv10-art/wasla` (this repository is WASLA MARKET)
**Last updated:** 2026-09-12 (M5-13 review 18/N — the inventory-conflict acknowledgement write route)
**Previous milestone:** the delivery idempotency-key sweeper now has a caller: a one-shot CLI (`pnpm --filter @wasla/delivery-service sweep:idempotency`) that runs a single sweep round, prints one machine-readable JSON report line to stdout and exits with a distinct code per outcome (ADR-026 §4.16 — lifting the first debt declared in §4.15), documented as a schedule in `docs/14-runbooks/DELIVERY_IDEMPOTENCY_SWEEP.md`. Roadmap and roadmap-freshness gate remain in force. No cross-repository WASLA integration code has been changed yet; the change above is internal to MARKET.

**Last milestone:** delivery now detects active inventory conflicts — the last debt in ADR-026 §4 that needed neither an owner decision nor an independent scope. The inventory observation projection recorded `quantity_after` and never asked whether the adjustment casts doubt on units a live order is holding; it does now, and **not by the rule §4.8 itself wrote**. A reservation is a negative delta in the marketplace's own inventory ledger, so the `quantity_after` arriving on `marketplace.inventory_adjusted` is *already net of our reservations*: comparing it against reserved demand double-counts and would raise a flag on every healthy order in the system. The criterion is the adjustment's **reason**, not a quantity comparison. New: `delivery_inventory_conflicts` (a flag ledger written in the same transaction as the observation), a pure `assessInventoryConflict()` with closed kind and dismissal vocabularies, and `GET /delivery/inventory-conflicts` for operators. Every flag carries `changes_order_state: false` on the wire and a `CHECK (changes_order_state = FALSE)` in the database: it informs, it never cancels, transitions or releases. Details in ADR-026 §4.18 and `docs/04-api/DELIVERY_HTTP.md`.

## What this project is

WASLA MARKET is the commerce system of WASLA. It is a permanently independent
repository with its own code, data, tests, CI and releases.

```
MARKET creates the work.  MOVE executes the work.  CORE coordinates it.
```

| System | Repository | Role |
|---|---|---|
| WASLA CORE | `noor-seez/wasla-core` | shared operating layer and coordinator |
| WASLA MOVE | `noor-seez/ceezr` | field execution |
| WASLA MARKET | `skyosv10-art/wasla` | this repository — commerce |

No monorepo, no merged repositories, no shared runtime package, no
cross-database access between the three.

## Ownership boundary

**MARKET owns:** merchants, stores and store staff, products, categories and
catalog, inventory and reservations, Commercial Orders and order items,
marketplace search, commercial review content, B2B and partner commerce,
customer commerce surfaces, store-level pricing and product-specific rules.

**MARKET does not own:** identity, sessions, principals, roles and permissions,
organizations and tenancy, payments, wallets, ledger, settlement,
subscriptions and entitlements, reputation scoring, notification delivery,
channel abstraction, fulfillment coordination (all CORE) — nor drivers,
vehicles, fleets, dispatch, matching, tracking, proof of delivery, rides or
delivery execution (all MOVE).

**Canonical model:** a Commercial Order is a commercial commitment owned here.
It is never an Operational Job and never a Ride.

## Current state of this repository (observed, not assumed)

- pnpm workspace. `services/`: analytics, audit, auth, billing, chat,
  compliance, customers, delivery, dispatch, drivers, fraud, geography,
  identity, marketplace, matching, negotiations, notifications, orders,
  partners, referrals, reputation, rides, search, subscriptions, support,
  translation.
- `packages/`: contracts, events, channel-core, channel-postgres,
  telegram-adapter, bot-runtime, service-auth, auth-sdk, telemetry, i18n,
  errors, config, ui, test-utils, and a set of `*-e2e` suites.
- `bots/`, `apps/`, `infra/`, `docs/`, `scripts/`, `.gitlab/`, `CODEOWNERS`.
- One GitHub workflow: `.github/workflows/ci.yml`, plus `.gitlab-ci.yml`.

Several service folders here own domains that the final architecture assigns
elsewhere: `drivers`, `dispatch`, `matching`, `rides`, `delivery` belong to
MOVE; `identity`, `auth`, `billing`, `subscriptions`, `notifications`,
`reputation`, `referrals`, `geography`, `audit`, `compliance`, `support` belong
to CORE. They stay in place until their replacement is proven — being present
today is not a claim of ownership.

## Done

- [x] Roadmap established at the repository root.
- [x] Roadmap-freshness gate (`scripts/check-roadmap.mjs` +
      `.github/workflows/roadmap.yml`): a push that changes implementation and
      does not update this file fails CI.
- [x] Gate proven on a live CI run: run "Roadmap freshness" on commit
      `2cb88e4c` failed with
      `ROADMAP.md was not updated alongside implementation changes:
      - .github/workflows/roadmap.yml`.
      That failure is the gate correctly refusing its own bootstrap commit,
      which added the workflow without touching ROADMAP.md. The commit that
      updates this file passes.

Nothing else has been changed in this repository by the WASLA integration work.

## In progress

- **M5-13 (Store Orders & Delivery) — review 13/N, claim `CLM-0134`.** Delivery idempotency
  keys now expire. Added: an `expires_at TIMESTAMPTZ NOT NULL` column on
  `delivery_idempotency_keys` with a table-level `CHECK (expires_at > created_at)` and an
  index on the expiry, mirrored in `src/db/schema.ts`; a generated, hand-corrected
  migration `drizzle/0001_idempotency_key_lifetime.sql` (plus its `.down.sql`) that adds
  the column nullable, backfills it to `created_at + 24 hours`, then sets `NOT NULL` —
  the generator's single `ADD COLUMN ... NOT NULL` statement was measured failing with
  `23502` against a table that already held a row; a boot-time resolver for
  `IDEMPOTENCY_KEY_TTL_SECONDS` (default 86400, floor 3600) that **refuses to start**
  rather than silently correcting a bad value; expiry-aware reads plus an atomic
  `ON CONFLICT ... DO UPDATE ... WHERE expires_at <= now()` takeover of dead rows, so an
  expired key is reusable without a spurious 409 while a live key still answers 409; and
  a batched sweeper (`DELETE ... FOR UPDATE SKIP LOCKED`, batch 500, at most 20 batches
  per round) exposed as `POST /delivery/idempotency-keys/sweep` returning measured counts
  (`batches`, `deleted`, `remaining`, `stopped_because`) instead of a bare acknowledgement.
  No in-process scheduler: the platform bans `setInterval` in services and exposes
  periodic work as a route. Nothing schedules the sweep yet — that wiring and its cadence
  are an operational decision; what changed is that the backlog is now measurable.
  The upgrade is proven against a table that already holds rows, so the §4.14 gap is
  closed **for this migration**; `RISK-0020` stays open for the repository as a whole,
  by owner decision.
- **M5-13 (Store Orders & Delivery) — review 14/N, claim `CLM-0135`.** The sweeper now has a
  caller. Added: `src/ops/idempotency-sweep-runner.ts`, the pure half — it reads the two
  sweep settings out of a plain env record (decimal digits only; `5oo`, `0`, `-1`, `2.5`,
  `0x10` and `1e3` are all **refused loudly**, because `Number.isInteger(Number(raw))` was
  measured accepting `0x10` as 16), runs one round through the existing use case, and returns
  a report plus an exit code — it touches no `process`, opens no connection and prints
  nothing; and `src/ops/idempotency-sweep-cli.ts`, the only process boundary — it requires
  `DATABASE_URL`, opens a single-connection pool, writes the report line to stdout and errors
  to stderr, closes the pool in `finally` and exits with the report's code. Exit codes are the
  alarm channel and are deliberately distinct: `0` drained, `1` failed, `3` hit the batch
  ceiling with work left, `4` an empty batch while expired rows remain (transient lock
  contention). `2` is left alone — Node itself produces it on a broken import. The caller
  talks to the database directly rather than calling its own HTTP route, so no service-auth
  key has to live on a scheduler host and no client timeout can cut a long round in half; the
  route stays for manual in-network maintenance. Killing the process mid-round is safe by
  construction (each batch commits alone, the round limit is a local counter), so there is no
  graceful-shutdown handler and no lock against overlapping runs. A text guard
  (`ops-runner-purity.test.ts`) asserts that `src/ops/` contains no timers or cron, and that
  env reads, `process.exit` and stream writes occur in exactly the one declared boundary file
  — asserted by set equality, so a second entry point must be declared to pass. Measured:
  delivery unit **329/329 in 20 files**, delivery integration **69/69 in 9 files** (six new
  tests spawn the real command as a child process against real PostgreSQL and assert exit
  code, stdout and stderr). Not claimed: the schedule itself is not in this repository — the
  crontab line and the Kubernetes `CronJob` example in the runbook are written, not proven
  against a deployment, since `infra/` still holds only `.gitkeep`; and there is still no
  metric or alert on `remaining`, only an exit code an operator can wire.
- **M5-13 (Store Orders & Delivery) — review 15/N, claim `CLM-0136`.** `GET /delivery/ready`
  now asks the marketplace instead of admitting it never did. Until this review the response
  carried `not_claimed: ["marketplace_catalog_not_probed"]`: the catalog port was wired
  (review 8/N) but readiness never probed it. Both reasons review 8/N gave for refusing to
  probe still hold, so the answer is an **observation, not a check**. Added:
  `src/domain/dependency-probe.ts` — a pure `CachedDependencyProbe` with an injected clock
  that caches one observation per TTL per replica (`MARKETPLACE_PROBE_TTL_MS`, default
  15000), caches failures as well as successes (otherwise a marketplace outage costs a full
  timeout on *every* heartbeat, i.e. the protection disappears exactly when it is needed),
  coalesces concurrent heartbeats onto a single in-flight call, and never reports a negative
  age; and `src/infrastructure/http-marketplace-probe.ts` — a signed `GET /health` call with
  an **empty scope list** (a health probe reads no store and no product), a client-side
  `AbortSignal` timeout (`MARKETPLACE_PROBE_TIMEOUT_MS`, default 1000) and a closed reason
  vocabulary. The probe reads the **body**, not the HTTP code: marketplace `/health` answers
  200 unconditionally and carries `status: "ok" | "degraded" | "unavailable"` in the body
  (its `catalog.health()` really queries the database), so a code-only probe would have
  reported a marketplace that had lost its database as healthy — and an unknown status is
  `marketplace_contract_drift`, not health. The result enters the response as
  `dependencies: [{name, ok, detail?, observed_at, age_ms, gates_readiness: false}]` and
  **never** influences `status`, which is still derived from `checks` alone: reads,
  cancellation and fulfillment transitions need no marketplace, so evicting this service
  from rotation for another service's outage would widen the outage rather than contain it.
  `gates_readiness` is declared on the wire (and pinned `const: false` in the contract)
  because whoever reads the body during an incident does not read the ADR. Both new settings
  refuse to boot on a non-decimal value rather than falling back silently, and the same
  measurement from review 14/N was applied to `resolveIdempotencyTtlSeconds`, which still
  accepted `0x10` as 16. Measured: delivery unit **382/382 in 23 files** (was 329 in 20),
  delivery contracts **28/28** (was 26), exit gate **8/8** now wired to a real probe against
  the real marketplace origin — proving a signature with empty scopes is actually accepted at
  that boundary. Not claimed: no metric or alert on the observation (`docs/13-observability/`
  is still empty — an owner decision), no probe for the dispatch bridge or outbox lag, and no
  circuit breaker: a fifteen-second-old observation is far too stale a decision to refuse an
  order with.
- **M5-13 (Store Orders & Delivery) — review 16/N, claim `CLM-0137`.** Active inventory
  conflict detection, lifting the debt declared in ADR-026 §4.8 — the last §4 debt that
  needed neither an owner decision nor an independent scope. The headline finding is that
  **the rule §4.8 wrote is wrong and was not implemented.** §4.8 asked for "comparing the
  observed `quantity_after` against active order lines", but a reservation is a negative delta
  in the marketplace's *own* inventory ledger (`services/marketplace/src/domain/reservation.ts`
  writes `reason_code: 'reservation'` as `system:delivery`) and `product_inventory.quantity_on_hand`
  carries `CHECK (>= 0)`. So `quantity_after` is already net of our reservations: a store with
  three units and one order reserving all three reports `quantity_after = 0`, which is perfect
  health. That comparison would have flagged **every** healthy order — a hundred percent noise
  rate. There is therefore no quantity-versus-quantity comparison anywhere in this
  implementation; the criterion is whether the adjustment's **reason** casts doubt on units we
  hold. Added: `src/domain/inventory-conflict.ts` — a pure assessment with three closed kinds
  (`stock_zeroed_while_reserved`, which outranks the reason because severity comes first;
  `downward_correction_while_reserved`; `shrinkage_while_reserved`) and four closed dismissals
  evaluated in a fixed, contractual order (`no_active_reservation`,
  `delivery_own_reservation_flow`, `quantity_increase`, `reason_not_conflicting`), with our own
  `reservation`/`reservation_release` excluded by construction — without that exclusion our own
  action flags us on every order placed. `delivery_inventory_conflicts` (fourteenth table,
  eleven named checks, migration `0002_inventory_conflict_ledger` plus a hand-reviewed reverse)
  is written in the **same transaction** as the observation, because an observation stored
  without its flag means a consumed event and a lost doubt with no way back, and with
  `ON CONFLICT DO NOTHING` rather than `DO UPDATE`, because a redelivery must not erase an
  operator's acknowledgement. The stale guard still comes first: a stale `adjustment_sequence`
  writes no flag at all, so the port now returns a discriminated
  `InventoryObservationOutcome` instead of `void`. Active demand is joined through
  `store_orders`, the only row carrying both the marketplace `store_id` and the `order_id`
  (reservations carry `store_slug`), so no marketplace table is joined and no cross-boundary
  `REFERENCES` is added. `GET /delivery/inventory-conflicts` returns the flags with the
  applied filter echoed in the body — whoever reads a zero learns *under which filter* it was
  zero — and is deliberately absent from `api.openapi.yml`, following the sweep route
  precedent exactly. The contract guard in `packages/contracts/delivery` earned a mention: it
  forbids `reserved_quantity` anywhere in the delivery schema (delivery holds no balance,
  §2.3), it really did fail on the first column name, and the column was renamed to
  `affected_units_total` rather than the guard widened. Measured on real PostgreSQL: delivery
  unit **412/412 in 25 files** (was 382 in 23), delivery integration **84/84 in 10 files**
  (was 69 in 9), delivery contracts **28/28**, exit gate **8/8**, `pnpm -r typecheck` clean
  repository-wide, contract-versus-migration equivalence measured across seven catalogue
  dimensions, and all eleven constraint names read out of a real catalogue rather than
  predicted. Not claimed: no inbound service-auth on any delivery route (the service signs
  outbound only — an independent scope for all eleven routes together); no write route for
  acknowledgement yet (the columns exist and are read, acknowledgement is manual on the
  database); no metric, alert or time series on the flags; no retention policy for the flag
  ledger; and a flag does not prove damage — a `shrinkage` exceeding free stock is *refused*
  by the marketplace, so a recorded loss is a floor, not a measure.
- **M5-13 (Store Orders & Delivery) — review 17/N, claim `CLM-0138`.** Inbound service
  authentication on the delivery boundary, lifting the debt declared in ADR-026 §4.18 ("no
  inbound auth on any route — the service signs outbound only"). Nine of the eleven routes now
  require a proven service identity (`aud = delivery`) **and a scope that is unique to that
  route**: `delivery:store-order:{write,read,cancel,confirm}`, `delivery:payment-mirror:write`,
  `delivery:fulfillment:transition`, `delivery:delivery-task:read`,
  `delivery:ops:idempotency-sweep`, `delivery:ops:inventory-conflicts:read`. Missing identity
  is `401`, proven identity with a missing scope is `403`, and the two answers are never
  conflated. `GET /delivery/health` and `GET /delivery/ready` stay **open by a written
  decision**: their caller is the deployment orchestrator, which holds no service key — closing
  them stops deployments, not attackers. An unregistered path answers `401` **before** `404`,
  so the service surface cannot be mapped without a key, and a newly registered route with no
  identity classification **fails startup** rather than passing silently.
  The measured finding worth recording is that the shared middleware emits **three** denial
  codes, not two: `packages/service-auth/src/errors.ts` `codeFor()` returns `AUTHN_EXPIRED` for
  an expired token and `AUTHN_AUDIENCE_MISMATCH` for a token aimed at another boundary,
  otherwise `AUTHN_UNAUTHENTICATED`. A test was written asserting two and **failed**; the
  assertion and the source comments were corrected to the measured truth rather than the
  behaviour bent to the guess. Both exceptions are only ever spoken *after* the signature is
  proven, so they serve an honest operator diagnosing a deployment mistake and tell an attacker
  without a key nothing. Denials use this contract's flat envelope
  `{error_code, message, trace_id}` — not dispatch's `code` — and deliberately carry no
  `DELIVERY_` prefix, because they are the vocabulary of every boundary in the system
  (ADR-020, ADR-021) and a caller who programs against `AUTHZ_FORBIDDEN` at one boundary must
  read the same code here.
  This is also **the first boundary enforced before a production caller exists**: a measured
  search found no in-repo HTTP caller of any of the eleven routes outside `services/delivery/**`
  except `packages/delivery-e2e`, so enforcement preceded adoption and broke no caller.
  Measured: **20 new proof cases** in `services/delivery/src/__tests__/service-identity.test.ts`
  (the full matrix, four dangerous writes unreachable by read tokens, and binding limits — other
  path, other method, other order id, health and ready still open, unknown route `401` before
  `404`, unclassified route rejected at startup); delivery unit **432/432 in 26 files** (was
  412 in 25); delivery integration **84/84 in 10 files**, unchanged; exit gate **11/11** (was
  8/8) including three on-the-wire proofs issued with raw `fetch` against the running gate
  rather than through the signing helper; `pnpm -r typecheck` clean repository-wide. No
  `pnpm-lock.yaml` change: both packages already depended on `@wasla/service-auth`.
  Not claimed: `api.openapi.yml` was **not touched** — the published contract declares neither
  `securitySchemes` nor `401`/`403`, which is a **real gap, not a good choice**, and it is the
  precedent of all five previously enforced boundaries, so the fix is one contract convention
  for every boundary at once rather than a second convention invented here.
  `services/marketplace` is still not enforced (declared, not fixed). `RISK-0026` (the query
  string is not bound into the signature — it affects `GET /delivery/inventory-conflicts`) and
  `RISK-0015` (the replay guard is in-memory, so it is per-process) remain open. Role-to-scope
  granting is `M1-05`: this boundary declares what each route *requires*; who deserves a scope
  is the token issuer's decision. `docs/12-testing/M1-04_GATE.md` still describes five
  enforced boundaries and needs a sixth-wave update — a declared debt.
- **M5-13 (Store Orders & Delivery) — review 18/N, claim `CLM-0139`.** The acknowledgement
  write route, lifting the debt declared in ADR-026 §4.18 ("no write route for the
  acknowledgement") — the debt whose only blocker, per §4.19, had already fallen: a `POST` that
  writes `acknowledged_by` without inbound authentication is **an acknowledgement with no
  acknowledger**. `POST /delivery/inventory-conflicts/{adjustmentId}/acknowledgement` is
  **schema-free**: `acknowledged_at`, `acknowledged_by`, the half-acknowledgement `CHECK` and
  the partial index have existed since 16/N and were created **for this route**, so what was
  missing was the door, not the ledger — which is itself evidence that the §4.18-9 decision to
  add the columns early was right.
  The acknowledger is taken **from the proven token only** (`service:<name>` or
  `service:<name>/on-behalf-of:<publicId>`), and any non-empty body is **rejected `400`, never
  silently ignored** — silent ignoring would produce the worst outcome available: a row in an
  **accountability ledger** bearing a name other than the one the caller believes it signed
  with. The rejection is justified by *the route having no body at all*, not by one field being
  reserved, so there is no ban-list to forget a future addition in. A composed identity longer
  than 128 characters is **rejected, not truncated**: a truncated identity in an accountability
  ledger is a lie that reads as a fact.
  A **tenth scope**, `delivery:ops:inventory-conflicts:acknowledge`, is separate from `:read`
  **by construction**, so whoever reads the board does not close incidents in their own name;
  a read-only token is answered `403` on a real socket in the phase-13 gate.
  **The first acknowledgement wins, in one statement** (`WITH upd AS (UPDATE … WHERE
  acknowledged_at IS NULL RETURNING …) SELECT … UNION ALL … WHERE NOT EXISTS`), so there is no
  window between "is it acknowledged?" and "acknowledge it" for a concurrent call to enter —
  proven with `Promise.all` and two different acknowledgers: one wins, the other reads the
  winner, and never both. The second call answers **`200`, not `409`**, with an explicit
  `outcome: "acknowledged" | "already_acknowledged"` discriminator that **names the first
  acknowledger**: the requested state is satisfied, so `409` would push a caller into a retry
  that cannot help, but staying silent about the difference would let a second operator believe
  an incident is in their custody when it is in someone else's. There is deliberately **no
  `Idempotency-Key`**: the operation is idempotent **in its nature** (`WHERE acknowledged_at IS
  NULL`), not by machinery, and demanding a key here would falsely imply the key is the
  protection — which would break the day key semantics change.
  A malformed `adjustmentId` is `400` **before touching the database**, not `404`, because
  `404` would send an operator hunting the database for a row that exists; an unknown flag is
  `404` with a new code `DELIVERY_INVENTORY_CONFLICT_NOT_FOUND` and no row is created. An
  unwired write port answers **`500`**, never `200 {outcome: "acknowledged"}` — a stricter
  stance than its read counterpart, because a falsely empty list reads as cleanliness while a
  false acknowledgement closes a real incident in an operator's mind with no trace in any ledger.
  The route stays **out of `api.openapi.yml`**, the third ops path to do so on the sweep and
  read precedents verbatim: the published contract stays **nine** routes, the registered surface
  becomes **twelve**.
  Discovered while wiring the gate: `packages/delivery-e2e/src/harness.ts` was passing
  **neither** ops port, so the read route merged in 16/N had never been exercised by the exit
  gate at all. Both are wired now.
  Measured on PostgreSQL 18.6 locally (CI runs 17.6): 7 unit cases for the composer and 10 for
  the route; inventory-conflict integration **21/21** (was 15/15); exit gate **16/16** (was
  11/11), including a full journey over a real socket; `pnpm -r typecheck` clean
  repository-wide.
  **A real pre-existing defect was found here and deliberately not fixed here**
  ([`RISK-0035`](docs/07-security/RISK_REGISTER.md), `high`): the marketplace writes
  `actor_public_id: "system:delivery"` on the reservation-decrement event, and the delivery
  inventory relay's classifier requires `^WS-[0-9]{10}$`, so the row is **poisoned and the
  checkpoint advances past it** — the event is *lost*, not held. It surfaced because this is the
  first case in the repository that relays inventory **after** placing an order (measured: 2
  applied, 1 poisoned), and it stayed hidden because `observed_quantity_after` is absolute, so
  any later applied event repairs the snapshot. Fixing it means either widening the classifier's
  actor pattern or changing **a published event payload**, both of which are contract decisions
  and not something to slip into a route delivery. The measurement is **pinned in the gate with
  an exact assertion** (`{applied: 2, poisoned: 1}`) rather than a lenient one, so the defect is
  measured, not masked.
  Not claimed: no `un-acknowledge` route — **a policy question, not a forgotten method**: who
  may overturn another operator's judgement, and with what trace is the reversal itself kept?
  No metric or alert on flags or acknowledgers (`docs/13-observability/` is empty); no retention
  policy for the flag ledger; `trace_id` still not published in the rows; still no
  `securitySchemes` in the published contract; `services/marketplace` still not enforced.
- M5-13 remains `In Progress` on the execution board. Promotion to `Completed` is the
  program owner's decision alone (governance protocol §9).

## Remaining, in dependency order

1. Boundary audit across all 26 services: classify each as `KEEP_IN_MARKET`,
   `MOVE_TO_CORE`, `MOVE_TO_MOVE`, `REFACTOR`, `REBUILD` or `RETIRE`, with
   evidence from the code rather than the folder name.
2. Migration matrix per entity, published in `docs/migration/`.
3. Adopt the CORE identity contract; retire local identity/auth as the source
   of truth once CORE holds it.
4. Canonical Commercial Order model, cleanly separated from any operational
   job or delivery execution state.
5. Produce `market.order.created` through a transactional outbox using the
   canonical event envelope; consume `core.fulfillment.completed`.
6. Remove any direct coupling with MOVE; all cross-system traffic goes through
   CORE APIs or events.
7. Hand billing, subscriptions, notifications, reputation, referrals,
   geography reference and compliance concerns to CORE.
8. Reconciliation and dry-run tooling for order and identity migrations.
9. Cutover and rollback rehearsal.

## Migrated

Nothing.

## Retired

Nothing. No legacy component is switched off before its replacement is proven.

## Blockers

| # | Blocker | Impact | What unblocks it |
|---|---|---|---|
| B-1 | Production data inventory unknown (row counts, live orders, duplicate identities) | No migration can be planned against real volumes | Read access to production, or an exported inventory |
| B-2 | Duplicate-identity merge policy undecided | Identity handover to CORE cannot complete | An owner decision on canonical selection and conflict rules |
| B-3 | No CORE database or environment provisioned | Integration against CORE cannot be executed end-to-end yet | Infrastructure decision and provisioning |
| B-4 | Regulatory pricing policy undecided | Commercial pricing rules cannot be finalised | A legal/regulatory decision |
| B-5 | No production release approval | No production deployment will be attempted | Explicit owner approval |

## Open questions

- Which of the 26 services are actually running, and which are scaffolding?
- Which tables here hold live commercial data versus fixtures?
- Which contracts under `packages/contracts` are honoured by a real
  implementation today?

## Risks

| Risk | Severity | Note |
|---|---|---|
| Services present here that the architecture assigns to CORE or MOVE | high | Presence is not ownership; each needs an evidenced disposition |
| Order model conflating commercial and operational concerns | high | Must be split before the fulfillment flow is wired |
| Contracts drifting ahead of implementation | medium | A contract without a producer and consumer is not implemented |

## Tests that pass at this commit

Measured on real PostgreSQL 17.6, not estimated:

- `services/delivery` unit suite: **297/297** in 18 files (was 280 in 17 — the 17 new
  tests cover the TTL resolver, the sweep loop and the sweep route).
- `services/delivery` integration suite: **63/63** in 8 files (was 51 in 7 — the 12 new
  tests cover stored TTL, expiry-aware replay, dead-row takeover, the database CHECK,
  batching, `SKIP LOCKED` under a real lock, the route, and the upgrade over existing rows).
- `@wasla/contracts-delivery`: **26/26**.
- `@wasla/delivery-e2e` phase-13 exit gate with a database: **8/8**.
- `pnpm -r typecheck`: clean.

No existing test was modified or removed. The cross-repository WASLA integration work
still has no test of its own here.

## Not proven yet

- Integration with CORE (not attempted).
- Any data migration.
- Any cutover or rollback.

## Cross-repository status (recorded 2026-09-11)

- WASLA CORE canonical repository: `noor-seez/wasla-core` — permanently
  independent. It is not merged here, not vendored here, and not a shared
  package. CORE published its Money (double-entry ledger, wallets,
  authorization/capture) and Fulfillment coordination cycle at commit
  `f0eccc4bf2`, verified locally: typecheck clean, 37/37 tests, governance,
  contract and migration gates passing.
- No cross-repository integration has started. This repository still emits and
  consumes nothing from CORE.
- Nothing in this repository is left uncommitted by the WASLA work: every
  change made here is published on `main`.
- GitHub Actions runs normally in this repository; the roadmap gate and the
  WASLA CI workflow both passed on commit `da569d3e3b`.
