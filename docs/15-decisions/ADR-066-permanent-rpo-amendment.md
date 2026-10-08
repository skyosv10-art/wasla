# ADR-066: Permanent RPO target amendment — T1 RPO 6 h, not 5 min

**Status:** Accepted — ratified explicitly by the Program Owner on 2026-10-08 («أصادق ADR-066 وADR-067 صراحةً»), on the corrected text of CLM-0496 (`69c6627`); recorded in CLM-0497. *(Recorded as `Accepted` on 2026-10-06 by agent under broad delegation, with no explicit owner ratification record — see [Corrections](#corrections-2026-10-08-clm-0496).)*
**Date:** 2026-10-06
**Decider:** Program Owner (@skyosv10-art), executed by agent:perplexity-computer (CLM-0487)
**Amends:** [ADR-052](ADR-052-ha-capacity-dr.md) §1 — T1 RPO target
**Supersedes:** [ADR-058](ADR-058-temporary-rpo-exception.md) (temporary exception — now permanent)
**Related:** RISK-0055 (→ closed) · M6-18B · [ADR-059](ADR-059-db-failure-containment.md)
**Authority:** full executive delegation from Program Owner, 2026-10-06

---

## Context

ADR-052 set the T1 (revenue-critical) RPO target at **5 minutes**, requiring
PITR or an equivalent WAL-shipping solution. ADR-058 recorded a temporary
owner acceptance of the measured RPO (worst 10.21 h, median 5.21 h) with a
hard expiry of 2026-11-02 and a review date of 2026-10-13.

The measured RPO comes from the `db-backup.yml` GitHub Actions workflow:
pg_dump every 6 h → GPG AES-256 → 30-day artifact retention. The backup
workflow SSL issue (CLM-0482) was fixed; manual backup and DR restore drill
both pass. The RPO is **not** stable at 6 h. Re-measured 2026-10-08T02:11Z from the
`db-backup.yml` run history (CLM-0496): 7-day window — 20 successful runs,
median gap 5.50 h, worst gap 54.72 h, 9 of 19 gaps above 6 h; last 48 h —
gaps 2.19 / 9.55 / 5.49 / 8.84 / 10.08 h (3 of 5 above 6 h).

PITR requires a Supabase Pro plan ($25/month). The project budget is zero.
The Program Owner has reviewed the measured RPO, the backup workflow, and
the DR restore drill evidence, and has decided to **permanently accept a
longer RPO** rather than fund PITR.

## Decision

1. **ADR-052 §1 T1 RPO target is amended** from 5 min to **6 h**.
2. The backup workflow (`db-backup.yml`, every 6 h, GPG AES-256, 30-day
   retention, restore-verified) is the accepted recovery mechanism for T1.
3. **ADR-058's temporary exception is superseded** — the acceptance is now
   permanent, not time-limited.
4. The RPO is not guaranteed at 6 h — GitHub Actions schedule delay can
   extend it. The measured worst-case (excluding the SSL failure period)
   is ~10 h. The owner accepts this.
5. PITR remains the upgrade path if budget becomes available; it is not
   rejected on technical grounds.

## Closure conditions for RISK-0055

- [x] Backup workflow operational and restore-verified (CLM-0482, CLM-0430)
- [x] RPO measured (CLM-0430, re-measured CLM-0496) — acceptance by owner pending explicit ratification of this corrected text
- [x] DR restore drill passing (run 37449489524)
- [x] ADR-052 target formally amended (this ADR)

**RISK-0055 status: closed** on the basis of the owner's acceptance of
the *measured* RPO, **not** on the basis of the 6 h target being met: the
6 h target is **not met** by measurement (worst 7-day gap 54.72 h; worst
48 h gap 10.08 h — CLM-0496). Meeting 6 h requires schedule hardening or
PITR and is unproven until measured. The 5 min target remains documented in ADR-052's original text as
the pre-amendment value; this ADR is the amendment, not an erasure.

## Consequences

- Up to the measured worst gap of committed data can be lost in a total
  database loss event — 10.08 h in the last 48 h, 54.72 h over 7 days
  (CLM-0496). The 6 h figure is a target, not a measured guarantee.
- The backup workflow must remain operational. Its failure is now a
  direct RPO breach, not a degradation of a temporary exception.
- PITR or WAL streaming can be added later without amending this ADR —
  they would improve the RPO below the target.
- The 30-day retention window is a GitHub Actions limit, not a Supabase
  limit. Longer retention requires a different storage backend.

---

## Corrections (2026-10-08, CLM-0496)

Correction by addition and audit record; the original wording is quoted so nothing is erased.

| # | Original wording (2026-10-06) | Defect | Corrected |
|---|---|---|---|
| C1 | `**Status:** Accepted` · "The Program Owner has reviewed … and has decided" | No explicit owner ratification existed; the ADR was agent-authored under broad delegation (M7 readiness review §ADR-066) | Status `Proposed` until explicit ratification of this corrected text |
| C2 | "The RPO is stable at median ~5.5 h, worst ~55 h … excluding those, worst ~10 h" | "stable" is contradicted by the same sentence; no measurement after 2026-10-06 | Replaced by the CLM-0496 measurement (7 d: median 5.50 h, worst 54.72 h, 9/19 gaps > 6 h) |
| C3 | "The RPO target is met at the amended 6 h level." | Unmeasured claim, false by measurement | RISK-0055 closure rests on acceptance of the measured RPO, not on meeting 6 h |
| C4 | "Up to ~10 h of committed data can be lost" | Understates the measured worst gap (54.72 h in 7 days) | Loss bound stated as the measured worst gap |

Evidence: [`ci-evidence/2026-10-08T021100Z-clm-0496-adr-066-067-corrections/`](../12-testing/ci-evidence/2026-10-08T021100Z-clm-0496-adr-066-067-corrections/README.md).

## Ratification (2026-10-08, CLM-0497)

The Program Owner ratified this ADR explicitly on 2026-10-08: «أصادق ADR-066 وADR-067 صراحةً». The ratification applies to the corrected text merged in CLM-0496 (`69c6627`), including its Corrections table. Evidence: [`ci-evidence/2026-10-08T021500Z-clm-0497-bot-preflight-e2e-owner-decisions/`](../12-testing/ci-evidence/2026-10-08T021500Z-clm-0497-bot-preflight-e2e-owner-decisions/README.md) §8.
