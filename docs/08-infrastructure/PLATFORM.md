# Infrastructure Platform — ADR-038 Summary

> **Status:** Proposed · **Date:** 2026-09-18 · **ADR:** [ADR-038](../15-decisions/ADR-038-platform-provider-iac-toolchain.md) · **Work Item:** M2-02

---

## Decisions

| Layer | Choice | Status |
|---|---|---|
| IaC tool | Terraform | Decided (ADR-038) |
| Database | Supabase managed PostgreSQL | Decided (ADR-038) |
| Compute | Deferred (Kubernetes at Stage D per SCALING.md) | Not yet decided |
| TLS | Edge-terminated at ingress/gateway | Decided (ADR-038) |
| Environments | local, ci, development, staging, production | Decided (ADR-038) |

## Directory Structure (planned)

```
infra/
  terraform/
    modules/          # reusable Terraform modules
    environments/
      development/    # dev Supabase project
      staging/        # staging Supabase project
      production/     # production Supabase project
  docker/             # local development containers
  kubernetes/         # deferred to Stage D
  environments/       # environment variable files
```

## Secrets

Database URLs and service-role tokens are never committed. They are referenced as Terraform variables or environment variables. See M2-03 (secrets/KMS/rotation) for the full secrets management plan.

## Next Steps

1. M2-02B: Terraform scaffolding (`infra/terraform/` structure, provider config, `terraform plan` validation)
2. M2-02C: Environment configuration files
3. M2-02D: DNS/TLS (after compute platform ADR)
