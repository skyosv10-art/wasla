# M2-02 Terraform Plan + Apply Evidence

**Date:** 2026-09-21T09:58:00Z+03:00
**Work Claim:** CLM-0267
**Branch:** docs/m2-02-terraform-apply-evidence
**Commit:** main@56016a0

## Environment

- Terraform v1.9.8
- Provider: render-oss/render v1.9.1
- Render credentials: provided via environment (RENDER_API_KEY, RENDER_OWNER_ID)
- Supabase database URL: provided via TF_VAR_supabase_database_url
- Environment: development
- Region: oregon
- Plan: free

## terraform init

Result: SUCCESS
- Provider render-oss/render v1.9.1 installed
- .terraform.lock.hcl generated

## terraform plan

Result: SUCCESS
- Plan: 16 to add, 0 to change, 0 to destroy
- All 16 render_web_service resources planned for creation

## terraform apply

Result: SUCCESS — 16 resources created, 0 changed, 0 destroyed

### Created Services (with Render IDs)

| # | Service Name | Render Service ID | URL |
|---|---|---|---|
| 1 | wasla-customers | srv-daodbe3m8hqs73e8b5ag | https://wasla-customers.onrender.com |
| 2 | wasla-delivery | srv-daodbc3m8hqs73e8atvg | https://wasla-delivery.onrender.com |
| 3 | wasla-dispatch | srv-daodbfmk1f9s73bknib0 | https://wasla-dispatch.onrender.com |
| 4 | wasla-drivers | srv-daodb6740ujc73esa7v0 | https://wasla-drivers.onrender.com |
| 5 | wasla-geography | srv-daodbbn40ujc73esarsg | https://wasla-geography.onrender.com |
| 6 | wasla-identity | srv-daodb63m8hqs73e8a900 | https://wasla-identity.onrender.com |
| 7 | wasla-matching | srv-daodbdrtqb8s73et2sl0 | https://wasla-matching.onrender.com |
| 8 | wasla-negotiations | srv-daodb6ek1f9s73bkmcr0 | https://wasla-negotiations.onrender.com |
| 9 | wasla-orders | srv-daodb63m8hqs73e8a9fg | https://wasla-orders.onrender.com |
| 10 | wasla-reputation | srv-daodb63tqb8s73et1tlg | https://wasla-reputation.onrender.com |
| 11 | wasla-search | srv-daodbbbtqb8s73et2i0g | https://wasla-search.onrender.com |
| 12 | wasla-marketplace | srv-daodb60ae00c73c2utjg | https://wasla-marketplace.onrender.com |
| 13 | wasla-subscriptions | srv-daodb66gekts73br8q9g | https://wasla-subscriptions.onrender.com |
| 14 | wasla-customer-bot | srv-daodb6bm8hqs73e8aa50 | https://wasla-customer-bot.onrender.com |
| 15 | wasla-driver-bot | srv-daodb6740ujc73esa79g | https://wasla-driver-bot.onrender.com |
| 16 | wasla-partner-bot | srv-daodb6f40ujc73esa8bg | https://wasla-partner-bot.onrender.com |

## Known Limitations (Render Free)

1. Free Web Services CANNOT receive private network traffic — inter-service calls use public URLs (PoC only)
2. Free Web Services sleep after 15 min idle
3. 16 services × continuous run exceeds 750 free instance hours/month
4. Private networking, no-sleep, and 750h/month require Render Paid

These limitations are documented in ADR-039 and do not block M2-02 acceptance criteria ("fresh plan/apply").

## Verdict

M2-02 acceptance criteria "fresh plan/apply" is MET:
- Fresh plan with real Render credentials: ✅
- Apply with real resource creation: ✅
- 16 services created on Render Free: ✅
- All services have valid onrender.com URLs: ✅
