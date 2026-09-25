# ADR-048: Partner Identity, Tenant Model, and Enterprise Boundary

| | |
|---|---|
| **Status:** | Accepted |
| **Date:** | 2026-09-25 |
| **Work Item:** | M5-14 |
| **Decider:** | Perplexity Computer (autonomous technical authority) |
| **Supersedes:** | None |
| **Related:** | ADR-018 (Principal model), ADR-001 (identity decoupled), ADR-026 (store orders/delivery boundary), ADR-046 (partner mini-app deferral), RISK-0042 (tenant membership) |

## 1. Context

M5-14 requires a Partner / Enterprise surface: partner identity, tenant model, tenant
isolation, API credentials, webhooks, usage limits, audit, onboarding, and
suspension/offboarding. The closing evidence is a tenant/SLA gate.

Current state:
- `services/partners/` — empty scaffold (`.gitkeep` only)
- `services/marketplace/` — has stores with `owner_public_id` and `store_staff` table
  (roles: owner, manager, staff), but **no tenant membership check** (RISK-0042:
  `storeSlug` read from path in 11 routes without verifying the caller belongs to
  the store)
- `services/identity/` — source of truth for users (`wasla_public_id` in `WS-##########` format)
- `packages/authz-policy/` — authorization matrix (80 enforced operations, 10 roles)
- `packages/auth-sdk/` — Principal model (UserPrincipal, ServicePrincipal, AnonymousPrincipal)
- Partner bot — partially implemented (`bots/partner-bot/`)
- ADR-046 deferred the Partner Mini App — partners interact via bot and admin

## 2. Decision

### Decision 1 — A tenant is a store

A **tenant** is a marketplace store (`stores.store_id`). The store owner is the
**tenant principal** — the partner who owns the store. Partner users are store
staff members (`store_staff` table). This is not a new entity: the marketplace
already has stores with owners and staff. What is missing is enforcement of that
membership boundary.

**Rationale:** Introducing a separate `tenants` table would duplicate the store
ownership model. The store IS the tenant. A partner IS a store owner. This
avoids a second source of truth for "who belongs to what."

### Decision 2 — Tenant isolation is enforced at the partners service boundary

The partners service provides a **tenant membership guard** (`assertTenantMember`)
that verifies a `UserPrincipal` is an active member of the store identified by
`store_id` (or `store_slug`). This guard is:

- **Not** a gateway check (the marketplace service already enforces service identity)
- **Not** a replacement for RISK-0042's path-based `storeSlug` fix (that's M1-05B)
- **A new boundary** on the partners service that wraps partner-facing operations

The guard reads `store_staff` (from marketplace) via an HTTP port, not a direct
DB connection — following the ADR-026 §2.3 boundary rule: no JOIN across service
boundaries.

### Decision 3 — Partner identity extends Principal, not replaces it

```text
PartnerPrincipal = {
  ...UserPrincipal,
  tenantStoreId: string,       // UUID of the store they belong to
  tenantRole: "owner" | "manager" | "staff",
}
```

A `PartnerPrincipal` is a `UserPrincipal` enriched with tenant context. It is
**not** a new principal type — it's a derivation. The auth-sdk `UserPrincipal`
already carries `waslaPublicId`; the partners service adds tenant membership by
querying `store_staff`.

### Decision 4 — API credentials are scoped to a tenant

Partner API keys are:
- Issued by the partners service (not the identity service)
- Scoped to a single store (`tenant_store_id`)
- Carrying a subset of scopes from the authorization matrix
- Revocable independently of the user account
- Hashed at rest (SHA-256), never stored in plaintext

### Decision 5 — Webhooks are event-driven, not polled

Partners register webhook URLs. The partners service delivers events via the
existing outbox pattern (ADR-026). Events are:
- Store-scoped (never cross-tenant)
- Delivered with exponential backoff (3 retries)
- Signed with HMAC-SHA256 using the partner's webhook secret
- Acknowledged with 2xx within 10 seconds or retried

### Decision 6 — Usage limits are per-tenant, not per-user

Rate limits are enforced per `tenant_store_id`:
- API calls: configurable per store (default: 1000/hour)
- Webhook deliveries: configurable per store (default: 100/hour)
- Storage: not enforced here (marketplace owns product/inventory storage)

### Decision 7 — Onboarding lifecycle is a state machine

```text
PartnerStoreLifecycle:
  pending → approved → active → suspended → offboarded
                 ↑         ↓
                 ←── reinstated ←
```

- `pending`: store created but not yet approved (marketplace review)
- `approved`: store approved, partner can onboard
- `active`: partner API credentials issued, webhooks active
- `suspended`: credentials revoked, webhooks paused (incident or violation)
- `offboarded`: all data archived, credentials revoked permanently

### Decision 8 — Audit trail is append-only

Every partner action (credential issue/revoke, webhook create/delete, suspension,
reinstatement) is written to an append-only `partner_audit_log` table with:
- `actor_public_id` (who)
- `tenant_store_id` (which store)
- `action` (what)
- `metadata` (JSONB, what details)
- `created_at` (when)

### Decision 9 — SLA model is declarative

SLA tiers are declared in the partners service config:
- `standard`: 99.5% uptime, best-effort response, 4-hour incident response
- `enterprise`: 99.9% uptime, priority response, 1-hour incident response

SLA is **declared** per tenant, not **enforced** here. Enforcement is operational
(monitoring + alerting from M2-08).

## 3. What this service does NOT do

| Not here | Where it is |
|---|---|
| User authentication / token issuance | `services/identity/` (ADR-018) |
| Store CRUD / product management | `services/marketplace/` |
| Order management | `services/orders/` |
| Delivery / fulfillment | `services/delivery/` |
| Billing / invoicing | M5-17 (not yet built) |
| Partner Mini App UI | Deferred (ADR-046) |
| Role → scope matrix | `packages/authz-policy/` (M1-05) |

## 4. Service boundary

The partners service:
- **Owns:** partner API credentials, webhooks, usage counters, audit log,
  onboarding lifecycle state
- **Reads from (via HTTP):** marketplace `store_staff` (membership), identity
  `wasla_public_id` (user existence)
- **Writes to (via outbox):** `partner.events.*` events for audit and
  notification
- **Does NOT touch:** marketplace tables, identity tables, orders, delivery

## 5. Database schema (owned by this service)

```sql
-- partner_api_credentials — hashed API keys scoped to a store
CREATE TABLE partner_api_credentials (
  credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_store_id UUID NOT NULL,           -- FK to marketplace.stores (via HTTP, not DB)
  issued_by_public_id TEXT NOT NULL,        -- WS-##########
  key_prefix TEXT NOT NULL,                 -- first 8 chars for identification
  key_hash TEXT NOT NULL UNIQUE,            -- SHA-256 of full key
  scopes TEXT[] NOT NULL DEFAULT '{}',      -- subset of authz scopes
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

-- partner_webhooks — event delivery endpoints per store
CREATE TABLE partner_webhooks (
  webhook_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_store_id UUID NOT NULL,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,                -- HMAC secret, hashed
  event_types TEXT[] NOT NULL DEFAULT '{}', -- filter by event type
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'paused', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- partner_usage_counters — rate limit counters per store
CREATE TABLE partner_usage_counters (
  tenant_store_id UUID NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  api_calls BIGINT NOT NULL DEFAULT 0,
  webhook_deliveries BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_store_id, window_start)
);

-- partner_audit_log — append-only audit trail
CREATE TABLE partner_audit_log (
  entry_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_public_id TEXT NOT NULL,
  tenant_store_id UUID NOT NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- partner_lifecycle — onboarding state per store
CREATE TABLE partner_lifecycle (
  tenant_store_id UUID PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'approved', 'active', 'suspended', 'offboarded')),
  sla_tier TEXT NOT NULL DEFAULT 'standard'
    CHECK (sla_tier IN ('standard', 'enterprise')),
  suspended_reason TEXT,
  suspended_at TIMESTAMPTZ,
  offboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 6. API surface

```
POST   /partners/credentials          — issue API credential (owner only)
GET    /partners/credentials          — list credentials (staff)
DELETE /partners/credentials/{id}     — revoke credential (owner/manager)
POST   /partners/webhooks             — register webhook (owner/manager)
GET    /partners/webhooks             — list webhooks (staff)
DELETE /partners/webhooks/{id}        — delete webhook (owner/manager)
GET    /partners/usage                — usage counters (staff)
GET    /partners/audit                — audit log (owner)
POST   /partners/lifecycle/suspend    — suspend tenant (admin)
POST   /partners/lifecycle/reinstate  — reinstate tenant (admin)
GET    /partners/lifecycle            — lifecycle state (staff)
GET    /partners/health               — liveness
GET    /partners/ready                — readiness
```

## 7. Consequences

- **Positive:** Closes RISK-0042's tenant membership gap for the partners surface.
  Provides a clean enterprise boundary without duplicating the store model.
- **Negative:** Adds a new service with its own database tables. The
  marketplace-to-partners boundary is HTTP-only (no shared DB).
- **Neutral:** The Partner Mini App remains deferred (ADR-046). Partners interact
  via bot + this API + admin console.
