/**
 * صندوقُ الصادر: الحدثُ يُكتب في معاملةِ القرارِ نفسِها، ولا ناقلَ في هذه المراجعة.
 *
 * ## القرار: كتابةٌ ذرّيّةٌ مع الأثرِ لا نشرٌ بعده
 *
 * أرخصُ نسخةٍ خاطئةٍ من الأحداثِ تُنشئ الحدثَ **بعد** نجاحِ المعاملة: تُعتمد متجرٌ، تُغلق
 * المعاملةُ، ثمّ يسقط الوسيطُ أو تسقط العمليّةُ قبلَ الإرسال — فيبقى المتجرُ `approved` في
 * القاعدةِ ولا أحدَ خارجَ الخدمةِ يعلم. والعكسُ أسوأ: إرسالٌ قبلَ الالتزامِ يُعلن قراراً
 * تراجَعت معاملتُه. فالحدثُ صفٌّ في هذا الجدولِ يُدرَج بنفسِ `tx` الذي كتب الدفترَ والصفَّ
 * المُتحقِّق: إمّا أن يستقرّ القرارُ وحدثُه معاً، أو لا شيء.
 *
 * ## ولا `markPublished` هنا — وهذا **دَينٌ مُعلَنٌ لا سهوٌ**
 *
 * ناقلُ الصناديقِ (الأطوار 06 و07 و09 و10 وهذا) دَينُ المرحلة 09 المُعلَن في `RISK_REGISTER`،
 * وهو قرارٌ **لم يُتَّخذ** بعد: أين يعيش الناقلُ، وبأيِّ ضمانِ تسليمٍ، وكيف يُقاس تأخّرُه.
 * فكتابةُ `markPublished` اليومَ تعني اختيارَ الإجابةِ بلا قرارٍ مكتوبٍ ولا مالكٍ — ثمّ تصير
 * الدالّةُ سطحاً يُنادي أحدٌ فيُختم صفٌّ لم يُنشَر. فالمخزنُ يكتب ويقرأ غيرَ المنشورِ وحدَه،
 * والختمُ يأتي مع الناقلِ في قرارِه.
 *
 * ## ولا حذفَ ولا تفريغَ لصفوفِ الصندوق
 *
 * القرارُ 10 يمنع الحذفَ الصلبَ، وصندوقُ الصادرِ أظهرُ مواضعِه: صفٌّ منشورٌ محذوفٌ يُلغي
 * القدرةَ على إعادةِ بناءِ ما أُرسل. والتنظيفُ — إن لزم — سياسةُ احتفاظٍ في قرارٍ مستقلٍّ لا
 * `delete` في مخزن.
 *
 * ## والمُعرِّفُ من المحرّكِ لا من العمليّة
 *
 * `gen_random_uuid()` تُطلَب في جملةِ الإدراج: `randomUUID(` ممنوعٌ في `src/` كلِّه (محروسٌ في
 * `purity.test.ts`)، ومُعرِّفٌ يُولَّد في العمليّةِ يجعل إعادةَ تشغيلِ نفسِ القرارِ حدثاً
 * بمُعرِّفٍ جديدٍ فينكسر إهمالُ المُستهلكِ للمُكرَّر.
 */

import { asc, isNull, sql } from "drizzle-orm";

import type { DbOrTx } from "./client.js";
import { translateConstraint } from "./constraints.js";
import { marketplaceOutbox } from "./schema.js";
import { validationFailed } from "../domain/errors.js";
import {
  MARKETPLACE_EVENT_TYPES,
  marketplaceEventEnvelope,
  type MarketplaceAggregateType,
  type MarketplaceEventDraft,
  type MarketplaceEventEnvelope,
  type MarketplaceEventPayload,
  type MarketplaceEventType,
} from "../domain/events.js";

/** حدُّ القراءةِ الأقصى لدفعةِ غيرِ المنشور — سقفٌ مُعلَنٌ لا `LIMIT` مفتوح. */
export const OUTBOX_BATCH_LIMIT_MAX = 500;
export const OUTBOX_BATCH_LIMIT_DEFAULT = 100;

/** صفُّ صندوقٍ كما استقرّ في القاعدة. */
export interface OutboxRecord {
  readonly outboxId: string;
  readonly eventType: MarketplaceEventType;
  readonly eventVersion: string;
  readonly aggregateType: MarketplaceAggregateType;
  readonly aggregateId: string;
  readonly payload: MarketplaceEventPayload;
  readonly occurredAt: string;
  /** `undefined` تعني «لم يُنشَر» — ولا ناشرَ في هذه المراجعة، فكلُّها كذلك. */
  readonly publishedAt?: string;
  readonly createdAt: string;
}

interface OutboxRow {
  readonly outboxId: string;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly occurredAt: Date;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
}

const AGGREGATE_TYPES: readonly MarketplaceAggregateType[] = Object.freeze([
  "store",
  "product",
  "inventory",
]);

/**
 * قيمةُ عمودٍ نصّيٍّ مُقيَّدةٌ بقائمةِ العقدِ **عند القراءة**.
 *
 * والقاعدةُ تحميها بفحصٍ، فلمَ تُفحَص مرّةً ثانيةً؟ لأنّ استعادةَ نسخةٍ من بيئةٍ أقدمَ أو
 * ترحيلاً يدويّاً قد يُدخل نوعَ حدثٍ لم يكن ممنوعاً يومَه، فيقرؤه ناقلٌ لا يعرفه ويُهمله
 * صامتاً. والصراخُ عند القراءةِ يجعل العطبَ سطراً في السجلِّ لا حدثاً ضائعاً.
 */
function narrowed<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw validationFailed(field, `واحدةٌ من: ${allowed.join(", ")}`);
  }
  return value as T;
}

function isPayload(value: unknown): value is MarketplaceEventPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOutboxRecord(row: OutboxRow): OutboxRecord {
  if (!isPayload(row.payload)) {
    throw validationFailed("payload", "كائنُ JSON");
  }
  return {
    outboxId: row.outboxId,
    eventType: narrowed(row.eventType, MARKETPLACE_EVENT_TYPES, "event_type"),
    eventVersion: row.eventVersion,
    aggregateType: narrowed(row.aggregateType, AGGREGATE_TYPES, "aggregate_type"),
    aggregateId: row.aggregateId,
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
    ...(row.publishedAt === null ? {} : { publishedAt: row.publishedAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * يُعيد بناءَ الحدثِ الكاملِ من صفٍّ — وهذا ما سيُنشره الناقلُ يومَ يُكتب.
 *
 * وهي هنا لا في المجالِ لأنّها تعرف شكلَ الصفِّ؛ والغلافُ نفسُه يُبنى في `domain/events.ts`
 * فلا يتكرّر وصفُ العقدِ في موضعَين.
 */
export function envelopeOf(record: OutboxRecord): MarketplaceEventEnvelope {
  return marketplaceEventEnvelope(record.outboxId, {
    eventType: record.eventType,
    eventVersion: record.eventVersion as "v1",
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    occurredAt: record.occurredAt,
    payload: record.payload,
  });
}

/** سطحُ الصندوقِ كما تراه طبقةُ التطبيق — إضافةٌ وقراءةُ غيرِ المنشور، ولا ختمَ. */
export interface OutboxStore {
  appendEvent(draft: MarketplaceEventDraft): Promise<OutboxRecord>;
  listUnpublished(limit?: number): Promise<readonly OutboxRecord[]>;
}

export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly db: DbOrTx) {}

  /**
   * يُدرِج حدثاً واحداً. ويُنادى **داخلَ** معاملةِ القرارِ لا بعدها — وهذا ما يجعله ذرّيّاً
   * مع الدفترِ والصفِّ المُتحقِّق. ولا فحصَ «هل نحن في معاملة؟» هنا: `DbOrTx` نوعٌ واحدٌ
   * بقصدٍ، ومالكُ الحدودِ `unit-of-work.ts` وحدَه.
   */
  async appendEvent(draft: MarketplaceEventDraft): Promise<OutboxRecord> {
    try {
      const rows = await this.db
        .insert(marketplaceOutbox)
        .values({
          outboxId: sql`gen_random_uuid()`,
          eventType: draft.eventType,
          eventVersion: draft.eventVersion,
          aggregateType: draft.aggregateType,
          aggregateId: draft.aggregateId,
          payload: draft.payload,
          occurredAt: new Date(draft.occurredAt),
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw validationFailed("outbox", "صفٌّ واحدٌ مُدرَج");
      }
      return toOutboxRecord(row as OutboxRow);
    } catch (error) {
      throw translateConstraint(error) ?? error;
    }
  }

  /**
   * يقرأ غيرَ المنشورِ بترتيبِ `created_at` — نفسُ عمودِ الفهرسِ الجزئيِّ في العقدِ
   * (`ix_marketplace_outbox_unpublished`)، فالقراءةُ تستعمل الفهرسَ ولا تمسح الجدولَ كلَّه.
   *
   * والترتيبُ بـ`created_at` لا بـ`occurred_at`: الثاني لحظةُ الواقعةِ كما رآها الطلبُ، وقد
   * تسبق واقعةٌ أُدرجت لاحقاً واقعةً أُدرجت قبلها لو تأخّرت معاملةٌ — والناقلُ يحتاج ترتيبَ
   * **الاستقرارِ** لا ترتيبَ الحدوث.
   */
  async listUnpublished(limit: number = OUTBOX_BATCH_LIMIT_DEFAULT): Promise<readonly OutboxRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > OUTBOX_BATCH_LIMIT_MAX) {
      throw validationFailed("limit", `عددٌ صحيحٌ بين 1 و${OUTBOX_BATCH_LIMIT_MAX}`);
    }
    const rows = await this.db
      .select()
      .from(marketplaceOutbox)
      .where(isNull(marketplaceOutbox.publishedAt))
      .orderBy(asc(marketplaceOutbox.createdAt), asc(marketplaceOutbox.outboxId))
      .limit(limit);
    return rows.map((row) => toOutboxRecord(row as OutboxRow));
  }
}
