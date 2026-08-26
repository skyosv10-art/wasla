/**
 * منعُ التكرار: مفتاحٌ محفوظٌ **مع جوابه**، مقروءاً بمفتاحٍ مركّبٍ كما في العقد.
 *
 * ## لماذا الجوابُ يُحفَظ ولا يُعاد بناؤه
 *
 * أرخصُ نسخةٍ خاطئةٍ من منعِ التكرارِ تحفظ «هذا المفتاحُ رأيتُه» ثمّ تُعيد بناءَ الجوابِ من
 * الحالةِ الحاضرة. وهي تعمل يوماً واحداً: أوّلُ إعادةِ إرسالٍ **بعد** قرارِ مُعتدِلٍ تُعيد
 * `state: approved` عن طلبٍ أنشأ `draft`، فيقرأ المُتَّصلُ جواباً لطلبٍ لم يُرسله. ولذلك
 * `response_status` و`response_body` عمودان في العقدِ لا مُشتقّان — والإعادةُ نسخٌ حرفيٌّ.
 *
 * ## لماذا المفتاحُ مركّبٌ `(route_key, idempotency_key)`
 *
 * مفتاحُ المسارِ يُخزَّن في عمودٍ مستقلٍّ ولا يدخل البصمة: تغييرُ شكلِ المسارِ لا يُبطل
 * مفاتيحَ محفوظة، ومفتاحٌ واحدٌ من عميلٍ لا يُقرأ في مسارَين. وقراءةٌ بالمفتاحِ وحدَه على
 * جدولٍ مفتاحُه مركّبٌ كانت ستُعيد أوّلَ صفٍّ يُصادفه المحرّكُ — أي جوابَ مسارٍ آخر.
 *
 * ## لماذا `onConflictDoNothing` ثمّ قراءةٌ، لا `onConflictDoUpdate`
 *
 * `DO UPDATE` كان سيدهس جواباً محفوظاً بجوابٍ جديدٍ — أي يجعل الإعادةَ كتابةً. والفرقُ يظهر
 * عند طلبَين متزامنَين بنفسِ المفتاح: أحدُهما يفوز بالصفّ، والثاني يقرأ ما استقرّ ويُعيده.
 * والبصمةُ المختلفةُ عند القراءةِ ⇒ `MARKETPLACE_IDEMPOTENCY_KEY_REUSED` لا كتابةٌ صامتة.
 */

import { and, eq } from "drizzle-orm";

import type { DbOrTx } from "./client.js";
import { marketplaceIdempotency } from "./schema.js";
import { marketplaceIdempotencyKeyReused, validationFailed } from "../domain/errors.js";

/** حدودُ العقد (`contracts/schema.sql` §9) مقروءةً في الكود قبل أن ترفضها القاعدة. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const ROUTE_KEY_MIN_LENGTH = 3;
export const ROUTE_KEY_MAX_LENGTH = 64;
export const REQUEST_HASH_LENGTH = 64;

/**
 * الحالاتُ التي يقبلها العقدُ للحفظ: `2xx` وحدَها.
 *
 * وهذا قرارٌ لا تفصيلٌ: خطأٌ محفوظٌ يعني أنّ إعادةَ الإرسالِ تُعيد الفشلَ إلى الأبد، فيصير
 * `409` عارضٌ سببُه سباقٌ لحظيٌّ حكماً دائماً على مفتاحٍ لا يُبدَّل. والفشلُ لا يُحفَظ:
 * المعاملةُ تتراجع فلا يبقى صفٌّ أصلاً.
 */
export const RESPONSE_STATUS_MIN = 200;
export const RESPONSE_STATUS_MAX = 299;

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
  readonly createdAt: string;
}

/** ما يُكتب — بلا `created_at`: لحظةُ الصفِّ من المحرّك لا من المُنادي. */
export interface IdempotencyDraft extends StoredResponse {
  readonly idempotencyKey: string;
  readonly routeKey: string;
  readonly requestHash: string;
}

interface IdempotencyRow {
  readonly idempotencyKey: string;
  readonly routeKey: string;
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly createdAt: Date;
}

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    idempotencyKey: row.idempotencyKey,
    routeKey: row.routeKey,
    requestHash: row.requestHash,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    createdAt: row.createdAt.toISOString(),
  };
}

/** طولُ المفتاحِ كما يفحصه العقد — يُرفض هنا برمزِ تحقّقٍ لا بخطأِ محرّك. */
export function assertIdempotencyKey(key: string): string {
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw validationFailed(
      "Idempotency-Key",
      `${IDEMPOTENCY_KEY_MIN_LENGTH}..${IDEMPOTENCY_KEY_MAX_LENGTH} chars`,
    );
  }
  return key;
}

/** ومفتاحُ المسار: `store.register` لا `POST /stores`، وشكلُه مفحوصٌ بنمطِ العقد. */
export function assertRouteKey(routeKey: string): string {
  if (routeKey.length < ROUTE_KEY_MIN_LENGTH || routeKey.length > ROUTE_KEY_MAX_LENGTH) {
    throw validationFailed("route_key", `${ROUTE_KEY_MIN_LENGTH}..${ROUTE_KEY_MAX_LENGTH} chars`);
  }
  if (!/^[a-z][a-z0-9_.]{2,63}$/.test(routeKey)) {
    throw validationFailed("route_key", "^[a-z][a-z0-9_.]{2,63}$");
  }
  return routeKey;
}

/** والبصمةُ أربعٌ وستّونَ خانةً ستّ‌عشريّة — طولُ sha256 بحرفه، والعقدُ يفحصه. */
export function assertRequestHash(requestHash: string): string {
  if (requestHash.length !== REQUEST_HASH_LENGTH || !/^[0-9a-f]{64}$/.test(requestHash)) {
    throw validationFailed("request_hash", `sha256 hex (${REQUEST_HASH_LENGTH} chars)`);
  }
  return requestHash;
}

/** والحالةُ المحفوظةُ `2xx` — ما دونها لا يُحفَظ بقرارٍ مكتوبٍ أعلى هذا الملفّ. */
export function assertResponseStatus(status: number): number {
  if (
    !Number.isSafeInteger(status) ||
    status < RESPONSE_STATUS_MIN ||
    status > RESPONSE_STATUS_MAX
  ) {
    throw validationFailed("response_status", `${RESPONSE_STATUS_MIN}..${RESPONSE_STATUS_MAX}`);
  }
  return status;
}

/** نتيجةُ التذكّر: أوّلُ مرّةٍ (`fresh`) أو جوابٌ محفوظٌ يُعاد كما هو (`replay`). */
export interface RememberOutcome {
  readonly verdict: "fresh" | "replay";
  readonly stored: IdempotencyRecord;
}

export class PostgresIdempotencyStore {
  constructor(private readonly db: DbOrTx) {}

  /**
   * الصفُّ إن وُجد — يُقرأ **أوّلَ ما تفتح المعاملةُ** كي لا يبدأ العملُ أصلاً.
   *
   * والمفتاحان معاً لا أحدُهما: هذا هو المفتاحُ الأوّليُّ في العقد، وقراءةٌ بأحدِهما كانت
   * ستقرأ صفَّ مسارٍ آخر أو تمسح الجدولَ بلا فهرس.
   */
  async read(routeKey: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const rows = await this.db
      .select()
      .from(marketplaceIdempotency)
      .where(
        and(
          eq(marketplaceIdempotency.routeKey, assertRouteKey(routeKey)),
          eq(marketplaceIdempotency.idempotencyKey, assertIdempotencyKey(idempotencyKey)),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  /**
   * يُثبّت الجوابَ لهذا المفتاح، أو يُعيد المحفوظَ إن سبقه صفٌّ بنفسِ البصمة.
   *
   * ولا استثناءَ لـ«نفسِ المسار»: بصمةٌ مختلفةٌ على نفسِ المفتاحِ ونفسِ المسارِ خطأُ عميلٍ
   * مُسمّىً (`MARKETPLACE_IDEMPOTENCY_KEY_REUSED`)، لا كتابةٌ ثانيةٌ تُدهَس بها الأولى.
   */
  async remember(draft: IdempotencyDraft): Promise<RememberOutcome> {
    const idempotencyKey = assertIdempotencyKey(draft.idempotencyKey);
    const routeKey = assertRouteKey(draft.routeKey);
    const requestHash = assertRequestHash(draft.requestHash);
    const responseStatus = assertResponseStatus(draft.responseStatus);

    const inserted = await this.db
      .insert(marketplaceIdempotency)
      .values({
        idempotencyKey,
        routeKey,
        requestHash,
        responseStatus,
        responseBody: draft.responseBody,
      })
      .onConflictDoNothing()
      .returning();

    const fresh = inserted[0];
    if (fresh) return { verdict: "fresh", stored: toRecord(fresh) };

    const stored = await this.read(routeKey, idempotencyKey);
    if (!stored) throw validationFailed("idempotency_key", "one stored row after conflict");
    if (stored.requestHash !== requestHash) throw marketplaceIdempotencyKeyReused();
    return { verdict: "replay", stored };
  }
}
