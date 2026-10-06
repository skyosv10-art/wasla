# ADR-065: D4 Confirmation Route — Deferred as Latent Risk

**Status:** ACCEPTED
**Date:** 2026-10-06
**Decider:** Program Owner
**Review date:** 2027-01-06 (or sooner if triggers fire)
**Owner:** @xuuux-voox (CODEOWNER review), @skyosv10-art (execution)
**Risk:** RISK-0042 (open)
**Context:** D4 architectural investigation (`docs/15-decisions/D4-INVESTIGATION.md`)

---

## Context

`POST /store-orders/:orderPublicId/confirmation` (delivery service) confirms a store order — the fulfillment state transition `placed → confirmed` (per `decideConfirmation` in `services/delivery/src/domain/store-order-confirmation.ts`). This is a fulfillment-state transition only; it does not create or modify task eligibility (the `pending_eligibility → eligible` edge is a separate concern, per the code comment in `confirm-store-order.ts`). The route currently has binding `none` — it checks only that the caller's token carries the `delivery:store-order:confirm` scope, without verifying that the caller (a store_staff member) belongs to the store that owns the order.

The D4 investigation (2026-10-06) found:

1. **No production caller exists.** `partner-bot` — the intended caller per ADR-062 — has no domain flows. Its `main.ts` explicitly states: "This bot has no domain flows yet."
2. **No production delivery grants.** `PRODUCTION_GRANTS["partner-bot"]` includes only `identity` scopes — no `delivery` audience.
3. **No `storePublicId` concept.** The store is identified by `storeId` (UUID) and `storeSlug` (text). The staff member's identity is a personal WaslaPublicId. Mapping staff → store requires a cross-service lookup into marketplace's `store_staff` table, which delivery cannot perform today.
4. **OBO is necessary but not sufficient.** The `asserted()` pattern (ADR-060) requires a field on the resource to compare against `endUser.publicId`. `StoreOrder` has `customerRef` but no store-identity field.
5. **D5 depends on D4's mechanism.** D5's fulfillment transitions need the same staff-membership verification.

---

## Decision

**D4 = DEFERRED / ACCEPTED AS LATENT RISK.**

No implementation, no implementation/execution claim, no production changes, no migrations, no authz grants, no Render changes.

### Rationale

- No attack surface exists without a production caller.
- Implementing Option A (cross-service staff membership lookup) now would introduce a delivery → marketplace dependency, a new API contract, and `ASSERTION_AUDIENCES_BY_ACTOR` expansion before the product flow is designed.
- Premature infrastructure for a flow that may change during partner-bot development.

### Preferred direction (non-binding)

**Option A — cross-service staff membership lookup** is the preferred initial direction when partner-bot domain flows are built. This is documented in `D4-INVESTIGATION.md` §14. Options B and C remain unapproved alternatives — they are not chosen for execution.

---

## Reopen triggers

D4 must be reopened when **any** of the following occurs:

1. A domain flow for `partner-bot` is started or merged.
2. A caller for `POST /store-orders/:orderPublicId/confirmation` is added.
3. `delivery` scopes are granted to `partner-bot` in `PRODUCTION_GRANTS`.
4. A production request or actual usage of the confirmation route is observed.
5. The store or `store_staff` model changes (schema, identity, or authz).
6. Independent evidence of an attack surface on this route emerges.

---

## Constraints until reopened

- Do **not** add `delivery` to `ASSERTION_AUDIENCES_BY_ACTOR.store_staff`.
- Do **not** add `delivery` scopes to `partner-bot` in `PRODUCTION_GRANTS`.
- Do **not** enable observe or enforce for this route.
- Do **not** implement Option A, B, or C code.
- Do **not** open an implementation/execution work claim for D4.

---

## D5 Reassessment

**D5 remains DEFERRED.**

D5 (`POST /store-orders/:orderPublicId/fulfillment-transition`) needs the same staff-membership verification as D4 for store-side transitions (picking, picked, ready_for_delivery). D5 also needs a separate driver-side binding (using the existing `assertedDriver` pattern from CLM-0475) for driver-side transitions (handed_to_courier, delivered).

Since D4's mechanism is not chosen or built, D5 cannot proceed. D5 remains deferred until D4 is reopened and resolved. No execution plan or claim is opened for D5.

---

## P3 Status

**P3 = NOT STARTED.** No observe or enforce. P3 waits until D4 and D5 are resolved. A per-service P3 plan (service, operations, owner, observe readiness, metrics, false-positive handling, acceptance criteria, rollback, prerequisite before enforce) will be created after D4/D5 resolution.

---

## Impact

| Item | State |
|------|-------|
| D4 | Deferred — accepted as latent |
| D5 | Deferred — depends on D4 resolution |
| P3 | Not started — per-service plan after D4/D5 |
| RISK-0042 | OPEN — not closed by this ADR |
| Wave 3 measured gaps | 0 (D4 gap is latent, not measured) |
| `AUTHORIZATION_POLICY_MATRIX` | Unchanged — D4 row stays `none` binding |

---

## Related

- `docs/15-decisions/D4-INVESTIGATION.md` — full architectural investigation
- `docs/15-decisions/ADR-062-risk-0042-architectural-execution-plan.md` — original execution plan (D4/D5 rows)
- `docs/15-decisions/ADR-063-risk-0042-program-owner-decisions.md` — PO-005 binding deferral
- `docs/07-security/RISK_REGISTER.md` — RISK-0042 entry
