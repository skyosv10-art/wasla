# Environment Catalogue — WASLA

> **ADR:** [ADR-038](../../docs/15-decisions/ADR-038-platform-provider-iac-toolchain.md) · **Work Item:** M2-02C · **Config Source:** `packages/config/env-registry.json` (M2-04)

---

## Purpose

This directory defines non-secret environment manifests for each deployment tier. Each environment has an `environment.json` manifest that declares facts about the environment — not secret values. Secrets are managed by M2-03 (KMS/rotation).

## Environments

| Directory | Tier | Purpose |
|---|---|---|
| `local/` | local | Developer machine — Docker dependencies, in-memory fallback allowed |
| `ci/` | ci | GitHub Actions — ephemeral, in-memory, no external services |
| `development/` | dev | Shared Supabase project, ephemeral deployments |
| `staging/` | staging | Production-like, separate Supabase project, no in-memory fallback |
| `production/` | prod | Separate Supabase project, protected, no in-memory fallback |

## Manifest Schema

Each `environment.json` contains:

```json
{
  "name": "production",
  "purpose": "Live production environment",
  "tier": "production",
  "database_mode": "supabase_managed",
  "terraform_environment": "infra/terraform/environments/production/",
  "tls_status": "required_blocked",
  "dns_status": "required_blocked",
  "allow_in_memory_fallback": false,
  "required_secrets": ["DATABASE_URL", "WASLA_SERVICE_AUTH_KEYS"],
  "notes": "TLS/DNS blocked pending compute platform ADR"
}
```

### Fields

- `name` — must match directory name
- `purpose` — human-readable description
- `tier` — one of: local, ci, development, staging, production
- `database_mode` — one of: local_postgres, in_memory, supabase_managed
- `terraform_environment` — path to Terraform environment directory
- `tls_status` — one of: none (local/ci), required_blocked (staging/prod pending ADR)
- `dns_status` — one of: none (local/ci), required_blocked (staging/prod pending ADR)
- `allow_in_memory_fallback` — boolean; false for staging/production
- `required_secrets` — list of config variable names from `env-registry.json`; values never stored
- `notes` — free text

## Validation

`scripts/checks/validate-environments.sh` validates:
- All five environment directories exist
- Each manifest has required fields
- Manifest `name` matches directory name
- Staging/production: `allow_in_memory_fallback` must be false
- Staging/production: `database_mode` must not be `in_memory` or `local_postgres`
- `required_secrets` entries exist in `env-registry.json` or are M2-03 pending secrets
- No real `.env`, `.tfvars`, or secret patterns in any file
