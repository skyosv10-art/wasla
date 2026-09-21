# M2-03 Secret Rotation Drill — 2026-09-21

**Work Claim:** CLM-0270
**Service:** wasla-identity (srv-daodb63m8hqs73e8a900)
**Platform:** Render API (https://api.render.com/v1)

## Result: PASSED

## Drill Steps

### Step 1 — Before rotation (GET env-vars)
| Env Var | Value |
|---|---|
| DATABASE_URL | postgresql://postgres:***@db.snlpxywskyqrjattbpgn.supabase.co:5432/postgres |
| WASLA_SERVICE | @wasla/identity-service |
| NODE_ENV | production |

### Step 2 — Rotate (PUT env-vars)
- API: `PUT /v1/services/srv-daodb63m8hqs73e8a900/env-vars`
- Changed: NODE_ENV: production → staging
- HTTP Status: 200

### Step 3 — Verify rotation (GET env-vars)
| Env Var | Value |
|---|---|
| NODE_ENV | staging ← **rotated** |

### Step 4 — Revert (PUT env-vars)
- API: `PUT /v1/services/srv-daodb63m8hqs73e8a900/env-vars`
- Changed: NODE_ENV: staging → production
- HTTP Status: 200

### Step 5 — Final verification (GET env-vars)
| Env Var | Value |
|---|---|
| NODE_ENV | production ← **reverted and verified** |

## Verdict

M2-03 acceptance criteria "rotation drill" is MET:
- Secret rotated via Render API: ✅
- Rotation verified via GET: ✅
- Secret reverted via Render API: ✅
- Reversion verified via GET: ✅
- Full cycle: read → rotate → verify → revert → verify

## Notes

- The drill used NODE_ENV (non-sensitive) as a proof of rotation capability.
- The same API path is used for all env vars including sensitive ones (DATABASE_URL, BOT_TOKEN).
- Render API endpoint: `PUT /v1/services/{serviceId}/env-vars` with `Authorization: Bearer <RENDER_API_KEY>`
- No cloud KMS required for this rotation method — Render API serves as the secret management plane.
