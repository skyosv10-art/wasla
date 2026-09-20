/**
 * أنواعُ صندوق الصادر المشتركة — عقدٌ واحدٌ لكلِّ خدمةٍ (ADR-042).
 *
 * لماذا مشتركٌ: تسعُ خدماتٍ بلا آليةِ تصريفٍ (G1)، وتسعةُ drain مستقلّةٍ
 * كانت ستُكرّرُ المنطقَ نفسَه وتُنتجُ مصادرَ حقيقةٍ متعدّدةً (ADR-017).
 * هذا الملفُ يُصدِّرُ العقدَ، وكلُّ خدمةٍ تُصدِّرُ محوّلًا رقيقًا يربطُ
 * جدولَها به.
 *
 * ## الحقولُ الاختياريّةُ لا المُفتَرَضة
 *
 * `aggregateType` و`traceId` و`sequenceNumber` قد تكونُ غائبةً في بعضِ
 * الجداول (G2/G4، واختلافُ المخطط). المحوّلُ يُرجعُ `null` لا يُفترِضُ.
 * G4 أُغلقَ للجداول الستّة الباقية (CLM-0250).
 *
 * Scope: مشترك · صندوقُ الصادر
 * Last Updated: 2026-09-20
 * Status: Active
 * Related Code: ADR-042 · services/reputation/src/outbound/drain-outbox.ts
 */

/**
 * صفٌّ من جدولِ الصادر كما يراه المُصرّف.
 *
 * الحمولةُ `unknown` لا نوعُ حدثٍ مُضيَّق، وذاك مقصود: الصفُّ خرج من القاعدة،
 * وقد كُتب بنسخةٍ أقدمَ من الكود. فتحويلُه إلى نوعِ حدثٍ مُضيَّقٍ هنا كان
 * سيُدخل مُصرّفاً في تفسيرِ حمولةٍ لا يملكها.
 */
export interface OutboxRecord {
  /** المفتاحُ الأساسيّ — قد يكونُ `id` أو `outbox_id` أو `event_id`. */
  readonly id: string;
  /** مُعرّفُ الحدث — UUID فريدٌ. */
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: string;
  /** قد يكونُ `null` في جداولٍ بلا `aggregate_type` (geography). */
  readonly aggregateType: string | null;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly occurredAt: string;
  /** قد يكونُ `null` في جداولٍ بلا `trace_id` (G4 — أُغلقَ للجداول الستّة). */
  readonly traceId: string | null;
  /**
   * عددُ محاولاتِ التسليم السابقة — يُرجعُ `0` إن لم يكن العمودُ موجودًا (G3).
   * يُقرأ ليُقرِّر من يُشغّل التصريف تراجعاً أُسّياً.
   */
  readonly attempts: number;
}

/**
 * منفذُ التسليم — يرمي عند الفشل ولا يُرجع `boolean`.
 *
 * و`boolean` كان أرخصَ وأخطر: `false` صامتةٌ تُخفي **لماذا** فشل التسليم.
 * والاستثناءُ يحمل رسالتَه، و`drainOutbox` يكتبها في العمود المُعَدّ لها
 * إن وُجد.
 */
export interface EventSinkPort {
  deliver(record: OutboxRecord): Promise<void>;
}

export interface DrainFailure {
  readonly id: string;
  readonly eventType: string;
  readonly reason: string;
}

/**
 * تقريرُ دفعةٍ واحدة.
 *
 * `claimed = published + failed.length` دائماً، ويُثبته اختبار. والحقولُ
 * منفصلةٌ لا عدّادٌ واحد: «صُرّف 40» لا تقول هل نُشر أربعون أم فشل عشرون.
 */
export interface DrainReport {
  readonly claimed: number;
  readonly published: number;
  readonly failed: readonly DrainFailure[];
  /**
   * صفوفٌ سُلّمت ثمّ رفض التعليمُ الشرطيُّ أن يُغيّرها — أي كانت منشورةً أصلاً.
   *
   * الرقمُ يجب أن يبقى صفراً؛ ووجودُه في التقرير هو ما يجعله يُلاحَظ بدل أن
   * يُبتلَع. وأيُّ قيمةٍ فوق الصفر تعني أنّ الاحتجازَ لم يُقفل، وذاك عطلُ بنيةٍ.
   */
  readonly alreadyPublished: number;
}
