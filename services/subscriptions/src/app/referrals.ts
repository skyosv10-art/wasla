/**
 * طبقةُ الاستعمال للإحالة — **المطالبةُ تُسجّل واقعةً، ولا تحكم ولا تكافئ**.
 *
 * ## القرارُ المركزيّ: `pending` مُخرَجُ المطالبةِ الوحيد
 *
 * المطالبةُ تكتب إحالةً `pending` وتنتهي. لا تسأل عن وقائعِ المُحال، ولا عن حالةِ المُحيل،
 * ولا تمنح يوماً واحداً. والتأهيلُ (`qualifyReferral`) والمكافأةُ (`applyReferralReward`)
 * يقعان في مستهلكِ الأحداث والنبضةِ في المراجعة 5/6.
 *
 * ولمَ لا يُحكَم عند المطالبة؟ لسببين مكتوبين في `domain/referral.ts`:
 *
 * 1. **أسبابُ الرفضِ متقلّبة.** «المُحيلُ غيرُ نشط» حقيقةُ اليومِ تتغيّر غداً بدفعة، و«لا
 *    وقائعَ كافية» تتغيّر بكلّ طلبٍ يُنفّذه المُحال. فحكمٌ يُثبَّت عند التسجيل يُجمّد سبباً
 *    زائلاً في صفٍّ دائم، ثمّ يقرأ المستهلكُ رفضاً صار غيرَ صحيح.
 * 2. **المكافأةُ على التسجيلِ هي النسخةُ الخاطئةُ الأرخص** بعينها: توزيعُ رمزٍ، وفتحُ
 *    حساباتٍ، ومنحُ ثلاثين يوماً لكلّ حسابٍ نام فوراً.
 *
 * فما يُفحَص هنا حقائقُ **بنيويةٌ لا تتغيّر أبداً**: الإحالةُ الذاتيةُ، ووجودُ الرمزِ، وإحالةٌ
 * سابقةٌ للمُحال، ونافذةُ الخطّة. وثلاثتُها الأولى أخطاءٌ لا أسبابُ رفضٍ مخزنة، لأنّ الطالبَ
 * يحتاج جواباً الآن لا صفّاً يقرأه لاحقاً.
 *
 * ## نافذةُ الإحالة: رقمٌ في نسخةِ الخطّة لا ثابتٌ في الكود
 *
 * `window_ends_at` تُحسب من **لحظةِ المطالبة** وأيّامِ النافذةِ في نسخةِ خطّةِ **المُحيل**
 * (`referralWindowEnd`). ولمَ خطّةُ المُحيل؟ لأنّ المكافأةَ ستُمنح له بأيّامٍ من نسختِه، فمن
 * غيرِ المعقولِ أن تُقاس نافذتُها بأرقامِ خطّةٍ أخرى. والقيمةُ تُخزَّن في الصفّ ولا تُحسب عند
 * كلّ قراءة: نافذةٌ تُعاد حسابُها بعد تعديلِ الكتالوج تُغيّر ماضياً بصمت.
 *
 * ## الرمزُ لا يُنشأ في القراءة
 *
 * `GET /referrals/codes/{ownerPublicId}` قراءةٌ محضة، وغيابُ الرمزِ `404`. الرمزُ يُبذَر مع
 * بدءِ الاشتراك (`app/subscriptions.ts`) داخل معاملتِه — لأنّ إنشاءً ضمنيّاً في `GET` يجعل
 * قراءةً بريئةً تكتب صفّاً، ويُنتج لمالكٍ واحدٍ رموزاً متنافسةً عند تزامنِ قراءتين.
 */

import {
  refereeAlreadyReferred,
  referralCodeNotFound,
  referralFilterRequired,
  referralSelfForbidden,
  referralWindowClosed,
  subscriptionUnavailable,
  validationFailed,
} from "../domain/errors.js";
import { assertReferralCode, assertWaslaPublicId } from "../domain/identifiers.js";
import { referralWindowEnd } from "../domain/referral.js";
import { assertTimestamp, isAtOrAfter, type Clock } from "../domain/time.js";
import type { ReferralCodeRecord, ReferralFilter, ReferralRecord } from "../db/referrals.js";
import type { SubscriptionUnitOfWork } from "../db/unit-of-work.js";

/** سقفُ `ReferralList` في العقد. يُقرأ هنا ولا يُخترع رقمٌ ثانٍ في الاستعلام. */
export const REFERRAL_LIST_LIMIT = 200;

export interface ClaimInput {
  readonly referralCode: string;
  readonly refereePublicId: string;
  readonly claimedAt: string;
  readonly traceId?: string | null;
}

export interface ClaimOutcome {
  readonly referral: ReferralRecord;
  /** إعادةُ نفسِ المطالبةِ تُعلَن صراحةً كي لا يعدّها العميلُ مطالبةً جديدة. */
  readonly duplicate: boolean;
}

export class ReferralService {
  constructor(
    private readonly uow: SubscriptionUnitOfWork,
    private readonly clock: Clock,
  ) {}

  /** رمزُ مالكٍ كما استقرّ؛ ولا يُولَّد رمزٌ في هذا الطريق. */
  async getCode(owner: string): Promise<ReferralCodeRecord> {
    const ownerPublicId = assertWaslaPublicId(owner, "owner_public_id");
    return this.uow.read(async ({ stores }) => {
      const code = await stores.referrals.readCodeByOwner(ownerPublicId);
      if (!code) throw referralCodeNotFound();
      return code;
    });
  }

  /**
   * قراءةُ الإحالاتِ بمُرشِّحٍ إلزاميّ.
   *
   * والإلزامُ ليس تضييقاً بلا سبب: قراءةٌ بلا مُرشِّحٍ تُصدّر شبكةَ إحالاتِ كلِّ السائقين
   * بطلبٍ واحد، وتتوسّع بلا حدٍّ مع الجدول. والحدُّ الأعلى من العقدِ نفسِه لا من تقدير.
   */
  async list(filter: ReferralFilter): Promise<ReadonlyArray<ReferralRecord>> {
    if (
      filter.referrerPublicId === undefined &&
      filter.refereePublicId === undefined &&
      filter.state === undefined
    ) {
      throw referralFilterRequired();
    }
    if (filter.referrerPublicId !== undefined) {
      assertWaslaPublicId(filter.referrerPublicId, "referrer_public_id");
    }
    if (filter.refereePublicId !== undefined) {
      assertWaslaPublicId(filter.refereePublicId, "referee_public_id");
    }
    return this.uow.read(({ stores }) => stores.referrals.listReferrals(filter, REFERRAL_LIST_LIMIT));
  }

  /**
   * مطالبةٌ برمزٍ موجود: تُسجّل إحالةً `pending` أو تُعيد المطالبةَ نفسَها.
   *
   * ترتيبُ الفحصِ مقصود ومطابقٌ لترتيبِ الأسبابِ المُعلَنِ في المجال قدرَ ما ينطبق هنا:
   * الذاتيّةُ أوّلاً (حقيقةٌ بنيويةٌ لا تتغيّر)، ثمّ إحالةُ المُحال السابقة، ثمّ النافذة.
   * ولو قُدّمت النافذةُ على الذاتيّة لأعطت الإحالةُ الذاتيةُ المتأخّرةُ سببَين مختلفَين في
   * يومَين، ولصار سببُ الرفضِ خاصيّةً للتنفيذِ لا للقاعدة.
   */
  async claim(input: ClaimInput): Promise<ClaimOutcome> {
    // ولمَ تُفحص هنا وقد فُحصت على الحدّ? لأنّ الحدّ ليس المُنادي الوحيد، ولأنّ الرمزَ
    // المشوّه كان سيُقرأ من المخزنِ فيُجيب `404` عن سببٍ خاطئ: «لا مالكَ لهذا الرمز»
    // غيرُ «رمزٌ لا يمكن أن يوجد أصلاً»، والفرقُ هو ما يقرأه الدعمُ في شكوى سائق.
    assertReferralCode(input.referralCode);
    assertWaslaPublicId(input.refereePublicId, "referee_public_id");
    const claimedAt = this.declaredInstant(input.claimedAt, "claimed_at");
    const { value } = await this.uow.write(async ({ stores }) => {
      const code = await stores.referrals.readCode(input.referralCode);
      // رمزٌ لا مالكَ له موردٌ غائب؛ ولا يُختلَق مالكٌ من الرمزِ نفسِه.
      if (!code) throw referralCodeNotFound();

      const referrerPublicId = code.ownerPublicId;
      if (referrerPublicId === input.refereePublicId) throw referralSelfForbidden();

      const existing = await stores.referrals.readByReferee(input.refereePublicId);
      if (existing) {
        // نفسُ الرمزِ ونفسُ المُحال ⇒ إعادةُ تسليمٍ، تُعاد المطالبةُ المحفوظةُ بلا صفٍّ ثانٍ.
        if (existing.referralCode === input.referralCode) {
          return { referral: existing, duplicate: true } satisfies ClaimOutcome;
        }
        // رمزٌ آخرُ لمُحالٍ له إحالةٌ قائمةٌ ⇒ تعارضٌ: إحالتان لسائقٍ واحدٍ تعنيان مكافأتين
        // على وصولٍ واحد. و`rejected` تُحسب أيضاً، وإلّا صارت إعادةُ المحاولةِ تُلغي الرفض.
        throw refereeAlreadyReferred(existing.state);
      }

      // نسخةُ خطّةِ المُحيلِ من صفِّه المُتحقِّق: الرمزُ لا يوجد إلّا لمن بدأ اشتراكاً، فغيابُ
      // الصفِّ عطبُ بياناتٍ لا طلبٌ خاطئ — و`503` أصدقُ من `404` يقول للطالب إنّ رمزَه وهمٌ.
      const owner = await stores.projection.read(referrerPublicId);
      if (!owner) throw subscriptionUnavailable("subscription row for the referral code owner");
      const plan = await stores.ledger.readPlanVersion(owner.planCode, owner.planVersion);
      if (!plan) throw subscriptionUnavailable("catalog row for the referrer plan version");

      const windowEndsAt = referralWindowEnd(claimedAt, plan);
      // نافذةٌ مضت قبل أن تُسجَّل المطالبةُ أصلاً: القيمةُ مقروءةٌ والمانعُ رقمٌ في نسخةِ الخطّة.
      if (isAtOrAfter(claimedAt, windowEndsAt)) {
        throw referralWindowClosed(plan.planCode, plan.planVersion);
      }

      const referral = await stores.referrals.insertReferral({
        referralCode: input.referralCode,
        referrerPublicId,
        refereePublicId: input.refereePublicId,
        // `pending` لا `qualified`: الحكمُ يقع على وقائعَ مُسجّلةٍ في 5/6 لا على التسجيل.
        state: "pending",
        reasonCode: null,
        qualifyingFactCount: 0,
        planCode: plan.planCode,
        planVersion: plan.planVersion,
        windowEndsAt,
        claimedAt,
        traceId: input.traceId ?? null,
      });

      return { referral, duplicate: false } satisfies ClaimOutcome;
    });
    return value;
  }

  /** نفسُ حارسِ لحظةِ الاشتراك: لحظةٌ في المستقبل تفتح نافذةً لم تبدأ بعد. */
  private declaredInstant(value: string, field: string): string {
    const instant = assertTimestamp(value, field);
    const now = assertTimestamp(this.clock.now(), "now");
    if (isAtOrAfter(instant, now) && instant !== now) {
      throw validationFailed(field, "instant not ahead of the service clock");
    }
    return instant;
  }
}
