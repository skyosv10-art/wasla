# ADR-046: Defer Partner Mini App — Bot-First Partner Surface

**Status:** Accepted
**Date:** 2026-09-22
**Decider:** Perplexity Computer (autonomous technical authority)
**Supersedes:** None
**Related:** ADR-007 (channel adapter isolation), ADR-019 (session lifecycle), M3-03 (Partner surface)

## Context

M3-03 requires a "Partner surface أو ADR تأجيل" — either build a Partner Mini App or defer it with an ADR. The Partner surface would provide store owners and business partners with a web UI for managing their marketplace presence (products, orders, inventory).

Current state of partner-facing infrastructure:
- **Marketplace service** (port 8089): product catalog, stores, inventory — implemented
- **Orders service** (port 8087): order intake, transitions — implemented
- **Negotiations service** (port 8086): bid/ask negotiation — implemented
- **Partners service** (services/partners/): scaffolded directory only — no implementation
- **Channel service** (port 8083): Telegram bot adapter — implemented

The bot already opens Mini Apps via `MiniAppRegistryPort` (ADR-007). The session lifecycle (ADR-019) supports partner authentication via `initData`.

However, the Partner Mini App is the lowest-priority UI surface because:
1. Partners primarily interact via the Telegram bot (notifications, deep-links, inline keyboards) — M3-05 will define the allowed bot commands and journeys
2. The Customer Mini App (M3-01) and Driver Mini App (M3-02) are the two critical user-facing surfaces and are now complete
3. The Admin MVP (M3-04) is higher priority for operations readiness
4. A full Partner Mini App would duplicate much of the Customer Mini App's marketplace browsing/ordering UI
5. The partners service itself is not yet implemented — only a scaffolded directory exists

## Decision

### Decision 1 — Defer the Partner Mini App

The Partner Mini App is deferred. Partners will interact with the system via:
- **Telegram bot** — notifications and deep-links (to be formally scoped in M3-05)
- **Admin MVP** (M3-04) — back-office operations including partner management
- **Future Mini App** — can be built in a later milestone when partner adoption demands it

### Decision 2 — Bot-first partner surface (M3-05 future scope)

M3-05 (Bot role restricted to notification/deep-links) will define the partner bot commands and journeys. The intended bot capabilities for partners include:
- Order notifications (new order, status changes)
- Product and inventory alerts
- Settlement notifications

The exact set of allowed bot commands will be defined in M3-05's spec, along with abuse-prevention tests. No Partner Mini App URL generation is in scope until the Partner Mini App itself is separately scoped and built.

### Decision 3 — Revisit when adoption demands

The Partner Mini App should be revisited when:
- Partner adoption exceeds 50 active partners, OR
- Partners report that bot-only interaction is insufficient for their workflow, OR
- A product decision is made to expand the partner surface

## Consequences

- **Positive:** Reduces scope for M3 phase. Allows focus on Admin MVP (M3-04) and bot role definition (M3-05). Avoids building a third Mini App with significant UI overlap with M3-01.
- **Negative:** Partners have no dedicated web UI. Complex operations (bulk product management, inventory reports) may be harder via bot-only interaction.
- **Neutral:** The deferral is reversible — the Partner Mini App can be built later using the same architecture as M3-01/M3-02 (React + Vite + hash routing + Zustand).
