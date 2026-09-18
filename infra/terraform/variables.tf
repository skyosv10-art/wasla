# ── Input variables for WASLA infrastructure ──────────────────────────
# No secrets here — use TF_VAR_* environment variables or a secrets manager.
# See ADR-038 §2.2 and M2-03 (secrets/KMS/rotation).

variable "environment" {
  description = "Deployment environment: development, staging, production"
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be one of: development, staging, production."
  }
}

variable "supabase_database_url" {
  description = "PostgreSQL connection string for Supabase managed database. Provided via TF_VAR_supabase_database_url — never committed."
  type        = string
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "Supabase service-role API key. Provided via TF_VAR_supabase_service_role_key — never committed."
  type        = string
  sensitive   = true
}
