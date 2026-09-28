# Supply Chain Hardening — M6-19C

**Last Updated:** 2026-09-28  
**Authority:** M6-19C  
**Depends on:** M6-19A (Ready for Gate)

---

## 1. Overview

This document defines the supply chain hardening controls, provenance
attestation procedures, and SBOM verification pipeline for the WASLA MARKET
platform. It builds on the container image supply chain established in M2-01.

### Current Supply Chain Posture

| Control | Status | Evidence |
|---------|--------|----------|
| Container image build | Implemented | M2-01 (Dockerfile, build-image.sh) |
| Tool pinning (SHA256) | Implemented | M2-01 (tool-pins.env) |
| SBOM generation (CycloneDX) | Implemented | M2-01 (generate-sbom.sh) |
| SBOM comparison | Implemented | M2-01 (compare-sbom.sh) |
| Vulnerability scanning | Implemented | M2-01 (scan-image.sh) |
| Image contract verification | Implemented | M2-01 (verify-image-contract.sh) |
| Entry point dry-run | Implemented | M2-01 (entry-dryrun.mjs) |
| CI supply chain job | Implemented | M2-01 (image-supply-chain job) |
| Production dependency guard | Implemented | M0-43 (check 22) |
| Dependency audit | Implemented | M0-06 (check 9) |
| Base image pinning | Implemented | M2-01 (SHA256 digest) |
| Non-root user | Implemented | M2-01 (USER node) |
| pnpm from packageManager | Implemented | M2-01 (no global install) |

---

## 2. Supply Chain Pipeline Design

### 2.1 Build Pipeline (CI)

The supply chain pipeline runs as the `image-supply-chain` job in CI:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Build Image │ →  │ Verify Image│ →  │ Generate   │ →  │ Compare    │
│ (Docker)    │    │ Contract    │    │ SBOM       │    │ SBOM       │
│             │    │ (id -u,     │    │ (CycloneDX)│    │ (purl set)  │
│             │    │ entrypoint) │    │            │    │            │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                                │
┌─────────────┐    ┌─────────────┐                               │
│ Scan Image  │ ←  │ Reject on   │ ←─────────────────────────────┘
│ (trivy)     │    │ Diff       │
│ HIGH/CRIT   │    │            │
└─────────────┘    └─────────────┘
```

### 2.2 Build Provenance

Each build produces:

1. **Container image** — built from `Dockerfile` with pinned base image
2. **SBOM** — CycloneDX JSON, generated inside the image
3. **Build log** — CI job output with all steps
4. **Base image digest** — SHA256 of the pinned base
5. **Tool versions** — from `tool-pins.env` (SHA256-pinned)

### 2.3 Base Image Integrity

The Dockerfile uses a pinned base image with SHA256 digest. The digest is
verified at build time. The base image includes:

- Node.js version matching `NODE_VERSION` in CI
- pnpm installed from `packageManager` field (no global install)
- Non-root user (`USER node`)
- No development dependencies in the runtime layer (RISK-0047 — `tsx` required)

---

## 3. SBOM Management

### 3.1 SBOM Generation

SBOMs are generated using CycloneDX format via `scripts/container/generate-sbom.sh`.
The SBOM includes:

- All packages installed in the container image
- Package URLs (purls) for each dependency
- Package versions (exact, not ranges)
- License information (where available)

### 3.2 SBOM Comparison

`scripts/container/compare-sbom.sh` compares two SBOMs by purl set. This detects:

- New dependencies introduced between builds
- Removed dependencies (potential breaking changes)
- Version changes in existing dependencies

### 3.3 SBOM Storage

SBOMs should be stored as CI artifacts for each release. The retention period
is the same as the release artifact retention.

---

## 4. Provenance Attestation Procedure

### 4.1 SLSA Framework Alignment

The supply chain aligns with SLSA (Supply-chain Levels for Software Artifacts):

| SLSA Level | Requirement | Status |
|------------|-------------|--------|
| Build L1 | Build provenance documented | Met (CI job + build log) |
| Build L2 | Hosted build platform | Met (GitHub Actions) |
| Build L3 | Hardened build platform | Partial (GitHub Actions with OIDC) |
| Source L1 | Version controlled source | Met (Git, GitHub) |
| Source L2 | Verified history | Met (branch protection, CODEOWNERS) |
| Source L3 | Two-party review | Not met (single-owner repo — RISK-0052) |

### 4.2 Provenance Evidence Collection

For each release candidate:

1. Record the Git commit SHA
2. Record the CI run ID
3. Record the container image digest
4. Record the SBOM hash
5. Record the base image digest
6. Store all in `docs/12-testing/ci-evidence/<release-tag>/`

### 4.3 Artifact Verification

Before deploying to production:

1. Verify the container image digest matches the provenance record
2. Verify the SBOM hash matches the provenance record
3. Verify no HIGH/CRITICAL vulnerabilities (scan-image.sh)
4. Verify the image contract (verify-image-contract.sh)
5. Record verification result in evidence directory

---

## 5. Vulnerability Management

### 5.1 Scanning

`scripts/container/scan-image.sh` scans the container image using `trivy`.
The scan rejects images with HIGH or CRITICAL vulnerabilities that have
available fixes.

### 5.2 Exception Process

Vulnerabilities without available fixes (e.g., Go stdlib in esbuild binary)
are documented as exceptions in `docs/07-security/IMAGE_VULN_EXCEPTIONS.yaml`
with:

- CVE ID
- Severity
- Affected package
- Reason for exception
- Expiry date
- Mitigation

### 5.3 Dependency Audit

`scripts/checks/validate-dependency-audit.sh` (check 9) runs `pnpm audit` on
the dependency tree. The check enforces:

- Production tree: 0 vulnerabilities (no exceptions)
- Development tree: vulnerabilities must have owner and expiry date
- `pnpm.overrides` must be justified in text

---

## 6. Supply Chain Hardening Roadmap

### Already Implemented (M2-01)

- Container image build with pinned base
- Tool pinning with SHA256
- SBOM generation (CycloneDX)
- SBOM comparison
- Vulnerability scanning
- Image contract verification
- CI supply chain job
- Production dependency guard

### M6-19C Deliverables

- This document (supply chain hardening plan)
- Provenance attestation procedure
- SLSA alignment assessment
- SBOM management procedure
- Vulnerability exception process (already documented in IMAGE_VULN_EXCEPTIONS.yaml)

### Future Hardening (Post-Launch)

- Image signing (cosign/sigstore)
- SBOM signing
- SLSA Build L3 (hardened build platform with OIDC)
- Binary authorization (deploy only signed images)
- Dependency pinning at lockfile level (already done via pnpm-lock.yaml)

---

## 7. Exit Criteria

The exit criteria for M6-19C is **provenance/SBOM attestations** — meaning:

1. The supply chain pipeline is documented (this document)
2. SBOM generation and comparison are in CI (already done in M2-01)
3. Provenance attestation procedure is defined (§4)
4. Vulnerability exception process is documented (§5.2)
5. SLSA alignment is assessed (§4.1)

### Current Status

| Criterion | Met | Evidence |
|-----------|-----|----------|
| Pipeline documented | Yes | This document |
| SBOM in CI | Yes | M2-01 (image-supply-chain job) |
| Provenance procedure | Yes | §4 |
| Vulnerability exceptions | Yes | IMAGE_VULN_EXCEPTIONS.yaml |
| SLSA assessment | Yes | §4.1 |

Status: Ready for Gate (§9 — owner decision to Completed).

---

## 8. References

- [CONTAINER_IMAGES.md](../08-infrastructure/CONTAINER_IMAGES.md) — Container image documentation (M2-01)
- [IMAGE_VULN_EXCEPTIONS.yaml](IMAGE_VULN_EXCEPTIONS.yaml) — Vulnerability exceptions
- [RISK_REGISTER.md](RISK_REGISTER.md) — RISK-0047 (dev deps in image), RISK-0048 (missing start cmd)
- [PENTEST_PLAN.md](PENTEST_PLAN.md) — Pentest plan (M6-19A)
- [ACCESS_SECRET_AUDIT_REVIEW.md](ACCESS_SECRET_AUDIT_REVIEW.md) — Access/secret/audit review (M6-19B)
