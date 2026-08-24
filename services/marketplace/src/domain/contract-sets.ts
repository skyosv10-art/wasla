/**
 * مجموعاتُ العقدِ: بابٌ واحدٌ للقوائمِ والحدودِ الآتيةِ من `@wasla/contracts-marketplace`.
 *
 * لا قائمةَ أعضاءٍ تُعاد كتابتُها هنا بحال. الملفُّ **يُصدّر ما في العقدِ ويشتقُّ منه أنواعاً**
 * فقط، وهذا هو الفرقُ بين حقيقةٍ واحدةٍ ونسختَين تتباعدان: لو نُسخت `STORE_STATES` في الخدمةِ
 * لبقيت الحزمتان متّفقتَين يوماً واحداً — يومَ الكتابة — ثمّ يُضيف أحدُهم حالةً في العقدِ
 * فيمرّ `typecheck` بسلامٍ لأنّ الخدمةَ تقرأ نسختَها، ويظهر الخللُ في الإنتاجِ سطراً في
 * الدفترِ لا يعرف المجالُ كيف يقرأه.
 *
 * والقاعدةُ نفسُها هي سببُ غيابِ جدولِ انتقالٍ هنا: `STORE_ALLOWED_TRANSITIONS` و
 * `PRODUCT_ALLOWED_TRANSITIONS` تُقرأان من العقدِ في `transitions.ts` كما هما. جدولٌ ثانٍ في
 * الخدمةِ يعني أنّ سؤالَ «هل يجوز `suspended → archived`؟» له جوابان في المستودعِ نفسِه،
 * ويقرّر ترتيبُ الاستيرادِ — لا القاعدةُ — أيُّهما يُطبَّق.
 *
 * ## لماذا بابٌ واحدٌ لا استيرادٌ مباشرٌ في كلّ ملف
 *
 * لأنّ حدَّ الاعتمادِ يصير مرئياً في مكانٍ واحد: من أراد أن يعرف ماذا تأخذ خدمةُ السوقِ من
 * حزمةِ العقدِ يقرأ هذا الملفَّ وحده، ومن أراد أن يُضيف اعتماداً يمرّ من هنا فيُسأل عنه في
 * المراجعة. والنسخةُ الخاطئةُ الأرخص: `import ... from "@wasla/contracts-marketplace"` في
 * ثلاثةَ عشرَ ملفاً، فيصير كلُّ ملفٍ باباً خلفياً ولا أحدَ يعرف السطحَ المُستعمَل حقّاً.
 */

export {
  CATEGORY_MAX_DEPTH,
  CATEGORY_SLUG_PATTERN,
  INVENTORY_DELTA_ABS_MAX,
  INVENTORY_REASON_CODES,
  MARKETPLACE_CURRENCY_CODE,
  MARKETPLACE_ERROR_CLASS_STATUS,
  MARKETPLACE_ERROR_CODE_CLASS,
  MARKETPLACE_ERROR_CODES,
  MARKETPLACE_SERVICE_PORT,
  PRICE_MINOR_UNITS_MAX,
  PRICE_MINOR_UNITS_MIN,
  PRODUCT_ACTOR_TYPES,
  PRODUCT_ALLOWED_TRANSITIONS,
  PRODUCT_DECISIONS,
  PRODUCT_MODERATION_STATES,
  PRODUCT_REASON_CODES,
  PRODUCT_SKU_PATTERN,
  PRODUCT_STATES,
  RESERVED_STORE_SLUGS,
  STORE_ACTIVE_LIMIT_PER_OWNER,
  STORE_ACTOR_TYPES,
  STORE_ALLOWED_TRANSITIONS,
  STORE_DECISIONS,
  STORE_REASON_CODES,
  STORE_SLUG_PATTERN,
  STORE_STAFF_ROLES,
  STORE_STATES,
  WASLA_PUBLIC_ID_PATTERN,
  buildProductDeepLinkPayload,
  buildStoreDeepLinkPayload,
  httpStatusForMarketplaceError,
  isProductVisible,
} from "@wasla/contracts-marketplace";

export type {
  ErrorResponse,
  InventoryReasonCode,
  MarketplaceErrorClass,
  MarketplaceErrorCode,
  ProductActorType,
  ProductDecision,
  ProductModerationState,
  ProductReasonCode,
  ProductState,
  StoreActorType,
  StoreDecision,
  StoreReasonCode,
  StoreStaffRole,
  StoreState,
} from "@wasla/contracts-marketplace";
