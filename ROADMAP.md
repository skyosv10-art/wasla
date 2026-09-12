# WASLA MARKET — Roadmap

**Repository:** `skyosv10-art/wasla` (this repository is WASLA MARKET)
**Last updated:** 2026-09-12 (M5-13 review 15/N — a marketplace readiness probe that informs without gating)
**Last milestone:** the delivery idempotency-key sweeper now has a caller: a one-shot CLI (`pnpm --filter @wasla/delivery-service sweep:idempotency`) that runs a single sweep round, prints one machine-readable JSON report line to stdout and exits with a distinct code per outcome (ADR-026 §4.16 — lifting the first debt declared in §4.15), documented as a schedule in `docs/14-runbooks/DELIVERY_IDEMPOTENCY_SWEEP.md`. Roadmap and roadmap-freshness gate remain in force. No cross-repository WASLA integration code has been changed yet; the change above is internal to MARKET.

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
