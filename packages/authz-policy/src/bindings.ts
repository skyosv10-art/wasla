/**
 * البُعدُ الثاني والثالثُ للتفويضِ: **الملكيّةُ والمستأجرُ** (`M1-05`).
 *
 * ── الاكتشافُ الذي أنشأَ هذا الملفَّ — مقيسٌ في 2026-09-15 ────────────────
 * كانَ في المستودعِ موضعانِ يُقرآنِ «تحقُّقَ ملكيّةٍ»:
 * `assertOwner()` في `services/orders/src/http/app.ts:187` يرفضُ حينَ
 * `detail.order.customerPublicId !== scope`. والقياسُ أظهرَ أنَّ `scope` هذا
 * **ترويسةٌ يكتبُها المُنادي**: `requireCustomerScope()` في
 * `services/orders/src/http/requests.ts:164` يقرأُ `X-Customer-Public-Id`
 * ويتحقَّقُ من **شكلِها** لا من صدقِها.
 *
 * **فالنتيجةُ مقيسةٌ لا مُستنتَجةٌ:** حاملُ `orders:order:read` يكتبُ أيَّ
 * معرّفِ عميلٍ في الترويسةِ فيقرأُ طلبَ ذلكَ العميلِ. و`assertOwner` ليسَ
 * حاجزَ تفويضٍ بل **تحقُّقُ تناسقٍ** بينَ ترويسةٍ ومَورِدٍ: يمنعُ الخطأَ ولا
 * يمنعُ القصدَ. والرمزُ نفسُهُ **لا يحملُ اسمَ الشخصِ الذي نُودِيَ نيابةً عنه**:
 * `packages/service-auth/src/token.ts` يحملُ `sub` (الخدمةَ) و`aud` و`scp`، ولا
 * مطلبَ فيهِ لهويّةِ الطرفِ المُنتَفِعِ. فالبُعدُ الأوّلُ (الدورُ) لهُ مصفوفةٌ
 * الآنَ، والبُعدانِ الآخرانِ **لا رمزَ يُثبِتُهما**.
 *
 * ── ولِمَ تصنيفٌ لا إصلاحٌ في هذهِ الدفعةِ ────────────────────────────────
 * الإصلاحُ الجذريُّ إضافةُ مطلبٍ إلى الرمزِ (هويّةُ المُنتَفِعِ) وإنفاذُهُ عندَ
 * كلِّ حدٍّ يقرأُ مَورِداً مملوكاً — أي تغييرُ عقدِ الرمزِ (`ADR-020` · `ADR-021`)
 * وكلِّ مُنادٍ وكلِّ حدٍّ. وذلكَ **عنصرُ عملٍ مستقلٌّ** (`M1-05B`) لأنَّ خلطَهُ
 * بهذهِ الدفعةِ يجعلُ مراجعةً واحدةً تحكمُ على تغييرِ عقدٍ وتغييرِ مصفوفةٍ معاً.
 * **والمُنجَزُ هنا أن يصيرَ الغيابُ مقيساً ومُعلَناً ومحروساً**: تصنيفٌ لكلِّ
 * عمليّةٍ مفحوصةٍ، وعددٌ صريحٌ لغيرِ المفحوصِ، وفحصٌ يرفضُ أن يزيدَ غيرُ
 * المفحوصِ بصمتٍ أو أن يدَّعيَ التصنيفُ ما لا تُثبِتُهُ الشفرة.
 *
 * المرجع: ADR-027 · RISK-0042 · docs/07-security/AUTHORIZATION_POLICY_MATRIX.md
 */

import { ENFORCED_OPERATIONS, type Audience, type HttpMethod } from "./operations.js";

/**
 * قوّةُ الربطِ — مُرتَّبةٌ من الأقوى إلى الأضعف. والفرقُ بينَ الأوّلِ والثاني
 * هوَ الفرقُ بينَ «لا يستطيعُ» و«لا يُخطئُ عن غيرِ قصدٍ».
 */
export type BindingStrength =
  /** المالكُ أو المستأجرُ مُثبَتٌ بمطلبٍ **داخلَ** الرمزِ. لا يُنتحَلُ بلا مفتاح. */
  | "token-bound"
  /** المالكُ يُقارَنُ بقيمةٍ **يكتبُها المُنادي** (ترويسةٌ أو جسمٌ). تحقُّقُ تناسقٍ لا تفويضٍ. */
  | "caller-asserted"
  /** لا ربطَ: مَن حملَ الصلاحيّةَ قرأَ أو كتبَ أيَّ مَورِدٍ في الحدِّ. */
  | "none";

export type BindingDimension = "owner" | "tenant";

export interface OperationBinding {
  readonly audience: Audience;
  readonly method: HttpMethod;
  readonly path: string;
  readonly dimension: BindingDimension;
  readonly strength: BindingStrength;
  /** الموضعُ في الشفرةِ الذي يُثبِتُ التصنيفَ — يُقابِلُهُ الفحصُ 16 حرفاً. */
  readonly evidence: string;
  /** ما يُقارَنُ بماذا، أو لِمَ لا مقارنةَ. */
  readonly note: string;
};

/**
 * الجردُ المفحوصُ — **ستَّ عشرةَ عمليّةً من ثمانينَ**. ولم يُصنَّفْ إلّا ما
 * قُرِئَتْ شفرتُهُ سطراً سطراً في هذهِ الدفعةِ، وما لم يُقرأْ يُحصى في
 * `UNCLASSIFIED_OPERATION_COUNT` ولا يُسمّى تصنيفاً.
 *
 * والغالبُ فيهِ `none` لا `caller-asserted`: فأضعفُ من مقارنةٍ بقيمةٍ يكتبُها
 * المُنادي هوَ **ألّا تكونَ مقارنةٌ أصلاً** — وهذا حالُ حدِّ السوقِ كلِّه.
 */
export const OPERATION_BINDINGS: readonly OperationBinding[] = [
  {
    audience: "orders",
    method: "GET",
    path: "/orders/:orderId",
    dimension: "owner",
    strength: "caller-asserted",
    evidence: "services/orders/src/http/app.ts:assertOwner",
    note: "تُقارَنُ ترويسةُ `X-Customer-Public-Id` بـ`order.customerPublicId`، والترويسةُ يكتبُها المُنادي — فالرفضُ `ORDER_NOT_FOUND` لا 403 بقصدٍ (لا يُفصَحُ عن وجودِ طلبٍ لغيرِ صاحبِه).",
  },
  {
    audience: "orders",
    method: "GET",
    path: "/orders/:orderId/history",
    dimension: "owner",
    strength: "caller-asserted",
    evidence: "services/orders/src/http/app.ts:assertOwner",
    note: "المقارنةُ نفسُها على سجلِّ الحالاتِ — وتسريبُ التاريخِ أخطرُ من تسريبِ لقطةٍ لأنّهُ يكشفُ نمطَ سلوكٍ.",
  },
  {
    audience: "orders",
    method: "GET",
    path: "/orders/lookup",
    dimension: "owner",
    strength: "none",
    evidence: "services/orders/src/http/app.ts:/orders/lookup",
    note: "مسارٌ بينَ الخدماتِ بقصدٍ: هويّةُ المَورِدِ في سلسلةِ الاستعلامِ، ولا ترويسةَ مالكٍ ولا مقارنةَ. وربطُ الرمزِ لا يشملُ الاستعلامَ (`ADR-021` · `RISK-0026`) فرمزٌ لطلبٍ صالحٌ لكلِّ طلبٍ — `RISK-0026` مفتوحٌ ولم يُغلَقْ هنا.",
  },

  // ── حدُّ السوقِ: المستأجرُ مُعنوَنٌ ولا مُتحقَّقٌ منه (مقيسٌ 2026-09-15) ──────
  // `storeSlug` يُقرأُ من المسارِ بـ`pathParam` ثمَّ يُسلَّمُ إلى المُستودَعِ
  // مباشرةً في كلِّ مسارٍ من الأحدَ عشرَ أدناه. ولا موضعَ واحدٌ في
  // `services/marketplace/src/http/app.ts` يسألُ «أهذا المُنادي من هذا المتجرِ؟».
  // فحاملُ صلاحيّةِ الموظّفينَ يكتبُ موظّفاً في **أيِّ** متجرٍ، وحاملُ صلاحيّةِ
  // المنتجاتِ يُنشِئُ منتجاً في **أيِّ** متجرٍ. والصلاحيّةُ هنا على مستوى الحدِّ
  // لا على مستوى المُستأجِرِ، وهوَ فرقٌ لم يكنْ مكتوباً قبلَ هذهِ الدفعةِ.
  //
  // وكُتِبَتِ الصفوفُ مبسوطةً لا مُولَّدةً بـ`map` بقصدٍ: الفحصُ 16 يقرأُ هذا
  // الملفَّ ساكناً، وبياناتٌ مُولَّدةٌ في زمنِ التشغيلِ تُعمي الحارسَ عن نفسِها.
  {
    audience: "marketplace",
    method: "GET",
    path: "/stores/:storeSlug",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:storeRead` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/review-requests",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:storeReviewRequest` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/decisions",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:storeReviewDecide` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/stores/:storeSlug/reviews",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:storeReviewRead` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/stores/:storeSlug/staff",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:staffRead` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/staff",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:staffWrite` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "DELETE",
    path: "/stores/:storeSlug/staff/:memberPublicId",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:staffWrite` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/stores/:storeSlug/products",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:productRead` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/products",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:productWrite` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/inventory/reserve",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:inventoryReserve` على مستوى الحدِّ لا المُستأجِرِ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/inventory/release",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "`storeSlug` مُعنوَنٌ في المسارِ ويُسلَّمُ إلى المُستودَعِ بلا تحقُّقِ عضويّةٍ؛ والصلاحيّةُ `marketplace:inventoryRelease` على مستوى الحدِّ لا المُستأجِرِ.",
  },

  // ── الفاعلُ في دورةِ حياةِ المنتجِ: من **جسمِ** الطلبِ لا من الرمزِ ──────────
  // `input.actorPublicId` (app.ts:409 · 425) يُتحقَّقُ من شكلِهِ ويُسجَّلُ في أثرِ
  // التدقيقِ، ثمَّ يُستعملُ كأنَّهُ فاعلٌ مُثبَتٌ. وأثرُ تدقيقٍ يُكتَبُ بقيمةٍ
  // يختارُها المُنادي **أثرٌ يُثبِتُ الدعوى لا الفعلَ** — وهوَ وجهٌ من `RISK-0042`
  // أضعفُ من وجهِ الطلباتِ: هناكَ تُقارَنُ القيمةُ بمَورِدٍ، وهنا لا تُقارَنُ بشيءٍ.
  {
    audience: "marketplace",
    method: "POST",
    path: "/products/:productId/publish",
    dimension: "owner",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:actorPublicId",
    note: "`actorPublicId` يُقرأُ من جسمِ الطلبِ، يُتحقَّقُ من شكلِهِ، ويُسجَّلُ في أثرِ التدقيقِ — ولا يُقارَنُ بمالكِ المنتجِ ولا بمطلبٍ في الرمزِ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/products/:productId/archive",
    dimension: "owner",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:actorPublicId",
    note: "`actorPublicId` يُقرأُ من جسمِ الطلبِ، يُتحقَّقُ من شكلِهِ، ويُسجَّلُ في أثرِ التدقيقِ — ولا يُقارَنُ بمالكِ المنتجِ ولا بمطلبٍ في الرمزِ.",
  },
];

/**
 * عددُ العملياتِ المفروضةِ التي **لم يُقرأْ** ربطُها في هذهِ الدفعةِ.
 * يُقاسُ لا يُكتَبُ: طولُ الجردِ المفروضِ ناقصَ ما صُنِّفَ. والفحصُ 16 يُثبِتُ
 * أنَّ المجموعَ يُساوي طولَ `ENFORCED_OPERATIONS` — فلا عمليّةَ تسقطُ من
 * الحسابِ، ولا يُقرأُ الغيابُ نجاحاً.
 */
export const UNCLASSIFIED_OPERATION_COUNT: number =
  ENFORCED_OPERATIONS.length - OPERATION_BINDINGS.length;

/** عددُ العملياتِ التي يُثبِتُ الرمزُ مالكَها أو مستأجرَها — **صفرٌ** في 2026-09-15. */
export const TOKEN_BOUND_OPERATION_COUNT: number = OPERATION_BINDINGS.filter(
  (b) => b.strength === "token-bound",
).length;

export function bindingFor(
  audience: Audience,
  method: HttpMethod,
  path: string,
  dimension: BindingDimension,
): OperationBinding | undefined {
  return OPERATION_BINDINGS.find(
    (b) =>
      b.audience === audience &&
      b.method === method &&
      b.path === path &&
      b.dimension === dimension,
  );
}
