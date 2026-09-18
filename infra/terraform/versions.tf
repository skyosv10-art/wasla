terraform {
  required_version = ">= 1.5.0"

  required_providers {
    # Render official Terraform provider (render-oss/render).
    # Added per owner decision 2026-09-18: Render Free as M2-02 experimental
    # compute target. Not production. See ADR-039.
    render = {
      source  = "render-oss/render"
      version = "1.9.1"
    }
  }
}

# Provider configuration — credentials from environment only, never committed.
# Set RENDER_API_KEY and RENDER_OWNER_ID in your environment.
# See: https://registry.terraform.io/providers/render-oss/render/latest/docs
provider "render" {
  # api_key and owner_id are read from RENDER_API_KEY and RENDER_OWNER_ID
  # environment variables. Do not set them here.
}
