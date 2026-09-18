# ── Input variables for WASLA infrastructure ──────────────────────────
# No secrets here — use TF_VAR_* environment variables or a secrets manager.
# See ADR-038 §2.2 and M2-03 (secrets/KMS/rotation).
# Render credentials (RENDER_API_KEY, RENDER_OWNER_ID) are read from
# environment by the provider — never declared here. See ADR-039.

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

# ── Render variables (non-secret) ──────────────────────────────────────
# RENDER_API_KEY is read from environment by the provider directly.
# RENDER_OWNER_ID is also read from environment by the provider directly.
# We declare render_owner_id as a variable only for use in resource
# owner_id fields — the provider reads RENDER_OWNER_ID from env.

variable "render_owner_id" {
  description = "Render owner ID. Read from RENDER_OWNER_ID env var. Not sensitive — it appears in dashboard URLs."
  type        = string
  default     = ""
}

variable "render_region" {
  description = "Render region for services. Oregon (oregon) is the default."
  type        = string
  default     = "oregon"

  validation {
    condition     = contains(["oregon", "ohio", "frankfurt", "singapore", "sydney"], var.render_region)
    error_message = "render_region must be one of: oregon, ohio, frankfurt, singapore, sydney."
  }
}

variable "render_plan" {
  description = "Render instance plan. 'free' for proof-of-concept, 'starter' for paid."
  type        = string
  default     = "free"

  validation {
    condition     = contains(["free", "starter", "standard"], var.render_plan)
    error_message = "render_plan must be one of: free, starter, standard."
  }
}
