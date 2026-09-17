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
 * ── تصحيحٌ بالإضافةِ · مقيسٌ في 2026-09-15 · `M1-05B` ─────────────────────
 * **الجملةُ أعلاهُ «والرمزُ نفسُهُ لا يحملُ اسمَ الشخصِ الذي نُودِيَ نيابةً عنه…
 * ولا مطلبَ فيهِ لهويّةِ الطرفِ المُنتَفِعِ» خاطئةٌ، وتُتركُ مكتوبةً ولا تُمحى.**
 * القياسُ المُعادُ أظهرَ أنَّ `packages/service-auth/src/token.ts` يحملُ مطلباً
 * **اختياريّاً** اسمُهُ `obo` (`ServiceTokenPayload.obo?: string`)، يُصدَرُ
 * بـ`MintServiceTokenOptions.onBehalfOfPublicId`، ويُفحَصُ في `decodePayload`
 * (فراغُهُ أو نوعُهُ الخاطئُ ⇒ `invalid_claims`)، ويظهرُ في
 * `ServicePrincipal.onBehalfOfPublicId`، ولهُ قارئٌ جاهزٌ
 * `ownerPublicIdOf()` في `packages/auth-sdk/src/authorize.ts`. وكانَ لهُ
 * مستهلِكٌ واحدٌ يومَها: نسبةُ تدقيقِ تعارضِ المخزونِ في `services/delivery`.
 *
 * **فالفجوةُ الحقيقيّةُ لم تكنْ «لا مطلبَ في الرمزِ» بل «المطلبُ موجودٌ
 * اختياريّاً ولا أحدَ يُلزِمُهُ، و`assertOwner` تجاهلَهُ وفضَّلَ ترويسةً
 * يكتبُها المُنادي».** وهذا فرقٌ يُغيِّرُ حجمَ الإصلاحِ لا اتّجاهَهُ: فلم يلزمْ
 * تغييرُ عقدِ الرمزِ (`ADR-020` · `ADR-021`) كما قُدِّرَ هنا، بل إلزامُ المطلبِ
 * الموجودِ عندَ المساراتِ المربوطةِ بمالكٍ. ولذلكَ صارَ ما قيلَ إنّهُ «تغييرُ
 * عقدٍ» موجةً واحدةً من ثلاثٍ في `M1-05B`.
 *
 * **ولماذا يُصحَّحُ بالإضافةِ لا بالحذفِ:** التقديرُ الخاطئُ هوَ ما بُرِّرَ بهِ
 * تأجيلُ الإصلاحِ في `M1-05`. فمحوُهُ يجعلُ التأجيلَ يبدو قراراً بلا سببٍ،
 * ويُخفي أنَّ سببَهُ كانَ قياساً ناقصاً — وهوَ الدرسُ الوحيدُ الذي يستحقُّ
 * البقاءَ هنا.
 *
 * المرجع: ADR-027 · ADR-028 · RISK-0042 · docs/07-security/AUTHORIZATION_POLICY_MATRIX.md
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
    strength: "token-bound",
    evidence: "services/orders/src/http/app.ts:requireBeneficiary",
    note: "`M1-05B`: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ. والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf`، والترويسةُ `X-Customer-Public-Id` بقيتْ مطلوبةً بالعقدِ ولكنَّها صارتْ **مُطالَبةً بالمطابقةِ** لا حَكَماً: مخالفتُها تُرَدُّ `ORDER_NOT_FOUND`. وسابقاً كانَ هذا الصفُّ `caller-asserted` بدليلِ `assertOwner` — يُذكَرُ ولا يُمحى.",
  },
  {
    audience: "orders",
    method: "GET",
    path: "/orders/:orderId/history",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/orders/src/http/app.ts:requireBeneficiary",
    note: "`M1-05B`: الربطُ نفسُهُ على سجلِّ الحالاتِ — وهوَ الأَوْلى بهِ لأنَّ تسريبَ التاريخِ يكشفُ نمطَ سلوكٍ لا لقطةً واحدةً. وسابقاً `caller-asserted` بدليلِ `assertOwner`.",
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

  // ── حدُّ العميلِ: تسعُ عملياتٍ مربوطةٌ بالمالكِ (`M1-04` · الموجةُ 9) ────
  //
  // ولِمَ تُربَطُ كلُّها دفعةً واحدةً لا على موجاتٍ كما جرى في حدِّ الطلباتِ:
  // هناكَ كانَ الفرضُ قائماً والربطُ وحدَهُ ناقصاً، فكانَ كلُّ مسارٍ يُربَطُ
  // **تغييرَ عقدٍ على مُنادٍ قائمٍ**. وهنا لا مُنادي إنتاجٍ عبرَ HTTP أصلاً
  // (بوتُ العميلِ يُنادي حالاتَ الاستعمالِ في العمليّةِ نفسِها)، فالفرضُ والربطُ
  // دفعةٌ واحدةٌ لا تكسرُ مُنادياً. والمساراتُ مبسوطةٌ لا مُولَّدةٌ بـ`map`
  // للسببِ المكتوبِ أعلاهُ: الفحصُ 16 يقرأُ هذا الملفَ ساكناً.
  {
    audience: "customers",
    method: "GET",
    path: "/customers/:waslaPublicId/profile",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). وملفُّ العميلِ أولى ما يُربَطُ: فيهِ اسمٌ وهاتفٌ.",
  },
  {
    audience: "customers",
    method: "PUT",
    path: "/customers/:waslaPublicId/profile",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). والكتابةُ أولى من القراءةِ: مَن كتبَ ملفَّ غيرِهِ أفسدَ بياناً لا قرأَهُ.",
  },
  {
    audience: "customers",
    method: "GET",
    path: "/customers/:waslaPublicId/places",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). والأماكنُ المحفوزةُ تكشفُ سكناً وعملاً — تسريبُها أخطرُ من تسريبِ اسمٍ.",
  },
  {
    audience: "customers",
    method: "POST",
    path: "/customers/:waslaPublicId/places",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). وإضافةُ مكانٍ لعميلٍ آخرَ تزرعُ عنواناً في دفترِ غيرِ صاحبِه.",
  },
  {
    audience: "customers",
    method: "DELETE",
    path: "/customers/:waslaPublicId/places/:placeId",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). والحذفُ كانَ أصلاً يُجيبُ 404 لما ليسَ للعميلِ، فالربطُ يُقَدِّمُ الحكمَ إلى الوسيطِ قبلَ مسِّ المخزنِ.",
  },
  {
    audience: "customers",
    method: "POST",
    path: "/customers/:waslaPublicId/order-requests/preview",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). والمعاينةُ لا تكتبُ شيئاً، ولكنَّها تقرأُ أماكنَ العميلِ وحدودَهُ — فلا تُترَكُ مفتوحةً لأنَّها «لا تُعدِّلُ».",
  },
  {
    audience: "customers",
    method: "GET",
    path: "/customers/:waslaPublicId/order-requests",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). وقائمةُ الطلباتِ تكشفُ نمطَ تنقُّلٍ لا لقطةً واحدةً.",
  },
  {
    audience: "customers",
    method: "POST",
    path: "/customers/:waslaPublicId/order-requests",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). وإيداعُ طلبٍ باسمِ عميلٍ آخرَ يُلزِمُهُ مالاً ومشواراً لم يطلبْهُ.",
  },
  {
    audience: "customers",
    method: "GET",
    path: "/customers/:waslaPublicId/order-requests/:orderRequestId",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/customers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ التاسعةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `CUSTOMER_PROFILE_NOT_FOUND` لا 403 (`ADR-009`). وقراءةُ طلبٍ واحدٍ بمُعرِّفِهِ: مُعرِّفٌ مُخمَّنٌ لا يكفي لقراءةِ مَورِدٍ مملوكٍ.",
  },

  // ── حدُّ السوقِ: المستأجرُ مُعنوَنٌ ولا مُتحقَّقٌ منه (مقيسٌ 2026-09-15) ──────
  // `storeSlug` يُقرأُ من المسارِ بـ`pathParam` ثمَّ يُسلَّمُ إلى المُستودَعِ
  // مباشرةً في كلِّ مسارٍ من الأحدَ عشرَ أدناه. ولا موضعَ واحدٌ في
  // `services/marketplace/src/http/app.ts` يسألُ «أهذا المُنادي من هذا المتجرِ؟».
  // فحاملُ صلاحيّةِ الموظّفينَ يكتبُ موظّفاً في **أيِّ** متجرٍ، وحاملُ صلاحيّةِ
  // المنتجاتِ يُنشِئُ منتجاً في **أيِّ** متجرٍ. والصلاحيّةُ هنا على مستوى الحدِّ
  // لا على مستوى المُستأجِرِ، وهوَ فرقٌ لم يكنْ مكتوباً قبلَ هذهِ الدفعةِ.
  //
  // ── تصحيحٌ بالإضافةِ · `M1-05B` الموجةُ 2 · `CLM-0179` (2026-09-15) ─────────
  // ما فوقَ **صحيحٌ في تاريخِهِ ولم يبقَ صحيحاً في خمسةٍ من الأحدَ عشرَ**، ولا
  // يُمحى: يُقرأُ وصفاً لحالةٍ سابقةٍ يُقاسُ عليها التحسُّنُ.
  //
  // والمربوطُ الآن خمسةٌ (`staffRead` · `staffWrite` ×2 · `productWrite` ·
  // `storeReviewRequest`): كلٌّ منها يُصنَّفُ `tenantScoped(...)` عندَ الحدِّ
  // فيُرفَضُ رمزٌ بلا `obo` **قبلَ** أن يُمسَّ المتجرُ، ثمَّ تُفحَصُ العضويّةُ
  // **داخلَ المعاملةِ نفسِها** بـ`assertActiveMembership` (`domain/staff.ts`) لا
  // في قراءةٍ سابقةٍ — فلا نافذةَ بينَ الفحصِ والكتابةِ.
  //
  // ولمَ بقيَتْ ستٌّ `none` — **بأسبابٍ مكتوبةٍ لا بإغفالٍ** (في `note` كلِّ صفٍّ):
  //   · أربعةٌ (`GET /stores/:slug` · `GET .../reviews` · `.../inventory/reserve` ·
  //     `.../inventory/release`) **لها مُنادٍ إنتاجيٌّ مقيسٌ** في
  //     `services/delivery` يُنادي **كخدمةٍ بلا مُنتَفِعٍ إنسانٍ**؛ فربطُها اليومَ
  //     يُسقِطُ التوصيلَ لا المهاجمَ. وحدُّها الصحيحُ حدُّ خدمةٍ لا حدُّ مُستأجِرٍ.
  //   · `GET .../products` قراءةُ كتالوجٍ عامٍّ يقرأُهُ التوصيلُ نفسُهُ.
  //   · `POST .../decisions` **عكسُ السياسةِ لو رُبِطَ**: البتُّ في متجرٍ سلطةُ
  //     منصّةٍ، وربطُهُ بعضويّةِ المتجرِ يجعلُ المتجرَ يوافقُ على نفسِهِ.
  //
  // وما لا يُدَّعى: المربوطُ يفرضُ **عضويّةً** لا **رتبةً**. فعضوٌ برتبةِ `staff`
  // يُضيفُ عضواً في متجرِهِ، وذلكَ دَينٌ مُسمّىً في `RISK-0042` يحتاجُ رمزَ خطأٍ
  // ثالثاً وتغييرَ عقدٍ — ولم يُنصَّفْ هنا كي لا يُقرأَ نصفُ إنفاذٍ إنفاذاً.
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
    note: "يبقى `none` بسببٍ مكتوبٍ: مُنادِيهِ الإنتاجيُّ المقيسُ خدمةُ التوصيلِ (`http-marketplace-catalog.ts` · `http-marketplace-probe.ts`) **كخدمةٍ بلا مُنتَفِعٍ إنسانٍ**، فربطُهُ بمُستأجِرٍ يُسقِطُ التوصيلَ لا المهاجمَ. وحدُّهُ الصحيحُ حدُّ خدمةٍ (`M1-06`).",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/review-requests",
    dimension: "tenant",
    strength: "token-bound",
    evidence: "services/marketplace/src/http/app.ts:tenantScoped",
    note: "`tenantScoped(storeReviewRequest)` يفرضُ `obo`؛ و`assertActiveOwnership` داخلَ المعاملةِ يفرضُ أنَّ الفاعلَ **المالكُ النشِطُ** لا مُجرَّدَ عضوٍ — لأنَّ الدفترَ يكتبُ `actorType` بقيمةِ المالكِ بلا شرطٍ، فالفرضُ يُصدِّقُ دعوىً قائمةً لا يخترعُ سياسةً.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/decisions",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "يبقى `none` **عن قصدٍ لا إغفالٍ**: البتُّ في متجرٍ سلطةُ منصّةٍ، وربطُهُ بعضويّةِ المتجرِ **عكسُ السياسةِ** — متجرٌ يوافقُ على نفسِهِ. وحدُّهُ دورُ اعتدالٍ عندَ مُصدِرِ الرمزِ لا عضويّةٌ.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/stores/:storeSlug/reviews",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "يبقى `none` بسببٍ مكتوبٍ: دفترُ قراراتٍ تقرأُهُ الإدارةُ والمتجرُ معاً، ولا مُنتَفِعَ إنسانَ في مُنادِيهِ المقيسِ. وربطُهُ يحتاجُ فصلَ «قراءةِ الإدارةِ» عن «قراءةِ المتجرِ» وهوَ تغييرُ عقدٍ.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/stores/:storeSlug/staff",
    dimension: "tenant",
    strength: "token-bound",
    evidence: "services/marketplace/src/http/app.ts:tenantScoped",
    note: "`tenantScoped(staffRead)` يفرضُ `obo`؛ و`assertActiveMembership` في `app/stores.ts:listStaff` يفرضُ عضويّةَ القارئِ. والرفضُ `STORE_NOT_FOUND` لا `403`: فرقُهما يجعلُ الحدَّ عرّافاً بوجودِ متاجرَ لا ينتسبُ إليها المُنادي.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/staff",
    dimension: "tenant",
    strength: "token-bound",
    evidence: "services/marketplace/src/http/app.ts:tenantScoped",
    note: "`tenantScoped(staffWrite)` يفرضُ `obo`؛ و`assertActiveMembership` في `app/stores.ts:addStaff` يفرضُ عضويّةَ المُضيفِ **داخلَ** معاملةِ الكتابةِ. وحقلُ `added_by_public_id` بقيَ في العقدِ **مُتحقَّقاً من تناسقِهِ معَ الرمزِ** لا حَكَماً.",
  },
  {
    audience: "marketplace",
    method: "DELETE",
    path: "/stores/:storeSlug/staff/:memberPublicId",
    dimension: "tenant",
    strength: "token-bound",
    evidence: "services/marketplace/src/http/app.ts:tenantScoped",
    note: "`tenantScoped(staffWrite)` يفرضُ `obo`؛ و`assertActiveMembership` تُفحَصُ **قبلَ** وجودِ المُزالِ في `app/stores.ts:removeStaff` — وعكسُ الترتيبِ كانَ يجعلُ المسارَ كاشفاً لعضويّاتِ متجرٍ لا ينتسبُ إليهِ المُنادي بفرقِ `STORE_STAFF_NOT_FOUND` عن `STORE_NOT_FOUND`.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/stores/:storeSlug/products",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "يبقى `none` بسببٍ مكتوبٍ: كتالوجٌ عامٌّ تقرأُهُ خدمةُ التوصيلِ نفسُها، وليسَ فيهِ ما يخصُّ عضواً.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/products",
    dimension: "tenant",
    strength: "token-bound",
    evidence: "services/marketplace/src/http/app.ts:tenantScoped",
    note: "`tenantScoped(productWrite)` يفرضُ `obo`؛ و`assertActiveMembership` في `app/products.ts:createProduct` يفرضُ عضويّةَ المُنشئِ داخلَ معاملةِ الكتابةِ. وحقلُ `created_by_public_id` مُتحقَّقٌ من تناسقِهِ معَ الرمزِ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/inventory/reserve",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "يبقى `none` بسببٍ مكتوبٍ: مُنادِيهِ الوحيدُ المقيسُ `services/delivery/src/.../http-marketplace-reservation.ts` **كخدمةٍ بلا مُنتَفِعٍ**؛ وربطُهُ بمُستأجِرٍ يُسقِطُ حجزَ المخزونِ في مسارِ طلبٍ حقيقيٍّ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores/:storeSlug/inventory/release",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:pathParam",
    note: "يبقى `none` بسببٍ مكتوبٍ: كنظيرِهِ في الحجزِ — والإفراجُ **تعويضٌ في مسارِ فشلٍ** (`ADR-026 §2.3`)، فربطُهُ بمُنتَفِعٍ إنسانٍ يجعلُ التعويضَ يفشلُ حيثُ يُحتاجُ أكثرَ ما يُحتاجُ.",
  },

  // ── دورةُ حياةِ المنتجِ: الفاعلُ من **الرمزِ** لا من الجسمِ (`M1-05B` الموجةُ 4) ──
  // كانَ الوصفُ هنا (قبلَ الموجةِ 4) أنَّ `input.actorPublicId` يُستعملُ كأنَّهُ
  // فاعلٌ مُثبَتٌ ولا يُقارَنُ بشيءٍ — وهوَ وصفٌ صادقٌ **للحالةِ التي انتهتْ**.
  // الآن: `tenantScoped` يُلزِمُ الرمزَ بمُستفيدٍ، و`productActor` في الحدِّ يُقارِنُ
  // فاعلَ الجسمِ بـ`obo` الموقّعِ (تنافُرٌ ⇒ `PRODUCT_NOT_FOUND` لا 403)،
  // و`transitionState` يفرضُ عضويّةَ الفاعلِ في متجرِ المنتجِ **داخلَ المعاملةِ**.
  // الحقلُ بقيَ في الجسمِ إلزاميّاً بالعقدِ — حذفُهُ تغييرُ عقدٍ — وصارَ
  // **مُتحقَّقاً من تناسقِهِ** لا حَكَماً.
  {
    audience: "marketplace",
    method: "POST",
    path: "/products/:productId/publish",
    dimension: "tenant",
    strength: "token-bound",
    evidence: "services/marketplace/src/http/app.ts:tenantScoped",
    note: "(صُحِّحَ بالموجةِ 4 — كانَ owner/none.) الفاعلُ من obo الموقّعِ عبرَ productActor؛ حقلُ الجسمِ actor_public_id تناسقٌ يُقارَنُ بالرمزِ لا حَكَمٌ، وعضويّةُ الفاعلِ في متجرِ المنتجِ مفروضةٌ داخلَ معاملةِ الكتابةِ."
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/products/:productId/archive",
    dimension: "tenant",
    strength: "token-bound",
    evidence: "services/marketplace/src/http/app.ts:tenantScoped",
    note: "(صُحِّحَ بالموجةِ 4 — كانَ owner/none.) الفاعلُ من obo الموقّعِ عبرَ productActor؛ حقلُ الجسمِ actor_public_id تناسقٌ يُقارَنُ بالرمزِ لا حَكَمٌ، وعضويّةُ الفاعلِ في متجرِ المنتجِ مفروضةٌ داخلَ معاملةِ الكتابةِ."
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/products/:productId/inventory",
    dimension: "tenant",
    strength: "token-bound",
    evidence: "services/marketplace/src/http/app.ts:tenantScoped",
    note: "(الموجةُ 4 · RISK-0042 البندُ 3.) تعديلُ المخزونِ فعلُ عضوٍ: الفاعلُ من obo الموقّعِ عبرَ productActor، والعضويّةُ مفروضةٌ داخلَ معاملةِ الكتابةِ نفسِها (adjustInventory) — لا نافذةَ بينَ فحصٍ وكتابةِ فرقٍ."
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/products/:productId/decisions",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:scoped",
    note: "يبقى `none` بسببٍ مكتوبٍ: قرارُ الاعتدالِ سلطةُ منصّةٍ لا فعلَ متجرٍ — وربطُهُ بعضويّةِ متجرٍ يعكِسُ السياسةَ (متجرٌ يوافقُ على نفسِهِ)، فالفاعلُ يُوثَّقُ في الدفترِ بصفتِهِ لا بعضويّةٍ تُفرَضُ."
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

/**
 * عددُ العملياتِ التي يُثبِتُ **الرمزُ** مالكَها أو مستأجرَها.
 *
 * كانَ **صفراً** في `M1-05`، وصارَ **اثنتَينِ** في `M1-05B` (الموجةُ الأولى:
 * قراءةُ الطلبِ وسجلُّهُ)، ثمَّ **سبعاً** في الموجةِ الثانيةِ (`CLM-0179`):
 * خمسُ عملياتٍ على حدِّ السوقِ تُربَطُ بالمُستأجِرِ — انظرْ
 * `TENANT_BOUND_OPERATION_COUNT` أدناهُ. وهوَ **مُشتَقٌّ لا مكتوبٌ** كي لا يصيرَ رقماً
 * يُحدَّثُ باليدِ فيُصدِّقُ ما لا تُثبِتُهُ الصفوفُ. والفحصُ 16 يُطابِقُهُ
 * بعددِ الصفوفِ ويُطابِقُ كلَّ صفٍّ `token-bound` بتصنيفِ مسارِهِ في شفرةِ
 * الحدِّ — فلا يكفي تغييرُ كلمةٍ هنا لرفعِ الرقمِ.
 */
export const TOKEN_BOUND_OPERATION_COUNT: number = OPERATION_BINDINGS.filter(
  (b) => b.strength === "token-bound",
).length;

/**
 * وكم من المربوطِ **بُعدُهُ مُستأجِرٌ** لا مالكُ مَورِدٍ (`M1-05B` الموجةُ 2).
 *
 * الفرقُ ليسَ تصنيفاً إداريّاً: ربطُ **المالكِ** يسألُ «أهذا المَورِدُ لهُ؟»
 * ويُقارَنُ بصفٍّ واحدٍ، وربطُ **المُستأجِرِ** يسألُ «أهوَ من هذا المتجرِ؟»
 * ويُقارَنُ بجدولِ عضويّةٍ **داخلَ المعاملةِ** لأنَّ العضويّةَ تُزالُ بينَ
 * فحصٍ وكتابةٍ. فخلطُهما في رقمٍ واحدٍ يُخفي أنَّ أحدَ البُعدَينِ صفرٌ.
 *
 * ومُشتَقٌّ لا مكتوبٌ للسببِ نفسِهِ، ويُطابِقُهُ اختبارُ الحزمةِ بعددِ الصفوفِ.
 */
export const TENANT_BOUND_OPERATION_COUNT: number = OPERATION_BINDINGS.filter(
  (b) => b.strength === "token-bound" && b.dimension === "tenant",
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
