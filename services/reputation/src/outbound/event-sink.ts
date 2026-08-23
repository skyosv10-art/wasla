/**
 * حدُّ التسليم: أين تذهب أحداثُ الصندوق (الطور 09 · المراجعة 5/6).
 *
 * ## لِمَ منفذٌ ولا `fetch`
 *
 * `purity.test.ts` يمنع `fetch` في **كلِّ** ملفٍّ تحت `src/` بلا استثناءٍ واحد، وهذه
 * المراجعةُ لا تُوسّعه ولا تُضيّقه: التسليمُ يبقى منفذاً، ومُهيئُه الشبكيُّ يسكن في
 * العملية التي تُشغّل التصريف — كما أنّ مُشغّلَ `POST /reputation/tick` خارجَ الخدمة.
 *
 * والسببُ ليس طاعةَ حارس. الناقلُ في وصلة قرارُ منصّةٍ لم يُتّخذ بعد: لا خدمةَ في
 * المستودع اليوم لها ناشرٌ يُصرّف صندوقَها، ولا ADR يُسمّي ناقلاً. فمُهيئٌ شبكيٌّ هنا
 * كان سيُلزم المنصّةَ بمكتبةٍ قبل قرارها، ثم يُقاس ثمنُه يومَ يُختار غيرُها — وأسوأُ
 * ما فيه أنّه كان سيُضيف تبعيّةً إلى `package.json` فيُفشل حرسَ التبعيّات الذي كُتب
 * ليمنع بعينه هذا.
 *
 * وما يجب أن يكون صحيحاً الآن ومُختبَراً هو **منطقُ التصريف**: يقرأ غيرَ المنشور،
 * يُسلّم، يُعلّم؛ وفشلُ التسليم لا يُبطل الكتابة؛ وإعادةُ المحاولة لا تُنتج نشرتين
 * لنفس الصفّ. وذاك كلُّه يُقاس بمنفذٍ في الذاكرة بلا شبكة.
 *
 * Scope: خدمة السمعة · حدُّ نشر الأحداث
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: src/outbound/drain-outbox.ts · services/reputation/contracts/events.json
 * Related Team: Reputation & Trust
 */

/**
 * صفٌّ من `reputation_outbox` كما يراه المُصرّف.
 *
 * الحمولةُ `unknown` لا نوعُ حدثٍ مُضيَّق، وذاك مقصود: الصفُّ خرج من القاعدة، وقد كُتب
 * بنسخةٍ أقدمَ من الكود. فتحويلُه إلى `ReputationDomainEvent` هنا كان سيُدخل مُصرّفاً
 * في تفسير حمولةٍ لا يملكها ويُسقطه على حدثٍ صحيحٍ من نسخةٍ سابقة. والمُصرّفُ ناقلٌ لا
 * قارئ: يأخذ ما في `payload` ويُسلّمه كما هو.
 */
export interface OutboxRecord {
  /** المفتاحُ الأساسيّ، وهو `event_id` نفسُه (انظر `PostgresReputationOutbox`). */
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly payload: unknown;
  readonly occurredAt: string;
  /** عددُ محاولاتِ التسليم السابقة — يُقرأ ليُقرِّر من يُشغّل التصريف تراجعاً أُسّياً. */
  readonly attempts: number;
  /**
   * مُعرّفُ التتبّع كما وُلد في الطلب الأصليّ.
   *
   * HANDOFF §16-ي البند 4: يمرّ `x-request-id` كما هو من الحدث الداخل إلى الواقعة إلى
   * الحدث الخارج. وهذا الحقلُ هو الحلقةُ الأخيرة في السلسلة، ولذلك يُسلَّم إلى المنفذ
   * صريحاً بدل أن يُنتزَع من `payload`: انتزاعُه كان سيلزم المُصرّفَ بمعرفة شكل الحمولة.
   */
  readonly traceId: string | null;
}

/**
 * منفذُ التسليم — يرمي عند الفشل ولا يُرجع `boolean`.
 *
 * و`boolean` كان أرخصَ وأخطر: `false` صامتةٌ تُخفي **لماذا** فشل التسليم، فيُسجَّل في
 * `last_error` نصٌّ من عندنا لا من العطل، ويُقرأ بعد أسبوعين فلا يقول شيئاً. والاستثناءُ
 * يحمل رسالتَه، و`drainOutbox` يكتبها في العمود المُعَدّ لها.
 */
export interface EventSinkPort {
  deliver(record: OutboxRecord): Promise<void>;
}

/**
 * خطأُ منفذٍ غيرِ مُهيَّأ — يُرفَع باسمه ولا يُبلَع.
 *
 * وهو نمطُ `services/negotiations/src/infrastructure/outbound-wiring.ts` نفسُه: متغيّرُ
 * بيئةٍ مفقودٌ يُنتج منفذاً **ظاهرَ العطل** لا افتراضاً مُخمَّناً. والبديلُ الأرخصُ
 * الخاطئ منفذٌ لا يفعل شيئاً ويُرجع بنجاح: الصندوقُ يُفرَغ، و`published_at` يُكتب،
 * ولا مستهلكَ يستلم شيئاً — أي فقدانُ أحداثٍ صامتٌ يظهر بعد شهرٍ في لوحةٍ ناقصة.
 */
export class EventSinkUnconfiguredError extends Error {
  constructor(reason: string) {
    super(`reputation event sink is not configured: ${reason}`);
    this.name = "EventSinkUnconfiguredError";
  }
}

/**
 * منفذٌ يُعلن أنّه غيرُ مُهيَّأ في كل نداء.
 *
 * يُستعمل حين تُقلَع الخدمةُ بلا هدفِ نشرٍ مُعلَن: التصريفُ حينئذٍ يفشل تسليمَ كلِّ صفٍّ
 * ويكتب السببَ في `last_error`، ويبقى `published_at` فارغاً — فلا حدثَ يُفقَد، ويُقرأ
 * العطلُ من الجدول بلا تحقيق.
 */
export function unconfiguredEventSink(reason: string): EventSinkPort {
  return {
    async deliver(): Promise<void> {
      throw new EventSinkUnconfiguredError(reason);
    },
  };
}
