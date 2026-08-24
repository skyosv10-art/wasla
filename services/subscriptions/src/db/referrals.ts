/**
 * مخزنُ الإحالة — إضافةٌ وقراءةٌ، و**تقدُّمُ حالةٍ في اتّجاهٍ واحدٍ محروسٍ بحالتِها السابقة**.
 *
 * ## ما تغيّر في المراجعة 5/6 ولِمَ
 *
 * حتى المراجعة 4/6 كان هذا الملفُّ **بلا تعديلٍ بحال**، وترويستُه تقول إنّ دالّةَ تعديلٍ بلا
 * مُنادٍ تُغري أوّلَ مسارٍ يحتاج «تصحيحاً سريعاً». والمراجعةُ 5/6 تُضيف المُنادي: مستهلكُ
 * وقائعِ السمعة يُقدّم المطالبةَ `pending → qualified → rewarded`، ويعدّ الوقائعَ المُؤهِّلة.
 * فالتعديلُ صار له سببٌ، والحرسُ انتقل من «لا دالّة» إلى **شكلِ الدالّة**:
 *
 *   1. **لا حقلَ حالةٍ يُكتب بلا حالةٍ سابقةٍ في `WHERE`.** `advanceState` تُلزم `from`،
 *      فتُصبح الكتابةُ ذرّيّةً في وجهِ وقيعتَين متزامنتين: الثانيةُ تجد صفراً معدَّلاً وتُعيد
 *      `null` بدل أن تُثبّت تأهّلاً مرّتين. و`SET state = $1` بلا شرطٍ كان سيُقبل قفزةً من
 *      `rejected` إلى `rewarded` بلا أن يمنعها شيء.
 *   2. **لا تراجعَ.** الأزواجُ المسموحةُ معدودةٌ في `REFERRAL_STATE_ADVANCES`، ويُقرأ الاسمُ
 *      في الاختبار. ومطالبةٌ تعود من `rewarded` إلى `pending` تعني مكافأةً تُمنح مرّتين.
 *   3. **ولا حالةَ `rejected` تُكتب بعد المطالبة.** الرفضُ حكمٌ في لحظتِه، ومطالبةٌ لم تبلغ
 *      العتبةَ تبقى `pending` حتى تُغلق نافذتُها — أي أنّ `pending` حالةُ **تخزينٍ** لا
 *      حكمٌ. ولو كُتب الرفضُ عند كلّ واقعةٍ لا تكفي، لَصار السائقُ يقرأ «مرفوضة» عن إحالةٍ
 *      ما زالت نافذتُها مفتوحةً وقد تتأهّل غداً (انظر `domain/referral.ts`).
 *
 * وسببُ الرفضِ يُحسب في المجال (`qualifyReferral`) لا هنا: هذا الملفُّ يكتب ما أُعطي،
 * والقاعدةُ تحرسه بـ`ck_referrals_reason_code` (سببٌ إن رُفض وإلّا فلا) و`ck_referrals_not_self`.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type { ReferralRejectionReason, ReferralState } from "../domain/contract-sets.js";
import { validationFailed } from "../domain/errors.js";
import type { DbOrTx } from "./client.js";
import { referralCodes, referralRewards, referrals } from "./schema.js";

/** رمزُ إحالةٍ كما استقرّ في القاعدة. */
export interface ReferralCodeRecord {
  readonly referralCode: string;
  readonly ownerPublicId: string;
  readonly isActive: boolean;
  readonly createdAt: string;
}

/** مطالبةٌ كما استقرّت — والمكافأةُ صفٌّ في `referral_rewards` يُقرأ بـ`readRewardByReferral`. */
export interface ReferralRecord {
  readonly referralId: string;
  readonly referralCode: string;
  readonly referrerPublicId: string;
  readonly refereePublicId: string;
  readonly state: ReferralState;
  readonly reasonCode: ReferralRejectionReason | null;
  readonly qualifyingFactCount: number;
  readonly planCode: string;
  readonly planVersion: number;
  readonly windowEndsAt: string;
  readonly claimedAt: string;
  readonly stateChangedAt: string;
  readonly createdAt: string;
}

/** ما يُكتب عند المطالبة — بلا مُعرّفٍ ولا `created_at`: كلاهما من المحرّك. */
export interface ReferralDraft {
  readonly referralCode: string;
  readonly referrerPublicId: string;
  readonly refereePublicId: string;
  readonly state: ReferralState;
  readonly reasonCode: ReferralRejectionReason | null;
  readonly qualifyingFactCount: number;
  readonly planCode: string;
  readonly planVersion: number;
  readonly windowEndsAt: string;
  readonly claimedAt: string;
  readonly traceId: string | null;
}

/** مُرشِّحُ القراءة — واحدٌ منه على الأقلّ إلزاميٌّ عند حدّ HTTP لا هنا. */
export interface ReferralFilter {
  readonly referrerPublicId?: string;
  readonly refereePublicId?: string;
  readonly state?: ReferralState;
}

interface CodeRow {
  readonly referralCode: string;
  readonly ownerPublicId: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

interface ReferralRow {
  readonly referralId: string;
  readonly referralCode: string;
  readonly referrerPublicId: string;
  readonly refereePublicId: string;
  readonly state: string;
  readonly reasonCode: string | null;
  readonly qualifyingFactCount: number;
  readonly planCode: string;
  readonly planVersion: number;
  readonly windowEndsAt: Date;
  readonly claimedAt: Date;
  readonly stateChangedAt: Date;
  readonly createdAt: Date;
}

function toCode(row: CodeRow): ReferralCodeRecord {
  return {
    referralCode: row.referralCode,
    ownerPublicId: row.ownerPublicId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function toReferral(row: ReferralRow): ReferralRecord {
  return {
    referralId: row.referralId,
    referralCode: row.referralCode,
    referrerPublicId: row.referrerPublicId,
    refereePublicId: row.refereePublicId,
    state: row.state as ReferralState,
    reasonCode: row.reasonCode as ReferralRejectionReason | null,
    qualifyingFactCount: row.qualifyingFactCount,
    planCode: row.planCode,
    planVersion: row.planVersion,
    windowEndsAt: row.windowEndsAt.toISOString(),
    claimedAt: row.claimedAt.toISOString(),
    stateChangedAt: row.stateChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** مكافأةٌ كما استقرّت — و`grantedPeriodId` يُشير إلى المُدّةِ التي دخلت الدفترَ فعلاً. */
export interface ReferralRewardRecord {
  readonly rewardId: string;
  readonly referralId: string;
  readonly grantedPeriodId: string;
  readonly beneficiaryPublicId: string;
  readonly rewardDays: number;
  readonly planCode: string;
  readonly planVersion: number;
  readonly grantedAt: string;
  readonly createdAt: string;
}

/** ما يُكتب عند المنح — بلا مُعرّفٍ ولا `created_at`: كلاهما من المحرّك. */
export interface ReferralRewardDraftRow {
  readonly referralId: string;
  readonly grantedPeriodId: string;
  readonly beneficiaryPublicId: string;
  readonly rewardDays: number;
  readonly planCode: string;
  readonly planVersion: number;
  readonly grantedAt: string;
  readonly traceId: string | null;
}

interface RewardRow {
  readonly rewardId: string;
  readonly referralId: string;
  readonly grantedPeriodId: string;
  readonly beneficiaryPublicId: string;
  readonly rewardDays: number;
  readonly planCode: string;
  readonly planVersion: number;
  readonly grantedAt: Date;
  readonly createdAt: Date;
}

function toReward(row: RewardRow): ReferralRewardRecord {
  return {
    rewardId: row.rewardId,
    referralId: row.referralId,
    grantedPeriodId: row.grantedPeriodId,
    beneficiaryPublicId: row.beneficiaryPublicId,
    rewardDays: row.rewardDays,
    planCode: row.planCode,
    planVersion: row.planVersion,
    grantedAt: row.grantedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * الأزواجُ المسموحةُ لتقدُّمِ الحالة — مُعلَنةٌ لتُقرأ في الاختبار لا لتُصان في الرؤوس.
 *
 * ولا زوجَ يعود إلى الوراء، ولا زوجَ ينتهي إلى `rejected`: الرفضُ يُكتب عند المطالبةِ وحدَها
 * (انظر ترويسةَ الملفّ).
 */
export const REFERRAL_STATE_ADVANCES: ReadonlyArray<readonly [ReferralState, ReferralState]> =
  Object.freeze([
    ["pending", "qualified"],
    ["qualified", "rewarded"],
  ]);

export class PostgresReferralStore {
  constructor(private readonly db: DbOrTx) {}

  async readCodeByOwner(ownerPublicId: string): Promise<ReferralCodeRecord | null> {
    const rows = await this.db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.ownerPublicId, ownerPublicId))
      .limit(1);
    const row = rows[0];
    return row ? toCode(row) : null;
  }

  async readCode(referralCode: string): Promise<ReferralCodeRecord | null> {
    const rows = await this.db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.referralCode, referralCode))
      .limit(1);
    const row = rows[0];
    return row ? toCode(row) : null;
  }

  /**
   * يُثبّت رمزَ مالكٍ ويُعيده — ومن سبقه بنفس المالك يفوز والصفُّ الأوّلُ هو الجواب.
   *
   * `onConflictDoNothing` ثمّ قراءةٌ: لا تعديلَ على صفٍّ قائمٍ (الرمزُ لا يُستبدَل بنصّ
   * العقد: «تعطيلُه لا يستبدله برمزٍ جديدٍ للمالك نفسه»)، ولا فشلَ في وجهِ مُنادين متزامنين.
   */
  async ensureCode(referralCode: string, ownerPublicId: string): Promise<ReferralCodeRecord> {
    await this.db
      .insert(referralCodes)
      .values({ referralCode, ownerPublicId })
      .onConflictDoNothing();
    const stored = await this.readCodeByOwner(ownerPublicId);
    if (!stored) throw validationFailed("referral_code", "one stored code for the owner");
    return stored;
  }

  /** مطالبةُ المُحال إن وُجدت — `ux_referrals_referee` يضمن أنّها واحدةٌ لا أكثر. */
  async readByReferee(refereePublicId: string): Promise<ReferralRecord | null> {
    const rows = await this.db
      .select()
      .from(referrals)
      .where(eq(referrals.refereePublicId, refereePublicId))
      .limit(1);
    const row = rows[0];
    return row ? toReferral(row) : null;
  }

  /**
   * يُضيف مطالبةً — و`state_changed_at` هي `claimed_at` نفسُها في هذه اللحظة.
   *
   * لا لحظةَ ثالثةً تُخترع للتغيير: الحالةُ الأولى **هي** المطالبة، وعمودٌ يقول غيرَ ذلك
   * كان سيجعل «متى صارت الحالةُ كذا؟» سؤالاً له جوابان في نفس الصفّ.
   */
  async insertReferral(draft: ReferralDraft): Promise<ReferralRecord> {
    const rows = await this.db
      .insert(referrals)
      .values({
        referralId: sql`gen_random_uuid()`,
        referralCode: draft.referralCode,
        referrerPublicId: draft.referrerPublicId,
        refereePublicId: draft.refereePublicId,
        state: draft.state,
        reasonCode: draft.reasonCode,
        qualifyingFactCount: draft.qualifyingFactCount,
        planCode: draft.planCode,
        planVersion: draft.planVersion,
        windowEndsAt: new Date(draft.windowEndsAt),
        claimedAt: new Date(draft.claimedAt),
        stateChangedAt: new Date(draft.claimedAt),
        traceId: draft.traceId,
      })
      .returning();
    const row = rows[0];
    if (!row) throw validationFailed("referral", "one inserted row");
    return toReferral(row);
  }

  /** قراءةٌ بمُرشِّحٍ — الأحدثُ أوّلاً، بحدٍّ يفرضه المُنادي (سقفُ العقد 200). */
  async listReferrals(
    filter: ReferralFilter,
    limit: number,
  ): Promise<ReadonlyArray<ReferralRecord>> {
    const conditions = [
      filter.referrerPublicId === undefined
        ? undefined
        : eq(referrals.referrerPublicId, filter.referrerPublicId),
      filter.refereePublicId === undefined
        ? undefined
        : eq(referrals.refereePublicId, filter.refereePublicId),
      filter.state === undefined ? undefined : eq(referrals.state, filter.state),
    ].filter((condition) => condition !== undefined);
    if (conditions.length === 0) {
      throw validationFailed("filter", "at least one referral filter");
    }
    const rows = await this.db
      .select()
      .from(referrals)
      .where(and(...conditions))
      .orderBy(desc(referrals.createdAt), asc(referrals.refereePublicId))
      .limit(limit);
    return rows.map(toReferral);
  }

  /**
   * يزيد عدّادَ الوقائعِ المُؤهِّلةِ بواحد، و**لا يزيده إلّا لمطالبةٍ ما زالت `pending`**.
   *
   * الزيادةُ في القاعدة (`count + 1`) لا في الكود: قراءةٌ ثمّ كتابةٌ بقيمةٍ محسوبةٍ عندنا
   * تفقد واقعةً كلَّما وصلت وقيعتان في نفسِ اللحظة (كلتاهما تقرأ 3 وتكتب 4)، والعدّادُ هو
   * بعينه ما تُقاس عليه العتبة — فنقصُ واحدٍ يمنع مكافأةً مستحقّة.
   *
   * و`state = 'pending'` في الشرط: مطالبةٌ كُوفئت لا يُزاد عدّادُها، وإلّا صار الصفُّ يقول
   * «12 من 5» فيُقرأ بعد شهرٍ كأنّ العتبةَ كانت مختلفة.
   *
   * ويُعاد `null` حين لا يُطابق صفٌّ — والمُنادي يُفرّق: `null` تعني «لا عملَ هنا» لا خطأً.
   */
  async incrementQualifyingFacts(referralId: string): Promise<ReferralRecord | null> {
    const rows = await this.db
      .update(referrals)
      .set({ qualifyingFactCount: sql`${referrals.qualifyingFactCount} + 1` })
      .where(and(eq(referrals.referralId, referralId), eq(referrals.state, "pending")))
      .returning();
    const row = rows[0];
    return row ? toReferral(row) : null;
  }

  /**
   * يُقدّم الحالةَ من `from` إلى `to`، ويُعيد `null` إن لم تكن الحالةُ السابقةُ كما أُعلنت.
   *
   * `from` وسيطٌ **إلزاميّ** لا اختياريّ: هو القفلُ بلا قفل. ومُنادٍ لا يعرف الحالةَ السابقةَ
   * لا يجوز أن يُقدّم الحالةَ أصلاً، لأنّه حينئذٍ يكتب حكماً بُني على قراءةٍ صارت قديمة.
   *
   * و`stateChangedAt` يُمرَّر ولا يُقرأ من ساعةِ القاعدة: لحظةُ **القرارِ** واحدةٌ في المعاملة
   * كلِّها (الحدثُ والصفُّ والمُدّة)، و`now()` في الاستعلامِ كان سيُنتج ثلاثَ لحظاتٍ متقاربةٍ
   * تجعل «متى تأهّلت؟» سؤالاً له ثلاثةُ أجوبةٍ في نفس الطلب.
   */
  async advanceState(
    referralId: string,
    transition: { readonly from: ReferralState; readonly to: ReferralState; readonly changedAt: string },
  ): Promise<ReferralRecord | null> {
    const allowed = REFERRAL_STATE_ADVANCES.some(
      ([from, to]) => from === transition.from && to === transition.to,
    );
    if (!allowed) {
      // رفضٌ صريحٌ قبل لمسِ القاعدة: زوجٌ غيرُ مُعلَنٍ عطبُ كودٍ لا حالةُ بياناتٍ، ولا يجوز
      // أن يظهر كـ«لم يُطابق صفٌّ» فيُقرأ كأنّه سباقٌ عاديّ.
      throw validationFailed("state", `an advance declared in REFERRAL_STATE_ADVANCES`);
    }
    const rows = await this.db
      .update(referrals)
      .set({ state: transition.to, stateChangedAt: new Date(transition.changedAt) })
      .where(and(eq(referrals.referralId, referralId), eq(referrals.state, transition.from)))
      .returning();
    const row = rows[0];
    return row ? toReferral(row) : null;
  }

  /**
   * يكتب صفَّ المكافأة — و`ux_referral_rewards_referral` يجعل الثانيةَ مستحيلة.
   *
   * ولا `onConflictDoNothing` هنا: مكافأةٌ ثانيةٌ لنفسِ الإحالةِ **عطبٌ يجب أن يُفشل
   * المعاملة**، لا حالةٌ تُبتلَع بهدوء. فالمنعُ الصامتُ كان سيُخفي أنّ المستهلكَ عالج نفسَ
   * الواقعةِ مرّتين، ويُثبّت مُدّةً ثانيةً في الدفتر بلا صفِّ مكافأةٍ يُفسّرها — أي أيّاماً
   * لا يعرف أحدٌ من أين جاءت.
   */
  async insertReward(draft: ReferralRewardDraftRow): Promise<ReferralRewardRecord> {
    const rows = await this.db
      .insert(referralRewards)
      .values({
        rewardId: sql`gen_random_uuid()`,
        referralId: draft.referralId,
        grantedPeriodId: draft.grantedPeriodId,
        beneficiaryPublicId: draft.beneficiaryPublicId,
        rewardDays: draft.rewardDays,
        planCode: draft.planCode,
        planVersion: draft.planVersion,
        grantedAt: new Date(draft.grantedAt),
        traceId: draft.traceId,
      })
      .returning();
    const row = rows[0];
    if (!row) throw validationFailed("referral_reward", "one inserted row");
    return toReward(row);
  }

  /** مكافأةُ إحالةٍ إن مُنحت — قراءةٌ يحتاجها المستهلكُ ليُميّز «كُوفئت» من «تأهّلت». */
  async readRewardByReferral(referralId: string): Promise<ReferralRewardRecord | null> {
    const rows = await this.db
      .select()
      .from(referralRewards)
      .where(eq(referralRewards.referralId, referralId))
      .limit(1);
    const row = rows[0];
    return row ? toReward(row) : null;
  }
}
