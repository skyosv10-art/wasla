# ADR-045: Driver Mini App architecture — React + Vite + Telegram Web App SDK

**Status:** Accepted
**Date:** 2026-09-22
**Decider:** Perplexity Computer (autonomous technical authority)
**Supersedes:** None
**Related:** ADR-007 (channel adapter isolation), ADR-019 (session lifecycle), ADR-044 (Customer Mini App architecture), M3-02 (Driver Mini App)

## Context

M3-02 requires building the Driver Mini App — the "heavy services" surface for drivers per VISION principle 5. The backend APIs are all implemented:

- **Drivers service** (port 8085): 14 routes — profile read/write, zones read/write, vehicles CRUD, documents CRUD + review, availability write, suspend/reinstate, eligibility read/tick
- **Dispatch service** (port 8084): 8 routes — job create/read, offers read, offer accept/reject, job cancel, tick
- **Orders service** (port 8087): 9 routes — intake, agreed-prices, lookup, read detail, history, transitions, assignments

The order state machine (`ORDER_ENGINE.md`) defines 72 allowed transitions across 21 states. The driver-facing transitions are: `assigned → driver_en_route → arrived → in_progress → completed`, plus cancel paths.

The bot already opens the Mini App via `MiniAppRegistryPort` (ADR-007). Session lifecycle is defined in ADR-019 (initData → identity service → opaque session token, 4h TTL). The `apps/driver-mini-app/` directory will be created.

The product spec ([DRIVER_MINI_APP_SPEC.md](../01-product/DRIVER_MINI_APP_SPEC.md)) defines 9 screens: Session/Loading, Home, Offer Feed, Job Detail, Job History/Earnings, Vehicles, Zones, Documents, Profile.

## Decision

### Decision 1 — Reuse the M3-01 architecture (ADR-044)

The Driver Mini App uses the same architecture as the Customer Mini App (ADR-044):

- **React 18 + Vite 5** — same frontend framework
- **Hash-based routing** — same lightweight router pattern
- **Zustand** — same state management
- **In-memory session token** — no localStorage/sessionStorage (ADR-019)
- **fetch API client** with Bearer auth — same pattern as `apps/customer-mini-app/src/lib/api-client.ts`
- **react-i18next** — same i18n setup (ar/en/ur)
- **Vitest** for unit tests, **Playwright + axe-core** for E2E and accessibility

**Reason:** ADR-044 already validated this stack for Telegram Mini Apps in the same monorepo. The driver app has the same constraints (WebView, client-rendered, session security, i18n). Diverging would add tooling overhead without benefit.

**Rejected alternatives:**
- Different framework: no technical justification — same WebView, same monorepo, same TypeScript paths.
- Shared monorepo package: not yet — see Decision 2.

### Decision 2 — No shared UI package extraction yet

The Customer Mini App (`apps/customer-mini-app/`) and Driver Mini App (`apps/driver-mini-app/`) will NOT share a common `packages/ui-kit/` or `packages/mini-app-core/` package at this stage.

**Reasons:**

1. **Premature abstraction.** Two apps do not yet demonstrate enough duplication to justify a shared package. The customer app has 8 screens, the driver app will have 9 — but the screen content, data flows, and state machines are different.
2. **The shared pieces (session store, API client, i18n setup, hash router) are ~50 lines each.** Copying 50 lines is cheaper than maintaining a cross-app dependency at this stage.
3. **ADR-044 already deferred this** — its Consequences section names "extract shared Mini App utilities" as a future decision when a third app arrives.

**When to revisit:** When a third Mini App (M3-03 Partner, or M3-04 Admin) is built, the duplication across 3+ apps will justify extraction. At that point, a `packages/mini-app-core/` with shared session, router, API client, and i18n setup can be extracted.

### Decision 3 — Driver-specific state machine awareness

The Driver Mini App's Job Detail screen must be aware of the order state machine. Unlike the Customer Mini App (which only creates orders and reads status), the Driver Mini App actively drives state transitions:

- `assigned → driver_en_route` (driver starts moving)
- `driver_en_route → arrived` (driver at pickup)
- `arrived → in_progress` (delivery/trip started)
- `in_progress → completed` (delivery/trip finished)

The UI must:
1. Show only the action button(s) valid for the current state
2. Call `POST /orders/:orderId/transitions` with the correct `to` status
3. Handle 409 (illegal transition) gracefully — the backend is the source of truth
4. Refresh order status after each transition

### Decision 4 — Offer Feed uses polling, not WebSocket

The Offer Feed screen polls `GET /dispatch/jobs/:job_id/offers` on an interval (e.g., every 10 seconds) rather than using WebSocket/SSE.

**Reasons:**
1. Telegram WebView has unreliable WebSocket support across clients.
2. The dispatch service has no WebSocket endpoint — only REST.
3. Polling is simpler and adequate for the offer volume (a few per hour).
4. The offer timeout is handled by the backend (offer expires → `driver_timeout` transition).

**Consequence:** There may be a delay of up to 10 seconds between an offer being created and the driver seeing it. This is acceptable for M3-02 MVP.

### Decision 5 — Build output is static files served by Render

Same as ADR-044 Decision 8. The Vite build produces static files in `apps/driver-mini-app/dist/`. Served by Render static site or a lightweight Fastify static handler. HTTPS required (Telegram requirement).

## Consequences

**Positive:**
- Same tooling, same patterns, same test infrastructure as M3-01
- Faster development — team already familiar with the stack
- No new dependencies to audit

**Negative:**
- Code duplication between customer and driver apps (session store, API client, router, i18n)
- Will need extraction when a third app arrives
- Polling for offers adds latency vs push

**Neutral:**
- The driver app lives in `apps/driver-mini-app/` per ADR-007 §1 rule 4
- The existing `customer-mini-app-e2e` CI job pattern will be replicated as `driver-mini-app-e2e` in Wave 6

## Implementation waves (planned)

Following the M3-01 pattern:

1. **Wave 1:** Scaffold — React 18 + Vite 5, hash router, Zustand session store, API client, i18n, Home screen
2. **Wave 2:** Offer Feed + Job Detail — dispatch API integration, state machine transitions
3. **Wave 3:** Vehicles + Zones — driver vehicle/zone CRUD
4. **Wave 4:** Documents + Profile — document upload, profile edit, eligibility
5. **Wave 5:** Job History/Earnings — order lookup, earnings summary
6. **Wave 6:** E2E + Accessibility — Playwright tests, axe-core audits, CI job

Each wave: unit tests, typecheck, i18n, governance checks. Merge via squash PR.
