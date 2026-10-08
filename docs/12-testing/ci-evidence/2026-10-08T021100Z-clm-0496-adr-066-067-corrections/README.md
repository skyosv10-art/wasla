# CLM-0496 — ADR-066 / ADR-067 corrections: measurement record

**Date:** 2026-10-08T02:11Z · **Work item:** M6-18B · **Mode:** read-only measurement + text correction · **Deployment:** none

## 1. RPO re-measurement (ADR-066)

Source: `gh run list --workflow db-backup.yml --limit 60` (GitHub API, read-only), gaps between consecutive **successful** runs (`updatedAt`).

| Window | Successful runs | Median gap | Worst gap | Gaps > 6 h |
|---|---|---|---|---|
| 7 days to 2026-10-08T02:11Z | 20 | 5.50 h | **54.72 h** | 9 / 19 |
| last 48 h | — | — | **10.08 h** | 3 / 5 (2.19 · 9.55 · 5.49 · 8.84 · 10.08 h) |

37 runs in history (oldest 2026-09-29T21:38Z): 26 success, 11 non-success. Last success 2026-10-07T22:32Z (age 3.65 h at measurement).

**Verdict:** the 6 h RPO target is **NOT MET** by measurement, including after the CLM-0482 SSL fix (worst 48 h gap 10.08 h). The schedule (`cron` every 6 h on GitHub Actions) is delayed or skipped by the platform; a 6 h schedule cannot produce a ≤ 6 h worst gap. ADR-066's sentence "The RPO target is met at the amended 6 h level" is therefore corrected.

## 2. Region measurement (ADR-067)

| Fact | Measured value | Source |
|---|---|---|
| Render services | 21 `web_service` in `oregon` + 3 `static_site` (no region) = 24 | Render API `GET /v1/services` (2026-10-08) |
| Bot instance plan | `free` (customer/driver/partner bots) | Render API `serviceDetails.plan` |
| Production pooler host | `aws-0-ap-south-1.pooler.supabase.com` (Mumbai) | CLM-0495 (Render env of `wasla-identity`, host only) |
| `aws-0-ap-northeast-2` | Seoul — the **test** project `snlpxywskyqrjattbpgn` pooler | owner-supplied test URL; [Supabase regions](https://supabase.com/docs/guides/platform/regions) |
| Render regions | Oregon, Ohio, Virginia, Frankfurt, Singapore (no India region) | [Render regions](https://render.com/docs/regions) |
| Supabase `us-west-2` | exists (West US, Oregon) | [Supabase regions](https://supabase.com/docs/guides/platform/regions) |

## 3. What changed / not changed

- ADR-066 and ADR-067: status `Accepted` → `Proposed` (awaiting explicit Program Owner ratification of the corrected text); factual corrections inline; a **Corrections** table quotes every original sentence (nothing erased).
- Not changed: RISK-0055 / RISK-0061 status (closed), ADR-052, ADR-058, Render, Supabase, any code. No ratification is recorded here.
