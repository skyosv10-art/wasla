/**
 * صندوقُ الصادر — **الحدثُ يُكتب مع الحقيقةِ في معاملةٍ واحدة**، ثمّ يُنشَر بعدها.
 *
 * ## النسخةُ الخاطئةُ الأرخص
 *
 * `await bus.publish(event)` بعد `COMMIT`. سطرٌ واحدٌ يمرّ في كلّ اختبارٍ محليّ، ويُنتج في
 * الإنتاج أحدَ عيبَين لا ثالثَ لهما:
 *
 * 1. نُشر حدثٌ لمعاملةٍ **انسحبت** (لو نُشر قبل `COMMIT`): مستهلكٌ يفتح للسائق أوامرَ اشتراكٍ
 *    لا وجودَ له في الدفتر.
 * 2. نجحت المعاملةُ وسقطت العمليةُ قبل النشر: تفعيلٌ **حقيقيٌّ لا يعرفه أحد**. وهذا أسوأ،
 *    لأنّه بلا أثرٍ في سجلٍّ ولا مقياس: يظهر بعد أسبوعٍ كسائقٍ دفع ولم تُفتح له الأوامر،
 *    ولا أحدَ يعرف كم مرّةً حدث قبلَه.
 *
 * والصندوقُ يُلغي الاحتمالَين معاً: الحدثُ صفٌّ في **نفس** معاملةِ المُدّةِ والانتقال. فإن
 * انسحبت المعاملةُ ذهب الحدثُ معها، وإن نجحت بقي الحدثُ مكتوباً ينتظر ناشراً — وسقوطُ
 * العمليةِ يؤجّل النشرَ ولا يُلغيه.
 *
 * ## التسليمُ **مرّةً على الأقلّ** ومُعلَنٌ كذلك
 *
 * `claimUnpublished` ⇒ `deliver` ⇒ `markPublished`. والترتيبُ مقصود: لو وُسم الصفُّ منشوراً
 * قبل التسليمِ لصار سقوطُ الناقلِ ضياعاً نهائياً لحدثٍ حقيقيّ. والثمنُ المُعلَنُ لهذا
 * الترتيبِ أنّ سقوطاً **بين** التسليمِ والوسمِ يُنتج تسليماً ثانياً — ولذلك يحمل كلُّ حدثٍ
 * `event_id` ثابتاً و`state_sequence`، فيُهمِله المستهلكُ بلا سؤال.
 *
 * ولا خيارَ ثالثاً هنا: «مرّةً واحدةً بالضبط» بين قاعدةٍ وناقلٍ ليست خصيصةً تُختار بسطرٍ، بل
 * وعدٌ لا يستطيع أيُّ ناقلٍ الوفاءَ به. فإمّا حدثٌ يُضيَّع، وإمّا حدثٌ يُكرَّر — واخترنا
 * التكرارَ لأنّ للمستهلك مفتاحاً يُهمِل به.
 *
 * ## ولمَ `FOR UPDATE SKIP LOCKED`
 *
 * ناشرٌ ثانٍ يعمل بالتوازي (نسختان في الإنتاج، أو نبضةٌ تتداخل مع سابقتِها) سيقرأ نفسَ
 * الصفوفِ ويُسلّمها مرّةً أخرى. و`SKIP LOCKED` يجعل كلَّ ناشرٍ يأخذ ما لم يأخذه غيرُه بلا
 * انتظار — بينما `FOR UPDATE` وحدَها كانت ستجعل الثاني ينتظر الأوّلَ ثمّ يُسلّم ما سلّمه.
 *
 * ## ولا تعديلَ على حمولةِ حدثٍ استقرّ
 *
 * الدالّتان الوحيدتان اللتان تُعدّلان صفّاً هنا تكتبان `published_at`/`attempts`/`last_error`
 * فقط — بيانات **تسليمٍ** لا حقيقةَ الحدث. و`payload` و`event_id` و`occurred_at` لا تُلمَس
 * بعد الكتابة أبداً، ولذلك يُولَّد `event_id` في طبقةِ التطبيقِ ويدخل الحمولةَ والمفتاحَ معاً
 * في نفس الإضافة: مغلَّفٌ يحمل مُعرِّفاً غيرَ مُعرِّفِ صفِّه كان سيجعل تتبّعَ حدثٍ في
 * السجلاتِ يعتمد على أيِّ الحقلَين نظر إليه القارئ.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { validationFailed } from "../domain/errors.js";
import type { DbOrTx } from "./client.js";
import { subscriptionOutbox } from "./schema.js";

/** أطولُ نصِّ سببٍ يُحفظ. سببٌ بلا حدٍّ يجعل صفَّ خطأٍ واحداً يكبر بحجم أثرِ استدعاءٍ كامل. */
export const OUTBOX_FAILURE_REASON_MAX_LENGTH = 500;

/** حدثٌ يُضاف مع الحقيقة — بمُعرِّفٍ يُولّده التطبيقُ لأنّه في الحمولةِ أيضاً. */
export interface OutboxDraft {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly occurredAt: string;
  readonly traceId: string | null;
}

/** صفُّ صادرٍ كما استقرّ — و`publishedAt = null` تعني «ينتظر ناشراً». */
export interface OutboxRow {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly occurredAt: string;
  readonly publishedAt: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly traceId: string | null;
}

interface RawOutboxRow {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly occurredAt: Date;
  readonly publishedAt: Date | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly traceId: string | null;
}

function toRow(row: RawOutboxRow): OutboxRow {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
    publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
    attempts: row.attempts,
    lastError: row.lastError,
    traceId: row.traceId,
  };
}

export class PostgresOutboxStore {
  constructor(private readonly db: DbOrTx) {}

  /**
   * يُضيف حدثاً — يُنادى **داخلَ** معاملةِ القرارِ وحدَها.
   *
   * ولا `onConflictDoNothing`: مُعرِّفُ الحدثِ جديدٌ في كلّ قرارٍ، فتضاربُ مفاتيحَ هنا خطأُ
   * برمجةٍ يجب أن يظهر لا أن يُكتَم.
   */
  async append(draft: OutboxDraft): Promise<OutboxRow> {
    const rows = await this.db
      .insert(subscriptionOutbox)
      .values({
        eventId: draft.eventId,
        eventType: draft.eventType,
        aggregateType: draft.aggregateType,
        aggregateId: draft.aggregateId,
        payload: draft.payload,
        occurredAt: new Date(draft.occurredAt),
        traceId: draft.traceId,
      })
      .returning();
    const row = rows[0];
    if (!row) throw validationFailed("outbox_event", "one inserted row");
    return toRow(row);
  }

  /** حدثٌ بمُعرِّفه — للقراءةِ في الاختبارِ وللتشخيصِ لا لمسارٍ ساخن. */
  async read(eventId: string): Promise<OutboxRow | null> {
    const rows = await this.db
      .select()
      .from(subscriptionOutbox)
      .where(eq(subscriptionOutbox.eventId, eventId))
      .limit(1);
    const row = rows[0];
    return row ? toRow(row) : null;
  }

  /**
   * يحجز غيرَ المنشورِ بترتيبِ حدوثِه — أقدمُ أوّلاً، وبقفلٍ يتخطّاه ناشرٌ آخر.
   *
   * والترتيبُ `occurred_at` ثمّ `event_id`: لحظتان متساويتان تحدثان فعلاً في نفس المعاملة
   * (تأهيلٌ ومكافأةٌ معاً)، وترتيبٌ غيرُ حاسمٍ كان سيجعل مستهلكاً يرى المكافأةَ قبل التأهيل.
   */
  async claimUnpublished(limit: number): Promise<ReadonlyArray<OutboxRow>> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw validationFailed("limit", "positive integer");
    }
    const rows = await this.db
      .select()
      .from(subscriptionOutbox)
      .where(isNull(subscriptionOutbox.publishedAt))
      .orderBy(asc(subscriptionOutbox.occurredAt), asc(subscriptionOutbox.eventId))
      .limit(limit)
      .for("update", { skipLocked: true });
    return rows.map(toRow);
  }

  /**
   * يوسم الحدثَ منشوراً — **بشرطِ أنّه لم يُوسَم بعد**، ويُعيد هل هو من وسمه.
   *
   * الشرطُ هو الفرقُ بين حارسٍ وتمنٍّ: ناشران سلّما نفسَ الحدثِ (وهو ممكنٌ بحكم at-least-once)
   * فأوّلُهما يُعيد `true` والثاني `false` — فيُحصى «سُلّم مرّتين» بدل أن يُكتَب بلا أثر.
   */
  async markPublished(eventId: string, publishedAt: string): Promise<boolean> {
    const rows = await this.db
      .update(subscriptionOutbox)
      // و`attempts` تزيد هنا أيضاً لا في الفشلِ وحدَه: تسليمٌ ناجحٌ **محاولةٌ** جرت، وصفٌّ
      // منشورٌ بصفرِ محاولاتٍ يُقرأ «نُشر بلا أن يُحاوَل» — وهو نصٌّ لا معنى له في تحقيقٍ
      // بعد حادثة. والعدّادُ بهذا يُجيب عن سؤالٍ واحدٍ واضح: كم مرّةً لامسَ هذا الحدثُ الناقل.
      .set({
        publishedAt: new Date(publishedAt),
        lastError: null,
        attempts: sql`${subscriptionOutbox.attempts} + 1`,
      })
      .where(
        and(eq(subscriptionOutbox.eventId, eventId), isNull(subscriptionOutbox.publishedAt)),
      )
      .returning({ eventId: subscriptionOutbox.eventId });
    return rows.length === 1;
  }

  /**
   * يُحصي محاولةً فاشلةً ويحفظ سببَها — والصفُّ **يبقى غيرَ منشور**.
   *
   * تسليمٌ يفشل صامتاً يجعل «الصندوقُ فارغٌ» و«الناقلُ مكسورٌ منذ ساعةٍ» متشابهَين من
   * الخارج؛ و`attempts` هو ما يجعل تنبيهاً على «حدثٌ حاول عشراً» ممكناً بلا سجلاتٍ.
   */
  async recordDeliveryFailure(eventId: string, reason: string): Promise<boolean> {
    const rows = await this.db
      .update(subscriptionOutbox)
      .set({
        attempts: sql`${subscriptionOutbox.attempts} + 1`,
        lastError: reason.slice(0, OUTBOX_FAILURE_REASON_MAX_LENGTH),
      })
      .where(
        and(eq(subscriptionOutbox.eventId, eventId), isNull(subscriptionOutbox.publishedAt)),
      )
      .returning({ eventId: subscriptionOutbox.eventId });
    return rows.length === 1;
  }
}

/**
 * ## النطاق
 *
 * صندوقُ الصادر: إضافةٌ داخلَ معاملةِ القرار، وحجزٌ بقفلٍ يتخطّاه غيرُه، ووسمُ نشرٍ مشروطٌ،
 * وإحصاءُ فشلِ تسليم.
 *
 * ## آخر تحديث
 *
 * المراجعة 5/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * مُستعمَلٌ من `db/unit-of-work.ts` (إضافةٌ مع القرار) ومن `app/events.ts`
 * (`drainSubscriptionOutbox`).
 *
 * ## كودٌ ذو صلة
 *
 * `services/reputation/src/outbound/drain-outbox.ts` (السابقةُ في Phase 09) ·
 * `contracts/events.json` · `contracts/schema.sql` §10.
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
