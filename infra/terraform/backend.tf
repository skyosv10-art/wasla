# ── Remote state backend ────────────────────────────────────────────────
# Configured per environment in environments/<env>/main.tf.
# ADR-038 defers the concrete backend choice until cloud provider is selected.

# Example (commented out — uncomment when backend is available):
#
# terraform {
#   backend "s3" {
#     bucket         = "wasla-terraform-state"
#     key            = "terraform.tfstate"
#     region         = "us-east-1"
#     dynamodb_table = "wasla-terraform-locks"
#     encrypt         = true
#   }
# }
