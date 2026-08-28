/**
 * المخزون: دفترُ فروقٍ موقَّعةٍ يحمل الرصيدَ بعده، لا رقمٌ يُدهَس.
 *
 * ADR-016 القرار 5. الفرقُ **موقَّعٌ وغيرُ صفريّ**، و`quantity_after` مكتوبٌ في كلّ سطر،
 * و`product_inventory.quantity_on_hand` إسقاطٌ يجب أن يُعاد بناؤه من الدفترِ بلا خسارة.
 *
 * ## لماذا الفرقُ لا القيمةُ الجديدة
 *
 * `PATCH { quantity_on_hand: 12 }` هو الاختصارُ المُغري، وهو يفقد **النيّة**: هل نقص الرصيدُ
 * من 15 إلى 12 لأنّ ثلاثةً بيعت أم لأنّ ثلاثةً تلفت أم لأنّ الجردَ صحّح خطأَ إدخال؟ ثلاثةُ
 * معانٍ لا يفرّق بينها رقمٌ نهائيّ، ولا يستطيع تاجرٌ بعد شهرٍ أن يعرف كم خسر تلفاً. والفرقُ
 * مع `reason_code` مُقفَلٍ يجعل السؤالَ مجموعاً في استعلامٍ واحد.
 *
 * وأخطرُ من ذلك: القيمةُ النهائيّةُ **تُخفي الكتابةَ المتزامنة**. طلبان يقرآن 15 ويكتبان 12
 * فيصير الرصيدُ 12 وقد نقص ستّة. والفرقُ يُجمَع فيصير 9 وهو الصحيح، ولذلك أيضاً يُحسَب
 * `quantity_after` من الرصيدِ الذي تراه المعاملةُ لحظةَ الكتابةِ لا من رقمٍ أرسله العميل.
 *
 * ## لماذا `quantity_after` مكتوبٌ وهو مُشتَقٌّ أصلاً
 *
 * لأنّه **حرسُ الإسقاط**: طيُّ الدفترِ يُقارَن بالرصيدِ المكتوبِ في كلّ سطر، فأوّلُ سطرٍ سقط أو
 * كُتب مرّتَين يُعلَن نفسَه فوراً بدلاً من أن يظهر بعد شهرٍ فرقاً لا يُفسَّر. وهو نفسُ سببِ
 * `state_sequence` في دفترَي المراجعة.
 *
 * ## ولا `quantity_reserved` ولا `quantity_available` في هذا الطور
 *
 * الحجزُ يعني عمراً للحجزِ ومن يُحرّره ومتى، وهو حديثُ سلّةٍ وطلبٍ (الطور 13). عمودُ حجزٍ بلا
 * مالكٍ للتحريرِ يجعل مخزوناً يتبخّر بلا بيعٍ ولا سبب.
 */

import {
  INVENTORY_DELTA_ABS_MAX,
  type InventoryReasonCode,
} from "./contract-sets.js";
import { inventoryInsufficientQuantity, validationFailed } from "./errors.js";
import type { InventoryAdjustmentEntry } from "./model.js";

/** الرصيدُ الابتدائيُّ قبل أوّلِ سطرٍ في الدفتر، مطابقاً لافتراضِ العمودِ في المخطّط. */
export const INVENTORY_INITIAL_QUANTITY = 0;
export const INVENTORY_INITIAL_SEQUENCE = 0;

/**
 * فرقٌ مقبول: عددٌ صحيحٌ غيرُ صفريٍّ في حدودِ المقدارِ المطلقِ المُعلَن.
 *
 * الصفرُ مرفوضٌ لا مُتجاهَل: سطرٌ بفرقِ صفرٍ في دفترٍ يُقرأ بالجمعِ سطرٌ لا يقول شيئاً، ومع
 * ذلك يشغل تسلسلاً ويحمل فاعلاً وسبباً فيُوهم من يقرأ أنّ شيئاً جرى. والسقفُ المطلقُ يمنع
 * خطأَ إدخالٍ (مليونٌ بدل عشرة) من أن يصير رقماً لا يُصدَّق يُفسد كلَّ حسابٍ بعده.
 */
export function assertQuantityDelta(value: unknown, field = "quantity_delta"): number {
  if (!Number.isSafeInteger(value) || value === 0) {
    throw validationFailed(field, "non-zero integer");
  }
  const delta = value as number;
  if (Math.abs(delta) > INVENTORY_DELTA_ABS_MAX) {
    throw validationFailed(field, `absolute value at most ${INVENTORY_DELTA_ABS_MAX}`);
  }
  return delta;
}

/**
 * يبني سطرَ تعديلٍ من الرصيدِ الحاضرِ والفرقِ المطلوب، أو يرمي إن نزل الرصيدُ تحت الصفر.
 *
 * الرصيدُ لا ينزل تحت الصفرَ بحال: قيدُ `quantity_on_hand >= 0` في المخطّطِ يحمي الكتابةَ، وهذا
 * يحمي **القرار**: رصيدٌ سالبٌ يعني منتجاً ظاهراً في السوقِ لا وجودَ له، فيدفع مشترٍ ثمنَ ما
 * لن يُسلَّم. والرمزُ `INVENTORY_INSUFFICIENT_QUANTITY` يُعيد الرصيدَ الحاضرَ فيعرف المستهلكُ
 * الحدَّ الأعلى للسحبِ المقبولِ بلا تخمين.
 */
export function applyInventoryAdjustment(input: {
  quantityOnHand: number;
  quantityDelta: number;
  reasonCode: InventoryReasonCode;
  actorPublicId: string;
  adjustmentSequence: number;
  occurredAt: string;
}): InventoryAdjustmentEntry {
  const delta = assertQuantityDelta(input.quantityDelta);
  if (!Number.isSafeInteger(input.quantityOnHand) || input.quantityOnHand < 0) {
    throw validationFailed("quantity_on_hand", "non-negative integer");
  }
  if (!Number.isSafeInteger(input.adjustmentSequence) || input.adjustmentSequence < 1) {
    throw validationFailed("adjustment_sequence", "integer >= 1");
  }
  const quantityAfter = input.quantityOnHand + delta;
  if (quantityAfter < 0) throw inventoryInsufficientQuantity(input.quantityOnHand);

  return {
    quantityDelta: delta,
    quantityAfter,
    reasonCode: input.reasonCode,
    actorPublicId: input.actorPublicId,
    adjustmentSequence: input.adjustmentSequence,
    occurredAt: input.occurredAt,
  };
}

/**
 * يطوي دفترَ المخزونِ إلى رصيدٍ، متحقّقاً في كلّ سطرٍ من التسلسلِ ومن مطابقةِ `quantity_after`.
 *
 * التحقّقُ من `quantity_after` هو ما يجعل الإسقاطَ **بلا خسارة** بالمعنى الحرفيّ: لا يكفي أن
 * يتّفق المجموعُ الأخير، بل يجب أن يتّفق الرصيدُ عند **كلِّ** سطر — وإلّا فسطران بخطأَين
 * متعاكسَين يُعطيان مجموعاً صحيحاً ويُخفيان أنّ الدفترَ كُتب مرّتَين.
 */
export function deriveQuantityOnHand(ledger: readonly InventoryAdjustmentEntry[]): number {
  let quantity = INVENTORY_INITIAL_QUANTITY;
  let sequence = INVENTORY_INITIAL_SEQUENCE;

  for (const entry of ledger) {
    if (entry.adjustmentSequence !== sequence + 1) {
      throw validationFailed("adjustment_sequence", `contiguous sequence ${sequence + 1}`);
    }
    assertQuantityDelta(entry.quantityDelta);
    const expected = quantity + entry.quantityDelta;
    if (expected < 0) throw validationFailed("quantity_after", "non-negative running balance");
    if (entry.quantityAfter !== expected) {
      throw validationFailed("quantity_after", `${expected} (running balance of the ledger)`);
    }
    quantity = expected;
    sequence = entry.adjustmentSequence;
  }

  return quantity;
}

/**
 * حُكمُ تدقيقٍ: الدفترُ وما بُني منه، والإسقاطُ وما هو عليه، والفرقُ بينهما إن وُجد.
 *
 * ولمَ حُكمٌ يُعاد لا استثناءٌ يُرفَع؟ لأنّ `deriveQuantityOnHand` ترفع عند دفترٍ **متناقضٍ في
 * نفسِه** (تسلسلٌ مثقوبٌ أو `quantity_after` لا يطابق الجمعَ) — وذاك عطبٌ في الدفترِ لا يُقرأ.
 * أمّا اختلافُ الإسقاطِ عن دفترٍ سليمٍ فحقيقةٌ تُقاس وتُقرأ وتُقارن، ورفعُها استثناءً كان
 * سيمنع مالكاً من رؤيةِ مقدارِ الانحرافِ واتّجاهِه — وهو ما يحتاجه ليقرّر.
 */
export interface InventoryReconciliation {
  readonly ledgerQuantity: number;
  readonly ledgerSequence: number;
  readonly projectedQuantity: number;
  readonly projectedSequence: number;
  readonly quantityDrift: number;
  readonly sequenceDrift: number;
  readonly inSync: boolean;
}

/**
 * يقارن دفترَ المخزونِ بإسقاطِه — دالّةٌ صرفةٌ لا تعرف قاعدةً ولا تكتب شيئاً.
 *
 * ## ولمَ التسلسلُ يُقاس مع الرصيد؟
 *
 * لأنّ رصيدَين متساويَين لا يعنيان تزامناً: إسقاطٌ فقد سطراً بفرقِ `+5` ثمّ فقد آخرَ بفرقِ
 * `-5` يُعطي الرصيدَ نفسَه وتسلسلاً أقصرَ باثنَين. والتسلسلُ هو الشاهدُ على **عددِ** ما وصل،
 * والرصيدُ شاهدٌ على **مقدارِه**؛ وشاهدٌ واحدٌ يمرّ عليه انحرافٌ متعادلٌ بلا أثر.
 *
 * ولمَ `ledgerSequence` من طولِ الدفترِ لا من آخرِ سطرٍ فيه؟ لأنّ `deriveQuantityOnHand` أثبتت
 * قبلَ سطرٍ واحدٍ أنّ التسلسلَ متّصلٌ يبدأ من واحد، فطولُه هو آخرُه بالضرورة — وقراءةُ الحقلِ
 * من الصفِّ الأخيرِ كانت ستُصدِّق رقماً بلا إثباتٍ لو تغيّر ذاك الحرسُ يوماً.
 */
export function reconcileInventory(input: {
  readonly ledger: readonly InventoryAdjustmentEntry[];
  readonly projectedQuantity: number;
  readonly projectedSequence: number;
}): InventoryReconciliation {
  if (!Number.isSafeInteger(input.projectedQuantity) || input.projectedQuantity < 0) {
    throw validationFailed("quantity_on_hand", "non-negative integer");
  }
  if (!Number.isSafeInteger(input.projectedSequence) || input.projectedSequence < 0) {
    throw validationFailed("last_adjustment_sequence", "non-negative integer");
  }

  const ledgerQuantity = deriveQuantityOnHand(input.ledger);
  const ledgerSequence = input.ledger.length;
  const quantityDrift = input.projectedQuantity - ledgerQuantity;
  const sequenceDrift = input.projectedSequence - ledgerSequence;

  return {
    ledgerQuantity,
    ledgerSequence,
    projectedQuantity: input.projectedQuantity,
    projectedSequence: input.projectedSequence,
    quantityDrift,
    sequenceDrift,
    inSync: quantityDrift === 0 && sequenceDrift === 0,
  };
}
