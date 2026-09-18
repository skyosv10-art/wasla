# Production environment
# See ADR-038 for decisions. Variables are provided via TF_VAR_* env vars.

terraform {
  required_version = ">= 1.5.0"
}

# Provider config will be added when concrete resources are defined.
