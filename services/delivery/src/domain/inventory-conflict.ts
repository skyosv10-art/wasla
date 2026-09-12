/**
 * كشفُ تضاربِ المخزونِ النشطِ — رفعُ دَينِ ADR-026 §4.8 (المراجعةُ 16/N).
 *
 * §4.8 أجّلَ «مقارنةَ `quantity_after` المُلاحَظِ مع أصنافِ الطلباتِ النشطةِ لتقريرِ ما
 * إذا كانَ التعديلُ يُؤثّرُ على طلبٍ قائمٍ»، وعلّقَهُ على قرارِ مسارِ الحجزِ. والمسارُ
 * نُفِّذَ في المراجعةِ 10/N (§4.13) والخصمُ النهائيُّ في 11/N، فالتعليقُ ارتفعَ.
 *
 * ## القياسُ الذي يقلبُ الصيغةَ الساذجةَ: الحجزُ **مخصومٌ سلفاً**
 *
 * الصيغةُ التي يتوقّعُها القارئُ هي «تضاربٌ إذا كانَ `quantity_after` أقلَّ من مجموعِ
 * ما نحجزُهُ». وهي **خاطئةٌ في هذا النظامِ**، والدليلُ في عقدِ السوقِ لا في تقديرٍ:
 * `services/marketplace/src/domain/reservation.ts` يبني الحجزَ **فرقاً سالباً** في
 * دفترِ المخزونِ بسببٍ `reservation` («لماذا فروقٌ سالبةٌ لا عمودَ حجزٍ» في رأسِ ذاكَ
 * الملفِّ)، و`product_inventory.quantity_on_hand` مقيَّدٌ بـ`>= 0`. فالوحداتُ التي
 * نحجزُها **خرجت من `quantity_on_hand` لحظةَ الحجزِ**، و`quantity_after` هوَ ما بقيَ
 * **بعدَ** خصمِها. فمقارنتُهُ بحجزِنا تعدُّ الشيءَ مرّتَينِ، وتُشعِلُ تضارباً على كلِّ
 * طلبٍ سليمٍ: متجرٌ رصيدُهُ 3 يُحجَزُ منهُ 3 ⇒ `quantity_after = 0` والحجزُ سليمٌ تماماً.
 *
 * ولذلك **لا تُقارَنُ كميّةٌ بكميّةٍ هنا**. ما يُقرَّرُ هوَ سؤالٌ آخرُ: هل هذا الفرقُ
 * **يُشكِّكُ في الوحداتِ التي نحملُها**؟ والوحداتُ محفوظةٌ حسابيّاً بالبناءِ (قيدُ
 * `>= 0` يمنعُ فرقاً أجنبيّاً من السحبِ منها)، فما يُشكِّكُ فيها ليسَ حسابيّاً بل
 * **معنى السببِ**.
 *
 * ## المفرداتُ مغلقةٌ — وكلُّ مفردةٍ لها سببُها
 *
 * - `stock_zeroed_while_reserved`: الرصيدُ الحرُّ صارَ صفراً بسببٍ ليسَ حجزاً ولا إفراجاً.
 *   الوحداتُ المحجوزةُ لم تُمَسَّ، لكنَّ **الوسادةَ اختفت**: أيُّ نقصٍ يُكتشَفُ عندَ
 *   `picking` لا يجدُ ما يُغطّيهِ، و`archive_zeroed` يعني منتجاً مسحوباً من الكتالوجِ
 *   يحملُ طلبٌ قائمٌ حجزاً عليهِ.
 * - `downward_correction_while_reserved`: `correction` بفرقٍ سالبٍ. التصحيحُ إعلانٌ
 *   من مالكِ المخزونِ أنَّ الدفترَ **كانَ خاطئاً** — والحجزُ الذي أُذِنَ لهُ إنّما أُذِنَ
 *   بناءً على ذلكَ الدفترِ الخاطئِ. فالشكُّ يمسُّ الحجزَ ولو لم يمسَّهُ الحسابُ.
 * - `shrinkage_while_reserved`: `shrinkage` بفرقٍ سالبٍ — فقدٌ ماديٌّ على منتجٍ نحملُ
 *   منهُ وحداتٍ. ومقيسٌ في عقدِ السوقِ أنَّ الفقدَ الذي يتجاوزُ الرصيدَ الحرَّ **لا
 *   يُسجَّلُ أصلاً** (`INVENTORY_INSUFFICIENT_QUANTITY` قبلَ النزولِ تحتَ الصفرِ)، فالرقمُ
 *   المُسجَّلُ **حدٌّ أدنى للفقدِ لا قياسٌ لهُ**، وهذا وحدَهُ سببٌ لرفعِ الرايةِ لا لخفضِها.
 *
 * وما ليسَ في القائمةِ **ليسَ تضارباً**، بالتصريحِ: `reservation` و`reservation_release`
 * أثرُنا نحنُ (فمن رصدَ نفسَهُ رصدَ ضجيجاً)، و`initial_stock` و`restock` والتصحيحُ
 * الموجبُ زياداتٌ (والزيادةُ لا تُشكِّكُ في وحدةٍ محجوزةٍ).
 *
 * ## والحكمُ مُعلِمٌ لا حاكمٌ — على سابقةِ §4.17-1
 *
 * هذا الملفُّ يُنتِجُ **تقريراً** لا قراراً: لا يُلغي طلباً، ولا يُغيّرُ حالةَ تنفيذٍ،
 * ولا يُفرِجُ حجزاً، ولا يمنعُ انتقالاً. ولمَ لا؟ لأنَّ الفرقَ الواصلَ **حدثٌ ماضٍ**
 * وصلَ عبرَ صندوقِ صادرٍ بتأخيرٍ غيرِ مضمونٍ، وإلغاءُ طلبِ عميلٍ آليّاً بناءً على
 * تأويلِ سببٍ نصّيٍّ قرارٌ تجاريٌّ لا هندسيٌّ (ومالكُ البرنامجِ وحدَهُ يملكُهُ).
 * فالرايةُ تُرفَعُ ويقرؤُها إنسانٌ يُلغي أو يُستبدِلُ (§2.5) بيدِهِ.
 *
 * والوحداتُ هنا خالصةٌ: لا `pg` ولا ساعةٌ ولا بيئةٌ — الزمنُ يُحقَنُ والمُدخَلُ سجلٌّ.
 */

import type { InventoryAdjustedData } from "./marketplace-inventory-events.js";

/* ════════════════════════════════════════════════════════════════════════
 * المفرداتُ المغلقةُ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * أنواعُ التضاربِ — قائمةٌ مغلقةٌ. تُقرأُ آليّاً وتُخزَّنُ في عمودٍ مقيَّدٍ بـ`CHECK`،
 * فإضافةُ نوعٍ تغييرُ مخطَّطٍ مُعلَنٌ لا سلسلةٌ حرّةٌ تُكتَبُ في السجلِّ.
 */
export const INVENTORY_CONFLICT_KINDS = [
  "stock_zeroed_while_reserved",
  "downward_correction_while_reserved",
  "shrinkage_while_reserved",
] as const;

export type InventoryConflictKind = (typeof INVENTORY_CONFLICT_KINDS)[number];

/**
 * أسبابُ **عدمِ** رفعِ الرايةِ — مفردةٌ واحدةٌ لكلِّ مسارٍ. ولمَ تُسمّى أصلاً؟ لأنَّ
 * «لا تضاربَ» جوابٌ لهُ أربعةُ معانٍ مختلفةٍ تماماً، ودمجُها في `null` يجعلُ سطرَ
 * السجلِّ في حادثةٍ عاجزاً عن التمييزِ بينَ «لا طلبَ نشطاً» و«هذا حجزُنا نفسُهُ».
 */
export const INVENTORY_CONFLICT_DISMISSALS = [
  "no_active_reservation",
  "delivery_own_reservation_flow",
  "quantity_increase",
  "reason_not_conflicting",
] as const;

export type InventoryConflictDismissal = (typeof INVENTORY_CONFLICT_DISMISSALS)[number];

/** أسبابُ الفرقِ التي هيَ أثرُ التوصيلِ نفسِهِ — فلا تُرصَدُ ضدَّهُ. */
const DELIVERY_OWN_REASONS = new Set(["reservation", "reservation_release"]);

/** أسبابُ الفرقِ التي يمسُّ نزولُها الوحداتِ المحجوزةَ معنىً. */
const CONFLICTING_DOWNWARD_REASONS = new Set(["correction", "shrinkage", "archive_zeroed"]);

/* ════════════════════════════════════════════════════════════════════════
 * المُدخَلُ والمُخرَجُ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * طلبٌ واحدٌ يحملُ حجزاً نشطاً على المنتجِ المُعدَّلِ.
 *
 * `orderId` و`orderPublicId` كلاهُما: الأوّلُ مفتاحُ الربطِ في القاعدةِ، والثاني ما
 * يقرؤُهُ المُشغِّلُ في الحادثةِ — واشتقاقُ أحدِهما من الآخرِ يلزمُهُ استعلامٌ ثانٍ.
 */
export interface ActiveReservationLine {
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly quantityReserved: number;
}

/** المُدخَلُ الكاملُ لقرارٍ واحدٍ — سجلٌّ خالصٌ لا اتّصالَ فيهِ. */
export interface InventoryConflictInput {
  readonly adjustment: InventoryAdjustedData;
  readonly activeReservations: readonly ActiveReservationLine[];
  /** لحظةُ الرصدِ — تُحقَنُ ولا تُقرأُ من ساعةٍ عالميّةٍ. */
  readonly detectedAt: string;
}

/** رايةٌ مرفوعةٌ — تقريرٌ يُخزَّنُ ويُقرأُ، لا أمرٌ يُنفَّذُ. */
export interface InventoryConflictReport {
  readonly kind: InventoryConflictKind;
  readonly storeId: string;
  readonly productId: string;
  readonly adjustmentId: string;
  readonly adjustmentSequence: number;
  readonly quantityDelta: number;
  readonly observedQuantityAfter: number;
  readonly reasonCode: string;
  /** عددُ الطلباتِ النشطةِ المتأثّرةِ — لا عددُ الأصنافِ. */
  readonly affectedOrderCount: number;
  /** مجموعُ الوحداتِ المحجوزةِ على هذا المنتجِ في تلكَ الطلباتِ. */
  readonly affectedUnitsTotal: number;
  /** مراجعُ الطلباتِ العامّةُ مرتَّبةً — الترتيبُ حتميٌّ ليكونَ السطرُ قابلاً للمقارنةِ. */
  readonly affectedOrderPublicIds: readonly string[];
  readonly detectedAt: string;
  /**
   * مُعلَنٌ على السلكِ وفي الصفِّ: هذا الرصدُ لا يُغيّرُ حالةَ طلبٍ. ثابتٌ لا محسوبٌ،
   * على سابقةِ `gates_readiness` في §4.17-2 — من يقرأُ صفّاً في حادثةٍ لا يقرأُ ADR.
   */
  readonly changesOrderState: false;
}

export type InventoryConflictAssessment =
  | { readonly conflict: true; readonly report: InventoryConflictReport }
  | { readonly conflict: false; readonly dismissedBecause: InventoryConflictDismissal };

/**
 * رايةٌ مُثبَتةٌ كما تُقرأُ — التقريرُ وما أضافتهُ القاعدةُ إليهِ.
 *
 * ولمَ نوعٌ ثانٍ لا `InventoryConflictReport` نفسُهُ؟ لأنَّ التقريرَ **قرارٌ لحظةٍ**
 * والصفَّ **سجلٌّ لهُ حياةٌ بعدَهُ**: الإقرارُ التشغيليُّ (`acknowledgedAt`) لا وجودَ
 * لهُ لحظةَ القرارِ ولا يجوزُ أن يكونَ حقلاً اختياريّاً في نوعِ القرارِ — وإلّا صارَ للقرارِ
 * حقلٌ لا يملأُهُ أحدٌ أبداً.
 */
export interface InventoryConflictRow extends InventoryConflictReport {
  readonly marketplaceEventId: string;
  readonly occurredFor: string;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly traceId: string | null;
}

/* ════════════════════════════════════════════════════════════════════════
 * القرارُ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * يُقرِّرُ إن كانَ فرقُ مخزونٍ مرصودٌ يُشكِّكُ في حجوزٍ نشطةٍ.
 *
 * الترتيبُ مقصودٌ: أرخصُ رفضٍ أوّلاً (لا حجزَ نشطاً ⇒ لا سؤالَ)، ثمَّ أثرُنا نفسُهُ،
 * ثمَّ اتّجاهُ الفرقِ، ثمَّ معنى السببِ. وعكسُ الترتيبِ كانَ سيُنتِجُ نفسَ الجوابِ
 * بمفردةِ رفضٍ **مختلفةٍ** — والمفردةُ هيَ ما يُقرأُ في السجلِّ، فترتيبُها جزءٌ من العقدِ.
 */
export function assessInventoryConflict(input: InventoryConflictInput): InventoryConflictAssessment {
  const { adjustment, activeReservations, detectedAt } = input;

  if (activeReservations.length === 0) {
    return { conflict: false, dismissedBecause: "no_active_reservation" };
  }

  if (DELIVERY_OWN_REASONS.has(adjustment.reason_code)) {
    return { conflict: false, dismissedBecause: "delivery_own_reservation_flow" };
  }

  // الزيادةُ لا تُشكِّكُ في وحدةٍ محجوزةٍ. والفرقُ صفرٌ مستحيلٌ بالعقدِ
  // (`quantity_delta` لهُ `not: {const: 0}`)، فلا حاجةَ لفرعٍ ثالثٍ يُدَّعى اختبارُهُ.
  if (adjustment.quantity_delta > 0) {
    return { conflict: false, dismissedBecause: "quantity_increase" };
  }

  if (!CONFLICTING_DOWNWARD_REASONS.has(adjustment.reason_code)) {
    return { conflict: false, dismissedBecause: "reason_not_conflicting" };
  }

  return {
    conflict: true,
    report: {
      kind: classifyKind(adjustment),
      storeId: adjustment.store_id,
      productId: adjustment.product_id,
      adjustmentId: adjustment.adjustment_id,
      adjustmentSequence: adjustment.adjustment_sequence,
      quantityDelta: adjustment.quantity_delta,
      observedQuantityAfter: adjustment.quantity_after,
      reasonCode: adjustment.reason_code,
      affectedOrderCount: countDistinctOrders(activeReservations),
      affectedUnitsTotal: activeReservations.reduce((sum, line) => sum + line.quantityReserved, 0),
      affectedOrderPublicIds: distinctSortedPublicIds(activeReservations),
      detectedAt,
      changesOrderState: false,
    },
  };
}

/**
 * الرصيدُ الحرُّ صفراً **يسبقُ** سببَ النزولِ في التصنيفِ.
 *
 * ولمَ يسبقُ؟ لأنَّ «صفرٌ» أشدُّ من «نزولٌ»: تصحيحٌ ينزلُ إلى 4 يُبقي وسادةً، وتصحيحٌ
 * ينزلُ إلى 0 لا يُبقي شيئاً — والمُشغِّلُ الذي يُصنِّفُ حادثةً يحتاجُ الأشدَّ في الرأسِ.
 * والسببُ الأصليُّ لا يُفقَدُ: `reason_code` عمودٌ مستقلٌّ في الصفِّ نفسِهِ.
 */
function classifyKind(adjustment: InventoryAdjustedData): InventoryConflictKind {
  if (adjustment.quantity_after === 0) return "stock_zeroed_while_reserved";
  if (adjustment.reason_code === "shrinkage") return "shrinkage_while_reserved";
  return "downward_correction_while_reserved";
}

/**
 * الطلباتُ تُعَدُّ متمايزةً لا مصفوفةً.
 *
 * قيدُ `UNIQUE (order_id, product_id)` في `delivery_inventory_reservations` يجعلُ
 * التكرارَ مستحيلاً اليومَ — والعَدُّ متمايزٌ رغمَ ذلكَ: مُدخَلٌ يأتي من استعلامٍ
 * يُعيدُ صفَّينِ لطلبٍ واحدٍ (بعدَ أيِّ توسيعٍ في الاستعلامِ) يُنتِجُ عدداً مضاعفاً،
 * وعددٌ خاطئٌ في راية حادثةٍ أسوأُ من عدمِها.
 */
function countDistinctOrders(lines: readonly ActiveReservationLine[]): number {
  return new Set(lines.map((line) => line.orderId)).size;
}

function distinctSortedPublicIds(lines: readonly ActiveReservationLine[]): readonly string[] {
  return [...new Set(lines.map((line) => line.orderPublicId))].sort();
}
