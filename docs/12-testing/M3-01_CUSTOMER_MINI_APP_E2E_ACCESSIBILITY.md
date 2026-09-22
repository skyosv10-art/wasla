# M3-01 — Customer Mini App E2E + Accessibility Evidence

**Work Item:** M3-01 · **Claim:** CLM-0289 · **Wave:** 6 (final)

## Overview

Wave 6 adds Playwright E2E tests and axe-core accessibility audits to the Customer Mini App, satisfying the M3-01 exit gate requirement: "secure UI E2E + accessibility evidence."

## Command

```bash
pnpm --filter @wasla/customer-mini-app exec playwright test
```

## Test Architecture

- **Runner:** Playwright 1.49+
- **Browser:** Chromium (headless shell)
- **Viewport:** Pixel 5 (393x851) — mobile-first, per ADR-044
- **Locale:** ar-SA, timezone Asia/Riyadh
- **Server:** `vite build` (with `VITE_E2E=true`) + `vite preview` on port 4173
- **API mocking:** `page.route()` at the Playwright route layer — no real backend dependency
- **Accessibility:** `@axe-core/playwright` with WCAG 2.0 A/AA tags

## E2E Test Coverage (32 tests)

### Session Security (5 tests) — `e2e/auth-session.spec.ts`

| # | Test | Asserts |
|---|------|---------|
| 1 | Fresh browser shows loading state | No session → app shows loading, not content |
| 2 | No API calls without session token | No `customers/**` requests fire when unauthenticated |
| 3 | localStorage has no token | ADR-019 §2.5: token never in localStorage |
| 4 | sessionStorage has no token | ADR-019 §2.5: token never in sessionStorage |
| 5 | Authenticated session shows app | Seeded session → app content visible |

### Navigation Smoke (11 tests) — `e2e/navigation.spec.ts`

| # | Test | Asserts |
|---|------|---------|
| 1 | Home shows all 8 menu items | Ride, Delivery, Places, Marketplace, Search, My Orders, Reputation, Profile |
| 2 | Ride order screen reachable | Hash route `#/ride` renders RideOrder |
| 3 | Delivery order screen reachable | Hash route `#/delivery` renders DeliveryOrder |
| 4 | Saved places screen reachable | Hash route `#/places` renders SavedPlaces |
| 5 | Marketplace screen reachable | Hash route `#/marketplace` renders Marketplace |
| 6 | Search screen reachable | Hash route `#/search` renders Search |
| 7 | My orders screen reachable | Hash route `#/orders` renders MyOrders |
| 8 | Reputation screen reachable | Hash route `#/reputation` renders Reputation |
| 9 | Profile screen reachable | Hash route `#/profile` renders Profile |
| 10 | Clicking menu items navigates | Link click → correct screen, back navigation works |

### Order Flow (4 tests) — `e2e/order-flow.spec.ts`

| # | Test | Asserts |
|---|------|---------|
| 1 | Preview sends Bearer token | `Authorization: Bearer ...` on POST to `/order-requests/preview` |
| 2 | Submit sends Bearer + Idempotency-Key | Both headers present on POST to `/order-requests` |
| 3 | Submit error shows error message | Error state rendered on API failure |
| 4 | Form validation prevents empty submit | Validation error shown when fields empty |

### Places Flow (4 tests) — `e2e/places-flow.spec.ts`

| # | Test | Asserts |
|---|------|---------|
| 1 | Loads places with Bearer | GET `/customers/{id}/places` with `Authorization: Bearer` |
| 2 | Adds place with Bearer | POST with Bearer, new place appears after re-fetch |
| 3 | Deletes place with Bearer | DELETE with Bearer, place removed after re-fetch |
| 4 | Empty state when no places | Empty state message shown |

### Accessibility (9 tests) — `e2e/accessibility.spec.ts`

| # | Screen | Standard | Violations |
|---|--------|----------|------------|
| 1 | Home | WCAG 2.0 A/AA | 0 |
| 2 | Ride Order | WCAG 2.0 A/AA | 0 |
| 3 | Delivery Order | WCAG 2.0 A/AA | 0 |
| 4 | Saved Places | WCAG 2.0 A/AA | 0 |
| 5 | Marketplace | WCAG 2.0 A/AA | 0 |
| 6 | Search | WCAG 2.0 A/AA | 0 |
| 7 | My Orders | WCAG 2.0 A/AA | 0 |
| 8 | Reputation | WCAG 2.0 A/AA | 0 |
| 9 | Profile | WCAG 2.0 A/AA | 0 |

## E2E Session Seeding

The app uses an in-memory Zustand session store (ADR-044 Decision 4). For E2E tests, a compile-time gated hook is exposed:

- **Gated by:** `import.meta.env.VITE_E2E === "true"`
- **Tree-shaken** in production builds (Vite removes the block when the env var is not set)
- **No production backdoor:** The hook is never available in production code
- **Usage:** `page.addInitScript()` sets `window.__waslaE2ESession` before page load, and `window.__waslaE2E` provides runtime `setSession`/`clearSession` controls

## Accessibility Fix

The viewport meta tag in `index.html` had `user-scalable=no, maximum-scale=1.0` which disabled text scaling and zooming on mobile devices — a WCAG 2.0 AA violation (1.4.4 Resize text). Fixed by removing `maximum-scale` and `user-scalable` attributes, allowing users to zoom as needed.

## CI Integration

A dedicated CI job `customer-mini-app-e2e` runs in `.github/workflows/ci.yml`:

1. Installs dependencies (`pnpm install --frozen-lockfile`)
2. Installs Playwright Chromium browser (`npx playwright install --with-deps chromium`)
3. Builds the app with `VITE_E2E=true` and runs all E2E + accessibility tests
4. Uploads the HTML report as an artifact

## Limits

- **Chromium only:** Tests run on Chromium headless. No Firefox or WebKit coverage.
- **Mocked backend:** All API calls are mocked at the Playwright route layer. No integration with real backend services.
- **No visual regression:** No screenshot comparison or visual regression testing.
- **RTL Arabic default:** Tests use Arabic locale. English and Urdu locales are not E2E tested.
- **Session seeding:** Uses a compile-time gated E2E hook, not a real Telegram initData flow.
