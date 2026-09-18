terraform {
  required_version = ">= 1.5.0"

  required_providers {
    # Provider pins are added when concrete resources are defined.
    # ADR-038 defers compute platform decision — no cloud provider yet.
  }
}
