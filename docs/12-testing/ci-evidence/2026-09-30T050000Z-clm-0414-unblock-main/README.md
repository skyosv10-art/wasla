# CLM-0414: unblock main (governance and dependencies), evidence

- **Date:** 2026-09-30
- **Base:** `main` = `bc5de79e8901523ae400187f95c1824a3c7a013d`
- **Work item:** M0-45
- **Owner decision:** program owner @skyosv10-art, 2026-09-30

The local results below are measurements. They are **not** the CI verdict. The CI verdict is the PR's run, recorded in the PR description.

## 1. What was red on main (reproduced locally before any change)

`bash scripts/checks/verify-governance.sh` on `bc5de79` fails 4 checks. This matches main rerun 36645750718 (attempt 2) and PR #550 run 36665719526:

| Check | Failure |
|---|---|
| 4 | CLM-0409 is `Active` on a branch that was deleted after PR #548 merged |
| 9 | Dependency audit, gate 1 (production tree): `fast-uri`. Gate 2: 3 × `brace-expansion` and 3 × `fast-uri` GHSAs not declared in SECURITY_RULES §11 |
| 10 | Risk register, gate 2: RISK-0012, RISK-0013 and RISK-0042 are past their `review:` date (2026-09-29) |
| 23 | Two branches (`ops/risk-0056-prod-preflight`, `ops/risk-0056-pgtrgm-readonly`) have no claim, no PR and no evidence declaration |

## 2. Dependencies

Both packages are transitive. `pnpm-lock.yaml` is parsed, and the chains are:

- **`brace-expansion@2.1.4`:** `openapi-typescript@7.13.0` (devDependency in 17 importers) → `@redocly/openapi-core@1.34.19` → `minimatch@5.1.9` (`^2.0.1`) → `brace-expansion`. It is dev-only, but it ships in the runtime image (RISK-0047), so trivy fails image-supply-chain on it.
- **`fast-uri@3.1.7` / `@4.1.4`:** `fastify@5.12.1` (21 importers) → `ajv@8.20.0` / `@fastify/ajv-compiler@4.0.6` / `fast-json-stringify@7.0.1` → `fast-uri`. It is in the **production** tree, so gate 1 allows no exception.

The change is `pnpm.overrides`: `fast-uri@3: ^3.1.8`, `fast-uri@4: ~4.1.5`, `brace-expansion@2: ^2.1.7`.

- The constraint is `~4.1.5` on purpose: `^4.1.5` resolves to 4.2.1, a minor release that nobody has reviewed.
- The resulting lock deltas are patch releases only: `brace-expansion` 2.1.4 → 2.1.7, `fast-uri` 3.1.7 → 3.1.8 and 4.1.4 → 4.1.5.
- `validate-dependency-audit.sh` after the change reports: production tree clean, every vulnerability declared, 7 justified overrides.

### Code generation check (`brace-expansion` is used only here)

There is no CI job that regenerates `api-types.ts`. The check was run by hand:

1. With the `main` lockfile (`minimatch` → `brace-expansion@2.1.4`, symlink resolved), `pnpm -r --no-bail --filter "./packages/contracts/*" run generate` was run and the 16 outputs saved.
2. With the new lockfile (→ `brace-expansion@2.1.7`), the same command was run.
3. **16 of 16 files are byte-identical** between the two runs (`cmp`).
4. The same two generators fail in both runs: `identity` and `subscription`, whose script paths do not exist.

Pre-existing finding, **not caused and not fixed here**:
- The committed `api-types.ts` in 11 contract packages differs from what the current OpenAPI files generate. For example, `AuthUnauthorized`/`AuthForbidden` responses are missing.
- `billing/src/api-types.ts` is not committed.
- This is contract drift with no guard. It is recorded for a separate work item.

## 3. RISK-0042: re-measurement (read only, CLM-0394 scope)

`measure-risk-0042.mts` (in this folder) imports `packages/authz-policy/src/bindings.ts` and `operations.ts` and **executes** them, instead of reading the constants as text. Output: `risk-0042-inventory-measurement.json`. It was re-run from this folder and gives an identical result.

| Metric | Value |
|---|---|
| ENFORCED_OPERATIONS | 157 (17 audiences) |
| OPERATION_BINDINGS (classified) | 52 |
| TOKEN_BOUND_OPERATION_COUNT | 44 (owner 36, tenant 8) |
| TENANT_BOUND_OPERATION_COUNT | 8 |
| strength `none` | 8 |
| UNCLASSIFIED_OPERATION_COUNT | 105 |

Two things about CLM-0394:
- Its table row "OPERATION_BINDINGS (total) 44" was the token-bound count. The total is 52.
- `validate-authz-policy.sh` passes, so the matrix and the code agree.

Residual debts, read from the code and **not tested**:
1. `addStaff` (`services/marketplace/src/app/stores.ts:393`) checks active membership only, not rank. Also, `addedByPublicId` comes from the request body.
2. The marketplace inventory reserve/release routes, which delivery calls as a service (`services/delivery/src/infrastructure/http-marketplace-reservation.ts`), are `none`.
3. Moderation actor fields are unchanged, as decided earlier.

No code was changed.

## 4. RISK-0012: why it is **not** closed

The closing rule (RISK_REGISTER §4, RISK-0012) is: «`mitigating` حتى يُقاسَ على PostgreSQL حقيقيّ في CI». It does not name PostgreSQL 17. CI runs `postgres:15`, and production is 17.6.

Before the PG version question even matters, reading the code shows that the risk's own defect is still present in three **consumers**. They order by a timestamp plus a random UUID, not by `sequence_number`:

- `services/delivery/src/infrastructure/dispatch-event-source.ts`: `ORDER BY occurred_at ASC, event_id ASC` on `dispatch_outbox`
- `services/delivery/src/infrastructure/marketplace-inventory-event-source.ts`: `ORDER BY occurred_at ASC, outbox_id ASC` on `marketplace_outbox`
- `services/search/src/infrastructure/marketplace-event-source.ts`: `ORDER BY created_at ASC, outbox_id ASC` on `marketplace_outbox`, where `created_at` is `DEFAULT now()`, i.e. the transaction start. This is exactly the shape that RISK-0012 was opened for.

Only the publishers' drain stores (orders, matching, negotiations, reputation) order by `sequence_number`.

On test coverage:
- Most of the seven services' integration tests check that `sequence_number` exists and is populated after migration.
- Only marketplace (`outbox.integration.test.ts`) checks intra-transaction order.
- No test covers the three consumers above.

So the risk cannot be closed on the current evidence on any PostgreSQL version. The row is unchanged except for the owner move. The review decision is the owner's, and is proposed in the PR description.

## 5. Claims and branches

- **CLM-0409 → `Released`:** PR #548 merged (squash `bc5de79`). Nothing is lost. The content is on main, and GitHub keeps `refs/pull/548/head`.
- **`ops/risk-0056-prod-preflight` (`8d5a99a`, run 36654335923) and `ops/risk-0056-pgtrgm-readonly` (`2333504`, run 36658728822):** both are declared in `BRANCH_EVIDENCE.md`. The branches are kept and not deleted.
- **PR #549** stays open.

## 6. Not claimed

- No CI verdict here. See the PR run.
- Nothing about the nine other risks with review dates of 2026-09-30 and 2026-10-05. Their rows are **untouched**, and proposals are in the PR description only.
- No production, Supabase, Render, secret or branch-protection change.
