/**
 * جردُ العملياتِ المفروضةِ (`M1-05`) — **مُشتَقٌّ من الشفرةِ ومُنفَذٌ عليها**.
 *
 * ── ما هذا الملفُّ، وما ليسَ هو ────────────────────────────────────────────
 * هذا **إعلانٌ** لِما تفرضُهُ الحدودُ فعلاً: لكلِّ عمليّةٍ (جمهورٌ · طريقةٌ ·
 * مسارٌ) الصلاحيّاتُ التي يطلبُها الحدُّ منها. وليسَ هذا المصدرَ الذي يُفرَضُ
 * منه: الفرضُ يبقى في `services/<svc>/src/http/app.ts` عبرَ `scoped(...)`.
 * فهذا الملفُّ **صورةٌ مُعلَنةٌ**، و`scripts/checks/validate-authz-policy.sh`
 * (الفحصُ 16) يُعيدُ قياسَ الشفرةِ ويُسقِطُ البوّابةَ عندَ أوّلِ انحرافٍ في
 * أيِّ الاتجاهَين: عمليّةٌ في الشفرةِ ولا إعلانَ لها، أو إعلانٌ لعمليّةٍ لا
 * وجودَ لها، أو صلاحيّةٌ تختلفُ حرفاً.
 *
 * ── لِمَ إعلانٌ ثانٍ إذا كانتِ الشفرةُ هيَ الحقيقةَ ────────────────────────
 * لأنَّ سؤالَ التفويضِ **لا يُجاب من الشفرةِ**: الشفرةُ تُجيبُ «هذا المسارُ
 * يطلبُ هذهِ الصلاحيّةَ»، ولا تُجيبُ «**مَن** يحقُّ لهُ أن يحملَها». والجوابُ
 * الثاني قرارٌ لا اشتقاقٌ، ولا موضعَ لهُ في شفرةِ الحدِّ لأنَّ الحدَّ لا يعرفُ
 * مُنادِيهِ إلّا بعدَ أن يُوقَّعَ الرمزُ — أي **بعدَ** موضعِ القرار. ولذلك
 * تُقرَنُ المصفوفةُ بهذا الجردِ في حزمةٍ واحدةٍ: الجردُ يُثبِتُ أنَّ المنحَ
 * يُشيرُ إلى صلاحيّةٍ **مفروضةٍ فعلاً**، لا إلى اسمٍ مات في الشفرةِ وبقيَ في
 * المصفوفة.
 *
 * ── حدُّ الدعوى ────────────────────────────────────────────────────────────
 * المسارُ هنا **قالبُ** التسجيلِ في Fastify (`/orders/:orderId`) لا مسارُ
 * طلبٍ. والربطُ في `ADR-021` §4 **لا يشملُ سلسلةَ الاستعلامِ**، فعمليّةٌ تحملُ
 * هويّةَ مَورِدِها في الاستعلامِ (`GET /orders/lookup`) تُقرأُ هنا عمليّةً
 * واحدةً وهيَ في الواقعِ بابٌ إلى كلِّ الطلباتِ — وهذا مُعلَنٌ في
 * `SERVICE_ONLY_OPERATIONS` أدناهُ وفي `RISK-0030`، **ولم يُغلَقْ في هذهِ
 * الدفعةِ**.
 *
 * المرجع: ADR-027 · docs/07-security/AUTHORIZATION_POLICY_MATRIX.md
 */

/**
 * الحدودُ التي تفرضُ هويّةَ خدمةٍ — مقيسةٌ لا مفترضةٌ (M0-36 · M1-03).
 *
 * **تصحيحٌ بالإضافةِ (`M1-04` · الموجةُ التاسعةُ · `CLM-0197`):** كانَ العنوانُ
 * «الحدودُ الثمانيةُ» والقائمةُ تسعةٌ — والعددُ في العنوانِ لم يُقَسْ يوماً، بل
 * شاخَ حينَ أُضيفَ `channel` في `M1-07`. فلا يُمحى العنوانُ السابقُ ليبدوَ
 * الجردُ معصوماً: يُقالُ إنَّهُ كانَ خطأً ويُستبدَلُ بعددٍ **يُقرأُ من طولِ
 * القائمةِ نفسِها**. وقد صارَتِ اليومَ **عَشْرَ** حدودٍ بإضافةِ `customers`،
 * وهيَ أوّلُ الخمسةِ التي قاسَتْها الموجةُ الثامنةُ حدوداً إنتاجيّةً لا تفرضُ
 * شيئاً ([`ADR-034`](../../../docs/15-decisions/ADR-034-ingress-boundary-inventory-closure.md) ·
 * `RISK-0051`). والباقي أربعةٌ: `drivers` · `reputation` · `search` ·
 * `subscriptions` — لا تُضافُ هنا حتّى تُفرَضَ فعلاً، فإضافتُها قبلَ الفرضِ
 * إعلانٌ كاذبٌ يُسقِطُهُ البابانِ 2 و3 من الفحصِ 16.
 */
export const AUDIENCES = [
  "channel",
  "customers",
  "delivery",
  "dispatch",
  "geography",
  "identity",
  "marketplace",
  "matching",
  "negotiations",
  "orders",
] as const;

export type Audience = (typeof AUDIENCES)[number];

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface EnforcedOperation {
  readonly audience: Audience;
  readonly method: HttpMethod;
  /** قالبُ المسارِ كما سُجِّلَ في `app.ts` — بلا سلسلةِ استعلامٍ. */
  readonly path: string;
  /** الصلاحيّاتُ التي يطلبُها الحدُّ — **كلُّها** مطلوبةٌ (`hasAllScopes`). */
  readonly scopes: readonly string[];
}

/**
 * إحدى وثمانونَ عمليّةً مفروضةً على ثمانيةِ حدودٍ — القياسُ في 2026-09-15.
 * و**تسعونَ على عَشْرِ حدودٍ** بعدَ الموجةِ التاسعةِ (`CLM-0197`) التي فرضَتْ
 * حدَّ العميلِ — والرقمُ الأوّلُ يبقى مكتوباً بتاريخِهِ لأنَّ محوَهُ يُخفي أنَّ
 * الجردَ ينمو بالفرضِ لا بالكتابةِ. والحاكمُ في الحالتَينِ طولُ هذهِ القائمةِ
 * كما يقيسُهُ الفحصُ 16، لا عددٌ في تعليقٍ.
 * ومسارات الفحصِ الصحّيِّ التسعةُ (`OPEN`) **ليستْ هنا** لأنّها لا تفرضُ صلاحيّةً؛
 * والفحصُ 16 يُثبِتُ أنَّ عددَ المفروضِ في الشفرةِ يُساوي طولَ هذهِ القائمةِ.
 */
export const ENFORCED_OPERATIONS: readonly EnforcedOperation[] = [
  // ── channel (bot-runtime internal routes — M1-07) ─────────────
  { audience: "channel", method: "POST", path: "/channel/messages", scopes: ["channel:message:send"] },
  { audience: "channel", method: "GET", path: "/channel/:bot/mini-app", scopes: ["channel:mini-app:read"] },
  { audience: "channel", method: "POST", path: "/channel/:bot/deep-links", scopes: ["channel:deep-link:create"] },
  // ── customers (M1-04 · الموجةُ التاسعةُ · CLM-0197) ────────────
  // تسعُ عملياتٍ كلُّها مربوطةٌ بالمُنتَفِعِ: المَورِدُ مملوكٌ لإنسانٍ مُعنوَنٍ
  // في المسارِ، فالصلاحيّةُ وحدَها لا تقولُ **أيَّ عميلٍ**. و`/health` مفتوحٌ.
  { audience: "customers", method: "GET", path: "/customers/:waslaPublicId/profile", scopes: ["customers:profile:read"] },
  { audience: "customers", method: "PUT", path: "/customers/:waslaPublicId/profile", scopes: ["customers:profile:write"] },
  { audience: "customers", method: "GET", path: "/customers/:waslaPublicId/places", scopes: ["customers:place:read"] },
  { audience: "customers", method: "POST", path: "/customers/:waslaPublicId/places", scopes: ["customers:place:write"] },
  { audience: "customers", method: "DELETE", path: "/customers/:waslaPublicId/places/:placeId", scopes: ["customers:place:write"] },
  { audience: "customers", method: "POST", path: "/customers/:waslaPublicId/order-requests/preview", scopes: ["customers:order-request:preview"] },
  { audience: "customers", method: "GET", path: "/customers/:waslaPublicId/order-requests", scopes: ["customers:order-request:read"] },
  { audience: "customers", method: "POST", path: "/customers/:waslaPublicId/order-requests", scopes: ["customers:order-request:write"] },
  { audience: "customers", method: "GET", path: "/customers/:waslaPublicId/order-requests/:orderRequestId", scopes: ["customers:order-request:read"] },
  // ── delivery ──────────────────────────────────────────────────
  { audience: "delivery", method: "POST", path: "/store-orders", scopes: ["delivery:store-order:write"] },
  { audience: "delivery", method: "GET", path: "/store-orders/:orderPublicId", scopes: ["delivery:store-order:read"] },
  { audience: "delivery", method: "POST", path: "/store-orders/:orderPublicId/cancellation", scopes: ["delivery:store-order:cancel"] },
  { audience: "delivery", method: "PUT", path: "/store-orders/:orderPublicId/payment-mirror", scopes: ["delivery:payment-mirror:write"] },
  { audience: "delivery", method: "POST", path: "/store-orders/:orderPublicId/confirmation", scopes: ["delivery:store-order:confirm"] },
  { audience: "delivery", method: "POST", path: "/store-orders/:orderPublicId/fulfillment-transition", scopes: ["delivery:fulfillment:transition"] },
  { audience: "delivery", method: "GET", path: "/store-orders/:orderPublicId/delivery-task", scopes: ["delivery:delivery-task:read"] },
  { audience: "delivery", method: "POST", path: "/delivery/idempotency-keys/sweep", scopes: ["delivery:ops:idempotency-sweep"] },
  { audience: "delivery", method: "GET", path: "/delivery/inventory-conflicts", scopes: ["delivery:ops:inventory-conflicts:read"] },
  { audience: "delivery", method: "POST", path: "/delivery/inventory-conflicts/:adjustmentId/acknowledgement", scopes: ["delivery:ops:inventory-conflicts:acknowledge"] },
  { audience: "delivery", method: "GET", path: "/delivery/relay/dead-letters", scopes: ["delivery:ops:relay-dead-letters:read"] },
  { audience: "delivery", method: "POST", path: "/delivery/relay/dead-letters/:ledger/:eventId/requeue", scopes: ["delivery:ops:relay-dead-letters:requeue"] },
  { audience: "delivery", method: "POST", path: "/delivery/relay/dead-letters/:ledger/:eventId/acknowledge", scopes: ["delivery:ops:relay-dead-letters:acknowledge"] },
  // ── dispatch ──────────────────────────────────────────────────
  { audience: "dispatch", method: "POST", path: "/dispatch/jobs", scopes: ["dispatch:job:write"] },
  { audience: "dispatch", method: "GET", path: "/dispatch/jobs/:job_id", scopes: ["dispatch:job:read"] },
  { audience: "dispatch", method: "GET", path: "/dispatch/jobs/:job_id/offers", scopes: ["dispatch:offer:read"] },
  { audience: "dispatch", method: "GET", path: "/dispatch/offers/:offer_id", scopes: ["dispatch:offer:read"] },
  { audience: "dispatch", method: "POST", path: "/dispatch/tick", scopes: ["dispatch:tick:write"] },
  { audience: "dispatch", method: "POST", path: "/dispatch/offers/:offer_id/accept", scopes: ["dispatch:offer:accept"] },
  { audience: "dispatch", method: "POST", path: "/dispatch/offers/:offer_id/reject", scopes: ["dispatch:offer:reject"] },
  { audience: "dispatch", method: "POST", path: "/dispatch/jobs/:job_id/cancel", scopes: ["dispatch:job:cancel"] },
  // ── geography ─────────────────────────────────────────────────
  { audience: "geography", method: "GET", path: "/geo/countries", scopes: ["geography:hierarchy:read"] },
  { audience: "geography", method: "GET", path: "/geo/countries/:countryId/regions", scopes: ["geography:hierarchy:read"] },
  { audience: "geography", method: "GET", path: "/geo/regions/:regionId/cities", scopes: ["geography:hierarchy:read"] },
  { audience: "geography", method: "GET", path: "/geo/cities/:cityId/districts", scopes: ["geography:hierarchy:read"] },
  { audience: "geography", method: "GET", path: "/geo/districts/:districtId/zones", scopes: ["geography:hierarchy:read"] },
  { audience: "geography", method: "GET", path: "/geo/zones/:zoneId", scopes: ["geography:zone:read"] },
  { audience: "geography", method: "GET", path: "/geo/users/:waslaPublicId/location", scopes: ["geography:location:read"] },
  { audience: "geography", method: "PUT", path: "/geo/users/:waslaPublicId/location", scopes: ["geography:location:write"] },
  { audience: "geography", method: "GET", path: "/geo/users/:waslaPublicId/location/history", scopes: ["geography:location:read"] },
  // ── identity ──────────────────────────────────────────────────
  { audience: "identity", method: "POST", path: "/identity/resolve", scopes: ["identity:resolve:write"] },
  { audience: "identity", method: "GET", path: "/identity/users/:waslaPublicId", scopes: ["identity:user:read"] },
  { audience: "identity", method: "POST", path: "/identity/users/:waslaPublicId/links", scopes: ["identity:link:write"] },
  { audience: "identity", method: "POST", path: "/identity/users/:waslaPublicId/recovery", scopes: ["identity:recovery:write"] },
  { audience: "identity", method: "GET", path: "/identity/users/:waslaPublicId/history", scopes: ["identity:history:read"] },
  // ── marketplace ───────────────────────────────────────────────
  { audience: "marketplace", method: "GET", path: "/categories", scopes: ["marketplace:category:read"] },
  { audience: "marketplace", method: "POST", path: "/stores", scopes: ["marketplace:store:write"] },
  { audience: "marketplace", method: "GET", path: "/stores", scopes: ["marketplace:store:read"] },
  { audience: "marketplace", method: "GET", path: "/stores/:storeSlug", scopes: ["marketplace:store:read"] },
  { audience: "marketplace", method: "POST", path: "/stores/:storeSlug/review-requests", scopes: ["marketplace:store:review:request"] },
  { audience: "marketplace", method: "POST", path: "/stores/:storeSlug/decisions", scopes: ["marketplace:store:review:decide"] },
  { audience: "marketplace", method: "GET", path: "/stores/:storeSlug/reviews", scopes: ["marketplace:store:review:read"] },
  { audience: "marketplace", method: "GET", path: "/stores/:storeSlug/staff", scopes: ["marketplace:staff:read"] },
  { audience: "marketplace", method: "POST", path: "/stores/:storeSlug/staff", scopes: ["marketplace:staff:write"] },
  { audience: "marketplace", method: "DELETE", path: "/stores/:storeSlug/staff/:memberPublicId", scopes: ["marketplace:staff:write"] },
  { audience: "marketplace", method: "GET", path: "/stores/:storeSlug/products", scopes: ["marketplace:product:read"] },
  { audience: "marketplace", method: "POST", path: "/stores/:storeSlug/products", scopes: ["marketplace:product:write"] },
  { audience: "marketplace", method: "GET", path: "/products/:productId", scopes: ["marketplace:product:read"] },
  { audience: "marketplace", method: "POST", path: "/products/:productId/publish", scopes: ["marketplace:product:lifecycle"] },
  { audience: "marketplace", method: "POST", path: "/products/:productId/archive", scopes: ["marketplace:product:lifecycle"] },
  { audience: "marketplace", method: "POST", path: "/products/:productId/decisions", scopes: ["marketplace:product:review:decide"] },
  { audience: "marketplace", method: "GET", path: "/products/:productId/inventory", scopes: ["marketplace:inventory:read"] },
  { audience: "marketplace", method: "POST", path: "/products/:productId/inventory", scopes: ["marketplace:inventory:adjust"] },
  { audience: "marketplace", method: "POST", path: "/stores/:storeSlug/inventory/reserve", scopes: ["marketplace:inventory:reserve"] },
  { audience: "marketplace", method: "POST", path: "/stores/:storeSlug/inventory/release", scopes: ["marketplace:inventory:release"] },
  // ── matching ──────────────────────────────────────────────────
  { audience: "matching", method: "POST", path: "/matching/candidates", scopes: ["matching:candidates:evaluate"] },
  { audience: "matching", method: "PUT", path: "/candidacy/:driverPublicId", scopes: ["matching:candidacy:write"] },
  { audience: "matching", method: "GET", path: "/candidacy/:driverPublicId", scopes: ["matching:candidacy:read"] },
  { audience: "matching", method: "POST", path: "/candidacy/:driverPublicId/availability", scopes: ["matching:candidacy:write"] },
  { audience: "matching", method: "GET", path: "/matching/rulesets", scopes: ["matching:rulesets:read"] },
  { audience: "matching", method: "GET", path: "/matching/decisions/:decisionId", scopes: ["matching:decisions:read"] },
  // ── negotiations ──────────────────────────────────────────────
  { audience: "negotiations", method: "POST", path: "/negotiations", scopes: ["negotiations:thread:write"] },
  { audience: "negotiations", method: "GET", path: "/negotiations", scopes: ["negotiations:thread:read"] },
  { audience: "negotiations", method: "POST", path: "/negotiations/tick", scopes: ["negotiations:tick:run"] },
  { audience: "negotiations", method: "GET", path: "/negotiations/:threadId", scopes: ["negotiations:thread:read"] },
  { audience: "negotiations", method: "POST", path: "/negotiations/:threadId/cancel", scopes: ["negotiations:thread:write"] },
  { audience: "negotiations", method: "GET", path: "/negotiations/:threadId/rounds", scopes: ["negotiations:round:read"] },
  { audience: "negotiations", method: "POST", path: "/negotiations/:threadId/rounds", scopes: ["negotiations:round:write"] },
  { audience: "negotiations", method: "POST", path: "/negotiations/:threadId/rounds/:roundNo/accept", scopes: ["negotiations:round:decide"] },
  { audience: "negotiations", method: "POST", path: "/negotiations/:threadId/rounds/:roundNo/reject", scopes: ["negotiations:round:decide"] },
  { audience: "negotiations", method: "GET", path: "/negotiations/:threadId/messages", scopes: ["negotiations:message:read"] },
  { audience: "negotiations", method: "POST", path: "/negotiations/:threadId/messages", scopes: ["negotiations:message:write"] },
  { audience: "negotiations", method: "GET", path: "/negotiations/:threadId/agreement", scopes: ["negotiations:agreement:read"] },
  // ── orders ────────────────────────────────────────────────────
  { audience: "orders", method: "POST", path: "/orders/intake", scopes: ["orders:intake:write"] },
  { audience: "orders", method: "POST", path: "/orders/agreed-prices", scopes: ["orders:agreed-price:write"] },
  { audience: "orders", method: "GET", path: "/orders/lookup", scopes: ["orders:order:read"] },
  { audience: "orders", method: "GET", path: "/orders/:orderId", scopes: ["orders:order:read"] },
  { audience: "orders", method: "GET", path: "/orders/:orderId/history", scopes: ["orders:history:read"] },
  { audience: "orders", method: "POST", path: "/orders/:orderId/transitions", scopes: ["orders:transition:write"] },
  { audience: "orders", method: "POST", path: "/orders/:orderId/assignments", scopes: ["orders:assignment:write"] },
  { audience: "orders", method: "PATCH", path: "/orders/:orderId/assignments/:assignmentId", scopes: ["orders:assignment:write"] },];

/** كلُّ صلاحيّةٍ مفروضةٍ على هذا الجمهورِ — مُشتَقّةٌ من الجردِ لا مكتوبةٌ ثانيةً. */
export function enforcedScopesAt(audience: Audience): readonly string[] {
  const out = new Set<string>();
  for (const op of ENFORCED_OPERATIONS) {
    if (op.audience === audience) {
      for (const s of op.scopes) out.add(s);
    }
  }
  return [...out].sort();
}

/** كلُّ صلاحيّةٍ مفروضةٍ في المستودعِ كلِّهِ — 64 صلاحيّةً في قياسِ 2026-09-15. */
export function allEnforcedScopes(): readonly string[] {
  const out = new Set<string>();
  for (const op of ENFORCED_OPERATIONS) for (const s of op.scopes) out.add(s);
  return [...out].sort();
}

/** العملياتُ التي تطلبُ هذهِ الصلاحيّةَ — لقراءةِ أثرِ منحٍ قبلَ إعطائِه. */
export function operationsRequiring(scope: string): readonly EnforcedOperation[] {
  return ENFORCED_OPERATIONS.filter((op) => op.scopes.includes(scope));
}
