/**
 * الصفُّ المُتحقِّق (`subscriptions`) — **يُكتب من الدفتر ولا يُصدّق العميلَ أبداً**.
 *
 * ## الملفُّ الوحيدُ في `src/` الذي يُعدّل صفّاً قائماً
 *
 * حارسُ `purity.test.ts` يمنع `.update(` و`onConflictDoUpdate` في كلّ الخدمة، واستُثني هذا
 * الملفُّ **باسمه وباسمِ جدولِه**: القائمةُ `PROJECTION_WRITING_FILES` تحمل `db/projection.ts`
 * وحده، واختبارٌ موجَبٌ يُثبت أنّ مجموعةَ الملفاتِ المطابقةِ للنمط تساويها بالضبط، واختبارٌ
 * ثانٍ يُثبت أنّ هذا الملفَّ **لا يذكر** `subscriptionPeriods` ولا `subscriptionTransitions`.
 * فالاستثناءُ شدٌّ لا تخفيف: من أراد تعديلاً على الدفتر لن يجد نمطاً مفتوحاً يستعمله.
 *
 * ولمَ جاز التعديلُ هنا وحرُم هناك؟ لأنّ هذا الصفَّ **لا يحمل معلومةً لا يحملها الدفتر**:
 * كلُّ حقلٍ فيه ناتجُ `deriveState(periods, plan, now)` وآخرِ انتقال. حذفُه كلِّه وإعادةُ
 * بنائه عملٌ بلا خسارة (وهذا نصُّ `recompute`)، فالتعديلُ عليه إعادةُ حسابٍ لا إعادةُ كتابةِ
 * تاريخ. أمّا `UPDATE` على مُدّةٍ أو على انتقالٍ فيمحو **واقعةً** لا نسخةَ لها في مكانٍ آخر،
 * ويجعل سؤالَ «لماذا هذا السائق `active`؟» بلا جواب.
 *
 * ## ولمَ `ON CONFLICT ... DO UPDATE` ولم يكن حذفاً ثمّ إدخالاً؟
 *
 * لأنّ `subscription_id` مُعرّفٌ يخرج للمستهلك في كلّ استجابة: حذفٌ وإدخالٌ يُنتج مُعرّفاً
 * جديداً لنفس الاشتراك بعد كلّ نبضة، فيرى البوتُ اشتراكاً «آخر» لسائقٍ لم يتغيّر شيءٌ من
 * أمره. والقيدُ `ux_subscriptions_driver` هو هدفُ التعارض، فيبقى المُعرّفُ الأوّلُ مُثبَّتاً
 * ويتغيّر ما هو مُشتَقٌّ وحده — ولذلك لا يُلمس `subscription_id` في قائمةِ التحديث.
 */

import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";

import type { SubscriptionState } from "../domain/contract-sets.js";
import { validationFailed } from "../domain/errors.js";
import type { DbOrTx } from "./client.js";
import { subscriptions } from "./schema.js";

/** الصفُّ المُتحقِّق كما يُقرأ — لحظاتٌ نصّاً ISO لأنّ المجالَ لا يعرف `Date`. */
export interface ProjectionRecord {
  readonly subscriptionId: string;
  readonly driverPublicId: string;
  readonly state: SubscriptionState;
  readonly planCode: string;
  readonly planVersion: number;
  readonly currentPeriodId: string | null;
  readonly startedAt: string;
  readonly expiresAt: string | null;
  readonly stateSequence: number;
  readonly stateChangedAt: string;
  readonly computedAt: string;
}

/** ما يُكتب: نفسُ الحقول بلا مُعرّفٍ — المُعرّفُ من المحرّك مرّةً واحدةً ولا يُعاد. */
export type ProjectionWrite = Omit<ProjectionRecord, "subscriptionId">;

interface ProjectionRow {
  readonly subscriptionId: string;
  readonly driverPublicId: string;
  readonly state: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly currentPeriodId: string | null;
  readonly startedAt: Date;
  readonly expiresAt: Date | null;
  readonly stateSequence: number;
  readonly stateChangedAt: Date;
  readonly computedAt: Date;
}

/** ترجمةٌ حقلاً حقلاً بالاسم — لا `...row`، لنفس سببِ `toPeriod` (HANDOFF §16-ز). */
export function toProjection(row: ProjectionRow): ProjectionRecord {
  return {
    subscriptionId: row.subscriptionId,
    driverPublicId: row.driverPublicId,
    state: row.state as SubscriptionState,
    planCode: row.planCode,
    planVersion: row.planVersion,
    currentPeriodId: row.currentPeriodId,
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    stateSequence: row.stateSequence,
    stateChangedAt: row.stateChangedAt.toISOString(),
    computedAt: row.computedAt.toISOString(),
  };
}

export class PostgresSubscriptionProjection {
  constructor(private readonly db: DbOrTx) {}

  /** الصفُّ المُتحقِّق لسائقٍ، أو `null` لمن لا اشتراكَ له بعد. */
  async read(driverPublicId: string): Promise<ProjectionRecord | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.driverPublicId, driverPublicId))
      .limit(1);
    const row = rows[0];
    return row ? toProjection(row) : null;
  }

  /**
   * يكتب النتيجةَ المُشتقّة: صفٌّ جديدٌ لأوّل مرّةٍ، أو تحديثٌ للمُشتَقّ وحدَه بعدها.
   *
   * القائمةُ مكتوبةٌ حقلاً حقلاً بقصد: `set: { ...write }` كان سيُدخل `driverPublicId`
   * (لا معنى لتحديثه، وهو مفتاحُ التعارض نفسُه) وكان سيمرّ صامتاً على حقلٍ يُضاف غداً.
   * و`updatedAt` وحدَه يأتي من المحرّك — لحظةُ كتابةٍ لا لحظةُ حساب، والفرقُ بينهما هو ما
   * يجعل `computed_at` قابلاً للمقارنة بلحظةِ النبضة.
   */
  async write(write: ProjectionWrite): Promise<ProjectionRecord> {
    const rows = await this.db
      .insert(subscriptions)
      .values({
        subscriptionId: sql`gen_random_uuid()`,
        driverPublicId: write.driverPublicId,
        state: write.state,
        planCode: write.planCode,
        planVersion: write.planVersion,
        currentPeriodId: write.currentPeriodId,
        startedAt: new Date(write.startedAt),
        expiresAt: write.expiresAt === null ? null : new Date(write.expiresAt),
        stateSequence: write.stateSequence,
        stateChangedAt: new Date(write.stateChangedAt),
        computedAt: new Date(write.computedAt),
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: subscriptions.driverPublicId,
        set: {
          state: write.state,
          planCode: write.planCode,
          planVersion: write.planVersion,
          currentPeriodId: write.currentPeriodId,
          startedAt: new Date(write.startedAt),
          expiresAt: write.expiresAt === null ? null : new Date(write.expiresAt),
          stateSequence: write.stateSequence,
          stateChangedAt: new Date(write.stateChangedAt),
          computedAt: new Date(write.computedAt),
          updatedAt: sql`now()`,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw validationFailed("subscription", "one written row");
    return toProjection(row);
  }

  /**
   * الصفوفُ التي تجاوز الزمنُ نهايتَها المخزنة — مُدخلُ النبضة، لا مسحٌ لكلّ الجدول.
   *
   * الشرطُ على `expires_at` وحدَه مع `state IN ('trial','active')` هو نفسُ شرطِ
   * `ix_subscriptions_expiring` في العقد، فتقرأ النبضةُ من الفهرس لا من الجدول كلِّه.
   * ونبضةٌ تمسح كلَّ الصفوف كانت ستعمل اليوم على مئةِ سائقٍ وتسقط على مئةِ ألف.
   */
  async listLapsed(now: string, limit: number): Promise<ReadonlyArray<ProjectionRecord>> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.state, ["trial", "active"]),
          isNotNull(subscriptions.expiresAt),
          lte(subscriptions.expiresAt, new Date(now)),
        ),
      )
      .orderBy(asc(subscriptions.expiresAt))
      .limit(limit);
    return rows.map(toProjection);
  }

  /**
   * صفوفُ `expired` — مرشّحو النزولِ إلى أرضيّةِ المجتمع بعد انقضاء المهلة.
   *
   * ولمَ لا يكفي `listLapsed`؟ لأنّ `expired` صفٌّ بلا `expires_at` بنصّ
   * `ck_subscriptions_period_state`، فلا فهرسَ زمنيّاً يُرشّحه. ومهلةُ المجتمع تُحسب من
   * **نهايةِ آخرِ تغطيةٍ في الدفتر** لا من عمودٍ في هذا الصفّ — وهذا مقصود: عمودٌ ثانٍ
   * للمهلة كان سيصير حقيقةً ثانيةً تتباعد عن الدفتر بصمت.
   */
  async listExpired(limit: number): Promise<ReadonlyArray<ProjectionRecord>> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.state, "expired"))
      .orderBy(asc(subscriptions.stateChangedAt))
      .limit(limit);
    return rows.map(toProjection);
  }
}
