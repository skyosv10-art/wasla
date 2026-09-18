# Terraform — Infrastructure as Code for WASLA

> **ADR:** [ADR-038](../../docs/15-decisions/ADR-038-platform-provider-iac-toolchain.md) · **Work Item:** M2-02B · **Status:** Scaffold (not Ready for Gate)

---

## Structure

```
infra/terraform/
  versions.tf          # Terraform and provider version pins
  variables.tf         # Input variables (no secrets — use TF_VAR_ env vars)
  outputs.tf           # Output values
  backend.tf           # Remote state backend (configured per environment)
  modules/             # Reusable modules (future)
  environments/
    development/        # Development Supabase project
      main.tf           # Environment-specific provider config
      terraform.tfvars.example  # Placeholder values (no real secrets)
    staging/
      main.tf
      terraform.tfvars.example
    production/
      main.tf
      terraform.tfvars.example
```

## Secrets

**Never commit secrets.** Database URLs, service-role tokens, and API keys are provided via `TF_VAR_*` environment variables or a secrets manager (M2-03). The `.tfvars.example` files contain only placeholder values.

## Validation

The `scripts/checks/validate-terraform-scaffold.sh` script validates:
- Required Terraform files exist
- No secrets in `.tfvars` files (only `.tfvars.example`)
- `.tf` files pass `terraform fmt -check` (if Terraform is installed)
- `.tf` files pass `terraform validate` (if Terraform is installed)

When Terraform is not installed (e.g., in the sandbox), the structural checks still run.

## Blocker

Live `terraform plan/apply` is blocked until:
1. Compute platform ADR is written (deferred per ADR-038)
2. Cloud provider credentials are available
3. Remote state backend is configured

This scaffold creates the validated structure for a future real plan/apply.
