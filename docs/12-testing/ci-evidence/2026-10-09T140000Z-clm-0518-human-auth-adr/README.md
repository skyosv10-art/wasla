# CLM-0518 — Human authentication architecture decision: evidence

- **main read:** `a93fe5ece4e0874f9b230c1962ce1048226dd1a2` (local `git rev-parse HEAD` == GitHub API `commits/main`, 2026-10-09)
- **Deliverable:** [ADR-069 (Proposed)](../../../15-decisions/ADR-069-human-authentication-edge-for-apps.md)
- **Scope:** design only. No code, no auth-path change, no grants change, no production/Render/DB change.

## Decisions and code read

ADR-001, 018, 019, 020, 027, 028, 029, 036, 048, 060 · `services/identity/src/use-cases/session.ts` ·
`services/identity/src/use-cases/issue-user-assertion.ts` · `services/identity/src/http/app.ts` ·
`packages/telegram-adapter/src/init-data.ts` · `packages/service-auth/src/{keys,http,fastify,user-assertion,outbound}.ts` ·
`packages/authz-policy/src/{grants,signer}.ts` · `packages/config/env-registry.json` ·
`docs/07-security/USER_ASSERTION_KEY_LIFECYCLE.md` · `docs/12-testing/ENGINEERING_COMPLETION_MATRIX.md` (CLM-0517).

## Facts the decision rests on (commands on the SHA above)

| Fact | Command | Result |
|---|---|---|
| Session use cases have no production caller | `rg -l "verifyTelegramInitData\|issueSessionFromTelegram\|verifySessionToken" --glob '!**/__tests__/**' services packages bots apps` | only definitions/exports/repositories — no route, no bot, no app |
| identity HTTP has no session route | `grep -nE "app\.(get\|post)" services/identity/src/http/app.ts` | health, resolve, users/:id, links, recovery, history, assertions |
| identity does not depend on telegram-adapter (ADR-019 §1 holds) | `rg telegram-adapter services/identity/package.json` | no match |
| bot-runtime already has the verifier, service-auth and Fastify | `packages/bot-runtime/package.json` | `@wasla/telegram-adapter`, `@wasla/service-auth`, `fastify ^5.12.5` |
| Service keys are a fleet keyset not bound to a service | `packages/service-auth/src/keys.ts` | registry maps `kid → secret/status` only |
| Grant ceiling enforced at the signer only | `packages/service-auth/src/outbound.ts` imports `assertSignerComposition`; `fastify.ts` does not read `PRODUCTION_GRANTS` | sender-side |
| No admin/support human role source | `packages/authz-policy/src/grants.ts` roles = services + bots + tick-scheduler; no staff table in `services/identity/contracts/schema.sql` | none |
| Actor is derived from caller for assertions | `ASSERTION_ACTOR_BY_CALLER` in `issue-user-assertion.ts` | customer-bot→customer, driver-bot→driver, partner-bot→store_staff |
| Assertion audiences | `ASSERTION_AUDIENCES_BY_ACTOR` | customer: identity, negotiations, marketplace, delivery, geography, subscriptions · driver: identity, negotiations, drivers, matching, geography |
| `identity_sessions` migrated | `rg -l identity_sessions services/identity/drizzle/*.sql` | `0000_spotty_blockbuster.sql` (+ down) |
| Routes each app calls | CLM-0517 `inventory.json` (app_callers) | customer 15 (4 services) · driver 16 (3) · admin 38 (8) |
| Blocked matrix rows | rows marked محجوب + P-03/P-04/A-01 in the matrix, plus C-05 and R-02 (app half) | 22 |

## What this evidence does not claim

- Authentication is **not** complete. Nothing was implemented; ADR-069 is `Proposed` and waits for the Program Owner's written approval.
- No live behaviour was measured in this claim.
