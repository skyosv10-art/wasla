# ADR-044: Customer Mini App architecture — React + Vite + Telegram Web App SDK

**Status:** Accepted
**Date:** 2026-09-22
**Decider:** Perplexity Computer (autonomous technical authority)
**Supersedes:** None
**Related:** ADR-007 (channel adapter isolation), ADR-019 (session lifecycle), M3-01 (Customer Mini App)

## Context

M3-01 requires building the Customer Mini App — the "heavy services" surface for customers per VISION principle 5. The backend APIs are all implemented (customer service 10 routes, order service 7 routes, search, marketplace, geography, reputation). The bot already opens the Mini App via `MiniAppRegistryPort` (ADR-007). Session lifecycle is defined in ADR-019 (initData → identity service → opaque session token, 4h TTL). The `apps/customer-mini-app/` directory exists but is empty.

The product spec ([CUSTOMER_MINI_APP_SPEC.md](../01-product/CUSTOMER_MINI_APP_SPEC.md)) defines 8 screens: Home, Ride order form, Delivery order form, Marketplace browse, Search, My Orders, Reputation, Profile.

## Decision

### Decision 1 — React 18 + Vite 5 as the frontend framework

**React** with **Vite** as the build tool. Reasons:

1. **Telegram Mini Apps are web pages loaded in a WebView.** They need fast cold-start, small bundle, and DOM manipulation. React + Vite is the industry standard for this use case.
2. **TypeScript** is already the repository's language. React's TypeScript support is first-class.
3. **Ecosystem maturity** — testing (Vitest + Playwright), accessibility (axe-core), i18n (react-i18next), state management (Zustand) all have mature React bindings.
4. **ADR-007 §1 rule 4** already names `apps/*-mini-app/` as the home for Mini App code. No conflict with existing architecture.

**Rejected alternatives:**
- Vue/Svelte: equally valid technically, but the monorepo's tooling (pnpm workspaces, TypeScript paths) is tuned for React's ecosystem.
- Vanilla JS: rejected — 8 screens with forms, lists, and API integration need component composition. Vanilla would create unmaintainable spaghetti.
- Next.js/SSR: rejected — Telegram Mini Apps are client-rendered in a WebView. SSR adds complexity with no benefit.

### Decision 2 — Hash-based routing (no router framework)

A lightweight hash-based router (`#/home`, `#/ride`, `#/orders`, etc.) instead of a framework router. Reasons:

1. **Telegram WebView does not support history API reliably** across all Telegram clients (mobile/desktop/web). Hash routing works universally.
2. **No dependency** — a 50-line router is simpler than pulling react-router-dom and configuring it for WebView quirks.
3. **Deep links from the bot** already use hash fragments (ADR-007 deep-link encoder).

### Decision 3 — Zustand for state management

**Zustand** (not Redux, not Context). Reasons:

1. **Minimal boilerplate** — the app has ~8 screens with shared session state and order draft state. Redux's ceremony is unjustified.
2. **No Context re-render problem** — Zustand uses selectors, so only components that read changed state re-render.
3. **Session token storage** — Zustand store holds the session token in memory (ADR-019: no localStorage). Store destruction on page unload is correct behavior.

### Decision 4 — Session token in memory only, no persistence

Per ADR-019 §2.5, the session token is stored in the Zustand store (in-memory). No localStorage, no sessionStorage, no cookies. On page refresh, the app re-initiates the session from Telegram initData.

### Decision 5 — API client pattern

A single `apiClient` module that:
1. Reads the session token from the Zustand store
2. Adds `Authorization: Bearer <token>` to every request
3. Handles 401 by triggering session re-initialization
4. Handles 409 (replay) by surfacing a user-facing error
5. Uses `fetch` (no Axios dependency — fewer supply-chain risks per ADR-033)

### Decision 6 — i18n via react-i18next

**react-i18next** with JSON message catalogs. Arabic is the default locale (RTL), English and Urdu are secondary. The `dir` attribute on `<html>` is set based on locale.

### Decision 7 — Vitest for unit tests, Playwright for E2E

- **Vitest** for unit/component tests (aligned with the monorepo's existing test runner).
- **Playwright** for E2E tests (cross-browser, can drive Telegram WebView in headed mode).
- **axe-core** via `@axe-core/playwright` for accessibility audits.

> **Implementation note (CLM-0289, 2026-09-22):** Playwright and axe-core are no longer deferred. Wave 6 delivers 32 E2E tests (session security, navigation smoke, order flow, places CRUD) and 9 axe-core accessibility audits (WCAG 2.0 A/AA, 0 violations). A dedicated CI job `customer-mini-app-e2e` runs in the WASLA CI workflow. See [M3-01_CUSTOMER_MINI_APP_E2E_ACCESSIBILITY.md](../12-testing/M3-01_CUSTOMER_MINI_APP_E2E_ACCESSIBILITY.md) for full evidence.

### Decision 8 — Build output is static files served by Render

The Vite build produces static files in `apps/customer-mini-app/dist/`. These are served:
- In development: Vite dev server with proxy to backend services
- In staging/production: Render static site or a lightweight Fastify static handler

The Mini App URL must be HTTPS (Telegram requirement, ADR-007 §5).

## Consequences

| Consequence | Impact |
|---|---|
| New dependencies: React, Vite, Zustand, react-i18next, Playwright | Added to `apps/customer-mini-app/package.json` — supply chain scanned by existing CI gate 19 |
| Bundle size | Target < 200KB gzipped (React + app code) — Telegram WebView loads slowly on 3G |
| Test infrastructure | Playwright added to CI — new job in WASLA CI workflow |
| No localStorage | Session loss on refresh — acceptable (3s re-init from initData) |
| Hash routing | No SSR/SEO — acceptable (Mini App is not indexed by search engines) |

## Limits published rather than hidden

- **No offline mode in this wave** — Mini App requires network. Offline UX is M3-06 scope.
- **No push notifications from within the app** — notifications go through the bot (principle 5).
- **No map rendering library** (Mapbox/Leaflet) in this wave — location input uses Telegram's native location picker via `getLocationButton`. Full map rendering deferred to a later wave.
- **No WebSocket for real-time order updates** in this wave — polling every 10s. WebSocket upgrade deferred to M3-06.

## References

- [CUSTOMER_MINI_APP_SPEC.md](../01-product/CUSTOMER_MINI_APP_SPEC.md) — product specification
- [ADR-007](ADR-007-telegram-channel-adapter-isolation-and-stack.md) — channel adapter isolation
- [ADR-019](ADR-019-human-session-lifecycle-and-init-data-verification.md) — session lifecycle
- [CUSTOMER_HTTP.md](../04-api/CUSTOMER_HTTP.md) — customer API contract
- [USER_FLOWS.md](../01-product/USER_FLOWS.md) — user flows
