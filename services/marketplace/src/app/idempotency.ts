/**
 * بصمةُ الطلبِ ومِغلافُ الإعادة — الطريقُ الذي يجعل مفتاحاً مُعاداً يُعيد **نفسَ البايتات**.
 *
 * ## لماذا بصمةٌ قانونيّةٌ لا `JSON.stringify` مباشرةً
 *
 * `JSON.stringify` يحفظ ترتيبَ المفاتيحِ كما وصل، فحمولتان متطابقتان معنىً يختلف ترتيبُ
 * حقولِهما تُنتجان بصمتَين — فتُرفض إعادةُ إرسالٍ صادقةٍ بـ`KEY_REUSED` لأنّ مكتبةَ العميلِ
 * رتّبت الحقولَ ترتيباً آخر. والقانونيُّ يُرتّب المفاتيحَ في كلّ عمقٍ ويُسقط `undefined`،
 * فتصير البصمةُ دالّةً على المعنى.
 *
 * والبصمةُ تُحسَب على المُدخلِ **المُتحقَّقِ منه** لا على الجسمِ الخام: الجسمُ الخامُّ يحمل
 * مسافاتٍ وترتيباً ومفاتيحَ زائدةً رفضها الحدُّ أصلاً، وبصمةٌ عليه كانت ستجعل الإعادةَ تعتمد
 * على شكلِ النصِّ لا على الطلب.
 *
 * ## لماذا `route_key` خارجَ البصمة
 *
 * مسارُ العمليّةِ عمودٌ مستقلٌّ في العقد ولا يدخل البصمة: تغييرُ شكلِ المسارِ لا يُبطل مفاتيحَ
 * محفوظة، والمفتاحُ الأوّليُّ المُركَّبُ `(route_key, idempotency_key)` هو ما يمنع أن يُقرأ
 * مفتاحُ عميلٍ في مسارَين مختلفَين.
 *
 * ## لماذا الإعادةُ تُرفَع خطأً
 *
 * `ReplayedResponse` ليست فشلاً بل قناةُ خروجٍ: رفعُها من داخلِ المعاملةِ **يُتراجِع** بها،
 * فلا يبقى صفٌّ من محاولةٍ ثانيةٍ لم يكن لها أن تكتب. وإعادةُ قيمةٍ عاديّةٍ كانت ستُلزم كلَّ
 * مسارٍ أن يتذكّر «هل هذه إعادة؟» في كلّ سطرٍ بعدها — ونسيانُ سطرٍ واحدٍ يكتب مرّتَين.
 * وطبقةُ HTTP تُميّزها في `sendMarketplaceError` وتُرسل المحفوظَ بحالته المحفوظة.
 *
 * ولا قراءةَ ولا كتابةَ قاعدةٍ في هذا الملفّ: المخزنُ يُمرَّر بمنفذٍ بنيويّ، فيبقى المِغلافُ
 * قابلاً للاختبارِ بلا قاعدةٍ ويبقى حارسُ النقاءِ صادقاً.
 */

import { createHash } from "node:crypto";

import { REQUEST_HASH_LENGTH } from "../db/idempotency.js";
import { marketplaceIdempotencyKeyReused } from "../domain/errors.js";

/** تمثيلٌ قانونيٌّ: مفاتيحُ مرتّبةٌ في كلّ عمقٍ، و`undefined` مُسقَطٌ لا مكتوبٌ `null`. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
  return `{${entries.join(",")}}`;
}

/** بصمةُ sha256 بالسدس‌عشري، بطولٍ مؤكَّدٍ لأنّ العقدَ يفحصه في القاعدة. */
export function fingerprint(value: unknown): string {
  const digest = createHash("sha256").update(canonical(value), "utf8").digest("hex");
  if (digest.length !== REQUEST_HASH_LENGTH) {
    throw new RangeError(`fingerprint must be ${REQUEST_HASH_LENGTH} characters`);
  }
  return digest;
}

/** جوابٌ محفوظٌ كما سيُعاد: الحالةُ والجسمُ معاً. */
export interface StoredIdempotentResponse {
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

/**
 * مِغلافُ كتابةٍ محروسة.
 *
 * `present` هي الدالّةُ التي تحوّل نتيجةَ العمليّةِ إلى ما سيُحفَظ — وتُمرَّر من الحدِّ لا
 * من الخدمة، لأنّ الحدَّ وحدَه يعرف حالةَ HTTP التي سيُرسلها (`201` لإنشاءٍ · `200` لقرار).
 */
export interface IdempotencyEnvelope<TOutcome> {
  readonly key: string;
  readonly routeKey: string;
  readonly requestHash: string;
  readonly present: (outcome: TOutcome) => StoredIdempotentResponse;
}

export class ReplayedResponse extends Error {
  constructor(readonly stored: StoredIdempotentResponse) {
    super("idempotent replay");
    this.name = "ReplayedResponse";
  }
}

export function isReplayedResponse(value: unknown): value is ReplayedResponse {
  return value instanceof ReplayedResponse;
}

/** ما تحتاجه الحراسةُ من المخزن: قراءةُ صفٍّ بمفتاحه المُركَّب. */
export interface IdempotencyReadPort {
  read(
    routeKey: string,
    idempotencyKey: string,
  ): Promise<(StoredIdempotentResponse & { readonly requestHash: string }) | null>;
}

/** وما يحتاجه التثبيت: إضافةٌ بلا دهسٍ تُعيد حكمَها. */
export interface IdempotencyRememberPort {
  remember(draft: {
    readonly idempotencyKey: string;
    readonly routeKey: string;
    readonly requestHash: string;
    readonly responseStatus: number;
    readonly responseBody: unknown;
  }): Promise<{
    readonly verdict: "fresh" | "replay";
    readonly stored: StoredIdempotentResponse;
  }>;
}

/**
 * **أوّلُ** جملةٍ في المعاملة: هل رأينا هذا المفتاحَ من قبل؟
 *
 * موضعُها ليس تفصيلاً: حرسٌ بعد أوّلِ قراءةٍ أو بعد أوّلِ فحصٍ يكون قد صرف عملاً على طلبٍ
 * جوابُه محفوظٌ، وحرسٌ بعد أوّلِ **كتابةٍ** يكون قد كتب. والبصمةُ المختلفةُ على نفسِ المفتاحِ
 * تعارضٌ مُسمّىً لا كتابةٌ ثانية.
 */
export async function replayGuard<TOutcome>(
  store: IdempotencyReadPort,
  envelope: IdempotencyEnvelope<TOutcome>,
): Promise<void> {
  const stored = await store.read(envelope.routeKey, envelope.key);
  if (stored === null) return;
  if (stored.requestHash !== envelope.requestHash) throw marketplaceIdempotencyKeyReused();
  throw new ReplayedResponse(stored);
}

/**
 * **آخرُ** جملةٍ في المعاملة: يُثبِّت الجوابَ الذي سيُعاد حرفاً عند أيّ إعادةِ إرسال.
 *
 * وموضعُها الأخيرُ لازمٌ: تثبيتٌ قبل تمامِ الكتابةِ يحفظ جواباً عن عملٍ قد يتراجع بعده، فتُعيد
 * الإعادةُ نجاحاً لم يقع. والحكمُ `replay` هنا يعني أنّ طلباً متزامناً سبقنا إلى الصفِّ — فنُعيد
 * ما استقرّ ونتراجع، ولا نكتب مرّتَين.
 */
export async function rememberOutcome<TOutcome>(
  store: IdempotencyRememberPort,
  envelope: IdempotencyEnvelope<TOutcome>,
  outcome: TOutcome,
): Promise<TOutcome> {
  const presented = envelope.present(outcome);
  const remembered = await store.remember({
    idempotencyKey: envelope.key,
    routeKey: envelope.routeKey,
    requestHash: envelope.requestHash,
    responseStatus: presented.responseStatus,
    responseBody: presented.responseBody,
  });
  if (remembered.verdict === "replay") throw new ReplayedResponse(remembered.stored);
  return outcome;
}
