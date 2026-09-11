# WASLA MARKET — Roadmap

**Repository:** `skyosv10-art/wasla` (this repository is WASLA MARKET)
**Last updated:** 2026-09-11
**Last milestone:** Roadmap and roadmap-freshness gate introduced and exercised. No application code has been changed yet by the WASLA integration work.

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

Nothing at this commit.

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

Unchanged from before this commit — the existing suite is untouched. The WASLA
integration work has added no test here yet.

## Not proven yet

- Integration with CORE (not attempted).
- Any data migration.
- Any cutover or rollback.
