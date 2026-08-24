/**
 * تسميةُ الحقيقةِ التي حماها المخطّطُ — لا نصُّ خطأٍ يُقرأ بالتعبير المنتظم.
 *
 * ## القرار: القيدُ يُقرأ باسمِه، والاسمُ يُترجَم إلى رمزِ عقد
 *
 * عميلُ `pg` يُعيد في الخطأِ حقلَ `constraint` يحمل اسمَ القيدِ الذي انتُهك. والأرخصُ الخاطئُ
 * هو `if (error.message.includes("duplicate key"))`: نصُّ الرسالةِ يتغيّر بلغةِ الخادمِ
 * (`lc_messages`) وبإصدارِ Postgres، فيصير 409 المكتوبُ في العقدِ خطأً غيرَ مُتوقَّعٍ 500 بعد
 * ترقيةٍ لا علاقةَ لها بالسوق.
 *
 * ## ولماذا يمشي `constraintOf` في سلسلةِ `cause` إلى عمقِ ثمانية
 *
 * Drizzle يُغلّف خطأَ `pg` في خطأٍ خاصٍّ به ويضعه في `cause`، ووحدةُ العملِ قد تُغلّفه مرّةً
 * أخرى. فقراءةُ `error.constraint` من السطحِ وحدَه تُعيد `undefined` فيُعاد رميُ الخطأِ خامّاً
 * ويصير تعارضُ لاحقةٍ مأخوذةٍ خطأَ خادمٍ 500 (وهذا ما وقع فعلاً في الطور 07 وأُصلح هناك بنفسِ
 * هذه الدالة). والعمقُ ثمانيةٌ لا لانهائيّ كي لا تُعلّق سلسلةُ `cause` دائريّةٌ الطلبَ.
 *
 * ## والترجمةُ مُعلَنةٌ قائمةً مُجمَّدةً لا `switch` مفتوحاً
 *
 * `TRANSLATED_CONSTRAINTS` تُقرأ في `__tests__/schema-drift.test.ts` ويُتحقَّق أنّ كلَّ اسمٍ
 * فيها موجودٌ **فعلاً** في نصِّ العقد. فقيدٌ يُعاد تسميتُه في `schema.sql` يُفشل البناءَ في
 * الحال، بدلاً من أن يبقى مُترجِمٌ يُطابق اسماً لا وجودَ له فيصمت عند الحاجة إليه.
 *
 * ولا يترجم هذا الملفُّ فحوصاً بلا أسماء (تعداداتُ الحالاتِ وصيغُ المُعرّفاتِ وحدودُ الأطوال):
 * تلك يفحصها المجالُ **قبل** الكتابةِ برمزٍ مُسمّىً (`MARKETPLACE_VALIDATION_FAILED` بحقلٍ
 * وقاعدةٍ)، وسقوطُها في القاعدةِ يعني عطباً في المجالِ لا مدخلاً سيّئاً — فيبقى خطأً غيرَ
 * مُتوقَّعٍ يُرمى كما هو ويُصرخ به في السجلّ، ولا يُلبَّس ثوبَ 4xx يُسكته.
 */

import {
  productNotModerated,
  productSkuTaken,
  storeOwnerLimitReached,
  storeOwnerRoleImmutable,
  storeSlugTaken,
  storeStaffAlreadyMember,
  type MarketplaceError,
} from "../domain/errors.js";
import { STORE_ACTIVE_LIMIT_PER_OWNER } from "../domain/contract-sets.js";

/** أقصى عمقٍ يُمشى في `cause` — سببُه في رأسِ الملفّ. */
const MAX_CAUSE_DEPTH = 8;

interface MaybePgError {
  readonly constraint?: unknown;
  readonly cause?: unknown;
}

/** اسمُ القيدِ المُنتهَكِ إن وُجد في الخطأِ أو في أحدِ أسبابه. */
export function constraintOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const candidate = (current as MaybePgError).constraint;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
    current = (current as MaybePgError).cause;
  }
  return undefined;
}

/**
 * أسماءُ التسلسلِ الفريدة: انتهاكُها **سباقٌ** لا مدخلٌ سيّئ.
 *
 * قرارٌ متزامنٌ على نفسِ المتجرِ يُنتج صفَّي دفترٍ بنفسِ `state_sequence`، فيسقط الثاني على
 * الفهرس. والصوابُ إعادةُ المحاولةِ بقراءةِ الدفترِ من جديدٍ (`unit-of-work.ts`) لا إعادةُ
 * 409 إلى المُتَّصل: القرارُ صحيحٌ ولم يُرفض، إنّما وصل ثانياً.
 */
export const SEQUENCE_RACE_CONSTRAINTS: ReadonlyArray<string> = Object.freeze([
  "ux_store_reviews_sequence",
  "ux_product_reviews_sequence",
  "ux_inventory_adjustments_sequence",
]);

export function isSequenceRace(error: unknown): boolean {
  const name = constraintOf(error);
  return name !== undefined && SEQUENCE_RACE_CONSTRAINTS.includes(name);
}

/** القيودُ المُترجَمةُ إلى أخطاءِ مجالٍ — بالاسمِ، ومحروسةٌ بمطابقةِ نصِّ العقد. */
export const TRANSLATED_CONSTRAINTS: ReadonlyArray<string> = Object.freeze([
  "ux_stores_slug_lower",
  "ux_stores_owner_active",
  "ux_products_store_sku",
  "ux_store_staff_active_member",
  "ux_store_staff_single_owner",
  "ck_products_published_moderated",
]);

export interface TranslationContext {
  readonly storeSlug?: string;
  readonly memberPublicId?: string;
  readonly moderationState?: string;
}

/**
 * خطأُ مجالٍ مُقابلٌ لقيدٍ مُسمّىً، أو `undefined` إن لم يكن القيدُ مُترجَماً.
 *
 * `undefined` تعني «أعِد رميَ الخطأِ كما هو»: مُترجِمٌ يُعيد خطأً عامّاً لكلِّ ما لم يعرفه كان
 * سيُحوّل عطبَ برمجةٍ (عمودٌ محذوفٌ · نوعٌ خاطئ) إلى 409 يقرؤه المُتَّصلُ «حاولْ لاحقاً» فيُعيد
 * المحاولةَ إلى الأبد على عطبٍ لا يُصلحه انتظار.
 *
 * و`ck_products_published_moderated` يُترجَم إلى `PRODUCT_NOT_MODERATED` لا إلى خطأِ تحقّقٍ:
 * القيدُ هو خطُّ الدفاعِ الثاني وراءَ `assertProductPublishable`، وسقوطُه يعني أنّ مساراً نشرَ
 * منتجاً لم يجتز الاعتدالَ — والمُتَّصلُ يستحقّ الرمزَ الذي يقول له ما ينقص.
 */
export function translateConstraint(
  error: unknown,
  context: TranslationContext = {},
): MarketplaceError | undefined {
  const name = constraintOf(error);
  if (name === undefined) return undefined;
  switch (name) {
    case "ux_stores_slug_lower":
      return storeSlugTaken(context.storeSlug ?? "unknown");
    case "ux_stores_owner_active":
      return storeOwnerLimitReached(STORE_ACTIVE_LIMIT_PER_OWNER);
    case "ux_products_store_sku":
      return productSkuTaken();
    case "ux_store_staff_active_member":
      return storeStaffAlreadyMember(context.memberPublicId ?? "unknown");
    case "ux_store_staff_single_owner":
      return storeOwnerRoleImmutable(context.memberPublicId ?? "unknown");
    case "ck_products_published_moderated":
      return productNotModerated(context.moderationState ?? "pending");
    default:
      return undefined;
  }
}
