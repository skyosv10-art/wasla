# CLM-0510 — RISK-0067: application-side pool limits (bounded `max` on every guarded pool)

- **Work Item(s):** M6-18B
- **Author/Owner:** @skyosv10-art (agent:perplexity-computer)
- **Date:** 2026-10-09
- **Risk:** RISK-0067 (sev:high, opened CLM-0509) → `mitigating`

## 1. What this is

The register's mitigation requirement, verbatim: *"an independent change setting application-side
pool limits (e.g. a bounded per-service max via config) with tests."* This claim is that change,
and nothing else.

## 2. The defect, restated from the measurement (CLM-0509)

- Supavisor session pool raised 15 → 40 (owner, CLM-0509); `max_connections = 60`; observed peak 25.
- Every service built `pg.Pool` with the library default `max: 10` → 17 × 10 = **170** possible
  demand against **40** pooler slots → `EMAXCONNSESSION` under load.

## 3. The change

| Unit | Change |
|---|---|
| `packages/resilience/src/pg-guard.ts` | `withPgPoolDefaults` sets a bounded `max` on every pool: default 2 (`PG_GUARD_DEFAULTS.poolMax`), per-process `WASLA_PG_POOL_MAX` (integer **1..10**, anything else refused at startup with the variable named), caller-set `max` wins. `PgPoolTimeouts` gains `max?`. |
| 14 db clients (`services/*/…/db.ts`, `packages/channel-postgres/src/db.ts`) | `max: config.max ?? 10` → `max: config.max` — the `?? 10` fallback removed; the bound comes from the shared factory, and a caller-passed `max` still wins. |
| `services/partners/src/infrastructure/pg.ts` | hard-coded `max: 10` removed (the shared bound applies; `idleTimeoutMillis` kept). |
| `packages/config/env-registry.json` | `WASLA_PG_POOL_MAX` registered (positive_int, optional, default 2, runtime+test); readers: `pg-guard.ts` (indirect_literal) + `pg-guard.test.ts` (bag). |
| `.env.example` · `packages/config/src/registry.generated.ts` | regenerated from the registry (`python3 scripts/config/render-config-artifacts.py`) — not hand-edited. |

**Fleet arithmetic, stated where it cannot be missed:** 17 services × default 2 = **34 ≤ 40** slots.
A one-shot CLI asking for `max: 1` keeps it. The env ceiling is deliberately capped at 10 (pg's own
default): a value that re-creates the 170-demand worst case is refused, not blessed.

## 4. Tests

`packages/resilience/src/__tests__/pg-guard.test.ts` — new `describe("withPgPoolDefaults — bounded pool size (RISK-0067)")`:

1. bounds an unbounded pool to 2; caller-set `max: 1` wins; `max: undefined` inherits the bound.
2. `WASLA_PG_POOL_MAX` read per process (4, 10 accepted); 11, 0, 2.5, "soon", blank refused/default.
3. the fleet worst case fits the pooler: 17 × `poolMax` ≤ 40 asserted in code.

**Local run (2026-10-09, pnpm vitest run): 33/33 pass** — 33 = 27 existing + 6 new.

## 5. CI verdict

- PR: filled on push (see §6).
- **CI verdict after merge is the authority; local green is not.**

## 6. Run links

- WASLA CI (PR head):
- Roadmap freshness (PR head):
- Post-merge main runs: to be recorded after merge.

## 7. What this does NOT claim

- RISK-0067 is **not closed**: the register's closure condition is *"a load measurement shows no
  `EMAXCONNSESSION`"*. Code + tests merged ≠ production-proven. Status → `mitigating`.
- No production change in this PR; the Render deploy of the merged commit is the pipeline's own
  pinned `render-deploy` workflow (deploy target = Singapore workspace, per `deploy-target.json`).
- The production value of `WASLA_PG_POOL_MAX` (if the owner wants > 2) is an owner decision; the
  default needs no env var set anywhere.
