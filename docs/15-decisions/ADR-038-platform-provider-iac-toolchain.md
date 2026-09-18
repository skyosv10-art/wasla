# ADR-038: Platform, Provider, and IaC Toolchain for M2 Infrastructure

> **Status:** Proposed · **Date:** 2026-09-18 · **Decision Owner:** @uxxxu · **Work Item:** M2-02 · **Claim:** CLM-0216
>
> **Related:** [ADR-033](ADR-033-container-image-supply-chain.md) (container images) · [ADR-032](ADR-032-config-schema-single-source.md) (config schema) · [SCALING.md](../02-architecture/SCALING.md) · [CONTAINERS.md §7](../02-architecture/CONTAINERS.md) · [LAUNCH_TO_100_ROADMAP.md §19](../16-progress/LAUNCH_TO_100_ROADMAP.md)

---

## 1. Context

M2-02 requires IaC, environments, networks, and TLS. The roadmap (§19) lists: Kubernetes/Terraform, environment configuration, secrets management, service discovery, ingress/gateway, TLS, DNS, network policies, database hosting, storage, backup, monitoring, alerting. Environments needed: local, ci, development, staging, production.

The repository already has:
- `infra/terraform/` — empty placeholder, documented as "Infrastructure as Code" ([CONTAINERS.md §7](../02-architecture/CONTAINERS.md))
- `infra/docker/` — empty placeholder, documented as "local development containers"
- `infra/kubernetes/` — empty placeholder, documented as "runtime (when needed — see SCALING.md)"
- `infra/environments/` — empty placeholder, documented as "dev / staging / production"
- Root `Dockerfile` — reproducible container image (ADR-033, merged)
- Supabase managed PostgreSQL provided by program owner (project URL, Postgres direct connection, service-role token)

The SCALING.md document defines a staged scalability path: Stage A (modular monolith + PostgreSQL + Redis + Search + outbox) is the current stage. Kubernetes is deferred to Stage D (regional deployments). The architecture explicitly says: "لا نضيف Kubernetes/Multi-Region لمجرد اكتمال الصورة المعمارية" — we don't add Kubernetes for architectural completeness.

---

## 2. Decision

### 2.1 IaC Toolchain: Terraform

Terraform is the IaC tool. The repository already has `infra/terraform/` and the roadmap says "fresh plan/apply". Terraform is declarative, provider-ecosystem-rich, and the team's existing architecture docs reference it.

**Non-goal:** Pulumi, CDK, or CloudFormation. Not considered — the repo already chose Terraform.

### 2.2 Database Hosting: Supabase Managed PostgreSQL

Supabase is the managed PostgreSQL provider. The program owner provided Supabase project credentials. All 13 services use PostgreSQL with Drizzle migrations. Supabase provides:
- Managed PostgreSQL with point-in-time recovery
- Connection pooling (PgBouncer)
- Dashboard and SQL editor for operations
- Service-role API for management tasks

**Secrets handling:** Database URLs and service-role tokens are never stored in IaC or committed files. They are referenced as environment variables / secrets manager entries. The `DATABASE_URL` pattern already exists in the config schema (ADR-032).

### 2.3 Compute/Hosting: Deferred — Container Images First

Compute platform (where containers run) is **not decided in this ADR**. The SCALING.md path shows Kubernetes at Stage D (regional deployments), not Stage A. The immediate need is:
1. Container images (done — ADR-033)
2. Environment configuration (ADR-032 config schema done)
3. Secrets management (M2-03, depends on this ADR)
4. Database hosting (this ADR — Supabase)

A follow-up ADR will decide the compute platform (Kubernetes vs. container orchestration vs. PaaS) when M2-02 IaC scaffolding reaches the deployment stage. The decision will be informed by:
- Whether the team has a cloud account (AWS/GCP/Azure)
- Whether Kubernetes is justified per SCALING.md criteria
- Whether a simpler PaaS (Fly.io, Railway, Render) suffices for Stage A

### 2.4 Environment Structure

Five environments per the roadmap:
- `local` — developer machine, docker-compose for dependencies
- `ci` — GitHub Actions runners, ephemeral
- `development` — shared Supabase project, ephemeral deployments
- `staging` — production-like, separate Supabase project
- `production` — separate Supabase project, protected

Each environment has its own `infra/environments/<env>/` directory with Terraform variables.

### 2.5 Network and TLS

- TLS is terminated at the edge (ingress/gateway), not at the service level
- Internal service-to-service communication uses mTLS or tokens (ADR-030 signer composition)
- DNS records managed via Terraform
- Network policies deferred until Kubernetes is adopted (Stage D)

---

## 3. Non-Goals

- Choosing a cloud provider (AWS/GCP/Azure) — deferred until compute platform decision
- Kubernetes manifests — deferred per SCALING.md (Stage D)
- Multi-region deployment — deferred per SCALING.md (Stage E)
- Kafka/event bus — deferred per SCALING.md (Stage B)
- Redis hosting — will be decided when M2-02 IaC scaffolding begins
- Live `terraform apply` — not executed in this ADR. This ADR is the decision; the next PR (M2-02B) will add Terraform scaffolding and `terraform plan` validation

---

## 4. Consequences

### Positive
- Clear toolchain decision unblocks M2-02 implementation
- Supabase as managed DB removes operational burden for Stage A
- Deferring compute platform avoids premature commitment to Kubernetes
- Environment structure enables parallel M2-03 (secrets) work

### Negative
- Two ADRs needed for full M2-02 (this one + compute platform later)
- Supabase vendor lock-in for PostgreSQL — mitigated by standard PostgreSQL + Drizzle migrations (portable)
- No live IaC yet — this ADR is docs-only, not "Ready for Gate"

### Risks
- `RISK-0051` (new): Supabase project credentials must not be committed. The service-role token is in the session context only. Terraform will reference `SUPABASE_DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as variables, never literals.

---

## 5. Implementation Plan

| Step | PR | Scope | Status |
|---|---|---|---|
| ADR-038 (this) | M2-02A | Decision document | This PR |
| Terraform scaffolding | M2-02B | `infra/terraform/` structure, provider config, `terraform plan` validation | Next |
| Environment configs | M2-02C | `infra/environments/{dev,staging,prod}/` variable files | After M2-02B |
| DNS/TLS | M2-02D | Edge TLS, DNS records | After compute platform ADR |

---

## 6. References

- [LAUNCH_TO_100_ROADMAP.md §19](../16-progress/LAUNCH_TO_100_ROADMAP.md) — infrastructure requirements
- [LAUNCH_EXECUTION_BOARD.md M2-02](../16-progress/LAUNCH_EXECUTION_BOARD.md) — execution board entry
- [SCALING.md](../02-architecture/SCALING.md) — scalability path and Kubernetes deferral
- [CONTAINERS.md §7](../02-architecture/CONTAINERS.md) — infra directory layout
- [ADR-033](ADR-033-container-image-supply-chain.md) — container image supply chain
- [ADR-032](ADR-032-config-schema-single-source.md) — config schema (DATABASE_URL pattern)
