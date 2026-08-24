/**
 * قراءةُ اسمِ القيدِ من خطأِ المحرّك — موضعٌ واحدٌ يقرؤه المخزنُ والصفُّ المُتحقِّق ووحدةُ العمل.
 *
 * كان هذا المنطقُ خاصّاً بـ`repository.ts` في المراجعة 3/6، وصار في المراجعة 4/6 لثلاثةِ
 * مُنادين: المخزنُ يُترجم القيدَ إلى رمزِ مجال، وطبقةُ الإحالة تُترجم `ux_referrals_referee`
 * إلى «مطالبةٌ مُعادة»، ووحدةُ العمل تعرف من الاسم وحدَه أنّ الفشلَ **سباقُ تسلسلٍ** يُعاد
 * تشغيلُه لا عطبٌ يُرمى إلى المُنادي. ونسخةٌ ثانيةٌ من هذه الدالّة كانت ستُصلح في مكانٍ
 * وتبقى مكسورةً في آخر، والأسوأُ أنّ الفرقَ لا يظهر إلّا في سباقٍ نادر.
 *
 * ولماذا سلسلةُ `cause`؟ لأنّ Drizzle يُغلّف خطأَ `pg`، فقراءةُ `error.constraint` على السطح
 * تُعيد `undefined` على خطأٍ يحمل الاسمَ في طبقةٍ أعمق — فيبدو كأنّ القيدَ لم يرفض شيئاً.
 */

/** اسمُ القيدِ إن وُجد في أيّ طبقةٍ من سلسلةِ الأسباب (بحدٍّ للعمق: لا حلقةَ لا نهائية). */
export function constraintOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null && typeof current === "object"; depth += 1) {
    const named = current as { readonly constraint?: unknown; readonly cause?: unknown };
    if (typeof named.constraint === "string" && named.constraint.length > 0) {
      return named.constraint;
    }
    if (named.cause === current) return undefined;
    current = named.cause;
  }
  return undefined;
}

/**
 * القيدُ الذي يحمي تسلسلَ الانتقالات — واسمُه هو شرطُ إعادةِ المحاولة.
 *
 * `insertTransition` يقرأ آخرَ تسلسلٍ ثمّ يكتب الذي يليه، فمُحاولتان متزامنتان لسائقٍ واحدٍ
 * تنجح إحداهما وتفشل الأخرى على هذا القيد. وهذا **فشلٌ مُسمّىً يُعاد تشغيلُه** (وحدةُ العمل)
 * لا خطأٌ يُعاد إلى العميل: النسخةُ الخاطئةُ الأرخص أن يُختَرع التسلسلُ في الذاكرة بلا قيدٍ،
 * فيعيش انتقالان برقمٍ واحدٍ في الدفتر إلى الأبد ولا يقول أحدٌ أيُّهما وقع أوّلاً.
 */
export const TRANSITION_SEQUENCE_CONSTRAINT = "ux_subscription_transitions_sequence";

/** أخطاءُ التسلسل وحدَها تُعاد؛ ما عداها يصعد كما هو (لا إعادةَ محاولةٍ على عطبِ بيئة). */
export function isTransitionSequenceRace(error: unknown): boolean {
  return constraintOf(error) === TRANSITION_SEQUENCE_CONSTRAINT;
}
