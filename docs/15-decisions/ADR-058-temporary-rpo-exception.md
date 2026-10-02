# ADR-058: Temporary exception — measured RPO accepted while PITR is unfunded

**Status:** Accepted — **temporary exception** · **Date:** 2026-10-02 · **Decider:** Program Owner (@skyosv10-art), recorded by agent:perplexity-computer (CLM-0434)
**Excepts (does not amend):** [ADR-052](ADR-052-ha-capacity-dr.md) §1 — T1 RPO 5 min
**Related:** RISK-0055 (stays `mitigating`) · M6-18B (stays `Blocked`) · RISK-0056 (closed, untouched)
**Authority:** written mandate "MASTER REPAIR & MERGE", 2026-09-30, plus the owner's written decision to accept the measured RPO temporarily (budget zero, no PITR).

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE"

## Context

- ADR-052 sets the T1 RPO target at **5 minutes**. That needs PITR or an equivalent WAL-shipping solution.
- Production is Supabase project `ppixaauyqoykrogwdxtv` without PITR. PITR is a paid add-on, and the project budget is **zero**.
- The only recovery point today is `db-backup.yml`: an encrypted, restore-verified logical dump, scheduled every 6 h.
- Measured RPO from the scheduled run history, 7-day window
  ([CLM-0430 evidence](../12-testing/ci-evidence/2026-10-02T070000Z-clm-0430-m6-18b-restore-drill/README.md)):

  | measure | value |
  |---|---|
  | **worst** gap between successful backups | **10.21 h** |
  | **median** gap | **5.21 h** |
  | ADR-052 T1 target | 5 min — **not met** |

  Gaps come from GitHub schedule delay (up to 5.67 h) and failed runs. The cron asks for 6 h. **No 6 h RPO is guaranteed.**

## Decision

1. The Program Owner **temporarily accepts the measured RPO** (worst 10.21 h, median 5.21 h) as the operating recovery point.
2. This is an **exception, not an amendment**. ADR-052's target (5 min) is unchanged. It is still the target, and it is **not met**.
3. PITR or an equivalent WAL solution is **deferred for budget reasons only**. It is not rejected on technical grounds.
4. RISK-0055 stays **`mitigating`**. This ADR does not close it, lower its severity, or count as closure evidence.
5. M6-18B is not completed or gated by this ADR (see "Effect on M6-18B").

## Validity

- **Review date:** 2026-10-13. This is the same as the RISK-0055 review date. The owner must renew or end the exception in writing at that review.
- **Hard expiry:** 2026-11-02. If it is not renewed in writing by then, the exception lapses. RISK-0055 then reports the unmet target with no accepted exception.
- **Ends early** on whichever comes first:
  - (a) PITR or an equivalent WAL solution is provided, and a restore with a measured RPO ≤ 5 min is linked to RISK-0055;
  - (b) a **permanent** owner decision formally amends the ADR-052 target in a new ADR that supersedes ADR-052 §1.
- **Re-measurement:** if a future measurement shows a worst gap above 10.21 h, the exception does not stretch to cover it. The new value is recorded by addition, and the owner must accept it again.

## Effect on M6-18B

Under [`STATUS_MODEL.md`](../00-rules/STATUS_MODEL.md), `READY FOR GATE` means verified, with only evidence outside the executor's control still missing. M6-18B's board row lists three blockers:

1. The RPO target is unmet and not formally amended. This ADR is an exception, not an amendment.
2. DR scenario 2 (database unavailable → circuit breaker) has not been executed. It needs an owner decision on whether it may run against the live DB.
3. A full restore into a real replacement Supabase project has not been measured.

This ADR only addresses item 1, and only partly. Items 2 and 3 are open verification work, not missing gate evidence. **M6-18B stays `Blocked`.** Nothing here moves it to `Ready for Gate` or `Completed`.

## Consequences

- Up to the measured worst gap (≈10 h) of committed data can be lost in a total database loss. This is accepted temporarily and written down, not hidden.
- Nothing here claims RPO 5 min, PITR, or a guaranteed 6 h RPO.
- Changes allowed under this ADR: free work that shortens the measured gap, such as fewer failed runs or a tighter schedule. Each change must be re-measured and recorded.
