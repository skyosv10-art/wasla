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
  /** المالكُ مُثبَتٌ **بتأكيدِ مستخدمٍ** مُوقَّعٍ (Ed25519 JWT · ADR-060 P2). أقوى من `caller-asserted`، وأضعفُ من `token-bound` (التأكيدُ يُعاد استخدامهُ ضمنَ نافذةِ الصلاحيّةِ). */
  | "asserted"
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
    path: "/orders/drivers/:driverPublicId/jobs",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/orders/src/http/app.ts:ownerScoped /orders/drivers/:driverPublicId/jobs",
    note: "`M3-02` (CLM-0314): مسار شاشة الأرباح في تطبيق السائق. المالكُ من `obo` في الرمز، ويُطابَقُ مع `driverPublicId` في المسار. المخالفةُ تُرَدُّ `ORDER_NOT_FOUND` (لا 403).",
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

  // ── حدُّ السائقين: المالكُ مُعنوَنٌ في المسارِ ومُقارَنٌ برمزٍ (M1-04 · الموجةُ العاشرةُ · CLM-0198) ──
  // `requireBeneficiary` يفرضُ `beneficiary: "required"` على خمسةَ عشرَ مساراً،
  // فالرمزُ بلا `obo` يُرَدُّ 403، والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf`
  // ويُقارَنُ بـ`:waslaPublicId`، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`).
  // و`POST /drivers/eligibility/tick` و`/health` ليستا هنا:
  // الأولى داخليّةٌ بلا مُنتَفِعٍ، والثانية مفتوحةٌ.
  // ومسارُ `POST /drivers` يأخذُ المُنتَفِعَ من **الجسمِ** لا من المسارِ.
  {
    audience: "drivers",
    method: "POST",
    path: "/drivers",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`wasla_public_id` المكتوبِ في **الجسمِ** لا في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). وإنشاءُ ملفٍ لغيرِ صاحبِهِ انتحالُ هويّةٍ.",
  },
  {
    audience: "drivers",
    method: "GET",
    path: "/drivers/:waslaPublicId",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). وملفُّ السائقِ أولى ما يُربَطُ: فيهِ اسمٌ ورخصةٌ ومركبةٌ.",
  },
  {
    audience: "drivers",
    method: "PATCH",
    path: "/drivers/:waslaPublicId",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). والكتابةُ أولى من القراءةِ: مَن كتبَ ملفَّ غيرِهِ أفسدَ بياناً لا قرأَهُ.",
  },
  {
    audience: "drivers",
    method: "PUT",
    path: "/drivers/:waslaPublicId/availability",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). والإتاحةُ تُحرِّكُ المطابقةَ: مَن أعلنَها لغيرِهِ أدخلَهُ في تجمّعٍ لا يعرفُهُ.",
  },
  {
    audience: "drivers",
    method: "GET",
    path: "/drivers/:waslaPublicId/eligibility",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). والأهليّةُ سرٌّ مهنيٌّ: هل السائقُ مؤهَّلٌ هوَ سؤالٌ يخصُّ صاحبَهُ.",
  },
  {
    audience: "drivers",
    method: "POST",
    path: "/drivers/:waslaPublicId/documents",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). ووثائقُ السائقِ (رخصةٌ · هويةٌ · تسجيلٌ) سرٌّ شخصيٌّ.",
  },
  {
    audience: "drivers",
    method: "GET",
    path: "/drivers/:waslaPublicId/documents",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). وقراءةُ وثائقَ غيرِ صاحبِها تسريبٌ.",
  },
  {
    audience: "drivers",
    method: "POST",
    path: "/drivers/:waslaPublicId/documents/:documentId/review",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). ومراجعةُ وثيقةٍ قرارٌ إداريٌّ يحتاجُ صلاحيّةَ `document:review`.",
  },
  {
    audience: "drivers",
    method: "GET",
    path: "/drivers/:waslaPublicId/vehicles",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). والمركباتُ تكشفُ سائقاً ونوعَ عملٍ.",
  },
  {
    audience: "drivers",
    method: "POST",
    path: "/drivers/:waslaPublicId/vehicles",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). وإضافةُ مركبةٍ لغيرِ صاحبِها تربطُ ملكيّةً بمن لا يملكُها.",
  },
  {
    audience: "drivers",
    method: "PATCH",
    path: "/drivers/:waslaPublicId/vehicles/:vehicleId",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). وتعديلُ مركبةٍ لغيرِ صاحبِها تزويرٌ.",
  },
  {
    audience: "drivers",
    method: "GET",
    path: "/drivers/:waslaPublicId/zones",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). ومناطقُ الخدمةِ تكشفُ نطاقَ عملٍ وسكناً.",
  },
  {
    audience: "drivers",
    method: "PUT",
    path: "/drivers/:waslaPublicId/zones",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). وربطُ منطقةٍ بسائقٍ غيرِ صاحبِها يُوجِّهُ الطلباتِ خطأً.",
  },
  {
    audience: "drivers",
    method: "POST",
    path: "/drivers/:waslaPublicId/suspend",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). وتعليقُ سائقٍ غيرِ صاحبِها إيقافٌ بلا سببٍ.",
  },
  {
    audience: "drivers",
    method: "POST",
    path: "/drivers/:waslaPublicId/reinstate",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/drivers/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ العاشرةُ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:waslaPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `DRIVER_NOT_FOUND` لا 403 (`ADR-009`). وإعادةُ تمكينٍ لغيرِ صاحبِها تجاوزٌ للتعليقِ.",
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
  // تصحيحٌ بالإضافةِ (2026-09-30 · CLM-0419): الدَّينُ أعلاهُ **سُدِّدَ** في
  // `services/marketplace` — `assertStaffManager` يفرضُ على إضافةِ العضوِ وإزالتِهِ
  // أن يكونَ الفاعلُ المالكَ أو مديراً نشِطاً، والرفضُ `403 AUTHZ_FORBIDDEN`. ولم
  // يلزمْ رمزٌ ثالثٌ ولا تغييرُ عقدٍ كما قُدِّرَ: الـ403 مُعلَنٌ أصلاً على المسارينِ
  // (`components/responses/AuthForbidden`). والجملةُ أعلاهُ تُتركُ لأنّها سببُ التأجيلِ.
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
  // ── reputation (الموجةُ الحاديةَ عشرةَ · CLM-0199) ────────────────────────────
  // حدُّ السمعة: مسارانِ مملوكانِ لمُنتَفِعٍ، وبقيّةُ المساراتِ داخليّةٌ لا مُنتَفِعَ لها.
  {
    audience: "reputation",
    method: "GET",
    path: "/reputation/scores/:subjectType/:subjectPublicId",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/reputation/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ الحاديةَ عشرةَ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`:subjectPublicId` المكتوبِ في المسارِ، والمخالفةُ تُرَدُّ `REPUTATION_SCORE_NOT_FOUND` لا 403 (`ADR-009`). وقراءةُ نتيجةِ غيرِ صاحبِها تسريبٌ.",
  },
  {
    audience: "reputation",
    method: "POST",
    path: "/reputation/ratings",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/reputation/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ الحاديةَ عشرةَ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`rater_public_id` المكتوبِ في الجسمِ، والمخالفةُ تُرَدُّ `REPUTATION_SCORE_NOT_FOUND` لا 403 (`ADR-009`). والتقييمُ باسمِ غيرِ صاحبِهِ يربطُ هوّيّةً بمن لا يملكُها.",
  },

  // ── subscriptions (الموجةُ الثالثةَ عشرةَ · CLM-0201) ──────────────────────────
  // حدُّ الاشتراك: ستَّ مساراتٍ مربوطةٌ بمُنتَفِعٍ، وخمسةٌ داخليّةٌ بلا مُنتَفِعَ. وكلُّ
  // مخالفةٍ في المُنتَفِعِ تُرَدُّ `SUBSCRIPTION_NOT_FOUND` (404) لا 403 (`ADR-009`).
  {
    audience: "subscriptions",
    method: "POST",
    path: "/subscriptions",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/subscriptions/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ الثالثةَ عشرةَ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ قبلَ المسارِ؛ والمالكُ يُقرأُ من الرمزِ بـ`ownerPublicIdOf` ويُقارَنُ بـ`driver_public_id` المكتوبِ في الجسمِ، والمخالفةُ تُرَدُّ `SUBSCRIPTION_NOT_FOUND` لا 403 (`ADR-009`).",
  },
  {
    audience: "subscriptions",
    method: "GET",
    path: "/subscriptions/:driverPublicId",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/subscriptions/src/http/app.ts:requireDriverBeneficiary",
    note: "`M1-04` الموجةُ الثالثةَ عشرةَ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، فرمزٌ بلا `obo` يُرَدُّ 403 عندَ الوسيطِ؛ والمالكُ يُقرأُ من الرمزِ ويُقارَنُ بـ`:driverPublicId` في المسارِ، والمخالفةُ `SUBSCRIPTION_NOT_FOUND` (404) لا 403 (`ADR-009`).",
  },
  {
    audience: "subscriptions",
    method: "POST",
    path: "/subscriptions/:driverPublicId/activate",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/subscriptions/src/http/app.ts:requireDriverBeneficiary",
    note: "`M1-04` الموجةُ الثالثةَ عشرةَ: الربطُ نفسُهُ على مسارِ التنشيطِ — وتفعيلُ اشتراكِ غيرِ صاحبِهِ تدخّلٌ في ملكيّةٍ.",
  },
  {
    audience: "subscriptions",
    method: "POST",
    path: "/subscriptions/:driverPublicId/recompute",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/subscriptions/src/http/app.ts:requireDriverBeneficiary",
    note: "`M1-04` الموجةُ الثالثةَ عشرةَ: الربطُ نفسُهُ على مسارِ إعادةِ الحسابِ — وإعادةُ حسابِ حالةِ غيرِ صاحبِها قراءةٌ في ملكيّةٍ.",
  },
  {
    audience: "subscriptions",
    method: "GET",
    path: "/subscriptions/:driverPublicId/periods",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/subscriptions/src/http/app.ts:requireDriverBeneficiary",
    note: "`M1-04` الموجةُ الثالثةَ عشرةَ: الربطُ نفسُهُ على مسارِ الفتراتِ — وسجلُّ فتراتِ غيرِ صاحبِها تسريبٌ زمنيّ.",
  },
  {
    audience: "subscriptions",
    method: "POST",
    path: "/referrals",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/subscriptions/src/http/app.ts:requireBeneficiary",
    note: "`M1-04` الموجةُ الثالثةَ عشرةَ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، والمُنتَفِعُ يُقارَنُ بـ`referee_public_id` في الجسمِ، والمخالفةُ `SUBSCRIPTION_NOT_FOUND` (404) لا 403 (`ADR-009`).",
  },
  {
    audience: "subscriptions",
    method: "GET",
    path: "/referrals/codes/:ownerPublicId",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/subscriptions/src/http/app.ts:requireOwnerBeneficiary",
    note: "`M1-04` الموجةُ الثالثةَ عشرةَ: المسارُ مُصنَّفٌ `beneficiary: \"required\"`، والمُنتَفِعُ يُقارَنُ بـ`:ownerPublicId` في المسارِ، والمخالفةُ `SUBSCRIPTION_NOT_FOUND` (404) لا 403 (`ADR-009`).",
  },

  // ── RISK-0042 الموجةُ 1 (CLM-0435 · 2026-10-02): 23 عمليّةً مقروءةً سطراً سطراً ──
  // كلُّ صفٍّ أدناهُ `none` لأنَّ إعدادَ مسارِهِ (`scoped` · `adminScoped` · `internalScoped`)
  // يُعيدُ `{ serviceIdentity: { scopes } }` بلا `beneficiary`، ومُدخَلَ حالةِ الاستعمالِ
  // لا يحملُ هويّةَ مُنادٍ. و`evidence` يُسمّي الملفَّ ومِرساتَينِ يتحقّقُ الفحصُ 16
  // (البابُ 7-ج) من وجودِهما حرفاً. و`none` هنا **إعلانُ فجوةٍ حيثُ يُقالُ "فجوةٌ"**،
  // وقرارُ تصميمٍ حيثُ لا مالكَ بطبيعةِ المَورِدِ — ولا يُقرأُ تصنيفٌ إصلاحاً.
  {
    audience: "dispatch",
    method: "POST",
    path: "/dispatch/jobs",
    dimension: "owner",
    strength: "none",
    evidence: "services/dispatch/src/http/app.ts:scoped(DISPATCH_SCOPES.jobWrite) createDispatchJob(deps,",
    note: "إنشاءُ مهمّةِ توزيعٍ من الجسمِ (`order_id` · `order_public_id`) بلا هويّةِ مُنادٍ تُقارَنُ؛ مُنادِيهِ خدمةٌ لا إنسانٌ. والمُدخَلُ إلى `createDispatchJob` لا يحملُ فاعلاً.",
  },
  {
    audience: "dispatch",
    method: "GET",
    path: "/dispatch/jobs/:job_id",
    dimension: "owner",
    strength: "none",
    evidence: "services/dispatch/src/http/app.ts:scoped(DISPATCH_SCOPES.jobRead) readDispatchJob(deps,",
    note: "قراءةُ مهمّةٍ بمُعرِّفِها وحدَهُ؛ `readDispatchJob` يتلقّى `{ jobId, traceId }` ولا فاعلَ. فحاملُ `dispatch:job:read` يقرأُ أيَّ مهمّةٍ.",
  },
  {
    audience: "dispatch",
    method: "GET",
    path: "/dispatch/jobs/:job_id/offers",
    dimension: "owner",
    strength: "none",
    evidence: "services/dispatch/src/http/app.ts:scoped(DISPATCH_SCOPES.offerRead) listDispatchOffers(deps,",
    note: "قائمةُ عروضِ مهمّةٍ بمُعرِّفِها وحدَهُ؛ لا فاعلَ في المُدخَلِ.",
  },
  {
    audience: "dispatch",
    method: "GET",
    path: "/dispatch/offers/:offer_id",
    dimension: "owner",
    strength: "none",
    evidence: "services/dispatch/src/http/app.ts:scoped(DISPATCH_SCOPES.offerRead) readDispatchOffer(deps,",
    note: "قراءةُ عرضٍ بمُعرِّفِهِ وحدَهُ؛ لا يُقارَنُ السائقُ المعروضُ عليهِ بأيِّ هويّةٍ.",
  },
  {
    audience: "dispatch",
    method: "POST",
    path: "/dispatch/tick",
    dimension: "owner",
    strength: "none",
    evidence: "services/dispatch/src/http/app.ts:scoped(DISPATCH_SCOPES.tickWrite) runTick(options.runner,",
    note: "نبضةُ جدولةٍ داخليّةٌ بجسمٍ فارغٍ؛ لا مَورِدَ مملوكاً بعينِهِ ولا مُنتَفِعَ.",
  },
  {
    audience: "dispatch",
    method: "POST",
    path: "/dispatch/offers/:offer_id/accept",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/dispatch/src/http/app.ts:assertedDriver(DISPATCH_SCOPES.offerAccept) assertOfferDriver(request, options.runner, offerId, traceId)",
    note: "CLM-0466: `asserted` — قبولُ العرضِ فعلُ سائقٍ (`beneficiary: \"asserted\"`، الفاعلُ `driver`، ولا مُمرِّرَ لأنَّ `driver-bot` حدٌّ يُنادي مباشرةً). يُقارَنُ `driverPublicId` في العرضِ بـ`endUser.publicId`؛ الخلافُ 404 (`DISPATCH_OFFER_NOT_FOUND`) كالعرضِ المجهولِ. في الوضعِ `off` (الإنتاجُ حتّى P3) لا تأكيدَ ولا مقارنةَ — السلوكُ كما كان. ولا منحةَ خدمةٍ لـ`dispatch:offer:accept` اليومَ، فالمسارُ مغلقٌ في الإنتاجِ أصلاً.",
  },
  {
    audience: "dispatch",
    method: "POST",
    path: "/dispatch/offers/:offer_id/reject",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/dispatch/src/http/app.ts:assertedDriver(DISPATCH_SCOPES.offerReject) assertOfferDriver(request, options.runner, offerId, traceId)",
    note: "CLM-0466: `asserted` — مثلُ القبولِ: رفضُ العرضِ لا يقبلُهُ إلّا السائقُ المعروضُ عليهِ (`endUser.publicId` = `driverPublicId`)، والخلافُ 404. `off` ⇒ السلوكُ كما كان.",
  },
  {
    audience: "dispatch",
    method: "POST",
    path: "/dispatch/jobs/:job_id/cancel",
    dimension: "owner",
    strength: "none",
    evidence: "services/dispatch/src/http/app.ts:scoped(DISPATCH_SCOPES.jobCancel) cancelDispatchJob(deps,",
    note: "إلغاءُ مهمّةٍ بمُعرِّفِها وسببٍ من الجسمِ؛ لا فاعلَ في المُدخَلِ.",
  },
  {
    audience: "geography",
    method: "GET",
    path: "/geo/countries",
    dimension: "owner",
    strength: "none",
    evidence: "services/geography/src/http/app.ts:scoped(GEO_SCOPES.hierarchyRead) listCountries(deps,",
    note: "بياناتٌ مرجعيّةٌ عامّةٌ (التسلسلُ الجغرافيُّ) — لا مالكَ بطبيعتِها.",
  },
  {
    audience: "geography",
    method: "GET",
    path: "/geo/countries/:countryId/regions",
    dimension: "owner",
    strength: "none",
    evidence: "services/geography/src/http/app.ts:scoped(GEO_SCOPES.hierarchyRead) listRegions(deps,",
    note: "بياناتٌ مرجعيّةٌ عامّةٌ — لا مالكَ بطبيعتِها.",
  },
  {
    audience: "geography",
    method: "GET",
    path: "/geo/regions/:regionId/cities",
    dimension: "owner",
    strength: "none",
    evidence: "services/geography/src/http/app.ts:scoped(GEO_SCOPES.hierarchyRead) listCities(deps,",
    note: "بياناتٌ مرجعيّةٌ عامّةٌ — لا مالكَ بطبيعتِها.",
  },
  {
    audience: "geography",
    method: "GET",
    path: "/geo/cities/:cityId/districts",
    dimension: "owner",
    strength: "none",
    evidence: "services/geography/src/http/app.ts:scoped(GEO_SCOPES.hierarchyRead) listDistricts(deps,",
    note: "بياناتٌ مرجعيّةٌ عامّةٌ — لا مالكَ بطبيعتِها.",
  },
  {
    audience: "geography",
    method: "GET",
    path: "/geo/districts/:districtId/zones",
    dimension: "owner",
    strength: "none",
    evidence: "services/geography/src/http/app.ts:scoped(GEO_SCOPES.hierarchyRead) listZones(deps,",
    note: "بياناتٌ مرجعيّةٌ عامّةٌ — لا مالكَ بطبيعتِها.",
  },
  {
    audience: "geography",
    method: "GET",
    path: "/geo/zones/:zoneId",
    dimension: "owner",
    strength: "none",
    evidence: "services/geography/src/http/app.ts:scoped(GEO_SCOPES.zoneRead) getZone(deps,",
    note: "بياناتٌ مرجعيّةٌ عامّةٌ — لا مالكَ بطبيعتِها.",
  },
  {
    audience: "geography",
    method: "GET",
    path: "/geo/users/:waslaPublicId/location",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/geography/src/http/app.ts:asserted(GEO_SCOPES.locationRead) getUserLocation(deps,",
    note: "ADR-060 P2 (CLM-0474): G1 — `:waslaPublicId` compared against `endUser.publicId`; mismatch → 404 (GEO_USER_LOCATION_NOT_FOUND). Production default `off`.",
  },
  {
    audience: "geography",
    method: "PUT",
    path: "/geo/users/:waslaPublicId/location",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/geography/src/http/app.ts:asserted(GEO_SCOPES.locationWrite) setUserLocation(withTrace(request.id),",
    note: "ADR-060 P2 (CLM-0474): G2 — `:waslaPublicId` compared against `endUser.publicId`; mismatch → 404. Production default `off`.",
  },
  {
    audience: "geography",
    method: "GET",
    path: "/geo/users/:waslaPublicId/location/history",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/geography/src/http/app.ts:asserted(GEO_SCOPES.locationRead) getUserLocationHistory(deps,",
    note: "ADR-060 P2 (CLM-0474): G3 — `:waslaPublicId` compared against `endUser.publicId`; mismatch → 404. Production default `off`.",
  },
  {
    audience: "drivers",
    method: "POST",
    path: "/drivers/eligibility/tick",
    dimension: "owner",
    strength: "none",
    evidence: "services/drivers/src/http/app.ts:internalScoped(DRIVER_SCOPES.eligibilityTick) runExpiryTick(deps)",
    note: "نبضةٌ داخليّةٌ بلا جسمٍ تمرُّ على السائقينَ المستحقّينَ؛ لا مُنتَفِعَ بالتصميمِ (التعليقُ فوقَ `internalScoped`).",
  },
  {
    audience: "drivers",
    method: "GET",
    path: "/drivers",
    dimension: "owner",
    strength: "none",
    evidence: "services/drivers/src/http/app.ts:adminScoped(DRIVER_SCOPES.adminRead) deps.profiles.list(limit,",
    note: "قائمةٌ إداريّةٌ لكلِّ السائقينَ بقصدٍ (لوحةُ الإدارةِ)؛ لا مالكَ لقائمةٍ. والضبطُ هنا للدورِ وحدَهُ (`drivers:admin:read`).",
  },
  {
    audience: "customers",
    method: "GET",
    path: "/customers",
    dimension: "owner",
    strength: "none",
    evidence: "services/customers/src/http/app.ts:adminScoped(CUSTOMER_SCOPES.adminRead) deps.repo.listProfiles({",
    note: "قائمةٌ إداريّةٌ لكلِّ العملاءِ بقصدٍ؛ والضبطُ للدورِ وحدَهُ (`customers:admin:read`).",
  },
  {
    audience: "customers",
    method: "GET",
    path: "/customers/:id",
    dimension: "owner",
    strength: "none",
    evidence: "services/customers/src/http/app.ts:adminScoped(CUSTOMER_SCOPES.adminRead) deps.repo.findProfile(id)",
    note: "تفاصيلُ عميلٍ لأيِّ مُعرِّفٍ بقصدٍ إداريٍّ؛ لا مقارنةَ بمالكٍ لأنَّ القارئَ الإدارةُ لا العميلُ.",
  },
  {
    audience: "customers",
    method: "POST",
    path: "/customers/:id/suspend",
    dimension: "owner",
    strength: "none",
    evidence: "services/customers/src/http/app.ts:adminScoped(CUSTOMER_SCOPES.adminSuspend) suspensionReasonCode:",
    note: "تعليقُ أيِّ عميلٍ سلطةٌ إداريّةٌ؛ ربطُهُ بالمالكِ عكسُ السياسةِ (عميلٌ يُعلِّقُ نفسَهُ أو يمنعُ تعليقَهُ).",
  },
  {
    audience: "customers",
    method: "POST",
    path: "/customers/:id/reinstate",
    dimension: "owner",
    strength: "none",
    evidence: "services/customers/src/http/app.ts:adminScoped(CUSTOMER_SCOPES.adminReinstate) suspensionReasonCode:",
    note: "إعادةُ أيِّ عميلٍ سلطةٌ إداريّةٌ؛ ربطُهُ بالمالكِ عكسُ السياسةِ.",
  },
  // ── RISK-0042 الموجةُ 2 (CLM-0437 · 2026-10-02): 35 عمليّةً مقروءةً سطراً سطراً ──
  // negotiations 12 · matching 6 · reputation 8 · subscriptions 4 · marketplace 5.
  // CLM-0441 (ADR-060 P2 · 2026-10-03): 11 من 12 عمليّة مفاوضاتٍ ارتقتْ من `none` إلى `asserted` —
  // `/negotiations/tick` يبقى `none` (نبضةٌ نظاميّةٌ بلا مُنتَفِعٍ).
  {
    audience: "negotiations",
    method: "POST",
    path: "/negotiations",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:asserted(NEGOTIATIONS_SCOPES.threadWrite) assertOpenedBy(request, body.opened_by)",
    note: "CLM-0441: `asserted` — يفتحُ خيطاً بتأكيدِ مستخدمٍ (`beneficiary: \"asserted\"`)، ويُقارِنُ `opened_by` بـ`endUser.actorType`. التطابقُ 200، الخلافُ 404. في الوضعِ `off` (الإنتاج) لا تأكيدَ ولا مقارنةَ — السلوكُ كما كان.",
  },
  {
    audience: "negotiations",
    method: "GET",
    path: "/negotiations",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:asserted(NEGOTIATIONS_SCOPES.threadRead) assertListFilter(request, filter)",
    note: "CLM-0441: `asserted` — القائمةُ تُرشَّحُ بـ`order_public_id` أو `driver_public_id`، ويُتحقَّقُ أنَّ المُرشِّحَ يطابقُ `endUser` (العميلُ يُرشِّحُ بطلبِهِ، السائقُ بسائقِهِ).",
  },
  {
    audience: "negotiations",
    method: "POST",
    path: "/negotiations/tick",
    dimension: "owner",
    strength: "none",
    evidence: "services/negotiations/src/http/app.ts:scoped(NEGOTIATIONS_SCOPES.tickRun) runTick(deps)",
    note: "`none`: نبضةُ انتهاءِ الصلاحيّةِ بلا جسمٍ (`assertNoBody`) ولا مُنتَفِعٍ بالتصميمِ؛ مُنادِيها المُجدوِلُ لا إنسانٌ. يبقى `none` في CLM-0441.",
  },
  {
    audience: "negotiations",
    method: "GET",
    path: "/negotiations/:threadId",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:asserted(NEGOTIATIONS_SCOPES.threadRead) assertThreadMembership(request, view.thread)",
    note: "CLM-0441: `asserted` — قراءةُ خيطٍ بتأكيدِ مستخدمٍ؛ يُتحقَّقُ أنَّ `endUser` طرفٌ في الخيطِ (`customer_public_id` أو `driver_public_id`). الخلافُ 404.",
  },
  {
    audience: "negotiations",
    method: "POST",
    path: "/negotiations/:threadId/cancel",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:asserted(NEGOTIATIONS_SCOPES.threadWrite) assertThreadMembership(request, result.thread)",
    note: "CLM-0441: `asserted` — الإلغاءُ يتطلّبُ تأكيدَ مستخدمٍ طرفاً في الخيطِ. الخلافُ 404.",
  },
  {
    audience: "negotiations",
    method: "GET",
    path: "/negotiations/:threadId/rounds",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:asserted(NEGOTIATIONS_SCOPES.roundRead) assertThreadMembership(request, view.thread)",
    note: "CLM-0441: `asserted` — قراءةُ عروضِ الأسعارِ بتأكيدِ مستخدمٍ طرفاً في الخيطِ.",
  },
  {
    audience: "negotiations",
    method: "POST",
    path: "/negotiations/:threadId/rounds",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:assertedDriver(NEGOTIATIONS_SCOPES.roundWrite) assertProposedBy(request, body.proposed_by) assertThreadMembership(request, view.thread)",
    note: "CLM-0441: `asserted` — `proposed_by` يُقارَنُ بـ`endUser.actorType`، ويُتحقَّقُ عضويّةُ الخيطِ. الخلافُ 404.",
  },
  {
    audience: "negotiations",
    method: "POST",
    path: "/negotiations/:threadId/rounds/:roundNo/accept",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:assertedCustomer(NEGOTIATIONS_SCOPES.roundDecide) assertActingParty(request, body.acting_party) assertThreadMembership(request, view.thread)",
    note: "CLM-0441: `asserted` — `acting_party` يُقارَنُ بـ`endUser.actorType`، ويُتحقَّقُ عضويّةُ الخيطِ. القبولُ عن طرفٍ غيرِ المُؤكَّدِ → 404. أخطرُ الفجواتِ السابقةِ تُغلَقُ هنا.",
  },
  {
    audience: "negotiations",
    method: "POST",
    path: "/negotiations/:threadId/rounds/:roundNo/reject",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:assertedCustomer(NEGOTIATIONS_SCOPES.roundDecide) assertActingParty(request, body.acting_party) assertThreadMembership(request, view.thread)",
    note: "CLM-0441: `asserted` — `acting_party` يُقارَنُ بـ`endUser.actorType`، ويُتحقَّقُ عضويّةُ الخيطِ. الرفضُ عن طرفٍ غيرِ المُؤكَّدِ → 404.",
  },
  {
    audience: "negotiations",
    method: "GET",
    path: "/negotiations/:threadId/messages",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:asserted(NEGOTIATIONS_SCOPES.messageRead) assertThreadMembership(request, view.thread)",
    note: "CLM-0441: `asserted` — قراءةُ رسائلِ خيطٍ بتأكيدِ مستخدمٍ طرفاً فيه.",
  },
  {
    audience: "negotiations",
    method: "POST",
    path: "/negotiations/:threadId/messages",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:asserted(NEGOTIATIONS_SCOPES.messageWrite) assertAuthorRole(request, body.author_role) assertThreadMembership(request, view.thread)",
    note: "CLM-0441: `asserted` — `author_role` يُقارَنُ بـ`endUser.actorType`، ويُتحقَّقُ عضويّةُ الخيطِ. الانتحالُ يُغلَقُ.",
  },
  {
    audience: "negotiations",
    method: "GET",
    path: "/negotiations/:threadId/agreement",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/negotiations/src/http/app.ts:asserted(NEGOTIATIONS_SCOPES.agreementRead) assertThreadMembership(request, view.thread)",
    note: "CLM-0441: `asserted` — قراءةُ الاتّفاقِ بتأكيدِ مستخدمٍ طرفاً في الخيطِ.",
  },
  {
    audience: "matching",
    method: "POST",
    path: "/matching/candidates",
    dimension: "owner",
    strength: "none",
    evidence: "services/matching/src/http/app.ts:scoped(MATCHING_SCOPES.candidatesEvaluate) evaluateCandidates(deps,",
    note: "`none`: تقييمُ المرشَّحينَ عمليّةُ خدمةٍ (يكتبُ قرارَ تدقيقٍ)؛ المُدخَلُ استعلامٌ لا يحملُ مُنادياً، ولا مُنتَفِعَ إنسانٍ بالتصميمِ.",
  },
  {
    audience: "matching",
    method: "PUT",
    path: "/candidacy/:driverPublicId",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/matching/src/http/app.ts:assertedDriver(MATCHING_SCOPES.candidacyWrite) upsertCandidacy(deps, assertDriverOwnership(request, command.driverPublicId)",
    note: "CLM-0442: `asserted` — كتابةُ الترشُّحِ بتأكيدِ مستخدمٍ سائقًا مطابقًا للمسارِ. الافتراضيُّ الإنتاجيُّ `off`.",
  },
  {
    audience: "matching",
    method: "GET",
    path: "/candidacy/:driverPublicId",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/matching/src/http/app.ts:assertedDriver(MATCHING_SCOPES.candidacyRead) readCandidacy(deps, assertDriverOwnership(request, driverPublicId)",
    note: "CLM-0442: `asserted` — قراءةُ الترشُّحِ بتأكيدِ مستخدمٍ سائقًا مطابقًا للمسارِ. الافتراضيُّ الإنتاجيُّ `off`.",
  },
  {
    audience: "matching",
    method: "POST",
    path: "/candidacy/:driverPublicId/availability",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/matching/src/http/app.ts:assertedDriver(MATCHING_SCOPES.candidacyWrite) changeAvailability(deps, assertDriverOwnership(request, command.driverPublicId)",
    note: "CLM-0442: `asserted` — تغييرُ الإتاحةِ بتأكيدِ مستخدمٍ سائقًا مطابقًا للمسارِ. الافتراضيُّ الإنتاجيُّ `off`.",
  },
  {
    audience: "matching",
    method: "GET",
    path: "/matching/rulesets",
    dimension: "owner",
    strength: "none",
    evidence: "services/matching/src/http/app.ts:scoped(MATCHING_SCOPES.rulesetsRead) listRulesets(deps)",
    note: "`none`: مجموعاتُ القواعدِ بياناتٌ مرجعيّةٌ بلا مالكٍ بطبيعتِها؛ قرارُ تصميمٍ لا فجوةٌ.",
  },
  {
    audience: "matching",
    method: "GET",
    path: "/matching/decisions/:decisionId",
    dimension: "owner",
    strength: "none",
    evidence: "services/matching/src/http/app.ts:scoped(MATCHING_SCOPES.decisionsRead) readDecision(deps,",
    note: "`none`: قراءةُ قرارِ تدقيقٍ بمُعرِّفِهِ بلا فاعلٍ؛ قراءةٌ تدقيقيّةٌ للخدماتِ. يُذكَرُ أنَّ القرارَ يذكرُ سائقينَ — فالربطُ غيرُ مقيسِ الحاجةِ لا مقيسُ الانتفاءِ.",
  },
  {
    audience: "reputation",
    method: "POST",
    path: "/reputation/facts",
    dimension: "owner",
    strength: "none",
    evidence: "services/reputation/src/http/app.ts:internalScoped(REPUTATION_SCOPES.factWrite) recordFact(deps,",
    note: "`none`: تسجيلُ وقائعِ السمعةِ مسارٌ داخليٌّ (`internalScoped` بلا مُنتَفِعٍ — «مسارُ عمليّاتٍ داخليٌّ لا مُنتَفِعَ إنسانٍ له»)؛ الواقعةُ من خدمةٍ مصدرٍ لا من صاحبِها.",
  },
  {
    audience: "reputation",
    method: "GET",
    path: "/reputation/facts",
    dimension: "owner",
    strength: "none",
    evidence: "services/reputation/src/http/app.ts:internalScoped(REPUTATION_SCOPES.factRead) listFacts(deps,",
    note: "`none`: قراءةُ الوقائعِ بمُرشِّحِ استفهامٍ عبرَ `internalScoped` بلا مُنتَفِعٍ. داخليٌّ بالتصميمِ، ومُرشِّحُهُ يُسمّي شخصاً — فكلُّ حاملٍ يقرأُ وقائعَ أيِّ شخصٍ.",
  },
  {
    audience: "reputation",
    method: "POST",
    path: "/reputation/scores/:subjectType/:subjectPublicId/recompute",
    dimension: "owner",
    strength: "none",
    evidence: "services/reputation/src/http/app.ts:internalScoped(REPUTATION_SCOPES.scoreRecompute) recomputeScore(deps,",
    note: "`none`: إعادةُ حسابِ النتيجةِ بلا جسمٍ عبرَ `internalScoped`؛ عمليّةٌ تشغيليّةٌ لا يملكُها صاحبُ النتيجةِ، وقراءتُها (`GET` الشقيقُ) مربوطةٌ بـ`ownerScoped`.",
  },
  {
    audience: "reputation",
    method: "GET",
    path: "/reputation/ratings",
    dimension: "owner",
    strength: "none",
    evidence: "services/reputation/src/http/app.ts:internalScoped(REPUTATION_SCOPES.ratingRead) listRatings(deps,",
    note: "`none`: قائمةُ التقييماتِ بمُرشِّحِ استفهامٍ عبرَ `internalScoped` بلا مُنتَفِعٍ، والكتابةُ الشقيقةُ وحدَها مربوطةٌ (`raterPublicId !== beneficiary`). داخليٌّ بالتصميمِ.",
  },
  {
    audience: "reputation",
    method: "GET",
    path: "/reputation/fraud-signals",
    dimension: "owner",
    strength: "none",
    evidence: "services/reputation/src/http/app.ts:internalScoped(REPUTATION_SCOPES.fraudSignalRead) listFraudSignals(deps,",
    note: "`none`: إشاراتُ الاحتيالِ قراءةٌ تشغيليّةٌ داخليّةٌ؛ ربطُها بصاحبِها عكسُ غايتِها.",
  },
  {
    audience: "reputation",
    method: "GET",
    path: "/reputation/rulesets",
    dimension: "owner",
    strength: "none",
    evidence: "services/reputation/src/http/app.ts:internalScoped(REPUTATION_SCOPES.rulesetRead) listRulesets(deps)",
    note: "`none`: مجموعاتُ قواعدِ السمعةِ بياناتٌ مرجعيّةٌ بلا مالكٍ.",
  },
  {
    audience: "reputation",
    method: "GET",
    path: "/reputation/rulesets/:rulesetVersion",
    dimension: "owner",
    strength: "none",
    evidence: "services/reputation/src/http/app.ts:internalScoped(REPUTATION_SCOPES.rulesetRead) readRuleset(deps,",
    note: "`none`: قراءةُ نسخةِ قواعدَ بإصدارِها؛ مرجعيّةٌ بلا مالكٍ.",
  },
  {
    audience: "reputation",
    method: "POST",
    path: "/reputation/tick",
    dimension: "owner",
    strength: "none",
    evidence: "services/reputation/src/http/app.ts:internalScoped(REPUTATION_SCOPES.tickRun) runTick(deps,",
    note: "`none`: نبضةٌ بلا جسمٍ (`assertNoBody`) ولا مُنتَفِعٍ بالتصميمِ.",
  },
  {
    audience: "subscriptions",
    method: "GET",
    path: "/subscriptions/plans",
    dimension: "owner",
    strength: "none",
    evidence: "services/subscriptions/src/http/app.ts:internalScoped(SUBSCRIPTIONS_SCOPES.plansRead) listPlans(frozenOnly)",
    note: "`none`: كتالوجُ الخططِ مرجعيٌّ بلا مالكٍ.",
  },
  {
    audience: "subscriptions",
    method: "GET",
    path: "/subscriptions/plans/:planCode/:planVersion",
    dimension: "owner",
    strength: "none",
    evidence: "services/subscriptions/src/http/app.ts:internalScoped(SUBSCRIPTIONS_SCOPES.plansRead) getPlan(planCode,",
    note: "`none`: نسخةُ خطّةٍ بمفتاحِها؛ مرجعيّةٌ بلا مالكٍ.",
  },
  {
    audience: "subscriptions",
    method: "POST",
    path: "/subscriptions/tick",
    dimension: "owner",
    strength: "none",
    evidence: "services/subscriptions/src/http/app.ts:internalScoped(SUBSCRIPTIONS_SCOPES.tickRun) subscriptions.tick()",
    note: "`none`: نبضةٌ بلا حمولةٍ (`assertEmptyPayload`) ولا مُنتَفِعٍ بالتصميمِ.",
  },
  {
    audience: "subscriptions",
    method: "GET",
    path: "/referrals",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/subscriptions/src/http/app.ts:asserted(SUBSCRIPTIONS_SCOPES.referralsRead) referrals.list(filter)",
    note: "ADR-060 P2 (CLM-0476): U1 — filter referrerPublicId or refereePublicId must match endUser.publicId; mismatch → 404. Production default off.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/categories",
    dimension: "owner",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:scoped(MARKETPLACE_SCOPES.categoryRead) catalog.listCategories(",
    note: "`none`: التصنيفاتُ مرجعيّةٌ بلا مالكٍ.",
  },
  {
    audience: "marketplace",
    method: "POST",
    path: "/stores",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/marketplace/src/http/app.ts:assertedStaff(MARKETPLACE_SCOPES.storeWrite) assertStoreOwner(request, input.ownerPublicId, input.storeSlug)",
    note: "CLM-0443: `asserted` — تسجيلُ متجرٍ بتأكيدِ مستخدمٍ `store_staff`؛ `owner_public_id` في الجسمِ يجبُ أن يساويَ المستخدمَ المُتحقَّقَ منهُ، والخلافُ `STORE_NOT_FOUND` (404). الافتراضيُّ الإنتاجيُّ `off`.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/stores",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/marketplace/src/http/app.ts:assertedStaff(MARKETPLACE_SCOPES.storeRead) assertOwnerFilter(request, query.ownerPublicId)",
    note: "CLM-0443: `asserted` — مُرشِّحُ المالكِ مربوطٌ بالمستخدمِ المُتحقَّقِ منهُ، والخلافُ 404. القوائمُ بالحالةِ أو التصنيفِ وحدَهما قراءةُ كتالوجٍ بلا تغيير. الافتراضيُّ الإنتاجيُّ `off`.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/products/:productId",
    dimension: "tenant",
    strength: "none",
    evidence: "services/marketplace/src/http/app.ts:scoped(MARKETPLACE_SCOPES.productRead) products.getProduct(productId)",
    note: "`none`: قراءةُ منتجٍ بمُعرِّفِهِ وحدَهُ بلا مُستأجِرٍ ولا فاعلٍ؛ `getProduct` يُعيدُ الظهورَ دونَ ترشيحٍ بالمُنادي. قراءةُ كتالوجٍ — والحاجةُ إلى الربطِ غيرُ مقيسةٍ.",
  },
  {
    audience: "marketplace",
    method: "GET",
    path: "/products/:productId/inventory",
    dimension: "tenant",
    strength: "asserted",
    evidence: "services/marketplace/src/http/app.ts:assertedStaff(MARKETPLACE_SCOPES.inventoryRead) memberPublicId: request.endUser.publicId",
    note: "CLM-0443: `asserted` — قراءةُ المخزونِ تشترطُ أن يكونَ المستخدمُ المُتحقَّقُ منهُ مالكَ متجرِ المنتجِ أو عضواً نشِطاً فيهِ، وإلّا `PRODUCT_NOT_FOUND` (404). الافتراضيُّ الإنتاجيُّ `off`.",
  },
  // ADR-060 · CLM-0440: عمليّةٌ جديدةٌ تُصنَّفُ عندَ ولادتِها — فلا يرتفعُ غيرُ المُصنَّفِ (47).
  {
    audience: "identity",
    method: "POST",
    path: "/identity/assertions",
    dimension: "owner",
    strength: "none",
    evidence: "services/identity/src/use-cases/issue-user-assertion.ts:findUserByTelegramId ASSERTION_ACTOR_BY_CALLER",
    note: "`none`: حاملُ `identity:assertion:issue` (البوتاتُ الثلاثةُ وحدَها) يطلبُ تأكيداً لأيِّ `telegram_user_id` مربوطٍ — فلا ربطَ يُثبِتُهُ الرمزُ، والثقةُ في الحدِّ الذي تحقَّقَ من سرِّ webhook Telegram. ويُقيِّدُهُ مقروءاً: نوعُ الفاعلِ يُشتقُّ من المنادي (`ASSERTION_ACTOR_BY_CALLER`) والجمهورُ من قائمةٍ مغلقةٍ، والقراءةُ لا تُنشئُ مستخدماً. وهذا مصدرُ التأكيدِ لا مُستهلِكُهُ: المُستهلِكونَ يتحقّقونَ من توقيعِ Ed25519 في P2/P3 (ADR-060).",
  },
  // ── partners (CLM-0444 · RISK-0059) ────────────────────────────
  // ثماني عمليّاتٍ مُصنَّفةٌ `none` بقراءةِ الكودِ من app.ts:
  // health/ready مفتوحانِ بلا صلاحيّةٍ؛ والبقيّةُ مُصنَّفةٌ بصلاحيّةٍ بلا مُنتَفِعٍ.
  {
    audience: "partners",
    method: "POST",
    path: "/partners/credentials",
    dimension: "owner",
    strength: "none",
    evidence: "services/partners/src/http/app.ts:scoped(PARTNERS_SCOPES.credentialIssue) issueCredential(options.staffPort, options.credentialStore, options.auditStore,",
    note: "`none`: إصدارُ بياناتِ اعتمادٍ بـ`x-wasla-principal` من الترويسةِ بلا مقارنةٍ بمُنادٍ. قراريُّ تصميميٌّ: المنادي موقَّعٌ بصلاحيّةٍ، والمُنتَفِعُ (المتجرُ) يُؤكَّدُ داخلَ `issueCredential` من `staffPort`.",
  },
  {
    audience: "partners",
    method: "GET",
    path: "/partners/credentials",
    dimension: "owner",
    strength: "none",
    evidence: "services/partners/src/http/app.ts:scoped(PARTNERS_SCOPES.credentialRead) options.credentialStore.listByTenant(query.storeId)",
    note: "`none`: قائمةُ بياناتِ الاعتمادِ بمُعرِّفِ المتجرِ من الاستعلامِ بلا مقارنةٍ. قراريُّ تصميميٌّ: المنادي موقَّعٌ بصلاحيّةٍ.",
  },
  {
    audience: "partners",
    method: "DELETE",
    path: "/partners/credentials/:id",
    dimension: "owner",
    strength: "none",
    evidence: "services/partners/src/http/app.ts:scoped(PARTNERS_SCOPES.credentialRevoke) revokeCredential(options.staffPort, options.credentialStore, options.auditStore,",
    note: "`none`: إلغاءُ بياناتِ اعتمادٍ بـ`x-wasla-principal` من الترويسةِ. قراريُّ تصميميٌّ: المنادي موقَّعٌ بصلاحيّةٍ.",
  },
  {
    audience: "partners",
    method: "POST",
    path: "/partners/lifecycle/suspend",
    dimension: "owner",
    strength: "none",
    evidence: "services/partners/src/http/app.ts:scoped(PARTNERS_SCOPES.lifecycleSuspend) suspendTenant(options.lifecycleStore, options.auditStore,",
    note: "`none`: تعليقُ متجرٍ بـ`x-wasla-principal` من الترويسةِ. قراريُّ تصميميٌّ: المنادي موقَّعٌ بصلاحيّةٍ.",
  },
  {
    audience: "partners",
    method: "POST",
    path: "/partners/lifecycle/reinstate",
    dimension: "owner",
    strength: "none",
    evidence: "services/partners/src/http/app.ts:scoped(PARTNERS_SCOPES.lifecycleReinstate) reinstateTenant(options.lifecycleStore, options.auditStore,",
    note: "`none`: إعادةُ تفعيلِ متجرٍ بـ`x-wasla-principal` من الترويسةِ. قراريُّ تصميميٌّ: المنادي موقَّعٌ بصلاحيّةٍ.",
  },
  {
    audience: "partners",
    method: "GET",
    path: "/partners/lifecycle",
    dimension: "owner",
    strength: "none",
    evidence: "services/partners/src/http/app.ts:scoped(PARTNERS_SCOPES.lifecycleRead) options.lifecycleStore.get(query.storeId)",
    note: "`none`: قراءةُ حالةِ دورةِ حياةِ متجرٍ بمُعرِّفِهِ. قراريُّ تصميميٌّ: بياناتٌ تشغيليّةٌ بلا مُنتَفِعِ إنسانٍ.",
  },
  {
    audience: "partners",
    method: "GET",
    path: "/partners/audit",
    dimension: "owner",
    strength: "none",
    evidence: "services/partners/src/http/app.ts:scoped(PARTNERS_SCOPES.auditRead) options.auditStore.listByTenant(query.storeId, limit)",
    note: "`none`: قراءةُ سجلِّ التدقيقِ بمُعرِّفِ المتجرِ. قراريُّ تصميميٌّ: بياناتٌ تدقيقيّةٌ بلا مُنتَفِعِ إنسانٍ.",
  },
  {
    audience: "partners",
    method: "GET",
    path: "/partners/usage",
    dimension: "owner",
    strength: "none",
    evidence: "services/partners/src/http/app.ts:scoped(PARTNERS_SCOPES.usageRead) options.usageStore.get(query.storeId, windowStart)",
    note: "`none`: قراءةُ استخدامِ متجرٍ بمُعرِّفِهِ. قراريُّ تصميميٌّ: بياناتٌ تشغيليّةٌ بلا مُنتَفِعِ إنسانٍ.",
  },
  // ── RISK-0042 الموجةُ 3 (CLM-0461 · 2026-10-04) — الـ47 الباقيةُ، كلُّها مقروءةٌ ──
  //
  // القاعدةُ نفسُها: إعدادُ المسارِ (`scoped` · `internalScoped` · `adminScoped`) بلا
  // `beneficiary`، ومُدخَلُ حالةِ الاستعمالِ لا يحملُ هويّةَ مُنادٍ تُقارَنُ، فكلُّها `none`.
  // **«فجوةٌ مقيسةٌ»** حيثُ للمَورِدِ مالكٌ ولا مقارنةَ، و**«قرارُ تصميمٍ»** حيثُ لا مالكَ
  // بطبيعتِهِ أو السلطةُ إداريّةٌ/تشغيليّةٌ. تصنيفٌ لا إصلاحٌ.
  {
    audience: "channel",
    method: "POST",
    path: "/channel/messages",
    dimension: "owner",
    strength: "none",
    evidence: "packages/bot-runtime/src/http/app.ts:scoped(CHANNEL_SCOPES.messageSend) sendMessage(deps.outbound,",
    note: "`none`: قرارُ تصميمٍ: خدمةٌ تُرسِلُ رسالةً عبرَ البوتِ؛ المُستلِمُ في الجسمِ و`sendMessage` لا يتلقّى فاعلاً. المُنادي خدمةٌ لا إنسانٌ.",
  },
  {
    audience: "channel",
    method: "GET",
    path: "/channel/:bot/mini-app",
    dimension: "owner",
    strength: "none",
    evidence: "packages/bot-runtime/src/http/app.ts:scoped(CHANNEL_SCOPES.miniAppRead) rawBot",
    note: "`none`: قرارُ تصميمٍ: وصفُ التطبيقِ المُصغَّرِ للبوتِ من الإعدادِ المحقونِ؛ لا مَورِدَ لمستخدمٍ.",
  },
  {
    audience: "channel",
    method: "POST",
    path: "/channel/:bot/deep-links",
    dimension: "owner",
    strength: "none",
    evidence: "packages/bot-runtime/src/http/app.ts:scoped(CHANNEL_SCOPES.deepLinkCreate) readDeepLinkRequest(request.body)",
    note: "`none`: قرارُ تصميمٍ: بناءُ رابطٍ عميقٍ من `action`/`params` بلا هويّةِ مُنادٍ؛ لا يُقرأُ ولا يُكتَبُ مَورِدُ مستخدمٍ.",
  },
  {
    audience: "delivery",
    method: "POST",
    path: "/store-orders",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/delivery/src/http/app.ts:asserted(DELIVERY_SCOPES.storeOrderWrite) placeStoreOrder(",
    note: "ADR-060 P2 (CLM-0474): D1 — `customer_ref` from body compared against `endUser.publicId`; mismatch → 404 (DELIVERY_ORDER_NOT_FOUND). Production default `off`.",
  },
  {
    audience: "delivery",
    method: "GET",
    path: "/store-orders/:orderPublicId",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/delivery/src/http/app.ts:asserted(DELIVERY_SCOPES.storeOrderRead) deps.readPort.getOrderByPublicId(publicId)",
    note: "ADR-060 P2 (CLM-0475): D2 — order loaded, `order.customerRef` compared against `endUser.publicId`; mismatch → 404 (DELIVERY_ORDER_NOT_FOUND). Production default `off`.",
  },
  {
    audience: "delivery",
    method: "POST",
    path: "/store-orders/:orderPublicId/cancellation",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/delivery/src/http/app.ts:asserted(DELIVERY_SCOPES.storeOrderCancel) cancelStoreOrder(",
    note: "ADR-060 P2 (CLM-0474): D3 — order loaded, `order.customerRef` compared against `endUser.publicId`; mismatch → 404. Production default `off`.",
  },
  {
    audience: "delivery",
    method: "PUT",
    path: "/store-orders/:orderPublicId/payment-mirror",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.paymentMirrorWrite) mirrorPayment(",
    note: "`none`: قرارُ تصميمٍ: مرآةُ حالةِ الدفعِ يكتبُها مُزوِّدُ الدفعِ/خدمةٌ؛ لا مُنتَفِعَ إنسانٌ في المُنادي.",
  },
  {
    audience: "delivery",
    method: "POST",
    path: "/store-orders/:orderPublicId/confirmation",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.storeOrderConfirm) confirmStoreOrder(",
    note: "`none`: **فجوةٌ مقيسةٌ:** تأكيدُ المتجرِ للطلبِ بمُعرِّفِهِ وحدَهُ؛ لا مقارنةَ بالمتجرِ صاحبِ الطلبِ.",
  },
  {
    audience: "delivery",
    method: "POST",
    path: "/store-orders/:orderPublicId/fulfillment-transition",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.fulfillmentTransition) parseFulfillmentTransitionBody(request.body)",
    note: "`none`: **فجوةٌ مقيسةٌ:** انتقالُ التنفيذِ بمُعرِّفِ الطلبِ وجسمٍ؛ لا مقارنةَ بالمتجرِ ولا بالسائقِ.",
  },
  {
    audience: "delivery",
    method: "GET",
    path: "/store-orders/:orderPublicId/delivery-task",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/delivery/src/http/app.ts:assertedActors DELIVERY_SCOPES.deliveryTaskRead deps.readPort.getTaskByOrderPublicId(",
    note: "ADR-060 P2 (CLM-0475): D6 — actor-aware: customer → `order.customerRef`, driver → `task.courierRef`; mismatch → 404. Production default `off`.",
  },
  {
    audience: "delivery",
    method: "POST",
    path: "/delivery/idempotency-keys/sweep",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.idempotencySweep) sweepExpiredIdempotencyKeys(",
    note: "`none`: قرارُ تصميمٍ: كنسٌ تشغيليٌّ لمفاتيحِ التكرارِ المنتهيةِ؛ لا مَورِدَ لمستخدمٍ.",
  },
  {
    audience: "delivery",
    method: "GET",
    path: "/delivery/inventory-conflicts",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.inventoryConflictsRead) deps.inventoryConflictReadPort.listInventoryConflicts(",
    note: "`none`: قرارُ تصميمٍ: قائمةُ تعارضاتِ المخزونِ للتشغيلِ؛ لا مُنتَفِعَ إنسانٌ.",
  },
  {
    audience: "delivery",
    method: "POST",
    path: "/delivery/inventory-conflicts/:adjustmentId/acknowledgement",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.inventoryConflictAcknowledge) acknowledgeInventoryConflict(",
    note: "`none`: قرارُ تصميمٍ: إقرارُ المشغِّلِ بتعارضٍ؛ مسارُ تشغيلٍ.",
  },
  {
    audience: "delivery",
    method: "GET",
    path: "/delivery/relay/dead-letters",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.relayDeadLettersRead) deps.relayDeadLetterReadPort.readRelayDeadLetters(",
    note: "`none`: قرارُ تصميمٍ: قياسُ دفترِ المسمومِ في المُرحِّلِ؛ مسارُ تشغيلٍ.",
  },
  {
    audience: "delivery",
    method: "POST",
    path: "/delivery/relay/dead-letters/:ledger/:eventId/requeue",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.relayDeadLettersRequeue) deps.relayRequeuePort.requeuePoisonedEvent(",
    note: "`none`: قرارُ تصميمٍ: إعادةُ حدثٍ مسمومٍ إلى الطابورِ؛ مسارُ تشغيلٍ.",
  },
  {
    audience: "delivery",
    method: "POST",
    path: "/delivery/relay/dead-letters/:ledger/:eventId/acknowledge",
    dimension: "owner",
    strength: "none",
    evidence: "services/delivery/src/http/app.ts:scoped(DELIVERY_SCOPES.relayDeadLettersAcknowledge) relayDeadLetterAcknowledgementPort.acknowledgePoisonedEvent(",
    note: "`none`: قرارُ تصميمٍ: إقرارٌ بحدثٍ مسمومٍ؛ مسارُ تشغيلٍ.",
  },
  {
    audience: "identity",
    method: "POST",
    path: "/identity/resolve",
    dimension: "owner",
    strength: "none",
    evidence: "services/identity/src/http/app.ts:scoped(IDENTITY_SCOPES.resolveWrite) resolveTelegramIdentity(deps,",
    note: "`none`: قرارُ تصميمٍ: الحلُّ هوَ مصدرُ الهويّةِ: البوتُ يُرسِلُ هويّةَ Telegram ليحصلَ على المُعرِّفِ العامِّ؛ لا مُعرِّفَ سابقٌ يُقارَنُ.",
  },
  {
    audience: "identity",
    method: "GET",
    path: "/identity/users/:waslaPublicId",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/identity/src/http/app.ts:asserted(IDENTITY_SCOPES.userRead) assertWaslaPublicId(request, waslaPublicId) getUser({",
    note: "`asserted` (CLM-0463): قراءةُ مستخدمٍ تطلُبُ تأكيدَ مستخدمٍ صالحاً، ويُقارَنُ `:waslaPublicId` بـ`sub`. عدمُ التطابقِ → 404 (IDENTITY_NOT_FOUND) لا 403 (ADR-060 §2.6). كانَ `none` قبلَ CLM-0463.",
  },
  {
    audience: "identity",
    method: "POST",
    path: "/identity/users/:waslaPublicId/links",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/identity/src/http/app.ts:asserted(IDENTITY_SCOPES.linkWrite) assertWaslaPublicId(request, waslaPublicId) addIdentityLink(deps,",
    note: "`asserted` (CLM-0462): إضافةُ ربطِ هويّةٍ تطلُبُ تأكيدَ مستخدمٍ صالحاً، ويُقارَنُ `:waslaPublicId` من المسارِ بـ`sub` في التأكيد. عدمُ التطابقِ يُرفَضُ بـ404 (IDENTITY_NOT_FOUND) لا 403 (ADR-060 §2.6). كانَ `none` قبلَ CLM-0462 — أعلى فجواتِ الموجةِ أثراً (استيلاءٌ على حسابٍ إن اختُرِقَ مُنادٍ).",
  },
  {
    audience: "identity",
    method: "POST",
    path: "/identity/users/:waslaPublicId/recovery",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/identity/src/http/app.ts:asserted(IDENTITY_SCOPES.recoveryWrite) assertWaslaPublicId(request, waslaPublicId) startRecovery(deps,",
    note: "`asserted` (CLM-0463): بدءُ استعادةٍ يطلُبُ تأكيدَ مستخدمٍ صالحاً، ويُقارَنُ `:waslaPublicId` بـ`sub`. عدمُ التطابقِ → 404 (IDENTITY_NOT_FOUND) لا 403 (ADR-060 §2.6). كانَ `none` قبلَ CLM-0463.",
  },
  {
    audience: "identity",
    method: "GET",
    path: "/identity/users/:waslaPublicId/history",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/identity/src/http/app.ts:asserted(IDENTITY_SCOPES.historyRead) assertWaslaPublicId(request, waslaPublicId) getIdentityHistory({",
    note: "`asserted` (CLM-0463): قراءةُ سجلِّ هويّةٍ تطلُبُ تأكيدَ مستخدمٍ صالحاً، ويُقارَنُ `:waslaPublicId` بـ`sub`. عدمُ التطابقِ → 404 (IDENTITY_NOT_FOUND) لا 403 (ADR-060 §2.6). كانَ `none` قبلَ CLM-0463.",
  },
  {
    audience: "orders",
    method: "POST",
    path: "/orders/intake",
    dimension: "owner",
    strength: "token-bound",
    evidence: "services/orders/src/http/app.ts:ownerScoped(ORDER_SCOPES.intakeWrite) caller.onBehalfOfPublicId command.customerPublicId",
    note: "`token-bound` (CLM-0464): `beneficiary: required` on the route; handler compares body `customer_public_id` with signed `obo` (`principal.onBehalfOfPublicId`). The `customers` service passes `onBehalfOfPublicId` in the signed request. Mismatch → 404.",
  },
  {
    audience: "orders",
    method: "POST",
    path: "/orders/agreed-prices",
    dimension: "owner",
    strength: "none",
    evidence: "services/orders/src/http/app.ts:scoped(ORDER_SCOPES.agreedPriceWrite) toAgreedPriceRecord(request.body,",
    note: "`none`: قرارُ تصميمٍ: سجلُّ السعرِ المتّفقِ يكتبُهُ حدُّ التفاوضِ؛ لا مُنتَفِعَ إنسانٌ في المُنادي.",
  },
  {
    audience: "orders",
    method: "POST",
    path: "/orders/:orderId/transitions",
    dimension: "owner",
    strength: "none",
    evidence: "services/orders/src/http/app.ts:scoped(ORDER_SCOPES.transitionWrite) transitionCaller?.onBehalfOfPublicId",
    note: "`none`: قرارُ تصميمٍ بعدَ CLM-0465: الفاعلُ غيرُ `system` (`customer`/`driver`/`partner`/`admin`) يُقارَنُ `actor_ref` فيهِ بـ`obo` الموقَّعِ في الرمزِ، وغيابُهُ أو اختلافُهُ ⇒ 404؛ فلا ينقلُ حاملُ الصلاحيّةِ طلباً باسمِ إنسانٍ لا يحملُ رمزُهُ اسمَهُ. والباقي سلطةُ نظامٍ: `system` بلا مُعرِّفٍ بالعقدِ، والصلاحيّةُ ممنوحةٌ لحدِّ التوزيعِ وحدَهُ؛ فمَن حملَها ينقلُ أيَّ طلبٍ بصفةِ النظامِ ضمنَ جدولِ الانتقالاتِ — مقبولٌ مكتوباً لا مُغفَلٌ. ولا يُربَطُ `actor_ref` بمالكِ الطلبِ في هذهِ الدفعةِ.",
  },
  {
    audience: "orders",
    method: "POST",
    path: "/orders/:orderId/assignments",
    dimension: "owner",
    strength: "none",
    evidence: "services/orders/src/http/app.ts:scoped(ORDER_SCOPES.assignmentWrite) toAssignmentDriver(request.body,",
    note: "`none` (CLM-0468): قرارُ تصميمٍ: الإسنادُ (`POST`) عمليةٌ نظاميّةٌ — النبضةُ تنشئُ الإسنادَ قبلَ قبولِ السائقِ، فلا تأكيدَ مستخدمٍ عندَ الإنشاءِ. والسائقُ يُتحقَّقُ منهُ عندَ القبول/الرفضِ (CLM-0466) ويُربَطُ بالإسنادِ عندَ الحسمِ (PATCH، CLM-0468).",
  },
  {
    audience: "orders",
    method: "PATCH",
    path: "/orders/:orderId/assignments/:assignmentId",
    dimension: "owner",
    strength: "none",
    evidence: "services/orders/src/http/app.ts:scoped(ORDER_SCOPES.assignmentWrite) toAssignmentResolution(request.body, expectedDriverPublicId from assignmentCaller?.onBehalfOfPublicId",
    note: "`none` (CLM-0468): حسمُ الإسنادِ صار مربوطاً بـ`obo` — السائقُ المسجَّلُ على الإسنادِ يُقارَنُ بـ`expectedDriverPublicId` من الرمزِ الموقَّعِ داخلَ معاملةِ الكتابةِ نفسِها. الخلافُ ⇒ 404. والمنادي الوحيدُ بـ`obo` هو قبولُ/رفضُ العرضِ في حدِّ التوزيعِ (CLM-0466). والمنادي النظاميُّ (النبضةُ، إلغاءُ المهمّةِ) لا يحملُ `obo` فيتخطَّى الفحصَ. والإسنادُ (`POST`) يبقى `none` بقرارٍ: عمليةٌ نظاميّةٌ (النبضةُ تنشئُ الإسنادَ قبلَ قبولِ السائقِ).",
  },
  {
    audience: "search",
    method: "GET",
    path: "/search/ready",
    dimension: "owner",
    strength: "none",
    evidence: "services/search/src/http/app.ts:internalScoped(SEARCH_SCOPES.readyRead) deps.indexHealthPort.probe()",
    note: "`none`: قرارُ تصميمٍ: جاهزيّةُ الفهرسِ؛ مسارُ تشغيلٍ.",
  },
  {
    audience: "search",
    method: "GET",
    path: "/search/products",
    dimension: "owner",
    strength: "none",
    evidence: "services/search/src/http/app.ts:internalScoped(SEARCH_SCOPES.productsRead) deps.searchReadPort.search(",
    note: "`none`: قرارُ تصميمٍ: بحثٌ في الكتالوجِ العامِّ؛ لا مَورِدَ لمستخدمٍ.",
  },
  {
    audience: "search",
    method: "GET",
    path: "/search/relay/dead-letters",
    dimension: "owner",
    strength: "none",
    evidence: "services/search/src/http/app.ts:internalScoped(SEARCH_SCOPES.relayDeadLettersRead) deps.deadLetterReadPort.readSearchDeadLetters(",
    note: "`none`: قرارُ تصميمٍ: قياسُ دفترِ المسمومِ؛ مسارُ تشغيلٍ.",
  },
  {
    audience: "search",
    method: "POST",
    path: "/search/relay/dead-letters/:ledger/:outboxId/requeue",
    dimension: "owner",
    strength: "none",
    evidence: "services/search/src/http/app.ts:internalScoped(SEARCH_SCOPES.relayDeadLettersRequeue) deps.relayRequeuePort.requeuePoisonedEvent(",
    note: "`none`: قرارُ تصميمٍ: إعادةُ حدثٍ مسمومٍ؛ مسارُ تشغيلٍ.",
  },
  {
    audience: "search",
    method: "POST",
    path: "/search/relay/dead-letters/:ledger/:outboxId/acknowledgement",
    dimension: "owner",
    strength: "none",
    evidence: "services/search/src/http/app.ts:internalScoped(SEARCH_SCOPES.relayDeadLettersAcknowledge) relayAcknowledgementPort.acknowledgePoisonedEvent(",
    note: "`none`: قرارُ تصميمٍ: إقرارٌ بحدثٍ مسمومٍ؛ مسارُ تشغيلٍ.",
  },
  {
    audience: "audit",
    method: "POST",
    path: "/audit/events",
    dimension: "owner",
    strength: "none",
    evidence: "services/audit/src/http/app.ts:adminScoped(AUDIT_SCOPES.write) request.serviceCaller options.deps.repo.append({",
    note: "ADR-063 PO-002 (CLM-0477): `actor_id`/`actor_role` removed from request body and derived from the verified service token (`obo` → `actorId`, `serviceName` → `actorRole`). Gap closed: callers can no longer impersonate arbitrary actors. `adminScoped` stays — audit is an admin-only operation, not an end-user resource.",
  },
  {
    audience: "audit",
    method: "GET",
    path: "/audit/events",
    dimension: "owner",
    strength: "none",
    evidence: "services/audit/src/http/app.ts:adminScoped(AUDIT_SCOPES.read) options.deps.repo.list({",
    note: "`none`: قرارُ تصميمٍ: قراءةُ سجلِّ التدقيقِ سلطةٌ إداريّةٌ؛ ربطُها بالمالكِ عكسُ السياسةِ.",
  },
  {
    audience: "support",
    method: "POST",
    path: "/support/tickets",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/support/src/http/app.ts:asserted(SUPPORT_SCOPES.ticketWrite) deps.store.createTicket(",
    note: "ADR-060 P2 (CLM-0475): S1 — `reporter_public_id` from body compared against `endUser.publicId`; mismatch → 404 (SUPPORT_TICKET_NOT_FOUND). Production default `off`.",
  },
  {
    audience: "support",
    method: "GET",
    path: "/support/tickets",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/support/src/http/app.ts:asserted(SUPPORT_SCOPES.ticketRead) deps.store.listTickets({ reporterPublicId:",
    note: "ADR-060 P2 (CLM-0475): S2 — list filtered by `reporter_public_id` = `endUser.publicId`; returns empty if none. Production default `off`.",
  },
  {
    audience: "support",
    method: "GET",
    path: "/support/tickets/:ticketId",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/support/src/http/app.ts:asserted(SUPPORT_SCOPES.ticketRead) deps.store.getTicket(ticketId)",
    note: "ADR-060 P2 (CLM-0475): S3 — ticket loaded, `ticket.reporter_public_id` compared against `endUser.publicId`; mismatch → 404 (SUPPORT_TICKET_NOT_FOUND). Production default `off`.",
  },
  {
    audience: "support",
    method: "POST",
    path: "/support/tickets/:ticketId/evidence",
    dimension: "owner",
    strength: "asserted",
    evidence: "services/support/src/http/app.ts:asserted(SUPPORT_SCOPES.evidenceWrite) deps.store.attachEvidence(",
    note: "ADR-060 P2 (CLM-0475): S4 — ticket loaded, `ticket.reporter_public_id` compared against `endUser.publicId`; mismatch → 404 (SUPPORT_TICKET_NOT_FOUND). Production default `off`.",
  },
  {
    audience: "support",
    method: "POST",
    path: "/support/tickets/:ticketId/escalate",
    dimension: "owner",
    strength: "none",
    evidence: "services/support/src/http/app.ts:/support/tickets/:ticketId/escalate deps.store.updateState(",
    note: "`none`: قرارُ تصميمٍ: تصعيدُ تذكرةٍ قرارُ فريقِ الدعمِ؛ سلطةٌ تشغيليّةٌ.",
  },
  {
    audience: "support",
    method: "POST",
    path: "/support/tickets/:ticketId/resolve",
    dimension: "owner",
    strength: "none",
    evidence: "services/support/src/http/app.ts:/support/tickets/:ticketId/resolve deps.store.resolve(",
    note: "`none`: قرارُ تصميمٍ: حسمُ تذكرةٍ قرارُ فريقِ الدعمِ.",
  },
  {
    audience: "support",
    method: "POST",
    path: "/support/tickets/:ticketId/close",
    dimension: "owner",
    strength: "none",
    evidence: "services/support/src/http/app.ts:/support/tickets/:ticketId/close deps.store.updateState(",
    note: "`none`: قرارُ تصميمٍ: إغلاقُ تذكرةٍ قرارُ فريقِ الدعمِ.",
  },
  {
    audience: "billing",
    method: "POST",
    path: "/billing/invoices",
    dimension: "tenant",
    strength: "none",
    evidence: "services/billing/src/http/app.ts:internalScoped(BILLING_SCOPES.invoiceWrite) createInvoice({",
    note: "`none`: قرارُ تصميمٍ: إنشاءُ فاتورةٍ لمتجرٍ (`store_public_id` من الجسمِ) سلطةُ الفوترةِ الداخليّةُ؛ لا مُنادٍ من المتجرِ في المستودعِ.",
  },
  {
    audience: "billing",
    method: "GET",
    path: "/billing/invoices",
    dimension: "tenant",
    strength: "none",
    evidence: "services/billing/src/http/app.ts:internalScoped(BILLING_SCOPES.invoiceRead) deps.store.findByStore(",
    note: "`none`: **فجوةٌ مقيسةٌ:** كامنةٌ: `store_public_id` من الاستعلامِ ولا يُقارَنُ بمستأجرٍ؛ لا مُنادٍ من المتجرِ اليومَ، فإن عُرِضَتْ للمتجرِ لزمَ الربطُ.",
  },
  {
    audience: "billing",
    method: "GET",
    path: "/billing/invoices/:id",
    dimension: "tenant",
    strength: "none",
    evidence: "services/billing/src/http/app.ts:internalScoped(BILLING_SCOPES.invoiceRead) deps.store.findById(id)",
    note: "`none`: **فجوةٌ مقيسةٌ:** كامنةٌ: قراءةُ فاتورةٍ بمُعرِّفِها بلا مستأجرٍ.",
  },
  {
    audience: "billing",
    method: "POST",
    path: "/billing/invoices/:id/issue",
    dimension: "tenant",
    strength: "none",
    evidence: "services/billing/src/http/app.ts:/billing/invoices/:id/issue deps.store.save(",
    note: "`none`: قرارُ تصميمٍ: إصدارُ فاتورةٍ سلطةُ الفوترةِ.",
  },
  {
    audience: "billing",
    method: "POST",
    path: "/billing/invoices/:id/payment",
    dimension: "tenant",
    strength: "none",
    evidence: "services/billing/src/http/app.ts:/billing/invoices/:id/payment deps.store.save(",
    note: "`none`: قرارُ تصميمٍ: تسجيلُ دفعٍ سلطةُ الفوترةِ.",
  },
  {
    audience: "billing",
    method: "POST",
    path: "/billing/invoices/:id/void",
    dimension: "tenant",
    strength: "none",
    evidence: "services/billing/src/http/app.ts:/billing/invoices/:id/void deps.store.save(",
    note: "`none`: قرارُ تصميمٍ: إبطالُ فاتورةٍ سلطةُ الفوترةِ.",
  },
  {
    audience: "billing",
    method: "GET",
    path: "/billing/settlements",
    dimension: "tenant",
    strength: "none",
    evidence: "services/billing/src/http/app.ts:internalScoped(BILLING_SCOPES.invoiceRead) deps.settlements.listSettlements(",
    note: "`none`: قرارُ تصميمٍ: قائمةُ التسوياتِ بالحالةِ للتشغيلِ؛ لا مستأجرَ في الاستعلامِ.",
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
