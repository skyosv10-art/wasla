# دليلُ CI — 2026-09-14T13-52-49Z

- **المُزوِّد:** `github` · **الموضوع:** skyosv10-art/wasla · **المرجع:** `chore/release-clm-0160-0161`
- **التشغيل:** [34851953605](https://github.com/skyosv10-art/wasla/actions/runs/34851953605)
- **حالةُ التشغيلِ كما جاءت:** `queued/None`
- **عددُ الوظائف:** 31 · **بدأت فعلاً:** 0
- **توزيعُ الحالات:** `failure`=30, `queued`=1
- **أسبابُ ما لم يبدأ:** `account_billing_blocked`=30, `job_did_not_start`=1
- **أوّلُ `started_at`:** `null`

## النتيجة: `CI = NOT VERIFIED`

- **السبب:** `account_billing_blocked`
- **started_at:** `null`
- **الخام:** `run.raw.json` · `jobs.raw.json` · `annotations.<job_id>.raw.json`

### السببُ كما نشرَه المُزوِّدُ (لا كما اشتُقَّ)

> The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings

المصدرُ: `GET /repos/…/check-runs/<job_id>/annotations` — محفوظٌ خاماً بجانبِه،
فيُراجَعُ التصنيفُ إلى الرمزِ من النصِّ نفسِه لا من ثقةٍ بالسكربتِ.

### وظائفُ لم تبدأ (31)

| الوظيفةُ | الحالُ | الخلاصةُ | إشارةُ «لم تبدأ» | السببُ |
| --- | --- | --- | --- | --- |
| `typecheck` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `doc-coverage` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `governance-guard` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (marketplace, @wasla/marketplace-service, wasla_marketplace_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (order, @wasla/order-e2e, wasla_order_e2e, ORDER_DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (search, @wasla/search-service, wasla_search_test)` | `queued` | `None` | `started_at+steps` | `job_did_not_start` |
| `verify` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (identity, @wasla/identity-service, wasla_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `test` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (negotiations, @wasla/negotiations-service, wasla_negotiations_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (customer, @wasla/customers-service, wasla_customer_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration-shared` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `repo-structure` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (drivers, @wasla/drivers-service, wasla_drivers_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (matching, @wasla/matching-service, wasla_matching_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (order, @wasla/orders-service, wasla_orders_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (subscriptions, @wasla/subscriptions-service, wasla_subscriptions_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (reputation, @wasla/reputation-service, wasla_reputation_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (channel, @wasla/channel-e2e, wasla_channel_e2e, DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (driver, @wasla/driver-e2e, wasla_driver_e2e, DRIVER_DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (delivery, @wasla/delivery-service, wasla_delivery_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (delivery, @wasla/delivery-e2e, wasla_delivery_e2e, DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (dispatch, @wasla/dispatch-e2e, wasla_dispatch_e2e, DISPATCH_DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (search, @wasla/search-e2e, wasla_search_e2e, DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (negotiation, @wasla/negotiation-e2e, wasla_negotiation_e2e, NEGOTIATION_DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (channel, @wasla/channel-postgres, wasla_channel_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (customer, @wasla/customer-e2e, wasla_customer_e2e, CUSTOMER_DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (dispatch, @wasla/dispatch-service, wasla_dispatch_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `db-integration (geography, @wasla/geography-service, wasla_geo_test)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (marketplace, @wasla/marketplace-e2e, wasla_marketplace_e2e, DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |
| `exit-gate-e2e (subscription, @wasla/subscription-e2e, wasla_subscription_e2e, DATABASE_URL)` | `completed` | `failure` | `started_at+steps+annotation` | `account_billing_blocked` |

**لم يُشغَّل شيءٌ** (أو لم يكتمل). فهذا ليس `PASS` ولا `FAIL`: لا دليلَ
على صحّةِ الشفرةِ ولا على عيبِها من هذا التشغيلِ. والمرجع:
`docs/12-testing/M1-03_GATE.md` §13 · `RISK-0001`.

> **حدٌّ مُعلَنٌ (مُصحَّحٌ في M0-33):** GitHub لا يُصدِرُ حقلَ `failure_reason`
> في `…/jobs`، لكنّه **ينشرُ السببَ حرفاً** في
> `…/check-runs/<job_id>/annotations`. فصارَ السببُ يُقرأُ من ثمَّ، ويُصنَّفُ
> إلى رمزٍ ثابتٍ، ويُحفَظُ نصُّه خاماً. وحينَ لا يُقرأُ تعليقٌ فالسببُ
> `job_did_not_start` — **ولا يُكتَبُ `failure`**: تلك خلاصةٌ تُعادُ لا سببٌ.
> والقاعدةُ نفسُها لا تتغيَّرُ: ما لم يبدأ لا يُكتَبُ له `PASS` ولا `FAIL`.
