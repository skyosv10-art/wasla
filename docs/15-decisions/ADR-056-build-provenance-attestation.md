# ADR-056: Build provenance attestation for image-supply-chain

- **Status:** Proposed
- **Date:** 2026-09-28
- **Decision maker:** @skyosv10-art (agent:perplexity-computer)
- **Work item:** M6-19C
- **Claim:** CLM-0395

## Context

M6-19C requires "provenance/SBOM attestations" as a board exit criterion. The `image-supply-chain` job (M2-01) currently builds container images, generates CycloneDX SBOMs, compares them, and scans for vulnerabilities — but produces no signed statement binding the SBOM and image to the build. The CLM-0391 audit classified this as **BLOCKED** with SLSA Build L0 (no provenance).

The repository is public (`visibility: public`), so GitHub artifact attestations are available without a paid plan.

## Decision

Add a first-party attestation step to the `image-supply-chain` job in `.github/workflows/ci.yml`:

1. **Attest SBOM files** using `actions/attest-build-provenance@v2` with `subject-path` pointing to the generated SBOM files. This creates a signed build provenance attestation binding each SBOM to the workflow run.

2. **Verify attestations** using `gh attestation verify` in the same job, proving the attestation was created and is valid.

3. **Job-level permissions**: Add `id-token: write` and `attestations: write` to the `image-supply-chain` job. These are the minimum permissions required for GitHub artifact attestations. The file-level permission remains `contents: read`.

## Policy change

This is a policy change to a guarded file (`.github/workflows/ci.yml`):

- **Guard update**: `validate-workflow-supply-chain.sh` DECLARED entry for `ci.yml` changes from `write=no` to `write=yes`, reflecting the new job-level write permissions.
- **Mutation enforcement**: `test-governance.sh` gains a mutation case that removes the attestation step and verifies the guard or a dedicated check rejects the removal.

## Consequences

- The `image-supply-chain` job now has `id-token: write` and `attestations: write` permissions. These are scoped to the job only, not the entire workflow.
- The supply chain guard (`validate-workflow-supply-chain.sh`) now declares `write=yes` for `ci.yml`, meaning any future removal of write permissions will be rejected by the guard.
- SLSA Build level improves from L0 (no provenance) to L1 (provenance document exists, platform-generated).
- Source level remains L2 not met (CODEOWNER review not enforced — GOV-002 ON HOLD, RISK-0054 OPEN).
- M6-19A (independent pentest) and owner gate decision remain external blockers.
