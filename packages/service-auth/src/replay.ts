/**
 * منعُ إعادةِ رمزِ الخدمةِ — العقدُ ومخزنُ الذاكرة (M1-03 · إغلاقُ دَينِ ADR-020 §3).
 *
 * القرارُ الحاكم: [ADR-021](../../../docs/15-decisions/ADR-021-service-token-replay-protection.md).
 *
 * ── لماذا عقدٌ قبلَ تنفيذٍ ─────────────────────────────────────────────────
 * المخزنُ الحقيقيُّ (Redis) ليس في المستودعِ اليومَ — `infra/` فيها `.gitkeep`
 * وحدَه. فلو كُتبَ الفرضُ على عميلِ Redis مباشرةً لكان الكودُ يتحدَّث إلى شيءٍ
 * لا وجودَ له، ولو أُجِّل كلُّ شيءٍ لبقيَ البابُ مفتوحاً. فالمكتوبُ هنا **عقدٌ
 * واحدٌ** (`ServiceTokenReplayGuard`) وتنفيذٌ في الذاكرةِ يُثبِته، وRedis تنفيذٌ
 * ثانٍ لنفسِ العقدِ يأتي مع طبقةِ النشرِ ولا يُغيِّر سطراً في نقطةِ الفرض.
 *
 * ── ثلاثةُ شروطٍ يجب أن يحققها أيُّ تنفيذٍ، وإلّا فليس حارساً ──────────────
 * 1. **الذَّرِّيّةُ (atomicity).** «اقرأ ثمّ اكتب» في نداءَينِ يجعل رمزَينِ
 *    متوازيَينِ يمرّانِ كليهما — وهي الحالةُ التي يُصنَع الهجومُ لها أصلاً.
 *    فالعمليّةُ واحدةٌ: **اكتب إن لم يكن موجوداً وأخبِرني بالنتيجة** (في Redis:
 *    `SET key 1 NX PX <ms>`؛ وهنا: فحصٌ وكتابةٌ داخلَ نبضةٍ واحدةٍ من حلقةِ الحدث).
 * 2. **مدّةُ الحفظِ ≥ لحظةِ انتهاءِ الرمزِ + هامشِ الانحراف.** أثرٌ يُنسى قبلَ
 *    انتهاءِ الرمزِ يفتح النافذةَ نفسَها التي أُغلقت. ومَن يحفظ أطولَ من ذلك
 *    يُنفِق ذاكرةً بلا فائدةٍ: الرمزُ المنتهي يُرفَض في البابِ الرابعِ قبلَ الحارس.
 * 3. **الإخفاقُ يُغلِق لا يُمرِّر.** مخزنٌ لا يُجيب لا يعني «لم يُعَد استخدامُه»؛
 *    يعني «لا أعرف». وحدٌّ لا يعرف لا يسمح — فيُرَدُّ 503 لا 200 ولا 401
 *    (وسببُ التمييزِ في ADR-021 §5: 401 يكذب على المُنادي الشريفِ ويُرسِله
 *    يبحث في مفاتيحِه، و200 يفتح الباب).
 *
 * ── ولا يُحفَظ أثرُ رمزٍ لم يُتحقَّق من توقيعِه ────────────────────────────
 * الحارسُ يُستدعى **بعدَ** التوقيعِ لا قبلَه، وهذا ليس ترتيباً تجميليّاً: مَن
 * يستطيع حفظَ آثارٍ بلا توقيعٍ يستطيع أن يُغرِق المخزنَ بمعرِّفاتٍ مُختلقةٍ حتّى
 * يمتلئ فيُغلَق الحدُّ على أصحابِه — أي يصنع من الحمايةِ سلاحاً بحرمانِ الخدمة.
 */

/** أثرُ رمزٍ يُحفَظ. لا سرَّ فيه ولا حِمْلَ — معرِّفٌ ومفتاحٌ ولحظةُ انتهاءٍ. */
export interface ServiceTokenReplayRecord {
  /** معرِّفُ المفتاحِ الموقِّع — يدخل في المِفتاحِ كي لا يتصادم مِنتاجانِ. */
  readonly kid: string;
  /** المعرِّفُ الفريدُ للرمزِ (`jti`). */
  readonly jti: string;
  /** لحظةُ انتهاءِ الرمزِ بالملّي — الحدُّ الأدنى لمدّةِ الحفظ. */
  readonly expiresAtMs: number;
}

/**
 * قرارُ الحارس. `accepted` = أوّلُ مرّةٍ يُرى فيها هذا الأثرُ. `replayed` = رُئي
 * قبلَ الآنَ ولم تنتهِ مدّتُه بعدُ.
 */
export type ServiceTokenReplayDecision = "accepted" | "replayed";

/**
 * عقدُ حارسِ الإعادة. **مُتزامنٌ أو غيرُ مُتزامنٍ**، لأنّ تنفيذَ الذاكرةِ لا
 * يحتاج انتظاراً وRedis يحتاجه — والعقدُ يقبل الاثنَينِ كي لا يُعاد كتابةُ
 * نقطةِ الفرضِ مرّةً ثانيةً حينَ يتغيَّر المخزن.
 */
export interface ServiceTokenReplayGuard {
  remember(
    record: ServiceTokenReplayRecord,
  ): ServiceTokenReplayDecision | Promise<ServiceTokenReplayDecision>;
}

/**
 * المخزنُ لا يستطيع الإجابةَ. **لا تُلتقَط هذه ولا تُترجَم إلى «مقبول»** في أيِّ
 * موضعٍ — نقطةُ الفرضِ تردُّها 503 صراحةً (ADR-021 §5).
 */
export class ServiceTokenReplayStoreUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServiceTokenReplayStoreUnavailableError";
  }
}

export interface InMemoryReplayGuardOptions {
  /**
   * أقصى عددِ آثارٍ محفوظةٍ. الحدُّ ليس تجميلاً: مخزنٌ بلا حدٍّ في عمليّةٍ
   * واحدةٍ هو تسريبُ ذاكرةٍ يُسقِط الخدمةَ عندَ أوّلِ فيضٍ من النداءات. وعندَ
   * البلوغِ **يُرمى** لا يُمسَح الأقدمُ: مسحُ الأقدمِ يُعيد فتحَ نافذةِ الإعادةِ
   * بصمتٍ، والرميُ يُغلِق الحدَّ بضجيجٍ يُرصَد.
   */
  readonly maxEntries?: number;
  /** هامشٌ يُضاف إلى مدّةِ الحفظِ فوقَ `exp` — بانحرافِ الساعاتِ نفسِه. */
  readonly retentionSkewSeconds?: number;
  /**
   * اللحظةُ الحاضرةُ. **تُمرَّر ولا تُقرأ من الساعةِ العامّةِ** — نفسُ قاعدةِ
   * الوقتِ المُمرَّرِ في ADR-011/ADR-013 وفي `verifyServiceToken`: نافذةُ حفظٍ
   * تُقاس بساعةٍ ضمنيّةٍ لا تُختبَر إلّا بمؤقِّتاتٍ زائفةٍ، والمؤقِّتُ الزائفُ
   * يُثبِت المؤقِّتَ لا الحارس.
   */
  readonly now?: () => Date;
}

/** الحدُّ الافتراضيُّ لعددِ الآثار. 100 ألفٍ ≈ نداءاتُ دقائقَ في خدمةٍ نشطةٍ. */
export const DEFAULT_MAX_REPLAY_ENTRIES = 100_000;

/**
 * تنفيذٌ في ذاكرةِ العمليّةِ. **يُثبِت العقدَ ولا يكفي للإنتاجِ**، ويُقال ذلك
 * ولا يُخفى: عمليّتانِ من نفسِ الخدمةِ وراءَ موازِنِ حِمْلٍ لهما مخزنانِ
 * منفصلانِ، فرمزٌ أُرسِل مرّتَينِ يقع على عمليّتَينِ ويمرُّ. فهذا للاختبارِ
 * ولنشرٍ بعمليّةٍ واحدةٍ فقط، وRedis هو التنفيذُ المشترَكُ (ADR-021 §6 · `RISK-0015`).
 */
export class InMemoryServiceTokenReplayGuard implements ServiceTokenReplayGuard {
  private readonly seen = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly retentionSkewMs: number;
  private readonly now: () => Date;

  constructor(options: InMemoryReplayGuardOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_REPLAY_ENTRIES;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries <= 0) {
      throw new TypeError("أقصى عددِ الآثارِ يجب أن يكون عدداً صحيحاً موجباً.");
    }
    this.retentionSkewMs = (options.retentionSkewSeconds ?? 60) * 1000;
  }

  /**
   * يحفظ الأثرَ إن لم يكن محفوظاً. **فحصٌ وكتابةٌ بلا `await` بينهما** — فلا
   * تتخلَّل نبضةٌ من حلقةِ الحدثِ بينَ السؤالِ والجواب.
   */
  remember(record: ServiceTokenReplayRecord): ServiceTokenReplayDecision {
    const nowMs = this.now().getTime();
    this.sweep(nowMs);

    const key = replayKey(record);
    const existingUntil = this.seen.get(key);
    if (existingUntil !== undefined && existingUntil > nowMs) {
      return "replayed";
    }

    if (existingUntil === undefined && this.seen.size >= this.maxEntries) {
      throw new ServiceTokenReplayStoreUnavailableError(
        `مخزنُ آثارِ الرموزِ بلغَ حدَّه (${this.maxEntries}) فلا يستطيع إثباتَ الطزاجة.`,
      );
    }

    this.seen.set(key, record.expiresAtMs + this.retentionSkewMs);
    return "accepted";
  }

  /** عددُ الآثارِ الحاضرةِ — للاختبارِ والرصدِ، لا للقرار. */
  size(): number {
    return this.seen.size;
  }

  /**
   * يُزيل ما انتهت مدّةُ حفظِه. المسحُ **كسولٌ** لا بمؤقّتٍ: مؤقّتٌ يعمل في
   * الخلفيّةِ يُبقي العمليّةَ حيّةً ويُصعِّب إيقافَ الخدمةِ نظيفاً، والمسحُ عندَ
   * الاستدعاءِ يكفي لأنّ الحارسَ لا يُسأل إلّا مع نداءٍ.
   */
  private sweep(nowMs: number): void {
    if (this.seen.size === 0) return;
    for (const [key, until] of this.seen) {
      if (until <= nowMs) this.seen.delete(key);
    }
  }
}

/**
 * مِفتاحُ المخزن. `kid` جزءٌ منه لأنّ `jti` فريدٌ عندَ مِنتاجٍ واحدٍ لا عبرَ
 * المفاتيحِ كلِّها، والفاصلُ حرفٌ لا يجوز في `jti` ولا في `kid` فلا يُخلَط
 * `a:b` بـ`ab` (خلطُ الحدودِ في المفاتيحِ النصّيّةِ بابُ تصادمٍ مقصودٍ).
 */
function replayKey(record: ServiceTokenReplayRecord): string {
  return `${record.kid}\u0000${record.jti}`;
}
