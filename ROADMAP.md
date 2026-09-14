# WASLA MARKET — Roadmap

**Repository:** `skyosv10-art/wasla` (this repository is WASLA MARKET)
**Last updated:** 2026-09-14 (M0-38 — the work-claim ledger can no longer contradict itself, one reader answers "is this claim active?" for both guards, and three guards that used to disable themselves silently now fail closed; **and GitHub Actions produced its first real verdict since 2026-09-13**)
**Last milestone (M0-38):** running the governance gate *with network access* — not reading code — turned check 4 red: two claims (`CLM-0078`, `CLM-0079`) were still `Active` while their branches were deleted, and one of them already carried a **measured release note** written the same day. The ledger, which is the only source of path ownership, was asserting a thing and its opposite, because the guard read the status column and never read the release notes beside it. Locally, without network, that check skips silently — so the defect only existed where it mattered. Four holes were closed, and three of them were found by *running* things, not by planning: (1) a door that pairs every `Active` row with release notes in both directions, network-free, with diacritics normalised, keeping the precision limit that a note about *another* claim's release must not count; (2) **one reader** (`scripts/checks/lib/claims_rows.sh`) after the two guards were measured disagreeing — one matched the status exactly, the other by substring, and the second one's header claimed they were identical, so *writing the release evidence re-created the defect*, and `Paused` was ignored entirely by the first even though it locks scope; (3) **fail-closed imports**, because wiring that shared reader in flipped two existing mutation cases to "pass": the synthetic stage copied only the guard file, the import failed, the row list came back empty, and the guard cheerfully reported "no active claims" and exited green — a guard that cancels itself on a missing file is more dangerous than a missing guard, since the absence is visible and the self-cancellation is not; and (4) the one that only CI could find — see below.
**CI, measured 2026-09-14T17:16Z:** the account block described in `RISK-0039` has lifted. Run [34873584143](https://github.com/skyosv10-art/wasla/actions/runs/34873584143) actually **started**: 30 jobs with real runner ids and executed steps, not `steps: []` / `runner_id: 0`. Its verdict was **red for a real defect**: the test-invocation guard's first door scanned with `rg … 2>/dev/null || true`, and `rg` is not installed on the GitHub runner — so the missing tool produced an empty offender list and the door passed green on nothing, in the one place that matters. That case is green on every local run; the guard whose stated purpose is to stop "local disagreeing with CI" was itself disagreeing with CI. The scan now runs in `python3` inside the same file that scans `package.json` (one scanner, one fewer tool in the trust path, and a scan failure is an error rather than a skip), and a new case re-runs the same mutation with `rg` crippled in `PATH`. Governance suite 292 → **302 cases, 0 failing**; `scripts/verify.sh` green; the gate green **with** network. Then run [34876097859](https://github.com/skyosv10-art/wasla/actions/runs/34876097859) came back **31/31 jobs successful — the first genuinely green CI verdict in this repository since 2026-09-13.** `RISK-0039` stays open until a green verdict is measured on `main` and the merges marked "NOT VERIFIED" during the block are reviewed; `RISK-0036` (no branch protection) is still open, so a verdict is now *read* but does not yet *block* a merge.

**Previous milestone (M0-34 — a migration upgrade is now proven against a database that already holds rows, and a guard makes that proof mandatory for every non-baseline migration)
**Last milestone:** the last remaining gap in `RISK-0020` was that every migration proof ran against an **empty** database: apply, roll back, re-apply. Production databases are never empty, and the difference is not theoretical — `drizzle-kit` emitted `ALTER TABLE … ADD COLUMN "expires_at" timestamptz NOT NULL;` as a single statement in `services/delivery/drizzle/0001`. That succeeds on an empty table and fails with `23502` on a table holding one row; only a human reviewer caught it. Two layers now close that: a live proof that applies baseline migrations, **seeds rows with known values**, applies the remaining migrations **to the populated database**, and asserts every row survives with the backfill equal to `created_at + interval '24 hours'` exactly — then rolls back a step and asserts the rows are still there. And a fourth gate in `validate-migrations.sh` rejects any non-baseline migration that has no declared upgrade proof, and rejects the single-statement `ADD COLUMN … NOT NULL` pattern outright. Nine mutation cases prove the gate both rejects and accepts. Measured locally on PostgreSQL 18.6; **CI is still account-blocked (`RISK-0039`), so no gate verdict exists and `RISK-0020` stays open**.

**Previous milestone:** `scripts/ci-evidence.sh` stopped restating a conclusion as a reason. It had declared that GitHub "publishes no counterpart to `failure_reason`", so a job that never started was recorded with `reason = failure` — a word that reads as "the code failed" when nothing ran at all. That declared limit was measured false, and the cause is now read literally from the check-run annotations.

**Earlier milestone:** the inventory-conflict flag ledger gained a write route: `POST /delivery/inventory-conflicts/{flag_id}/acknowledgement` records the acknowledger from the **proven service identity alone** — never from the request body — and the first acknowledgement wins in a single statement (ADR-026 §4.20).

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
  enforced boundaries and needs a sixth-wave update — a declared debt. **(Paid in review 22/N
  below.)**
- **M1-04 (central auth middleware) — gate update, review 22/N, claim `CLM-0143`.** Paying the
  debt declared by the sixth wave, and while measuring it two real defects surfaced that no
  check had caught. First, **silent documentation drift**: `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md`
  §2.7 and `docs/12-testing/M1-04_GATE.md` both declared **nine** delivery scopes while
  `DELIVERY_SCOPES` in `services/delivery/src/http/service-identity.ts` enforces **eleven** —
  the tenth (`delivery:ops:inventory-conflicts:acknowledge`, review 18/N) and the eleventh
  (`delivery:ops:relay-dead-letters:read`, review 21/N) were added to the code and never written
  down. Check 12 (`validate-service-auth-coverage.sh`) reads the §4 client table, not the §2.7
  scope table, so nothing failed. The fix is not a hand edit: the scope tables in both documents
  are now wrapped in `<!-- delivery-scopes:begin/end -->` markers and a new guard,
  `services/delivery/src/__tests__/service-auth-docs-drift.test.ts` (7 cases), reads the
  exported constant and both documents and fails on a missing, invented, or duplicated scope —
  and fails loudly if the markers themselves are deleted, so removing the markers cannot make
  the guard pass. It was confirmed RED against the nine-row tables before the documents were
  fixed. Second, routes 12 and 13 were classified with scopes in `app.ts` but had **never been
  measured unsigned** — their HTTP tests all call through the signing harness, so enforcement
  was inferred from middleware existence. Four boundary cases were added
  (`service-identity.test.ts` 20 → 24): each route unsigned ⇒ `401 AUTHN_UNAUTHENTICATED`, and
  each route with a valid token carrying a *different* delivery scope ⇒ `403 AUTHZ_FORBIDDEN`.
  The delivery boundary as measured today: **13 routes = 11 closed (one scope each) + 2 open by
  written decision** (`GET /delivery/health`, `GET /delivery/ready`). The gate document now
  carries a three-layer status header, a new §3.1 with a four-row measured-evidence table for
  waves 6 and reviews 18/N, 21/N, 22/N, and a new §5 holding the marked scope block.
  Measured: repository-wide `pnpm -r test` **4447 passing in 272 files** (was 4436/271),
  `pnpm -r typecheck` clean, governance gate green, `BASELINE.json` regenerated
  (`static.test_files_tracked` 340 → 341).
  Not claimed: the historical CI green for the wave-5 gate (run `34065473979`, 27/27,
  2026-09-07) is preserved and **not extended forward** — no CI verdict exists for wave 6 or
  anything after it, because every run since 2026-09-12T11:15Z fails with zero steps started
  (account billing, `docs/14-runbooks/CI_RUNNER_UNBLOCK.md`). `services/marketplace` remains the
  only implemented boundary with no enforcement, stated plainly rather than in a footnote.
  `api.openapi.yml` was not touched. No deployment was measured. The guard matches scope
  *names*, not the rationale next to them, and covers delivery only.
- **M1-04 (central auth middleware) — scope-table guard generalised to all six boundaries,
  review 23/N, claim `CLM-0144`.** Review 22/N closed the delivery drift with a unit-test guard
  and explicitly declared that it "covers delivery only". Measuring that residue produced a
  worse finding than the one it closed: the four geography scopes enforced in code
  (`geography:hierarchy:read`, `geography:zone:read`, `geography:location:read`,
  `geography:location:write`) appear **nowhere in `docs/`** — measured by searching every scope
  string across every documentation file, zero hits — and have been enforced since 2026-09-07.
  So the delivery drift was never one service's accident; it was the pattern, and the missing
  table is worse than a stale one because there is nothing to compare against. Chosen fix, among
  legitimate alternatives: extend **check 12**
  (`scripts/checks/validate-service-auth-coverage.sh`) with a new **gate 6** rather than add a
  fourteenth governance check. Rationale: one source of truth (the exported `*_SCOPES` constant
  in each `services/<svc>/src/http/service-identity.ts`), the strongest automatic enforcement
  available (check 12 already runs in CI and in the governance gate), and no new check counter,
  so no CI-config or baseline-counter churn. Gate 6 extracts every scope literal from each
  boundary's exported constant and requires it inside that boundary's
  `<!-- <svc>-scopes:begin/end -->` block in `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md`,
  and requires that no scope inside the block is absent from the code. A second, narrower rule
  was added after a fixture exposed the hole: every boundary the ledger declares **enforced**
  must have `service-identity.ts` at its declared path, so moving or renaming the file **fails**
  the check instead of silently skipping gate 6. Existing tables (matching, orders, identity,
  dispatch) were wrapped in markers in place — no table was copied, so no truth was duplicated
  — and a new §5.3 was written for geography with the nine closed routes measured from
  `services/geography/src/http/app.ts` plus `GET /health` open by explicit classification. The
  §5 heading, still reading "the two boundaries' scopes" while six are enforced, was corrected
  **by addition**: the stale title and the six-day documentation gap are both recorded in place
  rather than quietly overwritten. Measured: gate 6 was confirmed RED first — it rejected five
  of six boundaries before the tables were marked — then green across **6 boundaries and 38
  scopes** (delivery 11, dispatch 7, orders 6, identity 5, matching 5, geography 4). Six
  mutation cases were added to `scripts/checks/test-governance.sh` proving the gate actually
  rejects: a scope in code but not documented, a scope documented but not in code, a deleted
  marker, a moved identity file (all must fail), plus a truthful table and a boundary with no
  exported constant (must pass). The governance suite is **189 passing, 0 failing** (was 183/0).
  `M1-04_GATE.md` gained item 17, so the tally is now **16 ✅ and one ⚠️ partial (12)**, and its
  §5 records that the drift guard is now two layers over one truth source rather than one.
  Not claimed: this gate matches scope **names** against code, not each scope's binding to its
  route (that is proven on the wire in each boundary's `service-identity.test.ts`) and not the
  correctness of the rationale written beside a name. `bots/` and `packages/` remain outside the
  check's vision (`RISK-0027` still open). `services/marketplace` is still unenforced.
  `api.openapi.yml` was not touched. And there is still no CI verdict: every run fails with zero
  steps started (account billing, `docs/14-runbooks/CI_RUNNER_UNBLOCK.md`), so local green is
  reported as local green and nothing more.
- **M1-04 (central auth middleware) — coverage guard now sees `bots/` and `packages/`, review
  24/N, claim `CLM-0145`.** Review 23/N ended by naming its own blind spot: `bots/` and
  `packages/` stay outside check 12's vision (`RISK-0027`, open since 2026-09-05). Closing that
  root cause produced a genuine, previously invisible defect: two real outbound clients,
  `bots/customer-bot/src/infrastructure/http-negotiations.ts` and
  `bots/driver-bot/src/infrastructure/http-negotiations.ts`, follow the repository's own client
  naming convention, call `POST /negotiations/{thread}/rounds/{n}/{accept,reject}`, carry **no
  signer at all** (measured: no `sign*Request` anywhere in either file), and **had never
  appeared in the coverage ledger**. So the ledger's line "eleven signers out of eleven outbound
  clients — nothing deferred" was true of `services/` and misleading if read as a claim about
  the repository. Two changes: gate 2's discovery now globs `bots/*/src/infrastructure/http-*.ts`
  alongside `services/`, and a new **gate 7** takes a census of every production file containing
  `fetch(` under `services/`, `bots/`, and `packages/` (excluding `__tests__` and `*.test.ts`)
  and requires each one to be either a counted client or an exception **declared with its reason**
  inside `<!-- fetch-exceptions:begin/end -->` in the ledger. Gate 7 also rejects a *dead*
  exception (a listed file that no longer exists), rejects smuggling a real client into the
  exception list to exempt it from the ledger, and rejects deletion of the marker block —
  measured today as **22 raw callers = 16 counted clients + 11 declared exceptions** (the eleven
  being e2e harnesses, each with a written reason). The two bot clients were added to the ledger
  as `مؤجَّل` with an `M1-04` reference and the honest reason: the `negotiations` boundary is
  **not enforced** (measured — no `registerServiceIdentity` in
  `services/negotiations/src/http/app.ts`), so signing a call to a boundary that verifies nothing
  would buy reassurance rather than safety; they will be signed when the boundary is enforced,
  and the guard now prevents forgetting them. Seven mutation cases were added to
  `scripts/checks/test-governance.sh` (hidden raw caller, declared exception, dead exception,
  client smuggled into exceptions, deleted marker block, an unlisted `bots/` client, and a clean
  root) so the governance suite is **196 passing, 0 failing** (was 189/0). The gate document
  gained item 18, and item 12's old note — "all existing callers are signed" — was corrected
  **by addition**, not deleted: that sentence was false and only measurement could show it.
  `RISK-0027` stays `open` until its owner reviews it (§9: promotion is the owner's authority),
  while its technical cause is recorded as measured-closed. Not claimed: gate 7 matches `fetch(`
  only, so a caller using `undici`, `axios`, or another wrapper is still invisible, and no
  false-positive rate over time has been measured. And still no CI verdict: every run fails with
  zero steps started, so the green reported here is local only.
- **M1-04 — HTTP-wrapper lock closes the blind spot review 24/N declared, review 25/N, claim
  `CLM-0146`.** Review 24/N ended with an explicit non-claim: gate 7 greps `fetch(` only, so a
  caller using `axios`, `undici`, or any other wrapper stays invisible. Measured today, that hole
  is empty — zero HTTP-client dependencies exist in any `package.json` outside `node_modules`,
  and zero production files import one — but the hole is the dangerous kind: the day someone adds
  `axios`, gate 7 goes blind **while staying green**, which is worse than `RISK-0027` was, because
  that blindness is born green and warns nobody. So a new **gate 8** locks it by default-deny:
  thirteen known HTTP client packages (`axios`, `undici`, `got`, `node-fetch`, `ky`, `superagent`,
  `request`, `phin`, `needle`, `axios-retry`, `request-promise`, `isomorphic-fetch`,
  `cross-fetch`) are rejected in any `package.json` unless declared **with a reason** as a table
  row inside `<!-- http-wrappers:begin/end -->` in the ledger's new §4.2 — and once declared, the
  wrapper's import pattern is **added to gate 7's census automatically**, so every file importing
  it must itself be a counted client or a declared exception. Gate 8 also rejects a dead
  declaration (a wrapper declared but present in no `package.json`) because it widens the census
  with nothing behind it and simulates guarding, and it rejects deletion of the marker block. The
  declaration is parsed from the **first cell of table rows only**, not from the block's prose, so
  package names mentioned in the explanatory text are illustration rather than declaration — a
  first implementation read every backticked token and produced three phantom declarations
  (`fetch`, `node_modules`, `package.json`), which the guard correctly rejected as dead
  declarations, and the parser was narrowed. Five mutation cases were added (undeclared dependency
  fails, declared dependency passes, dead declaration fails, deleted block fails, and an importer
  of a declared wrapper is pulled into gate 7 and fails when unlisted), taking the governance
  suite to **201 passing, 0 failing** (was 196/0), and the gate document gained item 19. Also
  recorded honestly: during this work a stray shell heredoc executed with an unset root variable
  and deleted the new marker block from the real ledger instead of a synthetic fixture; the guard
  caught it immediately ("marker block missing"), which is exactly the failure mode gate 8 is
  built to catch, and the block was restored and re-measured green three times. Not claimed: the
  lock stops a wrapper entering **through `package.json`**; it does not stop a raw socket call
  (`node:http`, `net`) or a transitive package that wraps a client deep in its own dependency
  tree, and neither is measured today. And still no CI verdict: runs keep failing with zero steps
  started.
- **M1-04 — the negotiations boundary is enforced and the two deferred bot clients are signed,
  review 26/N, claim `CLM-0147`.** Review 24/N found two real outgoing clients that had never
  been in the coverage ledger and had never signed a call —
  `bots/{customer,driver}-bot/src/infrastructure/http-negotiations.ts` — and recorded them as
  `مؤجَّل` with an honest reason rather than signing them on the spot: `services/negotiations`
  did not verify inbound identity at all, so signing a call into a boundary that never reads the
  token is reassurance with no effect. This review removes the reason instead of the symptom:
  **the boundary is enforced first, then the clients are signed.** `services/negotiations` becomes
  the **seventh** enforced boundary with nine scopes over thirteen routes
  (`negotiations:thread:{write,read}`, `negotiations:round:{write,decide,read}`,
  `negotiations:message:{write,read}`, `negotiations:agreement:read`, `negotiations:tick:run`),
  `GET /health` open by explicit classification, and an unclassified route failing at boot rather
  than defaulting open. The split follows verbs, not tables, and the two splits that matter have
  their own `403` proofs on the wire: accepting or rejecting a round (`round:decide`) is not the
  same power as proposing one (`round:write`), because accepting creates an agreement and moves a
  price in the order engine; and the scheduler tick (`tick:run`) is a separate scope because it
  writes across every user's threads and its caller is a scheduler, not a user's bot. Fourteen
  proof cases were added in `services/negotiations/src/__tests__/service-identity.test.ts`
  (no identity → 401 with no reason leaked, forged → 401, valid → pass, missing scope → 403,
  replay → 401, replay store down → 503, a `round:write` token refused at accept, every thread /
  round / message scope refused at the tick, a token bound to another thread id or another path
  refused, unknown path → 401 before 404, and an unclassified route throwing at boot). The two bot
  clients now take a **required** `signRequest` with no default — a missing signer is a
  configuration fault at construction, not a silent unsigned call — and signing happens **outside**
  the request `try` block so a refusing signer surfaces as a config fault rather than being
  mislabelled `*_DEPENDENCY_UNAVAILABLE`. Each bot declares three scopes only
  (`thread:read`, `round:read`, `round:decide`), which is strictly less than the nine the boundary
  enforces, and four proof cases per bot read `aud`, `svc`, `scp` and the request binding `req`
  **out of the token payload itself** rather than asserting a function exists, plus a case proving
  a refusing signer means `fetch` is never called at all. The negotiation exit-gate harness now
  starts the service **enforced** and signs its own calls, so the boundary is proven over a real
  socket and not only by injection. Measured: negotiations service unit tests **244 passing in 14
  files** (was 230/13), customer-bot **36** (was 32), driver-bot **43** (was 39), repo-wide
  `pnpm -r test` **4469 passing in 275 files** (was 4447/272) with `EXIT=0`, `pnpm -r typecheck`
  clean, and the coverage guard green on **seven** enforced boundaries and **47** scopes with
  **zero deferred clients** — the first time that ledger has had no deferral since gate 2 was
  widened to see `bots/`. Gate item 12 moves from ⚠️ partial to ✅ because its stated reason no
  longer has a subject, and the old text is kept verbatim as evidence of what measurement could
  see that day rather than deleted. Not claimed: this does **not** complete `M1-04` —
  `services/marketplace` is still the one implemented boundary with no enforcement, promotion of
  the item to `Completed` and closing `RISK-0027` remain the program owner's authority alone, the
  query string is still outside the request binding so a token signed to list one order's threads
  can list another's (`RISK-0026`, same shape as `GET /orders/lookup`, root fix at `M1-05`), the
  replay guard is still in-process (`RISK-0015`), `api.openapi.yml` still documents no security
  scheme, and **there is still no CI verdict**: every run continues to fail with zero steps
  started, so the green reported here is local only.
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
- **M5-13 (Store Orders & Delivery) — review 19/N, claim `CLM-0140`.** The concurrency
  refusal now tells the caller *when* to retry. Until now a lost idempotency-key race
  answered a bare `409 DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT`: correct, and useless — it
  said "you failed" without saying "retry", so the caller either spun in a tight loop
  (turning a millisecond of contention into database load) or gave up and lost a request
  that had **actually succeeded**. This lifts the oldest surviving debt in ADR-026 §4,
  declared in §4.10-1 at review 7/N.
  New: `src/http/retry-after.ts`, a pure module that imports no framework and knows no
  reply — it holds a closed `Partial<Record<DeliveryErrorCode, number>>` with exactly one
  key, and exports `declaredRetryAfterSeconds()` so a test can read the promise instead
  of trusting a comment. The error mapper sets the header only when that lookup returns a
  number. The value is **measured, not guessed**: probing the race on real PostgreSQL
  18.6 over twelve concurrent rounds produced eleven refusals, and in every one of them an
  **immediate** retry — no wait at all — was answered `201` with `Idempotent-Replay: true`.
  The winner's key row is therefore already committed when the refusal is raised and the
  true wait is zero; `1` is chosen because `0` reads as "spin now" and `1` is the smallest
  integer that does not. Delta-seconds, not an HTTP-date, so response validity does not
  depend on two clocks agreeing. It is a constant in code, not an environment variable,
  because the contract publishes `minimum: 1` and a tunable would let the answer drift
  from the contract without failing a test.
  Keyed by **error code, not status**: three different errors share `409`, and only this
  one is worth retrying — `DELIVERY_IDEMPOTENCY_KEY_REUSED` is a caller construction bug
  whose retry can never succeed, and `DELIVERY_CONCURRENT_UPDATE` needs a fresh read and a
  new decision, not the same request again. A status-keyed rule would have lied in two
  cases out of three. `components/responses/ConflictError` in `contracts/api.openapi.yml`
  now declares the header machine-readably (`type: integer, minimum: 1`), and a contract
  guard asserts it is the only `headers:` block in the file and that
  `DependencyUnavailable` has none.
  Proven in three layers, each measuring a real race: 10 unit assertions without a
  database; an integration test on real PostgreSQL that creates the race with
  `Promise.all` in a loop and **fails explicitly if no refusal is ever observed**; and the
  phase-13 exit gate, which repeats the measurement **over a real socket** because
  `app.inject` never touches the HTTP header serialiser — a header dropped or renamed by
  the listener would have passed green in integration and been invisible to every real
  caller. The gate reads the header as a **string** (`"1"`), proving the RFC 9110 §10.2.3
  `delay-seconds = 1*DIGIT` form and not merely the value, and it asserts the promise is
  honest: the immediate retry replays the winner's body byte for byte. The gate was rerun
  five times, 17/17 each time.
  Not claimed: `packages/contracts/delivery/src/api-types.ts` still models **no response
  header for any route** — it is hand-authored, and the fix is one convention for every
  response at once, the same argument as the missing `securitySchemes`. Measured and
  recorded as a trap: running `pnpm generate` in that package **overwrites the
  hand-authored file** with a machine dump (721 insertions, 306 deletions); it was
  reverted. No metric or alert on refusal frequency, so a race that becomes a pattern
  rather than an incident says nothing. No `Retry-After` on `503`
  (`DEPENDENCY_UNAVAILABLE`, `MARKETPLACE_UNAVAILABLE`) — the standard's own example case —
  because a dependency's recovery time is **not measured here**, and an unmeasured promise
  is the thing this review argues against. No `429` and no rate limiting on this boundary
  at all. And no claim about probability: the loop proves the race occurs, not how often,
  and every measurement is on 18.6 locally — CI runs 15/17.6, untested for this.
- **M5-13 (Store Orders & Delivery) — review 20/N, claim `CLM-0141`.** `RISK-0035` is
  closed, and the fix is one file: the consumer, not the contract. Every
  reservation-decrement event in the system was being **silently lost** — the marketplace
  writes `actor_public_id: "system:delivery"` on it, the delivery inventory relay's
  classifier required `^WS-[0-9]{10}$`, so the row was poisoned and the checkpoint
  advanced past it by design (one bad row must not block the queue), meaning the event was
  never retried and never alerted on.
  **The documented dilemma rested on a false premise.** The risk was recorded as a choice
  between two doors, both "contract decisions": widen the classifier's actor pattern, or
  change what the marketplace writes. Reading the published contract dissolved it —
  `services/marketplace/contracts/events.json`,
  `MarketplaceInventoryAdjustedV1.data.actor_public_id`, has declared the actor as a
  **`oneOf` of two forms since it was published**: a Wasla public id, or
  `{"type": "string", "pattern": "^system:[a-z_]+$"}`. `"system:delivery"` is therefore
  **contract-legal, literally**. The producer never left its contract; the consumer was
  **narrower than the contract it consumes**. So there was no second door and no owner
  decision: **no published payload was changed, no migration was run, and
  `services/marketplace` was not touched.**
  The rule this leaves behind, written into the code and not just this bullet: a consumer's
  validation must be a **superset** of what its producer's contract permits, never a
  subset. A narrower consumer **destroys facts that exist** — and above an advancing
  checkpoint it destroys them without a trace. The worst a wider consumer does is wait for
  a fact that never arrives. The two costs are not comparable, so the safe direction is
  declared rather than inferred.
  The fix: an exported `MARKETPLACE_ACTOR_PATTERNS` constant plus a `reqInventoryActorId`
  validator whose failure message **names both permitted forms**, so an operator reading an
  incident learns what is allowed rather than what was rejected. `reqWaslaPublicId` was
  deleted — it had no remaining caller, and a dead validator in a validation module is an
  invitation to use it by mistake. Note also that `actor_public_id` is **never persisted**:
  `delivery_inventory_observations` has no column for it, so the rejection was paying the
  highest possible price for the cheapest possible field. No column was added; widening a
  table for a field no one reads is refactoring, not fixing.
  A new **drift guard** (`services/delivery/src/__tests__/marketplace-actor-contract-drift.test.ts`)
  reads `events.json` itself, resolves the `oneOf` branches through `$defs`, and asserts the
  classifier's pattern set is **literally equal** to the contract's, and that each branch has
  a sample the classifier **actually accepts**. Add a third branch to the contract and the
  test fails — because the original defect was not a logic error but a **drift between two
  documents** that broke no build and tripped no type, and only dropped events in
  production.
  The boundary was not loosened: seven poison cases still fail (`system:`,
  `system:Delivery`, `system:store-ops`, `system:delivery:extra`, `svc:delivery`, `WS-123`,
  surrounding whitespace), both patterns anchored.
  Measured on PostgreSQL 18.6 locally: delivery unit **473/473 in 30 files** (was 459/29),
  delivery integration **92/92 in 10 files** (was 91/10), delivery contracts 29/29,
  `pnpm -r typecheck` clean repository-wide, and the phase-13 exit gate **17/17** with the
  pinned assertion flipped from `{applied: 2, poisoned: 1}` to `{applied: 3, poisoned: 0}`
  on a real socket, plus two new assertions: **no poisoned row exists at all** in
  `delivery_inventory_relay_consumed_events`, and the reservation row **specifically** is
  `applied` (joined through `marketplace_outbox`, because the consumed ledger deliberately
  does not store the payload — no second source of truth for a marketplace-owned event).
  No conflict flag changed: `DELIVERY_OWN_REASONS` already dismisses
  `reservation`/`reservation_release` as `delivery_own_reservation_flow` (§4.18), which was
  decided in review 18/N and is not a consequence of this one.
  Not claimed: **there is still no metric and no alert on poisoned rows**
  (`docs/13-observability/` is empty), so the guard against this class of defect is a
  **test, not an alarm** — it fails in CI and says nothing in production; that is the real
  remaining limit. There is **no replay path for an already-poisoned row**, so in any
  environment that ran before this fix the lost events **stay lost**; recovering them is an
  operational re-relay from an earlier checkpoint, not code, and it was not performed. The
  guard covers the actor field only, not the whole payload — `reason_code`, for instance,
  is a 7-value enum in the contract and any non-empty string in the classifier, which is
  the safe direction and was left alone; generalising the guard needs a JSON Schema
  validator (no `ajv` in the service's dependencies today) and is its own scope. And
  nothing here was measured on PostgreSQL 15/17.6 (the CI versions) or against a production
  database.
- **M5-13 (Store Orders & Delivery) — review 21/N, claim `CLM-0142`.** The first of the
  two limits declared when `RISK-0035` was closed is now lifted: there is a **measured
  metric and a classified alert verdict** on poisoned relay rows. Route thirteen,
  `GET /delivery/relay/dead-letters`, reads both consumed-event ledgers
  (`delivery_relay_consumed_events`, `delivery_inventory_relay_consumed_events`) and
  returns the `poisoned` count per ledger, a per-event-type breakdown, the oldest and
  newest poisoned timestamps, and an `alert` verdict — behind an **eleventh scope**,
  `delivery:ops:relay-dead-letters:read`, separate from everything before it.
  **The table is the source of truth, not an in-process counter.** A counter in memory
  would reset on redeploy and multiply by replica count, and **a false zero reads as
  cleanliness** — which is precisely the defect the metric exists to deny. Both ledgers,
  the breakdown and the measurement timestamp come from **one SQL statement**, so the
  published total corresponds to a moment that actually existed; two sequential queries
  would produce a total that never did, and an alert on a number that does not add up is
  an alert that gets silenced. The measured column is `updated_at`, not `consumed_at`:
  the row is created on the **first** attempt and poisoned after they are exhausted, so
  `consumed_at` is the age of the first attempt, not the age of the loss.
  **The thresholds are code constants published in the response body**
  (`alert.thresholds`), following the `Retry-After` precedent of review 19/N. `warning`
  fires at **one row**, because a poisoned row is a **lost event**, not a held one, and a
  higher threshold would mean loss tolerated by written decision. `critical` fires at ten
  (a standing systemic defect) or when the oldest is neglected for a day (the warning was
  read and not acted on); the count reason takes precedence over the age reason when both
  hold. An environment variable would be raised at night without review or trace; the
  constant's change **fails a test named after it**. And a copy of the threshold at the
  collector would be a second source of truth that diverges in one review and is
  discovered in an incident.
  **The verdict informs, it does not govern:** `gates_readiness: false` is published in
  the body, and `critical` does not change `GET /delivery/ready` (the §4.17 precedent) —
  proven by measurement, with 99 poisoned rows and readiness still `200 ready`. A corrupt
  past event is not a present outage, and coupling them would let one poisoned row take
  down a healthy service, after which **either the row gets deleted or the alert gets
  weakened**. The route answers `200` even at `critical` — the measurement succeeded even
  if what it measured is bad — and the only legitimate error is `500` when no measurement
  port is wired: "I don't know" is said, never translated into zero.
  **A real defect was found by the integration test alone.** Timestamps arrive as
  **strings**, not `Date`, because the rows are wrapped in `json_agg` (the `pg` driver
  does not convert inside JSON), so every read containing **at least one poisoned row**
  threw a `TypeError` — the incident path specifically — **while the empty case passed**.
  A metric that works when there is nothing and fails when there is something is worse
  than no metric. No in-memory fake could have found it. Fixed at the root: the timestamp
  is formatted in SQL (`to_char … AT TIME ZONE 'UTC'`), so its literal shape is decided
  here rather than left to a driver layer, and the parser **raises** on an unreadable
  timestamp instead of swallowing it as `null`.
  Measured locally on PostgreSQL 18.6: **32 new tests** (14 pure-domain, 10 at the HTTP
  boundary, 8 integration on a real database, including a **read-only proof** that the
  two ledgers' fingerprints are unchanged across the call), and the phase-13 exit gate is
  now **19/19** (was 17/17) with two assertions that the route is **wired into the real
  composition root** — so it measures a real database rather than returning 500 — and that
  `401`/`403` are enforced over a socket. `docs/13-observability/` now holds its first
  file, a metric contract; the runbook is `docs/14-runbooks/RELAY_POISONED_EVENTS.md`.
  Earlier statements across the docs that the directory "is empty" were true when written
  and are annotated with audit notes rather than erased.
  Not claimed: **no alarm rings**. There is no alerting system and no deployment
  environment in this repository, so the metric is read by asking — whoever does not ask
  does not know. There is still **no re-process/replay path for a poisoned row** (the
  second limit of `RISK-0035` stands): it is a safety question, not a missing method — who
  decides the corruption is gone, and is an old event re-applied to state that has moved
  on? The operational repair is described in the runbook, **unmeasured and unclaimed**.
  There is **no retention policy**, so the count is cumulative and `warning` stays up
  until a row is deleted deliberately — intended today (loss is not forgotten) and written
  down so it is not read as a defect. There is no acknowledgement column distinguishing a
  handled poisoned row from a neglected one. And nothing here was measured on PostgreSQL
  15/17.6 (the CI versions) or against a production database.
- **M5-13R (poisoned-row requeue) — review 22/N, claims `CLM-0157` + `CLM-0158` + `CLM-0159`.** The
  **second** limit declared when `RISK-0035` was closed is now lifted: a poisoned relay
  row has a way back. Route fourteen,
  `POST /delivery/relay/dead-letters/{ledger}/{eventId}/requeue`, sits behind a **twelfth
  scope**, `delivery:ops:relay-dead-letters:requeue`, **separate from `…:read`** — folding
  requeue into the read scope would let any stolen dashboard token rewind both delivery
  relays to zero repeatedly, a read-amplification flood held by a **look** permission.
  Rejection happens **before the port is called**, and that is asserted, not assumed.
  **Two moves in one transaction, or neither.** Review 39/N measured two facts before a
  line was written: the consumed ledgers hold **no payload and no `occurred_at`** — they
  are judgement ledgers, not message queues — and `poisoned` is a **terminal** status, so
  `relay.ts` short-circuits it and `replayFrom` alone looks like a replay path while
  replaying nothing. So the adapter lifts terminality (`poisoned` → `pending`) under
  `FOR UPDATE` **and then** rewinds that ledger's checkpoint to `ZERO_CHECKPOINT` via
  `ON CONFLICT`, on one connection in one transaction. Either move alone is a lie: lifting
  the status alone drops the row out of the **§4.23 metric** (it is no longer `poisoned`)
  while the advanced checkpoint means it is never read — **loss made more hidden than it
  was**, which is worse than not requeuing at all. This is measured, not argued: **two
  mutations** (disable the rewind; disable the status lift) each **fail the end-to-end
  proof**, so the test is not decoration.
  **Evidence is not erased.** `attempt_count` and `last_error` are deliberately left
  untouched — the ledger keeps no history, so they are the only trace of **why** the row
  was poisoned, and wiping them would make every rescue attempt destroy the cause of the
  defect. The cost is **declared, not hidden**: the relay computes
  `attempt = attempt_count + 1`, so an exhausted row gets exactly **one** more try and
  then re-poisons with a fresh reason.
  **The rewind cost is published in the response.** `rewind_cost:
  "full_rescan_from_zero"` — there is no way to rewind *precisely* to just before one
  event without copying a third field into the ledger and creating a duplicated source of
  truth, which §4.23's own preamble rejects. Idempotency makes every terminal row on the
  way back a **no-op**; the price is a batched rescan from the start of the outbox, a
  **read, not a write**, on a rare operator action rather than a hot path. A caller
  reading a bare `requeued` would think the replay was instant and escalate an incident
  when the row is not applied within a second.
  **`202`, not `200`; `requeued`, not `reprocessed`.** The call accepted the requeue; it
  did not complete it. The relay reads the row on a later cycle and may re-poison
  immediately if the cause is unchanged — a response saying "recovered" would **close an
  incident over a standing loss**. Two distinct rejection codes, too:
  `DELIVERY_RELAY_DEAD_LETTER_NOT_FOUND` (404, no such row) and
  `DELIVERY_RELAY_DEAD_LETTER_NOT_POISONED` (409, row exists in another state, **with the
  observed state in the message text**). Merging them would send an operator mid-incident
  chasing a valid id, thinking they mis-copied it, when in fact a colleague beat them to
  it a second earlier. The state is in the **message**, not `details`, by measurement:
  the published delivery error contract is three fields and `http/errors.ts` **does not
  emit `details`** — asserting on `details` would have been a green claim about a field
  that never reaches the wire, and that is exactly what happened once and was corrected.
  **A guard gap was closed on the way through.** Every check in
  `scripts/checks/validate-launch-board.sh` — allowed status, closure evidence, duplicate
  ids — runs over the output of a single strict `grep`. A row whose id did not match was
  therefore **dropped from every check silently, and the guard exited green**. It surfaced
  because this item was first filed as `M5-13-R` (two hyphens): the validator printed 90
  items while the board held 91. That silent gap between the two numbers **is** the
  defect. It is now a hard failure checked on the **id cell** rather than line-start, with
  seven governance cases including the decisive one: a malformed row carrying a
  **forbidden status** no longer escapes the status check. The governance suite went from
  246 to 252 cases, zero failing.
  Measured locally on PostgreSQL 18.6: **35 new tests** (9 pure-domain, 12 at the HTTP
  boundary, **14 integration on a real database**). The claims a memory fake cannot make:
  both moves commit together; `attempt_count` and `last_error` survive, asserted on real
  columns; a **rejected call writes not one byte** (ledger and checkpoint fingerprints
  before and after); the neighbouring relay's checkpoint is **untouched**; the checkpoint
  row is **created** when absent; and the row leaves the §4.23 poisoned count read through
  the metric adapter itself. The load-bearing test is the **end-to-end proof**: a relay
  batch **before** the requeue applies **0** and leaves the task `dispatch_requested`;
  after it, **1** is applied, the task is `driver_assigned` with its courier, and the
  verdict is `applied`. Both blockers are staged in the fixture (terminal verdict **and**
  an advanced checkpoint), so the test cannot bless an application that would have
  happened anyway.
  Not claimed: **no distributed lock** — an in-flight relay batch can advance the
  checkpoint over the rewind after `COMMIT` and silently void the requeue; the row stays
  `pending`, so it is **visible in the metric and not lost**, but may not be read until
  another requeue. Lifting that needs an advisory lock on the consumer and is its own
  scope, and it is the next priority because it is the only declared limit that voids work
  already done. **One attempt for an exhausted row** (the price of keeping the evidence).
  **No bulk requeue** — a hundred rows means a hundred rewinds to zero. **Only `poisoned`
  is requeued.** And **no operator UI and no alert invokes this automatically**: the act
  is a human decision, since an automatic requeue driven by a metric would turn a systemic
  defect into an endless rescan loop. Nothing here was measured on PostgreSQL 15/17.6 (the
  CI versions) or against a production database, and **CI itself returned no verdict**:
  the account is billing-blocked (`RISK-0039`), so local green is not a gate verdict.
- M5-13R moves to `Ready for Gate`, not `Completed`. M5-13 remains `In Progress` on the
  execution board. Promotion to `Completed` is the program owner's decision alone
  (governance protocol §9).

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

Measured on real PostgreSQL 18.6, not estimated (CI runs 15/17.6 — that combination is
not measured here):

- `services/delivery` unit suite: **459/459** in 29 files (was 449 in 28 — the 10 new
  tests cover the retry-delay table, its bounds and the declared-promise reader).
- `services/delivery` integration suite: **91/91** in 10 files (was 90 — the new test
  creates a real idempotency-key race in a loop and asserts both the header and that an
  immediate retry replays; it fails explicitly if no refusal is ever observed).
- `@wasla/contracts-delivery`: **29/29** (was 28 — the new guard asserts `ConflictError`
  is the only response declaring `Retry-After`).
- `@wasla/delivery-e2e` phase-13 exit gate with a database: **17/17** in 1 file (was 16),
  rerun five times with the same result.
- `pnpm -r typecheck`: clean.
- `bash scripts/checks/verify-governance.sh`: all executed checks pass; two declared
  partial skips (claim dormancy across branches, and live CI status).

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
