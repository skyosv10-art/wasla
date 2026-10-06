# D4 Architectural Investigation — `POST /store-orders/:orderPublicId/confirmation`

**Status:** Investigation only — no code, no claim, no execution
**Date:** 2026-10-06
**Author:** @skyosv10-art (agent:perplexity-computer)
**Risk:** RISK-0042 (open)
**ADR reference:** ADR-062 (D4 row), ADR-063 (PO-005)

---

## 1. The Gap

`POST /store-orders/:orderPublicId/confirmation` confirms a store order (state transition `pending_eligibility → eligible` or similar). The route is `scoped(DELIVERY_SCOPES.storeOrderConfirm)` — it checks only that the caller's token has the `delivery:store-order:confirm` scope. It does **not** verify that the caller's identity (the store_staff person) is a member of the store that owns the order.

**Binding:** `none` — the gap is documented in `bindings.ts` line 1324 as deferred per PO-005.

---

## 2. Production Caller

**There is no production caller today.**

The ADR-062 plan identifies `partner-bot` as the intended production caller: it would forward a `store_staff` user assertion (`wua1`) with `obo` set to the staff member's WaslaPublicId. However:

- `bots/partner-bot/src/main.ts` explicitly states: _"This bot has no domain flows yet."_
- `bots/partner-bot/src/server.ts` is a stub that calls `buildBotApp(BOT, overrides)` from `@wasla/bot-runtime` — no delivery, marketplace, or store-order flows are wired.
- `PRODUCTION_GRANTS` for `partner-bot` includes only `identity` scopes (`identity:resolve:write`, `identity:assertion:issue`) — no `delivery` audience scopes.

**Conclusion:** D4 is a latent gap with no attack surface today. No bot, service, or human caller exercises this route in production.

---

## 3. Identity Source — `store_staff`

The `store_staff` identity flows through ADR-060's `wua1` assertion:

1. `partner-bot` receives a Telegram message from a store staff member.
2. `partner-bot` calls `identity` service with `act: store_staff` to issue a `wua1` assertion.
3. The assertion's `sub` is the staff member's personal WaslaPublicId (format: `WS-XXXXXXXXXX`).
4. `partner-bot` forwards the assertion + `obo` (the staff member's WaslaPublicId) to the delivery service.

The `ASSERTION_AUDIENCES_BY_ACTOR` for `store_staff` currently includes: `identity`, `marketplace`. It does **not** include `delivery` — this would need to be expanded if D4 is remediated.

---

## 4. Relationship Between `store_staff.sub` and `storePublicId`

**There is no `storePublicId` concept.** This is the core architectural problem.

### Schema analysis

**`marketplace.stores` table** (`services/marketplace/src/db/schema.ts:127`):
| Column | Type | Notes |
|--------|------|-------|
| `store_id` | UUID (PK) | Internal ID |
| `owner_public_id` | text | WaslaPublicId of the store owner (`WS-XXXXXXXXXX`) |
| `slug` | text | Public slug (e.g., `al-madina-market`) |

**`marketplace.store_staff` table** (`services/marketplace/src/db/schema.ts:251`):
| Column | Type | Notes |
|--------|------|-------|
| `store_id` | UUID (FK → stores) | Which store this staff member belongs to |
| `member_public_id` | text | WaslaPublicId of the staff member (`WS-XXXXXXXXXX`) |
| `role` | text | `owner`, `manager`, or `staff` |
| `added_by_public_id` | text | Who added them |
| `added_at` / `removed_at` | timestamp | Lifecycle |

**`delivery.store_orders` table** (`services/delivery/src/db/schema.ts:97`):
| Column | Type | Notes |
|--------|------|-------|
| `store_id` | UUID | FK to marketplace stores (but no DB-level FK — cross-service) |
| `store_slug` | text | Snapshot of the store's slug at order time |

**`delivery.StoreOrder` domain model** (`services/delivery/src/domain/model.ts:50`):
- `storeId: string` (UUID)
- `storeSlug: StoreSlug`
- `customerRef: WaslaPublicId`
- **No `storePublicId` field exists.**

### The identity chain

To verify that a store_staff member is authorized to confirm an order, the system must resolve:

```
store_staff.sub (WaslaPublicId)
  → store_staff.member_public_id (match)
    → store_staff.store_id (which store)
      → stores.store_id (match)
        → stores.owner_public_id (the store's owner)
          → StoreOrder.store_id (match: same store_id)
```

The delivery service holds `StoreOrder.storeId` (UUID) and `StoreOrder.storeSlug`, but it has **no way** to map the staff member's WaslaPublicId to a `storeId`. That mapping lives exclusively in the marketplace service's `store_staff` table.

---

## 5. Classification: User-Bound, Service-Bound, or Hybrid?

**D4 is hybrid.**

- The **identity** is user-bound: the `store_staff` is a person with a personal WaslaPublicId.
- The **caller** is service-bound: `partner-bot` (a service) makes the HTTP call to delivery, forwarding the user's assertion via `obo`.
- The **authorization decision** requires resolving a user-to-tenant relationship (staff → store) that lives in a different service (marketplace).

This is the same pattern as the marketplace tenant-scoped routes (CLM-0461 wave 2), but cross-service: the delivery service needs to verify a membership that only marketplace knows about.

---

## 6. Is OBO Suitable?

**OBO is necessary but not sufficient.**

OBO (on-behalf-of) carries the staff member's WaslaPublicId from `partner-bot` to the delivery service. This is the identity transport. But the delivery service cannot verify the relationship between that WaslaPublicId and the store that owns the order without a lookup.

ADR-060's `asserted()` pattern works when the resource has a field that can be compared directly to `endUser.publicId` (e.g., `order.customerRef === endUser.publicId`). For D4, there is no such field — `StoreOrder` has no `storeOwnerPublicId` or `storePublicId` to compare against.

---

## 7. Alternative Delegation Models

### Option A: Cross-service staff membership lookup

Add a `GET /marketplace/staff/:waslaPublicId/stores` endpoint to the marketplace service that returns the list of `storeId`s (or `storeSlug`s) the staff member belongs to. The delivery service calls this endpoint to verify that the order's `storeId` is in the returned list.

**Pros:** No schema change to delivery. Reusable for D5.
**Cons:** Introduces a service-to-service call from delivery to marketplace. Adds latency. The lookup must happen inside the write transaction (or be cached) to avoid TOCTOU.

### Option B: Add `storeOwnerPublicId` to `StoreOrder`

Denormalize the store owner's WaslaPublicId into the `store_orders` table at order creation time. The delivery service compares `obo` (staff's WaslaPublicId) against `order.storeOwnerPublicId`.

**Pros:** No cross-service call. Direct comparison (like `customerRef`). Works with the existing `asserted()` pattern.
**Cons:** Only verifies the store owner, not staff members. A `manager` or `staff` role member cannot confirm orders unless the comparison is broadened. Requires a migration to add the column and backfill existing orders.

### Option C: Add `storeOwnerPublicId` + staff membership assertion

Combine A and B: add `storeOwnerPublicId` to `StoreOrder` for the owner check, and add a cross-service lookup for non-owner staff (manager, staff roles). This is the most flexible but also the most complex.

**Pros:** Supports all staff roles. No false negatives for non-owner staff.
**Cons:** Two mechanisms for the same check. Complexity.

### Option D: Store-scoped token with `storeSlug` in `obo` context

Have `partner-bot` include the `storeSlug` in the request, and verify staff membership via the existing `assertActiveMembership` pattern (which already works in marketplace). The delivery service would need to call marketplace's staff check.

**Pros:** Reuses existing marketplace staff check logic.
**Cons:** The `storeSlug` is caller-supplied (could be spoofed). The delivery service still needs a cross-service call to verify membership.

---

## 8. Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| D1 (`POST /store-orders`) | **Remediated** (CLM-0474) | Store order creation is `asserted` — `customerRef` compared to `obo` |
| `partner-bot` assertion flow | **Not built** | partner-bot has no domain flows; would need to issue `wua1` for `store_staff` and forward to delivery |
| `ASSERTION_AUDIENCES_BY_ACTOR.store_staff` | **Missing `delivery`** | Currently `["identity", "marketplace"]` — needs `delivery` added |
| Marketplace staff lookup endpoint | **Does not exist** | No `GET /staff/:waslaPublicId/stores` or similar |
| Delivery → marketplace service call | **Does not exist** | Delivery has no client for marketplace staff queries |

---

## 9. Schema / Identity / Authz / Event-Contract Implications

### Schema
- **Option A:** No delivery schema change. Marketplace adds a new read endpoint.
- **Option B:** `store_orders` gains `store_owner_public_id` column. Migration required. Backfill from marketplace `stores.owner_public_id` joined on `store_id`.
- **Option C:** Both.

### Identity
- `ASSERTION_AUDIENCES_BY_ACTOR.store_staff` must include `delivery`.
- `partner-bot` must request `wua1` assertions with `act: store_staff` and `aud: delivery`.
- `partner-bot` PRODUCTION_GRANTS must include `delivery:store-order:confirm` scope.

### Authorization policy
- Binding for `POST /store-orders/:orderPublicId/confirmation` changes from `none` to `asserted`.
- Evidence anchor must point to the comparison code in the handler.
- Door 7-ج must pass (evidence tokens exist as literal substrings).

### Event contract
- `confirmStoreOrder` already emits `store_order.fulfillment_state_changed` — no change needed.
- The event context already includes `traceId` — the staff member's WaslaPublicId should be recorded in the audit trail (derived from `obo`, not from a body field — per PO-002 pattern).

---

## 10. Acceptance Criteria (Measurable)

1. `partner-bot` issues `wua1` assertion for `store_staff` actor with `aud: delivery`.
2. `POST /store-orders/:orderPublicId/confirmation` requires a valid user assertion.
3. The handler compares the staff member's WaslaPublicId (from `obo`) against the store that owns the order (via lookup or denormalized field).
4. Mismatch → `ORDER_NOT_FOUND` (404, not 403 — per established pattern).
5. The binding in `bindings.ts` changes from `none` to `asserted` with file:anchor evidence.
6. `ASSERTED_OPERATION_COUNT` increments by 1.
7. Wave 3 `none` count decrements by 1.
8. Tests: positive (staff member confirms own store's order), negative (staff member tries to confirm another store's order → 404), negative (no assertion → 403 in enforce mode).
9. Production stays `off` (P3 not started).

---

## 11. Rollback Strategy

- **Option A (cross-service lookup):** Roll back by reverting the binding to `none` and removing the `delivery` audience from `store_staff`. No migration to undo.
- **Option B (denormalized field):** Roll back by reverting the binding, removing the `delivery` audience, and dropping the `store_owner_public_id` column (or leaving it nullable and unused). Migration rollback script required.
- **Both:** The `asserted()` pattern is gated behind `WASLA_USER_ASSERTION_MODE` (default `off`), so production is not affected by the code change until P3 activation.

---

## 12. Closure Criteria

D4 is closed when:
1. The binding is `asserted` with evidence.
2. The comparison code exists in the handler.
3. Tests pass (positive + negative).
4. CI is green.
5. The `delivery` audience is added to `store_staff` in `ASSERTION_AUDIENCES_BY_ACTOR`.
6. `partner-bot` has a domain flow that exercises this route (or the gap is accepted as latent until partner-bot flows are built).

---

## 13. Does D5 Actually Depend on D4?

**Yes, but only partially.**

D5 (`POST /store-orders/:orderPublicId/fulfillment-transition`) needs to verify that the person performing a fulfillment transition (picking, picked, ready_for_delivery, handed_to_courier, delivered) is authorized for the store that owns the order. This is the same staff-membership verification as D4.

However, D5 is more complex because:
- Some transitions are store-side (picking, picked, ready_for_delivery) — need store_staff identity.
- Some transitions are driver-side (handed_to_courier, delivered) — need driver identity.
- The PO-005 decision is to split the route into two: store-confirmed + driver-confirmed.

**D5 depends on D4's resolution mechanism** (whichever option is chosen for D4's staff-membership verification would be reused for D5's store-side transitions). But D5 also needs a separate driver-side binding (using the existing `assertedDriver` pattern from CLM-0475).

If D4 uses Option A (cross-service lookup), D5 can reuse the same lookup for store-side transitions. If D4 uses Option B (denormalized field), D5 needs the same field for store-side transitions.

**D5 cannot be implemented before D4's mechanism is chosen and built.**

---

## 14. Recommendation

**Option A (cross-service staff membership lookup) is recommended** for the following reasons:

1. **No migration:** No schema change to the delivery service's `store_orders` table.
2. **Reusability:** The same lookup endpoint serves D5's store-side transitions.
3. **Consistency:** The marketplace service already has `assertActiveMembership` logic — exposing it as a read endpoint is a natural extension.
4. **No denormalization risk:** The store owner's WaslaPublicId could change (ownership transfer), and a denormalized field would go stale.

However, this decision requires **Program Owner approval** because:
- It introduces a new service-to-service dependency (delivery → marketplace).
- It requires a new marketplace endpoint (API contract change).
- It requires expanding `ASSERTION_AUDIENCES_BY_ACTOR.store_staff` to include `delivery`.
- It requires `partner-bot` to be built with domain flows (a significant project).

---

## 15. Next Steps (Per Program Owner Instructions)

1. This investigation is complete. No code, no claim, no execution.
2. If D4 needs a Program Owner decision (it does — Option A vs B vs C), create an independent ADR/decision record.
3. Do not implement before the decision is approved.
4. After D4 is resolved, reassess D5.
5. Do not close RISK-0042 based on this report alone.
