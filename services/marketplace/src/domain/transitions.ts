/**
 * الانتقالات: جدولُ العقدِ يُقرأ ولا يُنسَخ، والقرارُ يُترجَم إلى حالةٍ بجدولٍ واحد.
 *
 * `STORE_ALLOWED_TRANSITIONS` و`PRODUCT_ALLOWED_TRANSITIONS` مُعلَنان في
 * `@wasla/contracts-marketplace` ويُقرأان من هنا كما هما. لا جدولَ ثانياً في الخدمة: جدولان
 * يعنيان أنّ سؤالَ «هل يجوز `suspended → archived`؟» له جوابان في المستودعِ نفسِه، ويقرّر
 * ترتيبُ الاستيرادِ — لا القاعدةُ — أيُّهما يُطبَّق. وهذه هي القاعدةُ الأولى من قواعدِ الطور 11
 * الأربعِ في §19.2 من دفترِ التسليم.
 *
 * ## القرارُ ليس الحالة
 *
 * هذا أهمُّ ما في الملف. `store_reviews.decision` ستّةُ قرارات، و`stores.state` ستُّ حالات،
 * والاثنان **لا يتقابلان واحداً بواحد**: `review_requested` يُنتج `pending_review`،
 * و`reinstated` يُنتج `approved`. ولو خُلط الاثنان — وهو الخطأُ الأرخصُ: `to_state = decision` —
 * لصار في قيدِ الحالةِ قيمةٌ اسمُها `reinstated` لا معنى لها في السوق، ولضاع الفرقُ بين متجرٍ
 * اعتُمِد أوّلَ مرّةٍ ومتجرٍ أُعيد بعد إيقاف؛ وهو فرقٌ يسأل عنه أوّلُ تحقيقٍ إداريّ.
 *
 * ## لماذا السببُ إلزاميٌّ في الرفضِ والإيقافِ لا في غيرِهما
 *
 * لأنّ هذين وحدَهما **يُنقصان حقّاً**. المنعُ بلا سببٍ مُقفَلٍ يجعل صاحبَ المتجرِ لا يعرف ماذا
 * يُصلح، فيُعيد الطلبَ نفسَه فيُرفَض نفسَ الرفضِ فيصير المُراجعُ يكتب سببَه في محادثةٍ لا
 * يقرأها نظام. والقائمةُ مُقفَلةٌ لا نصّاً حرّاً: نصٌّ حرٌّ لا يُحصى في تقريرٍ ولا يُترجَم
 * للغةٍ ثانيةٍ ولا يُقاس عليه أثرُ سياسةٍ (القرار 10).
 *
 * وفي المقابلِ `approved` و`review_requested` و`reinstated` بلا سبب: سببُ الاعتمادِ أنّ الملفَّ
 * مكتملٌ، وسببٌ إلزاميٌّ هنا يعني حقلاً يُملأ بقيمةٍ صوريّةٍ في كلّ اعتماد. و`archived` سببُه
 * اختياريٌّ (`owner_request` غالباً) لأنّ صاحبَ المتجرِ قد يُنهي بلا أن يُسأل.
 */

import {
  PRODUCT_ALLOWED_TRANSITIONS,
  STORE_ALLOWED_TRANSITIONS,
  type ProductDecision,
  type ProductModerationState,
  type ProductReasonCode,
  type ProductState,
  type StoreDecision,
  type StoreReasonCode,
  type StoreState,
} from "./contract-sets.js";
import {
  productTransitionNotAllowed,
  storeDecisionNotAllowed,
  storeRejectionReasonRequired,
  validationFailed,
} from "./errors.js";

/**
 * ترجمةُ القرارِ إلى الحالةِ الناتجة. جدولٌ واحدٌ في المجالِ كلِّه، وهو موضعُ القرار 1 عمليّاً:
 * كلُّ من يكتب صفَّ مراجعةٍ يأخذ `to_state` من هنا فلا يُخترع سطرٌ يقول قراراً وحالةً لا
 * يتّفقان، فيصير إعادةُ بناءِ العمودِ من الدفترِ مستحيلةً بلا تخمين.
 */
export const STORE_DECISION_RESULT_STATE: Readonly<Record<StoreDecision, StoreState>> = {
  review_requested: "pending_review",
  approved: "approved",
  rejected: "rejected",
  suspended: "suspended",
  reinstated: "approved",
  archived: "archived",
};

/** القراراتُ التي يلزمها سببٌ مُقفَل — قائمةٌ واحدةٌ تُقرأ في المجالِ وفي طبقةِ HTTP معاً. */
export const STORE_DECISIONS_REQUIRING_REASON: readonly StoreDecision[] = ["rejected", "suspended"];

/** القراراتُ التي **لا** يجوز أن تحمل سبباً؛ و`archived` ليست فيها لأنّ سببَها اختياريّ. */
export const STORE_DECISIONS_FORBIDDING_REASON: readonly StoreDecision[] = [
  "review_requested",
  "approved",
  "reinstated",
];

/** ترجمةُ قرارِ الاعتدالِ إلى حالته؛ تقابلٌ واحدٌ بواحدٍ هنا، ومع ذلك يُعلَن ولا يُفترَض. */
export const PRODUCT_DECISION_RESULT_STATE: Readonly<
  Record<ProductDecision, ProductModerationState>
> = {
  approved: "approved",
  rejected: "rejected",
};

/**
 * انتقالاتُ الاعتدالِ المسموحة: من `pending` وحدها.
 *
 * ولماذا يُعلَن الجدولُ هنا لا في حزمةِ العقدِ كجدولَي الحالة؟ لأنّ العقدَ يُعلن قيدَ
 * `product_reviews` (`from_state` و`to_state` من الثلاثةِ) ولا يُعلن أزواجاً، والقيدُ أوسعُ من
 * القاعدةِ عن قصد: القاعدةُ تُضيَّق في المجالِ حيث تُقرأ، لا في `CHECK` يُهاجَر لتعديله.
 *
 * والتضييقُ ليس اعتباطاً: `approved → rejected` يجعل منتجاً **منشوراً** بموافقةٍ مسحوبةٍ،
 * وقيدُ `state <> 'published' OR moderation_state = 'approved'` في المخطّطِ يرفض ذلك، فلو
 * سمح المجالُ به لصارت المعاملةُ تسقط في القاعدةِ برسالةٍ لا يفهمها المُراجع. وسحبُ اعتمادِ
 * منتجٍ منشورٍ **أرشفةٌ** (`published → archived`) بقرارِ مُراجعٍ، وهي في جدولِ العقد.
 * و`rejected → pending` ليس قراراً أصلاً: لا `decision` في العقدِ يُنتج `pending`، فإعادةُ
 * العرضِ بعد الرفضِ تعديلُ منتجٍ يملكه صاحبُه لا حكمٌ يكتبه مُراجع (المراجعة 4/6).
 */
export const PRODUCT_MODERATION_ALLOWED_TRANSITIONS: ReadonlyArray<
  readonly [ProductModerationState | null, ProductModerationState]
> = [
  [null, "pending"],
  ["pending", "approved"],
  ["pending", "rejected"],
];

/** هل الزوجُ مُعلَنٌ في جدولِ العقد؟ `null` مفتاحُ الإنشاء (∅ → draft). */
export function isAllowedStoreTransition(from: StoreState | null, to: StoreState): boolean {
  return STORE_ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function isAllowedProductTransition(from: ProductState | null, to: ProductState): boolean {
  return PRODUCT_ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function isAllowedModerationTransition(
  from: ProductModerationState | null,
  to: ProductModerationState,
): boolean {
  return PRODUCT_MODERATION_ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/**
 * حرسُ قرارِ متجرٍ واحد: يُعيد الحالةَ الناتجةَ أو يرمي.
 *
 * الترتيبُ مقصود: يُفحَص **الانتقالُ** قبل **السبب**. لو فُحِص السببُ أوّلاً لقيل لمُراجعٍ
 * يحاول إيقافَ متجرٍ مُؤرشَفٍ «ينقصك سبب»، فيُرسل سبباً ثمّ يُرفَض ثانيةً لعلّةٍ أخرى: رسالتان
 * لخطأٍ واحد. والانتقالُ هو الأصلُ، والسببُ شرطٌ على قرارٍ جائزٍ أصلاً.
 */
export function assertStoreDecision(input: {
  fromState: StoreState | null;
  decision: StoreDecision;
  reasonCode?: StoreReasonCode;
}): StoreState {
  const toState = STORE_DECISION_RESULT_STATE[input.decision];
  if (!isAllowedStoreTransition(input.fromState, toState)) {
    throw storeDecisionNotAllowed(input.fromState, toState, input.decision);
  }
  if (STORE_DECISIONS_REQUIRING_REASON.includes(input.decision) && input.reasonCode === undefined) {
    throw storeRejectionReasonRequired(input.decision);
  }
  if (STORE_DECISIONS_FORBIDDING_REASON.includes(input.decision) && input.reasonCode !== undefined) {
    throw storeDecisionNotAllowed(input.fromState, toState, input.decision);
  }
  return toState;
}

/** حرسُ انتقالِ حالةِ منتج (`publish` · `archive`). `archived` نهائيّةٌ بلا مَخرج (القرار 9). */
export function assertProductTransition(from: ProductState | null, to: ProductState): ProductState {
  if (!isAllowedProductTransition(from, to)) throw productTransitionNotAllowed(from, to);
  return to;
}

/**
 * حرسُ قرارِ اعتدال. يرمي `PRODUCT_TRANSITION_NOT_ALLOWED` لأنّه الرمزُ المُعلَنُ لحالةِ منتجٍ
 * لا تقبل ما طُلِب — ولا يُخترَع رمزٌ ثانٍ لأنّ الكتالوجَ مُقفَلٌ في العقدِ من المراجعة 1/6.
 *
 * وسببُ رفضِ المنتجِ إلزاميٌّ وسببُ اعتمادِه ممنوع، حرفاً بحرفٍ كقيدِ `product_reviews` في
 * المخطّط. ولماذا `MARKETPLACE_VALIDATION_FAILED` لا `STORE_REJECTION_REASON_REQUIRED`؟ لأنّ
 * الثاني رمزُ **متجرٍ** باسمه، واستعمالُه لمنتجٍ يجعل مستهلكاً يقرأ الرمزَ فيفتح ملفَّ متجرٍ
 * ليُصلح ما لا يُصلَح هناك. والكتالوجُ مُقفَلٌ فلا رمزَ ثالثاً يُخترَع في المجال.
 */
export function assertProductDecision(input: {
  fromState: ProductModerationState | null;
  decision: ProductDecision;
  reasonCode?: ProductReasonCode;
}): ProductModerationState {
  const toState = PRODUCT_DECISION_RESULT_STATE[input.decision];
  if (!isAllowedModerationTransition(input.fromState, toState)) {
    throw productTransitionNotAllowed(input.fromState, toState);
  }
  if (input.decision === "rejected" && input.reasonCode === undefined) {
    throw validationFailed("reason_code", "one of the declared PRODUCT_REASON_CODES");
  }
  if (input.decision === "approved" && input.reasonCode !== undefined) {
    throw validationFailed("reason_code", "absent when the moderation decision is approved");
  }
  return toState;
}
