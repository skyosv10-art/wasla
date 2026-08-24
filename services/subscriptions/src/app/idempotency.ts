/**
 * بصمةُ الطلب: **نفسُ المفتاح + نفسُ المُدخل = إعادة، ونفسُ المفتاح + مُدخلٌ آخر = تعارض**.
 *
 * ## لِمَ بصمةٌ ولا مقارنةُ الجسمِ كما هو
 *
 * لأنّ العمودَ يجب أن يبقى قصيراً وقابلاً للفهرسة، ولأنّ حفظَ جسمِ الطلبِ الأصليِّ يُخزّن
 * مُدخلاً قد يحمل مرجعَ دفعٍ ونصّاً لا نحتاجه بعد لحظتِه. وأربعٌ وستّون حرفاً سِتّةَ عشرَ
 * أساساً تُجيب عن السؤال الوحيد المطلوب: «هل هذا هو نفسُ الطلبِ الذي رأيتُه؟».
 *
 * ## ولِمَ ترتيبُ المفاتيح مفروضٌ هنا
 *
 * `JSON.stringify` يحفظ ترتيبَ الإدراج، فطلبان متساويان في المعنى (`{a,b}` و`{b,a}`) كانا
 * سيُنتجان بصمتَين مختلفتَين، فتُرفض إعادةُ إرسالٍ سليمةٍ بـ409 لأنّ عميلاً غيّر ترتيبَ
 * حقولِه بين محاولتَين. والترتيبُ يُفرض بالفرزِ في كلّ عُمق — وهو الفرقُ بين حارسٍ يحمي
 * وحارسٍ يُغضب المستعمل.
 *
 * ## وما لا يدخل البصمة
 *
 * لا ترويسات (فـ`x-request-id` يتغيّر في كلّ محاولةٍ بحكمِ تعريفه، ودخولُه كان سيجعل كلَّ
 * إعادةِ إرسالٍ «مُدخلاً آخر»)، ولا لحظةُ الوصول، ولا المفتاحُ نفسُه. جسمُ الطلبِ والمسارُ
 * وحدَهما — والمسارُ في عمودٍ منفصلٍ (`route_key`) لا في البصمة، لأنّ تعارضَ مفتاحٍ بين
 * مسارَين يجب أن يُقرأ من الصفّ بلا فكِّ تعمية.
 */

import { createHash } from "node:crypto";

import { idempotencyKeyReused } from "../domain/errors.js";
import { REQUEST_HASH_LENGTH } from "../db/idempotency.js";

/**
 * تمثيلٌ ثابتٌ لأيّ قيمةٍ قابلةٍ للتحويل إلى JSON — المفاتيحُ مفروزةٌ في كلّ عُمق.
 *
 * `undefined` داخل كائنٍ يُحذف كما يفعل `JSON.stringify` بالضبط، فلا يصير حقلٌ غائبٌ
 * مختلفاً عن حقلٍ قيمتُه `undefined` — والاثنان لا يُفرَّق بينهما على السلك أصلاً.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
  return `{${entries.join(",")}}`;
}

/**
 * بصمةُ مُدخلٍ — sha256 سِتّةَ عشرَ أساساً، بطولٍ يُطابق حرسَ العمود.
 *
 * ولمَ sha256 ولا تعميةٌ أرخص؟ لأنّ تصادُماً هنا يعني أن يُعاد إلى عميلٍ **جوابُ طلبٍ آخر**
 * بمفتاحٍ صادَف تصادُماً — وهو أسوأُ عطلٍ ممكنٍ في هذا الجدول، وثمنُ التعميةِ لا يُقاس أمامه.
 */
export function fingerprint(value: unknown): string {
  const digest = createHash("sha256").update(canonical(value), "utf8").digest("hex");
  if (digest.length !== REQUEST_HASH_LENGTH) {
    throw new RangeError(`fingerprint must be ${REQUEST_HASH_LENGTH} characters`);
  }
  return digest;
}

// ---------------------------------------------------------------------------
// مِغلافُ الإعادة — الطريقُ الذي يجعل مفتاحاً مُعاداً يُعيد **نفسَ البايتات**
// ---------------------------------------------------------------------------

/**
 * جوابٌ محفوظٌ كما سيُعاد إرسالُه — الحالةُ والجسمُ معاً، لا الحالةُ وحدَها.
 *
 * ونوعٌ ثانٍ هنا بدلَ استيرادِ `StoredResponse` من `db/`؟ لا: هذا الملفُّ في طبقةِ
 * التطبيق، وربطُه بنوعٍ يسكن في طبقةِ الاستمرارية كان يجعل بديلَ مخزنٍ في الذاكرةِ
 * يوماً ما يستوردُ `db/` ليُعلن نوعَه. والحدُّ **بنيويٌّ** لا اسميّ: `IdempotencyRecord`
 * يُطابق هذا الشكلَ فيُمرَّر بلا محوّل.
 */
export interface StoredIdempotentResponse {
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

/**
 * مِغلافُ منعِ التكرار كما يُمرَّر من الحدِّ إلى العمليّة.
 *
 * ## لِمَ يُمرَّر المِغلافُ ولا تُنادى العمليّةُ ثمّ يُحفَظ جوابُها في الحدّ
 *
 * لأنّ صفَّ منعِ التكرارِ **يجب** أن يُلزَم في معاملةِ القرارِ نفسِها (`db/unit-of-work.ts`
 * يشرح): حفظٌ بعد المعاملةِ يُنتج قراراً مُثبَّتاً بلا مفتاحٍ محفوظ — فإعادةُ إرسالٍ سليمةٌ
 * تُنفّذ العملَ **ثانيةً**، وهذا هو العطبُ الذي وُجد الجدولُ لأجله. وحفظٌ قبلها يُنتج
 * مفتاحاً محفوظاً بلا عملٍ خلفه.
 *
 * ## ولِمَ دالّةُ عرضٍ (`present`) ولا الجسمُ جاهزاً
 *
 * لأنّ البايتاتَ المحفوظةَ يجب أن تكون **بايتاتِ السلك** التي يُنتجها محوّلُ HTTP، وطبقةُ
 * التطبيق لا تعرف السلكَ ولا يجوز أن تعرفه (`__tests__/purity.test.ts` يحرس ذلك بالاسم).
 * فالحدُّ يُمرّر دالّةً تُحوّل الحصيلةَ إلى حالةٍ وجسم، وتُنادى **داخلَ** المعاملة، فيُحفَظ
 * ما سيُرسَل حرفاً بحرف. وجسمٌ جاهزٌ كان مستحيلاً: لا يُعرف قبل أن تُقرّر العمليّةُ.
 */
export interface IdempotencyEnvelope<T> {
  readonly key: string;
  /** مسارُ العمليّةِ في عمودٍ منفصل — لا في البصمة (انظر ترويسةَ الملفّ). */
  readonly routeKey: string;
  readonly requestHash: string;
  readonly traceId: string | null;
  readonly present: (outcome: T) => StoredIdempotentResponse;
}

/**
 * إشارةُ تحكّمٍ لا عطل: «هذا المفتاحُ له جوابٌ محفوظٌ، أرسِلْه كما هو».
 *
 * ## ولِمَ رميٌ ولا قيمةُ إرجاعٍ ثانية
 *
 * لأنّ الإعادةَ تُكتشَف **داخلَ** معاملةٍ مفتوحة، والمطلوبُ أن تُترك القاعدةُ كما كانت: رميٌ
 * من داخلِ `uow.write` يُرجع المعاملةَ (`ROLLBACK`) بلا كتابةٍ واحدة. وقيمةُ إرجاعٍ ثانيةٌ
 * كانت ستُلزم كلَّ عمليّةٍ بأن تُعلن نوعاً اتّحاديّاً (`Outcome | Replay`) يتسرّب إلى كلّ
 * مُنادٍ — بما فيهم النبضةُ ومستهلكُ الوقائعِ اللذان لا مفتاحَ لهما أصلاً.
 *
 * وترجمتُها إلى جوابٍ تقع في `http/errors.ts` وحدَه: هو الموضعُ الواحدُ الذي يصير فيه
 * مرفوعٌ جواباً، فلا يحتاج معالجٌ أن يلتقط شيئاً — ولا `try` في معالجٍ (نصُّ `http/app.ts`).
 */
export class ReplayedResponse extends Error {
  constructor(readonly stored: StoredIdempotentResponse) {
    super("idempotent replay");
    this.name = "ReplayedResponse";
  }
}

export function isReplayedResponse(value: unknown): value is ReplayedResponse {
  return value instanceof ReplayedResponse;
}

/** ما تحتاجه الحراسةُ من المخزن: قراءةُ صفٍّ بمفتاحه. */
export interface IdempotencyReadPort {
  read(
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
    readonly traceId: string | null;
  }): Promise<{
    readonly verdict: "fresh" | "replay";
    readonly stored: StoredIdempotentResponse;
  }>;
}

/**
 * الحراسةُ **قبل** أيّ عمل: جوابٌ محفوظٌ يُعاد، ومفتاحٌ أُعيد استعمالُه يُرفض.
 *
 * ترتيبُ الفرعَين مقصود: تساوي البصمةِ يعني إعادةَ محاولةٍ صادقةً فتستحقّ المحفوظَ،
 * واختلافُها يعني مفتاحاً واحداً لطلبَين فيستحقّ `409` — وإعادةُ جوابِ الأوّلِ للثاني كانت
 * ستُخبر عميلاً بنجاحِ عملٍ لم يُنفَّذ له.
 *
 * والقراءةُ أوّلاً — لا `remember` مباشرةً — كي لا يُنفَّذ العملُ ثمّ يُرمى: كتابةٌ تُرجَع
 * ثمنٌ بلا مقابل على مسارٍ يُنادى في كلّ إعادةِ إرسال.
 */
export async function replayGuard<T>(
  store: IdempotencyReadPort,
  envelope: IdempotencyEnvelope<T>,
): Promise<void> {
  const stored = await store.read(envelope.key);
  if (stored === null) return;
  if (stored.requestHash !== envelope.requestHash) throw idempotencyKeyReused(envelope.routeKey);
  throw new ReplayedResponse(stored);
}

/**
 * تثبيتُ الجوابِ في **نفسِ** معاملةِ القرار، وحكمُ `replay` هنا يعني سباقاً خسرناه.
 *
 * والسباقُ يقع فعلاً: طلبان بنفسِ المفتاحِ يبدآن معاً، فيقرأ كلاهما لا شيءَ في
 * `replayGuard` ويعملان، ثمّ يفوز أحدُهما بالإدراج. والخاسرُ يرمي `ReplayedResponse`
 * فتُرجَع معاملتُه كلُّها — فلا مُدّةٌ مضاعفةٌ ولا حدثٌ ثانٍ — ويستلم المُتَّصلُ بايتاتِ
 * الفائز. وهذا هو الفرقُ بين مفتاحٍ يحرس وبين مفتاحٍ يُطمئن.
 */
export async function rememberOutcome<T>(
  store: IdempotencyRememberPort,
  envelope: IdempotencyEnvelope<T>,
  outcome: T,
): Promise<T> {
  const presented = envelope.present(outcome);
  const remembered = await store.remember({
    idempotencyKey: envelope.key,
    routeKey: envelope.routeKey,
    requestHash: envelope.requestHash,
    responseStatus: presented.responseStatus,
    responseBody: presented.responseBody,
    traceId: envelope.traceId,
  });
  if (remembered.verdict === "replay") throw new ReplayedResponse(remembered.stored);
  return outcome;
}

/**
 * ## النطاق
 *
 * بصمةُ مُدخلٍ ثابتةٌ لجدولِ منعِ التكرار · مِغلافُ الإعادةِ وحراستُه وتثبيتُ جوابِه — ولا
 * قراءةَ ولا كتابةَ قاعدةٍ في هذا الملفّ: المخزنُ يُمرَّر بمنفذٍ بنيويّ.
 *
 * ## آخر تحديث
 *
 * المراجعة 6/6 — أُضيف `IdempotencyEnvelope` و`ReplayedResponse` و`replayGuard`
 * و`rememberOutcome` لِتُوصَل بايتاتُ الجوابِ المحفوظِ بمساراتِ الكتابةِ الأربعة.
 *
 * ## الحالة
 *
 * مُستعمَلٌ من `app/facts.ts` (بصمةُ حمولةِ الواقعة) ومن `app/subscriptions.ts`
 * و`app/referrals.ts` (الحراسةُ والتثبيت) ومن `http/app.ts` (بناءُ المِغلاف)
 * و`http/errors.ts` (إرسالُ المحفوظ). و`POST /subscriptions/tick` **خارجَ** هذا الطريق
 * بقرارٍ مُعلَنٍ في `http/app.ts`.
 *
 * ## كودٌ ذو صلة
 *
 * `db/idempotency.ts` · `db/unit-of-work.ts` · `http/requests.ts` · `http/errors.ts` ·
 * `contracts/errors.md`.
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
