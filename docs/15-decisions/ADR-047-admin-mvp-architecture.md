# ADR-047: Admin MVP Architecture — React + Vite + Audit Service

**Status:** Accepted
**Date:** 2026-09-22
**Decider:** Perplexity Computer (autonomous technical authority)
**Supersedes:** None
**Related:** ADR-027 (authorization policy matrix), ADR-044 (customer mini app), ADR-045 (driver mini app), M3-04 (Admin MVP)

## Context

M3-04 requires building the Admin MVP — the operations back-office surface. The exit gate is "RBAC + audit + UAT." The spec ([ADMIN_MVP_SPEC.md](../01-product/ADMIN_MVP_SPEC.md)) defines 5 screens, 2 roles (operator, admin), and a new audit service.

The existing infrastructure:
- **Identity service** (port 8081): JWT signing, session management — implemented
- **Authz-policy** (M1-05): 10 production roles, 135 enforced operations — implemented
- **Drivers service** (port 8085): admin endpoints (suspend, reinstate, document review) — implemented
- **Orders service** (port 8087): read-only order detail — implemented
- **Customers service** (port 8080): needs admin endpoints (suspend, reinstate)
- **Audit service** (services/audit/): scaffolded only — needs implementation

## Decision

### Decision 1 — Reuse the M3-01/M3-02 frontend architecture

The Admin Portal uses the same architecture as the Customer and Driver Mini Apps:
- **React 18 + Vite 5** — same frontend framework
- **Hash-based routing** — same lightweight router pattern
- **Zustand** — state management
- **API client with Bearer token** — same pattern (in-memory, no localStorage)
- **react-i18next** — same i18n setup (ar/en/ur)
- **Tailwind CSS** — for rapid UI development (new — M3-01/M3-02 used plain CSS)

### Decision 2 — New Audit service (Fastify)

The audit service is a new Fastify application in `services/audit/`:
- `POST /audit/events` — receives audit events from other services
- `GET /audit/events` — returns audit log with filtering (date, actor, action)
- `audit_events` table: append-only (no UPDATE/DELETE), 90-day retention
- Port: 8090 (next available)

### Decision 3 — RBAC roles

Two new roles added to the authz-policy matrix:
- `operator`: users:read, users:suspend, drivers:read, drivers:review, drivers:suspend, orders:read, audit:read
- `admin`: all operator permissions + team:manage, reports:read, audit:export

### Decision 4 — Wave breakdown (4 waves)

1. **Wave 1**: Scaffold + Audit Service (apps/admin-portal/ setup, services/audit/ implementation, RBAC roles)
2. **Wave 2**: Users + Drivers Management screens
3. **Wave 3**: Orders + Audit Log UI
4. **Wave 4**: UAT scenarios, E2E tests, accessibility audits, exit gate

## Consequences

- **Positive:** Reuses proven M3-01/M3-02 architecture. Audit trail provides accountability. RBAC enforces least privilege.
- **Negative:** New audit service adds operational complexity. Customers service needs new admin endpoints.
- **Neutral:** Admin Portal is a separate app (not a Mini App) — opened via browser, not Telegram.
