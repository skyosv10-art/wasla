# CLM-0517 — Engineering Completion Audit: evidence

- **main audited:** `76d60fa832f080e5329538120ee22dd492b0b46a` (local `git rev-parse HEAD` == `origin/main` via API, 2026-10-09)
- **Production changes:** none. No writes to any database, no partition, no deploy, no credential rotation.
- **Matrix:** [`docs/12-testing/ENGINEERING_COMPLETION_MATRIX.md`](../../ENGINEERING_COMPLETION_MATRIX.md)

## Replay

```bash
python3 scripts/audit/engineering_completion_inventory.py --out /tmp/inventory.json
# reuses scripts/checks/lib/app_api_routes.py (check 24) for app calls and service routes
```

`inventory.json` here is the snapshot produced on the audited SHA. Key summary values:
routes 184 (domain 162), tested 159, success+failure markers 157 (text heuristic), untested 3 (partners),
app calls 74 (unresolved 0, unmatched 0), callers app 65 / internal-http 29 / none-http 68.

## Manual evidence (commands run on the audited SHA)

| Finding | Command / file | Result |
|---|---|---|
| No HTTP session route | `rg -n "sessions" services/identity/src/http/*.ts` | no match; identity routes = resolve, users, links, recovery, history, assertions |
| Apps never create a session in production | `rg -n "setSession" apps/*/src` | only `main.tsx` behind `import.meta.env.VITE_E2E === "true"` |
| Apps send Bearer, services require service token | `apps/*/src/api/client.ts` (`Authorization: Bearer`) vs `packages/service-auth/src/http.ts` (`x-wasla-service-auth`) | mismatch; M3-09 gate measured 401 |
| No runtime creator of dispatch jobs | `rg "/dispatch/jobs" --glob '!**/__tests__/**'` | only driver app reads, contracts, and e2e harnesses (`driver-e2e/src/harness.ts:1116`, `negotiation-e2e/src/harness.ts:908`); `services/customers/src/infrastructure` has no dispatch adapter |
| Bots call use cases in-process | `bots/driver-bot/src/driver-core.ts` imports `registerDriver`, `declareAvailability`; `bots/customer-bot/src/customer-core.ts` imports `upsertCustomerProfile`, `UnavailableOrderIntake` | registration/availability via bot exist; customer bot cannot create orders |
| Event sink unconfigured | `packages/outbox/src/sink.ts` `unconfiguredEventSink`; used by reputation/subscriptions | no production sink |
| Community escalation not posted | `rg community bots/*/src packages/bot-runtime/src` | config/welcome only; state set in `services/dispatch/src/use-cases/tick.ts:410` |
| Driver availability toggle absent in app | `rg availab apps/driver-mini-app/src` | display only in `Profile.tsx`; spec §4.2 + acceptance 2 require `PUT /drivers/:id/availability` |
| Golden E2E is reachability | `packages/golden-e2e/src/__tests__/golden-journeys.golden.test.ts` | `it("… is reachable …")` on LEGACY `wasla-<svc>.onrender.com` |
| Resilience imported by all 17 HTTP services | `rg -l "@wasla/resilience" services/*/src` | 17/17 |
| No local Postgres/Docker in the agent sandbox | `which docker postgres psql` | none → RISK-0067 L1 must run in CI |

## What this evidence does not claim

- No LIVE user journey was run (forbidden on production data; impossible without an isolated stack).
- CI-PG results referenced in the matrix come from the existing green main run 37923590657; this audit did not re-run them.
- The success/failure-marker counts are a text heuristic over test files, not a per-route verdict.
