/**
 * اشتقاقُ الحالة: `stores.state` و`products.moderation_state` **إسقاطٌ مُتحقَّقٌ** لا حقيقةٌ أولى.
 *
 * ADR-016 القرار 1: الحقيقةُ دفترٌ يُضاف إليه ولا يُحدَّث (`store_reviews` · `product_reviews`)،
 * والعمودُ نسخةٌ سريعةٌ للقراءةِ يجب أن **يُعاد بناؤها بلا خسارة**: تُسقِط العمودَ وتُشغّل
 * `deriveStoreState` على الدفترِ فتحصل على نفسِ القيمةِ حرفاً — وإلّا فالعمودُ ليس إسقاطاً بل
 * حقيقةٌ ثانيةٌ اسمُها إسقاط.
 *
 * ## لماذا لا يُقرأ آخرُ صفٍّ وحدَه
 *
 * لأنّه الخطأُ الأرخصُ الذي يبدو صحيحاً: `ORDER BY decided_at DESC LIMIT 1`. وهو يسقط في ثلاثةِ
 * مواضعَ مرّةً واحدة:
 *
 * 1. **الزمنُ ليس ترتيباً.** قرارُ مُراجعٍ وقرارٌ آليٌّ قد يحملان نفسَ `decided_at`، فيقرّر
 *    ترتيبُ الفرزِ غيرُ المستقرِّ حالةَ متجرٍ — فتتبدّل الحالةُ بين استعلامَين بلا كتابة.
 * 2. **الصفُّ الأخيرُ لا يُثبت أنّ ما قبله متّصل.** دفترٌ فيه ثغرةٌ (`state_sequence` من 1 إلى 3)
 *    يعني صفّاً ضاع في كتابةٍ نصفَ ناجحة، وآخرُ صفٍّ يُخفي ذلك ويُعطي حالةً «صحيحةً» كاذبة.
 * 3. **`first_approved_at` ليس في آخرِ صفّ.** لحظةُ أوّلِ اعتمادٍ تُقفَل بها `slug` (القرار 7)،
 *    وهي في صفٍّ قديمٍ قد يكون بعده إيقافٌ وإعادةٌ وأرشفة. من قرأ آخرَ صفٍّ فقدها، ومن فقدها
 *    أعاد `slug` متجرٍ مُؤرشَفٍ إلى السوقِ فوقعت روابطُ منشورةٌ على متجرٍ آخرَ لصاحبٍ آخر.
 *
 * فالاشتقاقُ هنا **يطوي الدفترَ كلَّه** ويتحقّق في كلّ خطوةٍ من أربعةِ أشياء: تسلسلٌ متّصلٌ،
 * وحالةٌ سابقةٌ مطابقةٌ لما هو مُسجَّلٌ في الصفّ، وانتقالٌ مُعلَنٌ في جدولِ العقد، وقرارٌ
 * يُنتج الحالةَ المكتوبة. وأربعتُها معاً هي ما يجعل قولَنا «الدفترُ حقيقةٌ» قولاً يُبرهَن لا
 * شعاراً في ADR.
 *
 * ## لماذا يُرفَض الدفترُ الفاسدُ ولا يُصلَح
 *
 * دالّةٌ تُصلح صامتةً (تتجاهل صفّاً لا يتّصل) تجعل حالةَ متجرٍ تعتمد على **ما تجاهلته**، ولا
 * أحدَ يعرف أنّ شيئاً تُجوهِل. والرمي هنا يُوقف كتابةَ إسقاطٍ كاذبٍ في المعاملة (المراجعة 3/6)
 * فيبقى العمودُ على قيمتِه القديمةِ الصحيحةِ ويُعلَن الخللُ بدلاً من أن يُدفَن.
 *
 * ولا ساعةَ تُسأل في هذا الملفِّ بحال: نفسُ الدفترِ ⇒ نفسُ الحالةِ، اليومَ وبعد سنةٍ وفي أيّ جهاز.
 */

import { type ProductModerationState, type StoreState } from "./contract-sets.js";
import { validationFailed } from "./errors.js";
import type {
  DerivedProductModeration,
  DerivedStoreState,
  ProductReviewEntry,
  StoreReviewEntry,
} from "./model.js";
import { isAtOrAfter } from "./time.js";
import {
  PRODUCT_DECISION_RESULT_STATE,
  STORE_DECISION_RESULT_STATE,
  isAllowedModerationTransition,
  isAllowedStoreTransition,
} from "./transitions.js";

/** حالةُ المتجرِ عند الإنشاء: `draft` بتسلسلٍ 1، مطابقةً لافتراضَي العمودَين في المخطّط. */
export const STORE_INITIAL_STATE: StoreState = "draft";
export const STORE_INITIAL_SEQUENCE = 1;

/** حالةُ اعتدالِ المنتجِ عند الإنشاء: `pending`. لا منتجَ يُنشَأ معتمَداً بحال. */
export const PRODUCT_INITIAL_MODERATION_STATE: ProductModerationState = "pending";
export const PRODUCT_INITIAL_MODERATION_SEQUENCE = 1;

/**
 * يطوي دفترَ مراجعاتِ متجرٍ إلى حالته. الدفترُ يُمرَّر **مرتّباً بـ`state_sequence`** كما
 * يُقرأ من `ix_store_reviews_store_seq`، والدالّةُ لا تفرزه: فرزٌ داخليٌّ يُخفي أنّ المُتّصلَ
 * قرأ بترتيبٍ خاطئ، ثمّ يعمل كلُّ شيءٍ في الاختبارِ ويسقط في استعلامٍ بلا `ORDER BY`.
 */
export function deriveStoreState(ledger: readonly StoreReviewEntry[]): DerivedStoreState {
  let state: StoreState = STORE_INITIAL_STATE;
  let sequence = STORE_INITIAL_SEQUENCE;
  let firstApprovedAt: string | undefined;
  let previousDecidedAt: string | undefined;

  for (const entry of ledger) {
    if (entry.stateSequence !== sequence + 1) {
      throw validationFailed("state_sequence", `contiguous sequence ${sequence + 1}`);
    }
    if (entry.fromState !== state) {
      throw validationFailed("from_state", `${state} (the state the ledger reached)`);
    }
    if (STORE_DECISION_RESULT_STATE[entry.decision] !== entry.toState) {
      throw validationFailed("to_state", `${STORE_DECISION_RESULT_STATE[entry.decision]} for this decision`);
    }
    if (!isAllowedStoreTransition(entry.fromState, entry.toState)) {
      throw validationFailed("to_state", "a transition declared in STORE_ALLOWED_TRANSITIONS");
    }
    assertActorShape(entry.actorType, entry.actorPublicId);
    if (previousDecidedAt !== undefined && !isAtOrAfter(entry.decidedAt, previousDecidedAt)) {
      throw validationFailed("decided_at", "an instant at or after the previous decision");
    }

    if (entry.toState === "approved" && firstApprovedAt === undefined) {
      firstApprovedAt = entry.decidedAt;
    }
    state = entry.toState;
    sequence = entry.stateSequence;
    previousDecidedAt = entry.decidedAt;
  }

  return firstApprovedAt === undefined
    ? { state, stateSequence: sequence }
    : { state, stateSequence: sequence, firstApprovedAt };
}

/**
 * يطوي دفترَ اعتدالِ منتجٍ إلى حالته.
 *
 * القرارُ الحاكمُ هنا: **الاعتدالُ عمودٌ مستقلٌّ عن `state`** (القرار 1). حالةُ النشرِ يملكها
 * صاحبُ المتجرِ وحالةُ الاعتدالِ يملكها مُراجعٌ، ودمجُهما في عمودٍ واحدٍ بست قيمٍ — وهو
 * الاختصارُ المُغري — يجعل نشرَ صاحبِ المتجرِ يمسح قرارَ المُراجعِ أو العكس، ولا يبقى في السوقِ
 * جوابٌ لسؤال «هل هذا المنتجُ مُعتمَدٌ ومُخفىً، أم مرفوضٌ ومعروض؟».
 */
export function deriveProductModerationState(
  ledger: readonly ProductReviewEntry[],
): DerivedProductModeration {
  let state: ProductModerationState = PRODUCT_INITIAL_MODERATION_STATE;
  let sequence = PRODUCT_INITIAL_MODERATION_SEQUENCE;
  let previousDecidedAt: string | undefined;

  for (const entry of ledger) {
    if (entry.moderationSequence !== sequence + 1) {
      throw validationFailed("moderation_sequence", `contiguous sequence ${sequence + 1}`);
    }
    if (entry.fromState !== state) {
      throw validationFailed("from_state", `${state} (the state the ledger reached)`);
    }
    if (PRODUCT_DECISION_RESULT_STATE[entry.decision] !== entry.toState) {
      throw validationFailed("to_state", `${PRODUCT_DECISION_RESULT_STATE[entry.decision]} for this decision`);
    }
    if (!isAllowedModerationTransition(entry.fromState, entry.toState)) {
      throw validationFailed("to_state", "a declared moderation transition");
    }
    if (entry.decision === "rejected" && entry.reasonCode === undefined) {
      throw validationFailed("reason_code", "one of the declared PRODUCT_REASON_CODES");
    }
    if (entry.decision === "approved" && entry.reasonCode !== undefined) {
      throw validationFailed("reason_code", "absent when the moderation decision is approved");
    }
    assertActorShape(entry.actorType, entry.actorPublicId);
    if (previousDecidedAt !== undefined && !isAtOrAfter(entry.decidedAt, previousDecidedAt)) {
      throw validationFailed("decided_at", "an instant at or after the previous decision");
    }

    state = entry.toState;
    sequence = entry.moderationSequence;
    previousDecidedAt = entry.decidedAt;
  }

  return { moderationState: state, moderationSequence: sequence };
}

/**
 * الفاعلُ: `system` وحدَه يُعفى من مُعرّفٍ مُسمّى، وكلُّ ما سواه **يلزمه** مُعرّفٌ علنيّ.
 *
 * ولماذا يُحرَس هنا لا في القاعدةِ وحدَها؟ لأنّ القيدَ في المخطّطِ يحمي الكتابةَ، وهذا يحمي
 * **القراءة**: دفترٌ فيه قرارُ مُراجعٍ بلا اسمٍ يجعل سؤالَ «من أوقف هذا المتجر؟» بلا جوابٍ في
 * تحقيقٍ إداريّ، وهو أوّلُ سؤالٍ يُسأل. و`system` مُستثنىً لأنّ فاعلَه النظامُ نفسُه ولا يُنسَب
 * قرارٌ آليٌّ إلى إنسانٍ لم يتّخذه.
 */
function assertActorShape(actorType: string, actorPublicId: string | undefined): void {
  if (actorType === "system") {
    if (actorPublicId !== undefined) {
      throw validationFailed("actor_public_id", "absent when actor_type is system");
    }
    return;
  }
  if (actorPublicId === undefined) {
    throw validationFailed("actor_public_id", "present for every non-system actor");
  }
}
