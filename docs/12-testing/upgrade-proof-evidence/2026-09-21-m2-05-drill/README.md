# M2-05C Upgrade/Repair Drill — 2026-09-21

**Work Claim:** CLM-0268
**Database:** Supabase pooler (PostgreSQL 17.6) — aws-0-ap-northeast-2.pooler.supabase.com
**Timestamp:** 20260921074421

## Result: 13/13 PASSED

| # | Service | Status | Forward Migrations | Down Migrations | Apply | Catalog | Rollback | Reapply |
|---|---|---|---|---|---|---|---|---|
| 1 | customers | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 2 | delivery | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 3 | dispatch | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 4 | drivers | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 5 | geography | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 6 | identity | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 7 | marketplace | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 8 | matching | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 9 | negotiations | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 10 | orders | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 11 | reputation | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 12 | search | ✓ PASS | 2 | 2 | pass | pass | pass | pass |
| 13 | subscriptions | ✓ PASS | 2 | 2 | pass | pass | pass | pass |

## Phases per service:
1. **apply_forward:** Apply all migrations forward → PASS
2. **catalog_equivalence:** Schema matches catalog → PASS
3. **rollback:** Rollback all migrations → PASS
4. **clean_after_rollback:** Database clean after rollback → PASS
5. **reapply:** Re-apply all migrations → PASS
6. **final_catalog:** Final schema matches catalog → PASS

## Verdict

M2-05 acceptance criteria "upgrade/repair drill" is MET:
- 13/13 services passed all 6 phases
- 0 failures
- Full cycle: apply → catalog check → rollback → clean → reapply → final catalog

Raw JSON: result.json
