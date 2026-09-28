# M6 Dependency Matrix — M6-18B · M6-18C · M6-19A · M6-19B · M6-19C

- **Built at (UTC):** 2026-09-28T06:00Z · **Claim:** CLM-0391 · **Main:** `751b60e`
- **Rule applied:** a green CI run is never, by itself, a reason to move `Ready for Gate → Completed`. `Completed` requires the
  board's exit evidence (a replayable link) **and** an owner gate decision (§9). Program state remains **NO-GO**.
- Sources: [`LAUNCH_EXECUTION_BOARD.md`](../16-progress/LAUNCH_EXECUTION_BOARD.md) rows · gate files listed below.

| ITEM | CURRENT STATUS (board) | BLOCKER | REQUIRED EVIDENCE (board exit) | OWNER DEPENDENCY | CAN ENTER GATE? | CAN BE COMPLETED? |
|------|------------------------|---------|--------------------------------|------------------|-----------------|-------------------|
| M6-18B HA/capacity/DR | Ready for Gate | Live RTO/RPO drill not executed ([`M6-18B_DRILL.md`](M6-18B_DRILL.md) §6: "Drill execution in live env — ⏳ Pending") | RTO/RPO drill record with measured times per scenario | Live Render + Supabase access for the drill; gate decision | **NO** — label overstates: exit evidence absent (procedure only) | **NO** |
| M6-18C observability operating model | Ready for Gate | Live-fire not executed ([`M6-18C_GATE.md`](M6-18C_GATE.md) §2: "Live-fire evidence — ⏳ Pending") | Alert fired → routed → runbook executed, with timestamps | Deployed Prometheus + Alertmanager; gate decision | **NO** — label overstates: exit evidence absent | **NO** |
| M6-19A independent pentest | Ready for Gate | Pentest not procured/executed ([`M6-19A_GATE.md`](M6-19A_GATE.md) §2) · dependency "M5,M6" unmet (`M5-13M` is `Ready for Gate`, not `Completed`) | Pentest report; no critical/high open | Procurement (budget, vendor); gate decision | **NO** — plan only | **NO** |
| M6-19B access/secret/audit review | **Blocked** (corrected this cycle from Ready for Gate) | Baseline incomplete (service identity, DB access, audit integrity unmeasured; rotation age unmeasurable) · depends on M6-19A · reviewer `@uxxxu` ineligible (GOV-002) ([`M6-19B_GATE.md`](M6-19B_GATE.md)) | Measured baseline in all 5 review areas + second cycle | Live environment for DB/audit baselines; valid CODEOWNER (GOV-002); gate decision | **NO** | **NO** |
| M6-19C supply-chain hardening | **Blocked** (corrected this cycle from Ready for Gate) | No provenance/SBOM attestation produced · depends on M6-19A ([`M6-19C_GATE.md`](M6-19C_GATE.md)) | Attestations generated and verified in CI on `main` | ADR to allow attestation action + `id-token`/`attestations` permissions; gate decision | **NO** | **NO** |

## Cross-cutting blockers

| Blocker | Affects | Record |
|---------|---------|--------|
| GOV-002 CODEOWNER eligibility (`@uxxxu` not a collaborator) | every gate that requires an owner/CODEOWNER review | [`2026-09-28T054535Z-gov-002-owner-dependency`](ci-evidence/2026-09-28T054535Z-gov-002-owner-dependency/README.md) |
| RISK-0054 approvals not effective (0-review merges succeed) | the meaning of "merged" for every item | [`RISK_REGISTER.md`](../07-security/RISK_REGISTER.md) |
| M6-19A not completed | M6-19B, M6-19C | board |
| M6 not completed | M7-01…M7-06 (not started; not to be started) | board |

## Status labels not changed here

M6-18B, M6-18C and M6-19A keep their board label in this cycle (the audit mandate covered M6-19B/M6-19C only). The matrix records
that their `Ready for Gate` label is **not supported by their exit evidence**; correcting those labels is an owner decision
or a separately claimed item.
