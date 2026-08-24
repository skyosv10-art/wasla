/**
 * سجلُّ منعِ التكرار — **الجوابُ المحفوظُ بنفسِ بايتاتِه**، لا «رأيتُ هذا المفتاح».
 *
 * ## النسخةُ الخاطئةُ الأرخص
 *
 * جدولٌ بمفتاحٍ واحدٍ يقول «مرّ من قبل» ثمّ يُجيب `409`. تُكتب في عشرة أسطرٍ وتمرّ في كلّ
 * اختبارٍ يكتبه كاتبُها، ثمّ تُنتج في الإنتاج الحالةَ الوحيدةَ التي وُجد منعُ التكرارِ من
 * أجلها: عميلُ جوّالٍ فعّل اشتراكاً، ثمّ انقطعت شبكتُه **بعد** الكتابةِ وقبل وصولِ الجواب،
 * فأعاد الطلبَ بنفس المفتاح — وهو محقٌّ تماماً — فتلقّى رفضاً عن عمليةٍ **نجحت**. فيُظهر
 * للسائق «فشل التفعيل» وقد صار مُشتركاً فعلاً، ويُعيد المحاولةَ، ويشتكي، ويُفتح تذكرةٌ لا
 * جوابَ لها في سجلٍّ لأنّ كلَّ شيءٍ «عمل كما هو مكتوب».
 *
 * ولذلك يحمل الجدولُ `response_status` و`response_body`: إعادةُ المفتاحِ بنفسِ البصمةِ تُعيد
 * **نفسَ** الحالةِ ونفسَ الجسم. والخارطةُ تقول ذلك بالحرف: «وإعادةُ المفتاحِ تُعيد نفسَ
 * البايتات لا 409».
 *
 * ## ولماذا بصمةٌ وليس المفتاحَ وحدَه
 *
 * `request_hash` يفصل حالتَين لا تتشابهان إلّا في الشكل:
 *
 * 1. **نفسُ الطلبِ ثانيةً** ⇒ يستحقّ الجوابَ المحفوظ (إعادةُ محاولةٍ صادقة).
 * 2. **مفتاحٌ أُعيد استعمالُه لطلبٍ آخر** ⇒ `SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED` (409)، لأنّ
 *    إعادةَ جوابِ الأوّلِ للثاني تعني إخبارَ العميلِ بنجاحِ عملٍ لم يُنفَّذ له.
 *
 * والبصمةُ **مُلخَّصٌ** لا الطلبُ نفسُه: الجسمُ يحمل `payment_reference` و`WS-` مُعرِّفات، ولا
 * سببَ لنسخِها في جدولٍ تقنيٍّ ثانٍ. والمُلخَّصُ يتساوى عند التساوي ولا يردُّ شيئاً.
 *
 * ## ولا تعديلَ على صفٍّ استقرّ
 *
 * `remember` تُضيف بـ`onConflictDoNothing` ثمّ تقرأ. فمُنادِيان متزامنان بنفس المفتاح: أحدُهما
 * يكتب والآخرُ يقرأ ما كُتب — لا فشلٌ خامٌّ ولا صفٌّ يُدهَس. و`onConflictDoUpdate` هنا كانت
 * ستجعل آخرَ واصلٍ يستبدل الجوابَ المحفوظ، فيصير «نفسُ البايتات» وعداً يعتمد على الترتيب.
 *
 * ## والصفُّ يُكتب داخلَ معاملةِ القرار
 *
 * `db/unit-of-work.ts` يربط هذا المخزنَ على نفس المِقبض، فيدخل صفُّ منعِ التكرارِ ومُدّةُ
 * الدفترِ وحدثُ الصادرِ في معاملةٍ **واحدة**. ولو كُتب المفتاحُ قبلَها لصارت كتابةٌ فاشلةٌ
 * تُنتج مفتاحاً محفوظاً بلا عملٍ خلفه — فتُجيب كلُّ إعادةِ محاولةٍ عن شيءٍ لم يحدث أبداً.
 */

import { eq } from "drizzle-orm";

import { idempotencyKeyReused } from "../domain/errors.js";
import { validationFailed } from "../domain/errors.js";
import type { DbOrTx } from "./client.js";
import { subscriptionIdempotency } from "./schema.js";

/** حدودُ العقد (`schema.sql` §9) مقروءةً في الكود قبل أن ترفضها القاعدة. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const ROUTE_KEY_MIN_LENGTH = 3;
export const ROUTE_KEY_MAX_LENGTH = 64;
export const REQUEST_HASH_LENGTH = 64;

/** جوابٌ محفوظٌ كما سيُعاد إرسالُه — الحالةُ والجسمُ معاً لا الحالةُ وحدَها. */
export interface StoredResponse {
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

/** صفُّ منعِ تكرارٍ كما استقرّ. */
export interface IdempotencyRecord extends StoredResponse {
  readonly idempotencyKey: string;
  readonly routeKey: string;
  readonly requestHash: string;
  readonly traceId: string | null;
  readonly createdAt: string;
}

/** ما يُكتب — بلا `created_at`: لحظةُ الصفِّ من المحرّك. */
export interface IdempotencyDraft extends StoredResponse {
  readonly idempotencyKey: string;
  readonly routeKey: string;
  readonly requestHash: string;
  readonly traceId: string | null;
}

interface IdempotencyRow {
  readonly idempotencyKey: string;
  readonly routeKey: string;
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly traceId: string | null;
  readonly createdAt: Date;
}

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    idempotencyKey: row.idempotencyKey,
    routeKey: row.routeKey,
    requestHash: row.requestHash,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    traceId: row.traceId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * فحصُ المفتاحِ بالاسم قبل الكتابة — والقاعدةُ خطُّ الدفاعِ الثاني لا الأوّل.
 *
 * فحوصُ العقد على هذا الجدول بلا أسماء (`char_length(...) BETWEEN 8 AND 128`)، فرفضُها
 * يظهر كخطأِ مُشغّلٍ خامٍّ لا كرمزِ عقد. وهذه الدالّةُ تُعطي `SUBSCRIPTION_VALIDATION_FAILED`
 * برسالةٍ تسمّي الحقلَ والمتوقَّع — وهي نفسُ الحدودِ حرفاً بحرف.
 */
export function assertIdempotencyKey(key: string): string {
  if (
    key.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    key.length > IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw validationFailed(
      "Idempotency-Key",
      `${IDEMPOTENCY_KEY_MIN_LENGTH}..${IDEMPOTENCY_KEY_MAX_LENGTH} chars`,
    );
  }
  return key;
}

/** ومِفتاحُ المسار كذلك: `activate` وحدَها ليست مساراً، و64 حرفاً حدُّ العقد. */
export function assertRouteKey(routeKey: string): string {
  if (routeKey.length < ROUTE_KEY_MIN_LENGTH || routeKey.length > ROUTE_KEY_MAX_LENGTH) {
    throw validationFailed("route_key", `${ROUTE_KEY_MIN_LENGTH}..${ROUTE_KEY_MAX_LENGTH} chars`);
  }
  return routeKey;
}

/** والبصمةُ ستّونَ وأربعةُ حرفاً — طولُ sha256 بالسدس عشري، والعقدُ يفحصه. */
export function assertRequestHash(requestHash: string): string {
  if (requestHash.length !== REQUEST_HASH_LENGTH) {
    throw validationFailed("request_hash", `sha256 hex (${REQUEST_HASH_LENGTH} chars)`);
  }
  return requestHash;
}

/** نتيجةُ التذكّر: أوّلُ مرّةٍ (`fresh`) أو جوابٌ محفوظٌ يُعاد كما هو (`replay`). */
export interface RememberOutcome {
  readonly verdict: "fresh" | "replay";
  readonly stored: IdempotencyRecord;
}

export class PostgresIdempotencyStore {
  constructor(private readonly db: DbOrTx) {}

  /** الصفُّ إن وُجد — تُستعمل قبل بدءِ العملِ كي لا تُعاد الكتابةُ أصلاً. */
  async read(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const rows = await this.db
      .select()
      .from(subscriptionIdempotency)
      .where(eq(subscriptionIdempotency.idempotencyKey, assertIdempotencyKey(idempotencyKey)))
      .limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  /**
   * يُثبّت الجوابَ لهذا المفتاح، أو يُعيد المحفوظَ إن سبقه صفٌّ بنفسِ البصمة.
   *
   * والبصمةُ المختلفةُ ⇒ `SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED`. ولا استثناءَ لـ«نفسِ المسار»:
   * مفتاحٌ واحدٌ لطلبَين مختلفَين خطأُ عميلٍ حتى لو كان المسارُ نفسَه.
   */
  async remember(draft: IdempotencyDraft): Promise<RememberOutcome> {
    const idempotencyKey = assertIdempotencyKey(draft.idempotencyKey);
    const routeKey = assertRouteKey(draft.routeKey);
    const requestHash = assertRequestHash(draft.requestHash);
    const inserted = await this.db
      .insert(subscriptionIdempotency)
      .values({
        idempotencyKey,
        routeKey,
        requestHash,
        responseStatus: draft.responseStatus,
        responseBody: draft.responseBody,
        traceId: draft.traceId,
      })
      .onConflictDoNothing()
      .returning();
    const fresh = inserted[0];
    if (fresh) return { verdict: "fresh", stored: toRecord(fresh) };

    const stored = await this.read(idempotencyKey);
    if (!stored) throw validationFailed("idempotency_key", "one stored row after conflict");
    if (stored.requestHash !== requestHash) throw idempotencyKeyReused(routeKey);
    return { verdict: "replay", stored };
  }
}

/**
 * ## النطاق
 *
 * سجلُّ منعِ التكرار: قراءةُ صفٍّ وإضافتُه بلا تعديل، وفحوصُ الحدودِ بالاسم قبل القاعدة.
 *
 * ## آخر تحديث
 *
 * المراجعة 5/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * مُستعمَلٌ من `db/unit-of-work.ts` و`http/app.ts` على مسارات الكتابةِ الخمسة، ومن
 * `app/facts.ts` لمنعِ تكرارِ وقائعِ السمعة.
 *
 * ## كودٌ ذو صلة
 *
 * `db/schema.ts` (المرآة) · `contracts/schema.sql` §9 · `domain/errors.ts`
 * (`idempotencyKeyRequired` · `idempotencyKeyReused`) · `http/requests.ts`
 * (`requireIdempotencyKey`).
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
