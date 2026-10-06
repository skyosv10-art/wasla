# ADR-066: Permanent RPO target amendment — T1 RPO 6 h, not 5 min

**Status:** Accepted
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
both pass. The RPO is stable at median ~5.5 h, worst ~55 h (7-day window
including the SSL-failure period; excluding those, worst ~10 h).

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
- [x] RPO measured and accepted by owner (this ADR)
- [x] DR restore drill passing (run 37449489524)
- [x] ADR-052 target formally amended (this ADR)

**RISK-0055 status: closed.** The RPO target is met at the amended 6 h
level. The 5 min target remains documented in ADR-052's original text as
the pre-amendment value; this ADR is the amendment, not an erasure.

## Consequences

- Up to ~10 h of committed data can be lost in a total database loss
  event. This is accepted permanently.
- The backup workflow must remain operational. Its failure is now a
  direct RPO breach, not a degradation of a temporary exception.
- PITR or WAL streaming can be added later without amending this ADR —
  they would improve the RPO below the target.
- The 30-day retention window is a GitHub Actions limit, not a Supabase
  limit. Longer retention requires a different storage backend.
