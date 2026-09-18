# ADR-039: Render Free as M2-02 Experimental Compute Target

**Status:** Accepted (experimental)
**Date:** 2026-09-18
**Owner:** @uxxxu
**Supersedes:** None (extends ADR-038)
**Related:** ADR-038 (Platform/IaC toolchain), ADR-033 (Container image supply chain)

## Context

ADR-038 decided Terraform for IaC and Supabase for managed PostgreSQL, but deferred the compute platform decision. M2-02 remained blocked on cloud provider credentials and a compute platform ADR.

The program owner decided on 2026-09-18 to use Render Free as the experimental compute target for M2-02. This is a proof-of-concept decision, not a production commitment.

## Decision

Use Render as the compute platform for WASLA services, starting with the Free tier.

### Scope

- **Compute:** Render Web Services (Free tier for proof, paid for production)
- **Database:** Supabase managed PostgreSQL (unchanged per ADR-038)
- **IaC:** Terraform with `render-oss/render` provider v1.9.1
- **Credentials:** `RENDER_API_KEY` and `RENDER_OWNER_ID` from environment only

### What is proven on Free

- Terraform provider configuration and validation (`terraform init`, `terraform validate`)
- `terraform plan` shape verified locally with test credentials — NOT against real Render account
- Service inventory mapping (13 HTTP services + 3 HTTP bots = 16 Web Services)
- Docker compatibility: monorepo Dockerfile with `WASLA_SERVICE` env var selects entry point
- PORT compatibility measured from source: 11 services read `PORT` (compatible), 5 units use custom port vars (BLOCKED)

### BLOCKED — EXTERNAL CREDENTIAL REQUIRED

- `terraform plan` against real Render account: requires `RENDER_API_KEY` and `RENDER_OWNER_ID` from environment
- `terraform apply`: same credential requirement

### What requires Render Paid

- **Private networking:** Free Web Services cannot receive private network traffic. Inter-service calls (dispatch→matching, customers→geography, etc.) must use public URLs on Free. Production requires Private Services.
- **Background Workers:** Not available on Free. All WASLA bots serve HTTP, so they can be Web Services on Free.
- **Persistent disks:** Not supported on Free.
- **No idle sleep:** Free Web Services sleep after 15 minutes without inbound traffic.
- **Single instance:** Free Web Services cannot scale beyond one instance.
- **750 instance hours/month:** Shared across all Free services.

### What can be simulated locally

- Docker build and run (via `docker build` / `docker run`)
- Inter-service communication (via `docker network` or `docker-compose`)
- CI pipeline (via GitHub Actions)

## Consequences

1. **Not production-ready:** Render Free is proof-of-concept only. Do not claim production readiness.
2. **Inter-service calls over public internet:** On Free, all service-to-service calls use public URLs. This is a security consideration for proof-of-concept only.
3. **Supabase remains the database:** No Render Postgres is created. `DATABASE_URL` points to Supabase.
4. **Separation of concerns:** Terraform config, validation, and plan are executable now. `terraform apply` requires owner approval and credentials.
5. **Service inventory guard:** A guard must verify that the Terraform resources match the actual services in the repository.

## References

- [Render Terraform Provider](https://registry.terraform.io/providers/render-oss/render/latest/docs)
- [Render Free Tier Documentation](https://render.com/docs/free)
- [ADR-038: Platform/IaC Toolchain](ADR-038-platform-provider-iac-toolchain.md)
- [ADR-033: Container Image Supply Chain](ADR-033-container-image-supply-chain.md)
