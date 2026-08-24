/**
 * مخزنُ الإحالة — **إضافةٌ وقراءةٌ فقط**، ولا تعديلَ على مطالبةٍ استقرّت.
 *
 * الحالةُ في `referrals` تُكتب مرّةً عند المطالبة (`pending` أو `rejected` بسببٍ مُعلَن)،
 * وتحويلُها إلى `qualified`/`rewarded` عملُ المراجعة 5/6 مع `referral_rewards` وسجلِّ
 * المعالجةِ الوحيدة. ولذلك لا دالّةَ تعديلٍ هنا: دالّةٌ موجودةٌ بلا مُنادٍ تُغري أوّلَ مسارٍ
 * يحتاج «تصحيحاً سريعاً» فتصير الحالةُ حقلاً يُكتب بيدٍ — وهو نصُّ ما يمنعه القرار 2.
 *
 * وسببُ الرفضِ يُحسب في المجال (`qualifyReferral`) لا هنا: هذا الملفُّ يكتب ما أُعطي،
 * والقاعدةُ تحرسه بـ`ck_referrals_reason_code` (سببٌ إن وإلّا رُفض) و`ck_referrals_not_self`.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type { ReferralRejectionReason, ReferralState } from "../domain/contract-sets.js";
import { validationFailed } from "../domain/errors.js";
import type { DbOrTx } from "./client.js";
import { referralCodes, referrals } from "./schema.js";

/** رمزُ إحالةٍ كما استقرّ في القاعدة. */
export interface ReferralCodeRecord {
  readonly referralCode: string;
  readonly ownerPublicId: string;
  readonly isActive: boolean;
  readonly createdAt: string;
}

/** مطالبةٌ كما استقرّت — بلا مكافأة: المكافأةُ جدولٌ آخرُ في المراجعة 5/6. */
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
}
