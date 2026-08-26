/**
 * حرّاسُ المُعرّفاتِ والنصوص: صيغةٌ واحدةٌ تُفحَص في المجالِ لا في كلّ مُتحكِّم.
 *
 * الصيغُ كلُّها مقروءةٌ من `@wasla/contracts-marketplace` (لا نسخةَ ثانيةَ منها هنا)، وهذا
 * الملفُّ يحوّلها من **تعبيرٍ نمطيٍّ** إلى **حارسٍ يرمي رمزَ العقد**. لماذا الفصل؟ لأنّ
 * التعبيرَ يقول «لا يطابق» ولا يقول أيَّ حقلٍ ولا ما المتوقَّع، وأوّلُ من ينسى تحويلَ ذلك إلى
 * رمزٍ يُعيد للمستهلكِ 500 على مدخلٍ خاطئ.
 *
 * ## لماذا `slug` تُقاس على صورتها الصغيرةِ
 *
 * الفهرسُ الفريدُ في المخطّط `ux_stores_slug_lower ON stores (LOWER(slug))`: التفرّدُ **بلا
 * حساسيّةِ حالةٍ**. فلو قَبِل المجالُ `MyStore` كما هي لصار في السوقِ متجران يختلفان في حرفٍ
 * كبيرٍ ويقعان على نفسِ الرابطِ ثمّ يسقط الثاني في القاعدةِ بخطأِ فهرسٍ لا يفهمه صاحبُه.
 * والحلُّ: `slug` تُقبَل صغيرةً فقط — لا تُحوَّل صامتةً. تحويلٌ صامتٌ يجعل صاحبَ المتجرِ يطلب
 * `Riyadh-Sweets` ويرى في الرابطِ شيئاً لم يكتبه، فيظنّ أنّ طلبَه ضاع.
 *
 * ## لماذا اللاحقاتُ المحجوزةُ تُفحَص هنا لا في القاعدة
 *
 * لأنّها قائمةٌ مُعلَنةٌ في العقدِ لا صفوفٌ في جدول. قيدٌ في القاعدةِ يعني مُهاجرةً لكلّ كلمةٍ
 * تُضاف، وقائمةٌ في العقدِ تُقرأ من الخدمةِ ومن لوحةِ الإدارةِ ومن أيّ مستهلكٍ يريد أن يُعرض
 * الحجزَ للمستخدمِ **قبل** أن يُرسل الطلب.
 */

import {
  CATEGORY_SLUG_PATTERN,
  PRODUCT_SKU_PATTERN,
  RESERVED_STORE_SLUGS,
  STORE_SLUG_PATTERN,
  WASLA_PUBLIC_ID_PATTERN,
} from "./contract-sets.js";
import { STORE_SLUG_FIELD, storeSlugReserved, validationFailed } from "./errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** حدودُ الطولِ كما في قيودِ `CHECK` في المخطّط؛ مُعادةٌ رقماً لأنّ المخطّطَ ليس مُستورَداً. */
export const STORE_TITLE_MIN_LENGTH = 2;
export const STORE_TITLE_MAX_LENGTH = 80;
export const PRODUCT_TITLE_MIN_LENGTH = 2;
export const PRODUCT_TITLE_MAX_LENGTH = 120;
export const STORE_DESCRIPTION_MAX_LENGTH = 2000;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 4000;

/**
 * المُعرّفُ العلنيُّ `WS-##########`: مُعرّفٌ **مُعتِمٌ** لا مفتاحٌ أجنبيٌّ (القرار 6).
 *
 * السوقُ لا يعرف من صاحبُ المتجرِ إنساناً، ولا يقرأ جدولَ هويّةٍ، ولا يملك حقَّ منعِ شخص.
 * كلُّ ما يملكه: نصٌّ بهذه الصيغةِ يُكتَب في الدفترِ ليُقال لاحقاً «مَن فعل». ولو كان مفتاحاً
 * أجنبياً لصار كلُّ حذفِ حسابٍ في حدِّ الهويّةِ إمّا كسراً للسِّجلِّ أو إبقاءً لصفٍّ لا يُحذَف.
 */
export function assertWaslaPublicId(value: unknown, field = "public_id"): string {
  if (typeof value !== "string" || !WASLA_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed(field, "WS-########## (ten digits)");
  }
  return value;
}

/** مُعرّفٌ داخليٌّ (UUID) لمتجرٍ أو منتجٍ أو تصنيف؛ يُفحَص شكلاً لا وجوداً. */
export function assertUuid(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw validationFailed(field, "UUID");
  }
  return value;
}

/**
 * `slug` المتجر. يرمي `STORE_SLUG_RESERVED` للمحجوزةِ و`MARKETPLACE_VALIDATION_FAILED` لغيرِ
 * المطابقة: رمزان لا رمزٌ واحدٌ، لأنّ الأوّلَ يعني «اختر غيرَها» والثاني يعني «اكتبها صحيحةً»،
 * ورمزٌ جامعٌ يترك صاحبَ المتجرِ يُصلح ما ليس مكسوراً.
 */
export function assertStoreSlug(value: unknown, field = STORE_SLUG_FIELD): string {
  if (typeof value !== "string" || !STORE_SLUG_PATTERN.test(value)) {
    throw validationFailed(field, "lowercase slug matching ^[a-z][a-z0-9-]{2,47}$");
  }
  if (isReservedStoreSlug(value)) throw storeSlugReserved(value);
  return value;
}

/** الحجزُ يُقاس على الصورةِ الصغيرةِ موافقةً لفهرسِ `LOWER(slug)`، فلا `Admin` تمرّ. */
export function isReservedStoreSlug(slug: string): boolean {
  return (RESERVED_STORE_SLUGS as readonly string[]).includes(slug.toLowerCase());
}

export function assertCategorySlug(value: unknown, field = "category_slug"): string {
  if (typeof value !== "string" || !CATEGORY_SLUG_PATTERN.test(value)) {
    throw validationFailed(field, "lowercase slug matching ^[a-z][a-z0-9-]{1,47}$");
  }
  return value;
}

/**
 * `sku`: فريدةٌ **داخل المتجرِ** لا في السوقِ كلِّه (`ux_products_store_sku`). ولذلك حالةُ
 * الحرفِ محفوظةٌ كما كتبها التاجر: الرقمُ التسلسليُّ يُطبَع على مُلصَقٍ ويُقارَن بالعين، وتحويلُه
 * صغيراً يجعل ما في النظامِ مختلفاً عمّا في المخزن.
 */
export function assertProductSku(value: unknown, field = "sku"): string {
  if (typeof value !== "string" || !PRODUCT_SKU_PATTERN.test(value)) {
    throw validationFailed(field, "1-40 chars matching ^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$");
  }
  return value;
}

/**
 * نصٌّ إلزاميٌّ بطولٍ محدود. الطولُ يُقاس بعد قصِّ الفراغِ الطرفيّ: عنوانٌ من مسافتَين يمرّ
 * كلَّ فحصٍ ثمّ يظهر في السوقِ متجراً بلا اسم.
 */
export function assertBoundedText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== "string") throw validationFailed(field, `text of ${minLength}-${maxLength} chars`);
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw validationFailed(field, `text of ${minLength}-${maxLength} chars`);
  }
  return trimmed;
}

/** نصٌّ اختياريّ: الغائبُ والفارغُ بعد القصِّ سواءٌ — كلاهما `undefined` لا سلسلةٌ فارغةٌ تُخزَّن. */
export function assertOptionalBoundedText(
  value: unknown,
  field: string,
  maxLength: number,
  minLength = 2,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw validationFailed(field, `text up to ${maxLength} chars`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw validationFailed(field, `text of ${minLength}-${maxLength} chars`);
  }
  return trimmed;
}
