# M6-19C Gate Readiness Audit — supply-chain hardening

- **Audited at (UTC):** 2026-09-28T05:55Z · **Claim:** CLM-0391 (audit) · implementation claim CLM-0390
- **Main at audit:** `751b60e` (PR #529)
- **Board exit criterion:** "provenance/SBOM attestations"
- **Verdict:** **BLOCKED — not ready for gate.** Board status corrected `Ready for Gate → Blocked` by addition.
- This audit does **not** move anything to `Completed`.

## 1. Audit matrix

| Dimension | Result | Evidence / reason |
|-----------|--------|-------------------|
| IMPLEMENTATION | **FAIL** | PR #529 added a document only. No provenance or SBOM **attestation** is produced anywhere: `.github/workflows/*.yml` contains no `attest`, `id-token`, `cosign` or provenance step (measured by `grep`). The `image-supply-chain` job produces two SBOMs, compares them and scans the image — that is M2-01, not M6-19C. |
| LOCAL VERIFICATION | **NOT VERIFIED** | No executable deliverable to verify. `docker` is not available on the execution desk (as recorded for M2-01). |
| DOCUMENTATION | **FAIL → corrected by addendum** | [`SUPPLY_CHAIN_HARDENING.md`](../07-security/SUPPLY_CHAIN_HARDENING.md) §9 addendum: (a) SLSA Build L1/L2 "Met" was wrong — SLSA Build L1 requires a provenance document and L2 a signed, platform-generated provenance; neither exists → **Build L0**. (b) Source L2 "Met (CODEOWNERS)" was wrong — CODEOWNER review is not enforced (GOV-002 BLOCKED) and approvals are not effective (RISK-0054) → **not met**. (c) `RISK-0052` was mis-cited for "single-owner repo"; RISK-0052 is the stuck-`main`-CI risk. (d) The "Exit Criteria — all met" table is withdrawn. |
| CI EVIDENCE | **PASS** (docs PR only) | PR #529: 42/42 green; `main` `751b60e` Roadmap freshness success. CI green on a docs PR is not evidence of attestations. |
| SECURITY EVIDENCE | **PARTIAL** | Existing, measured in CI (M2-01): `image-supply-chain` job success on `main` `751b60e`; artifact `image-supply-chain-evidence` uploaded (SBOM pass1/pass2 + scan). Missing: any signed statement binding the SBOM/image digest to the build. |
| OWNER AUTHORIZATION | **NOT VERIFIED** | No owner gate decision. |
| GATE REQUIREMENTS | **FAIL** | "provenance/SBOM attestations" not produced. |
| DEPENDENCIES | **FAIL** | Depends on M6-19A (`Ready for Gate`, pentest not executed). |

## 2. What unblocks the gate (next implementation, not started in this cycle)

The repository is **public** (`GET /repos/skyosv10-art/wasla` → `visibility: public`), so GitHub artifact attestations are
available. The implementation needs:

1. **DONE (CLM-0395):** ADR-056 created: adding a first-party attestation action to the `image-supply-chain` job. Policy change documented: `validate-workflow-supply-chain.sh` DECLARED updated to `write=yes` for `ci.yml`; job-level `id-token: write` + `attestations: write` added.
2. **DONE (CLM-0395):** SBOM files attested using `actions/attest-build-provenance@v2` (subject = file path). Verification step added using `gh attestation verify` in the same job.
3. **DONE (CLM-0395):** Two mutation cases added to `test-governance.sh`: removal of attestation step (fail), removal of verification step (fail). Gate 7 added to `validate-workflow-supply-chain.sh` enforcing presence of both steps.
4. M6-19A completed; owner gate decision.

### Remediation status (CLM-0395)

| Dimension | Before (CLM-0391 audit) | After (CLM-0395) |
|-----------|------------------------|-------------------|
| Provenance attestation | Not produced | **Produced** via `actions/attest-build-provenance@v2` on SBOM files |
| Attestation verification | Not present | **Present** via `gh attestation verify` in same job |
| SLSA Build level | L0 (no provenance) | **L1** (provenance document, platform-generated) |
| Supply chain guard | 6 gates | **7 gates** (Gate 7 enforces attestation step presence) |
| Mutation cases | 0 for attestation | **2** (removal of attestation step, removal of verification step) |
| Remaining blockers | — | M6-19A (external), owner gate decision |

## 3. Not claimed

No SLSA level above Build L0 is claimed. No image signing, SBOM signing or binary authorization exists.


---

## Owner gate decision — 2026-10-08 (CLM-0497)

**Owner gate decision (2026-10-08, CLM-0497):** the Program Owner approved the M6-19C gate («وافق على بوابات M6-18C وM6-19B وM6-19C»). Status stays `Ready for Gate`: the board dependency **M6-19A is not Completed** and the same owner message keeps M6-19A blocked. Promotion to `Completed` takes effect when M6-19A completes, without a new gate decision.

Evidence: [`ci-evidence/2026-10-08T021500Z-clm-0497-bot-preflight-e2e-owner-decisions/`](ci-evidence/2026-10-08T021500Z-clm-0497-bot-preflight-e2e-owner-decisions/README.md) §8.
