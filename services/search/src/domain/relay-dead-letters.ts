/**
 * مقياسُ الرسائلِ المسمومةِ في مُرحِّلِ البحثِ وحُكمُ تنبيهِها
 * (فجوةُ `G5` · موجةٌ أولى: **العينُ** · `CLM-0247`).
 *
 * ## الدَّينُ الذي يرفعُهُ هذا الملفُّ
 *
 * مُرحِّلُ البحثِ (`src/relay.ts`) يملكُ مخرَجاً نهائيّاً واحداً للحدثِ الذي
 * عجزَ عنهُ: يُكتَبُ `status = 'poisoned'` في `search_relay_consumed_events`،
 * **وتتقدَّمُ نقطةُ التقدُّمِ فوقَهُ**. وهذا صحيحٌ ومقصودٌ — حدثٌ واحدٌ فاسدٌ لا
 * يجوزُ أن يُوقِفَ فهرسةَ الكتالوجِ كلَّها. لكنَّهُ يعني أنَّ **الفقدَ صامتٌ**:
 * الصفُّ في القاعدةِ، والمُرحِّلُ يمضي، ولا عينَ تسألُ الجدولَ أبداً — فمنتجٌ لم
 * يُفهرَسْ يظهرُ للمستخدمِ «غيرَ موجودٍ» لا «مُتعذِّرَ الفهرسةِ».
 *
 * ## وسابقةٌ مُلزِمةٌ تُتَّبعُ حرفاً لا تُبتكَرُ
 *
 * خدمةُ التوصيلِ عالجت الدَّينَ نفسَهُ على ثلاثِ مراجعاتٍ مُرتَّبةٍ
 * (ADR-026 §4.23 العينُ · §4.24 اليدُ · §4.27 الإقرارُ). وهذا الملفُّ **موجةُ
 * العينِ** للبحثِ بنفسِ الشكلِ والأسماءِ والعتباتِ، كي يقرأَ المُشغِّلُ مقياسَينِ
 * بقاموسٍ واحدٍ لا بقاموسَينِ. واليدُ والإقرارُ موجتانِ تاليتانِ مُعلنتانِ في
 * الجردِ، لا نقصٌ مسكوتٌ عنهُ.
 *
 * ## ولمَ **جدولٌ** لا عدّادٌ في العمليّةِ؟
 *
 * عدّادٌ في العمليّةِ يُصفَّرُ بإعادةِ نشرٍ، ويتضاعفُ بعددِ النُّسَخِ، ويكذبُ
 * بعدَ انهيارٍ — فيقرأُ المُشغِّلُ صفراً ويظنُّهُ نظافةً وفي القاعدةِ أربعونَ
 * صفّاً مسموماً. والدفترُ هوَ مصدرُ الحقيقةِ، وكلُّ نداءٍ يسألُ الجدولَ.
 *
 * ## وحدٌّ صريحٌ: **مُعلِمٌ لا حاكمٌ**
 *
 * هذا المقياسُ **لا يمسُّ `GET /search/ready` أبداً** (`gates_readiness:
 * false`). صفٌّ مسمومٌ خبرٌ يستحقُّ إنساناً، وليسَ سبباً لإخراجِ نُسَخِ البحثِ
 * كلِّها من الدورةِ: الفهرسُ يخدمُ ما فيهِ بلا نقصٍ، والمسمومُ حدثُ فهرسةٍ
 * ماضٍ فُقِدَ. وربطُهُما كانَ سيجعلَ حدثاً فاسداً واحداً **انقطاعَ بحثٍ**.
 *
 * ## وحدٌّ مقيسٌ يُعلَنُ ولا يُخفى: العمرُ عمرُ **أوّلِ محاولةٍ**
 *
 * دفترُ التوصيلِ يملكُ `updated_at` فيقيسُ عمرَ **الفقدِ** نفسِهِ. ودفترُ
 * البحثِ يملكُ `consumed_at` وحدَهُ — وهوَ طابعُ إنشاءِ الصفِّ عندَ أوّلِ
 * محاولةٍ، لا طابعُ صيرورتِهِ مسموماً بعدَ استنفادِ المحاولاتِ. والفرقُ بينَهما
 * دقائقُ لا أيّامٌ (المحاولاتُ الخمسُ في دورةٍ واحدةٍ أو دوراتٍ متقاربةٍ)، فهوَ
 * لا يُبطِلُ عتبةَ اليومِ. **ولم يُضَفْ عمودٌ ثانٍ لهذا وحدَهُ**: عمودٌ يُكتَبُ
 * في مسارٍ واحدٍ ويُقرأُ في مقياسٍ واحدٍ زيادةُ سطحٍ بلا زيادةِ صدقٍ، والحدُّ
 * مكتوبٌ هنا ومنشورٌ في جسمِ الجوابِ (`age_measured_from`) كي يقرأَهُ مَن هوَ في
 * حادثةٍ لا مَن يقرأُ ADR.
 */

/* ════════════════════════════════════════════════════════════════════════
 * 1) الدفترُ — واحدٌ، ومُصرَّحٌ رغمَ وحدتِهِ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * اسمُ الدفترِ في **لغةِ المُشغِّلِ** لا اسمُ الجدولِ.
 *
 * ودفترٌ واحدٌ يُصرَّحُ في قائمةٍ لا يُكتَبُ نصّاً في الاستعلامِ: البحثُ يستهلكُ
 * `marketplace_outbox` اليومَ، وأيُّ مُرحِّلٍ ثانٍ يُضافُ غداً يصيرُ عنصراً في
 * هذهِ القائمةِ فيظهرُ في الجوابِ حتماً — والنوعُ يجعلُ نسيانَ جدولِهِ خطأَ
 * ترجمةٍ لا نقصاً صامتاً في المقياسِ.
 */
export const SEARCH_DEAD_LETTER_LEDGERS = ["marketplace"] as const;

export type SearchDeadLetterLedger = (typeof SEARCH_DEAD_LETTER_LEDGERS)[number];

/**
 * الحالةُ النهائيّةُ المقيسةُ — **واحدةٌ لا اثنتانِ**.
 *
 * `skipped` و`skipped_stale` و`ignored` ليست فقداً: الأولى تخطٍّ بتماثُليّةٍ
 * صحيحةٍ، والأخريانِ حدثٌ ليسَ لنا أو قِدَمٌ مقصودٌ. و`pending` ليست نهائيّةً
 * أصلاً — وعدُّها مسموماً كانَ سيُنبِّهُ على كلِّ دفعةٍ جاريةٍ فيصيرُ التنبيهُ
 * ضجيجاً يُصمَّتُ، وهذا أسوأُ من غيابِهِ.
 */
export const SEARCH_POISONED_STATUS = "poisoned" as const;

/* ════════════════════════════════════════════════════════════════════════
 * 2) شكلُ المقياسِ
 * ════════════════════════════════════════════════════════════════════════ */

/** تفصيلُ نوعِ الحدثِ داخلَ دفترٍ واحدٍ — أعلى أوّلاً ثمَّ بالاسمِ. */
export interface SearchDeadLetterEventTypeCount {
  readonly eventType: string;
  readonly poisoned: number;
}

export interface SearchDeadLetterLedgerMetric {
  readonly ledger: SearchDeadLetterLedger;
  readonly poisoned: number;
  /**
   * المُقَرُّ بهِ وغيرُ المُقَرِّ بهِ — **ومجموعُهما `poisoned` حتماً**
   * (موجةُ المحضرِ · `CLM-0249`).
   *
   * ونشرُ الثلاثةِ معاً مقصودٌ: نشرُ غيرِ المُقَرِّ بهِ وحدَهُ كانَ سيجعلُ
   * الإقرارَ **حذفاً بمظهرٍ آخرَ** في عينِ قارئِ الجوابِ.
   */
  readonly acknowledgedPoisoned: number;
  readonly unacknowledgedPoisoned: number;
  /** ISO-8601، أو `null` حينَ لا مسمومَ في هذا الدفترِ. */
  readonly oldestPoisonedAt: string | null;
  readonly newestPoisonedAt: string | null;
  /** أقدمُ **غيرِ مُقَرٍّ بهِ** — وهوَ وحدَهُ ما تُقاسُ عليهِ عتبةُ العمرِ. */
  readonly oldestUnacknowledgedPoisonedAt: string | null;
  readonly byEventType: readonly SearchDeadLetterEventTypeCount[];
}

/**
 * المقياسُ كاملاً.
 *
 * و**كلُّ دفترٍ يُذكَرُ دائماً وإن كانَ صفراً**: دفترٌ يغيبُ عن الجوابِ حينَ
 * يخلو لا يُفرَّقُ عن دفترٍ نُسِيَ من الاستعلامِ، فيُقرأُ الغيابُ نظافةً.
 * والصفرُ المقيسُ يُذكَرُ صريحاً لأنَّهُ جوابٌ، أمّا «لا أدري» فمخرجُهُ خطأٌ لا
 * صفرٌ.
 */
export interface SearchDeadLetterMetric {
  readonly measuredAt: string;
  readonly totalPoisoned: number;
  /**
   * **والمقسومُ منشورٌ لا مطويٌّ**: `totalPoisoned` هوَ الواقعُ،
   * و`totalUnacknowledgedPoisoned` هوَ ما يُحاكَمُ عليهِ. ومُشغِّلٌ يرى
   * `severity: ok` و`total_poisoned: 40` ولا يرى المقسومَ يقرأُ المقياسَ
   * معطوباً — أو أسوأَ: يصدِّقُهُ وينسى أربعينَ صفّاً.
   */
  readonly totalAcknowledgedPoisoned: number;
  readonly totalUnacknowledgedPoisoned: number;
  readonly ledgers: readonly SearchDeadLetterLedgerMetric[];
}

/* ════════════════════════════════════════════════════════════════════════
 * 3) العتباتُ — نفسُ أرقامِ سابقةِ التوصيلِ حرفاً
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * **`warningPoisoned = 1`، ولا مساومةَ.** عتبةٌ أعلى تعني أنَّ أحداثاً تُفقَدُ
 * **بقرارٍ مكتوبٍ** بلا أن يعلمَ أحدٌ؛ والمسمومُ ليسَ تقلُّباً في حِملٍ بل حدثٌ
 * استنفدَ محاولاتِهِ ثمَّ تُخُطِّيَ نهائيّاً. فواحدٌ خبرٌ.
 *
 * **و`criticalPoisoned = 10`** تفرِّقُ بينَ حادثةٍ مفردةٍ (حدثٌ فاسدٌ واحدٌ)
 * وبينَ عيبٍ منهجيٍّ (نسخةُ حدثٍ جديدةٌ من السوقِ تُسمِّمُ كلَّ صفٍّ): العلاجُ
 * مختلفٌ فدرجةُ التنبيهِ مختلفةٌ.
 *
 * **و`criticalAgeSeconds = 86_400`** تُدرِكُ ما يفوتُ العددَ: صفٌّ واحدٌ عمرُهُ
 * يومٌ يعني أنَّ تنبيهَ التحذيرِ **أُهمِلَ**، والإهمالُ حالةٌ تُصعَّدُ لا
 * تُنتظَرُ. والأرقامُ الثلاثةُ هيَ أرقامُ `RELAY_DEAD_LETTER_THRESHOLDS` في
 * التوصيلِ حرفاً: عتبتانِ مختلفتانِ لفقدٍ واحدٍ في منظومةٍ واحدةٍ كانتا ستجعلانِ
 * المُشغِّلَ يحفظُ جدولاً لا قاعدةً.
 */
export const SEARCH_DEAD_LETTER_THRESHOLDS = {
  warningPoisoned: 1,
  criticalPoisoned: 10,
  criticalAgeSeconds: 86_400,
} as const;

export type SearchDeadLetterSeverity = "ok" | "warning" | "critical";

/**
 * حكمٌ مُسبَّبٌ لا درجةٌ عارية. و`because` رمزٌ ثابتٌ لا نصٌّ حرٌّ: مَن يقرأُ
 * تنبيهاً يحتاجُ أن يعرفَ **أيُّ عتبةٍ** أطلقتْهُ قبلَ أن يفتحَ لوحةً، ولوحةٌ
 * تُصنِّفُ الحوادثَ تحتاجُ قيمةً تُجمَّعُ.
 */
export type SearchDeadLetterVerdictReason =
  | "no_poisoned_rows"
  /** مسمومٌ موجودٌ وكلُّهُ مُقَرٌّ بهِ — `ok` **بسببٍ مختلفٍ** لا بسببِ الخلوِّ. */
  | "all_poisoned_acknowledged"
  | "poisoned_present"
  | "poisoned_count_at_or_above_critical"
  | "oldest_poisoned_at_or_above_critical_age";

export interface SearchDeadLetterVerdict {
  readonly severity: SearchDeadLetterSeverity;
  readonly because: SearchDeadLetterVerdictReason;
  /** عمرُ أقدمِ صفٍّ مسمومٍ، أو `null` حينَ لا مسمومَ. */
  readonly oldestPoisonedAgeSeconds: number | null;
  /**
   * عمرُ أقدمِ صفٍّ مسمومٍ **غيرِ مُقَرٍّ بهِ** — وهوَ المقيسُ على العتبةِ.
   * والاثنانِ يُنشَرانِ معاً كي يُرى الفرقُ بينَ «لا فقدَ قديمَ» و«فقدٌ قديمٌ
   * نظرَ فيهِ إنسانٌ».
   */
  readonly oldestUnacknowledgedPoisonedAgeSeconds: number | null;
}

/* ════════════════════════════════════════════════════════════════════════
 * 4) الحسابُ — دالّتانِ نقيّتانِ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * عمرُ أقدمِ صفٍّ مسمومٍ عبرَ الدفاترِ كلِّها.
 *
 * **ويُقصُّ عندَ الصفرِ ولا يُعادُ سالباً**: ساعةُ القاعدةِ وساعةُ العمليّةِ قد
 * تختلفانِ بأجزاءٍ من الثانيةِ، وعمرٌ سالبٌ كانَ سيُقارَنُ بعتبةٍ ويُقرأُ في
 * لوحةٍ. وطابعٌ لا يُفهَمُ زمناً يُعادُ `null` لا صفراً: الصفرُ يُقرأُ «الآنَ»
 * وهوَ ادّعاءٌ لم يُقَسْ.
 */
export function oldestSearchPoisonedAgeSeconds(
  metric: Pick<SearchDeadLetterMetric, "ledgers">,
  at: Date,
): number | null {
  return oldestAgeSeconds(metric, at, (ledger) => ledger.oldestPoisonedAt);
}

/**
 * عمرُ أقدمِ صفٍّ مسمومٍ **غيرِ مُقَرٍّ بهِ** — بنفسِ قواعدِ القصِّ والعدمِ حرفاً
 * (موجةُ المحضرِ · `CLM-0249`).
 *
 * ولمَ دالّةٌ ثانيةٌ لا مُعامِلٌ في الأولى؟ لأنَّ الأولى منشورةٌ ومُختبَرةٌ
 * ومقروءةٌ في الجوابِ، ومُعامِلٌ اختياريٌّ يُغيِّرُ معناها كانَ سيجعلُ نداءً
 * قديماً يقيسُ شيئاً ونداءً جديداً يقيسُ آخرَ بالاسمِ نفسِهِ.
 */
export function oldestUnacknowledgedSearchPoisonedAgeSeconds(
  metric: Pick<SearchDeadLetterMetric, "ledgers">,
  at: Date,
): number | null {
  return oldestAgeSeconds(metric, at, (ledger) => ledger.oldestUnacknowledgedPoisonedAt);
}

function oldestAgeSeconds(
  metric: Pick<SearchDeadLetterMetric, "ledgers">,
  at: Date,
  pick: (ledger: SearchDeadLetterLedgerMetric) => string | null,
): number | null {
  let oldestMs: number | null = null;
  for (const ledger of metric.ledgers) {
    const value = pick(ledger);
    if (value === null) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (oldestMs === null || parsed < oldestMs) oldestMs = parsed;
  }
  if (oldestMs === null) return null;
  return Math.max(0, Math.floor((at.getTime() - oldestMs) / 1000));
}

/**
 * الحكمُ. **الأشدُّ يفوزُ، وسببُ العددِ يُقدَّمُ على سببِ العمرِ** حينَ
 * يتحقَّقانِ: تجاوُزُ العددِ يدلُّ على عيبٍ منهجيٍّ جارٍ، وتجاوُزُ العمرِ يدلُّ
 * على إهمالِ تنبيهٍ — وأوّلُهما أعجلُ في العلاجِ. والترتيبُ مُثبَتٌ باختبارٍ لا
 * مُستنتَجٌ من ترتيبِ الأسطرِ.
 *
 * **والعتبةُ تُقرأُ من الثابتِ ولا تُمرَّرُ مُعامِلاً**: عتبةٌ قابلةٌ للحَقنِ من
 * نداءٍ تعني مسارَ تشغيلٍ يستطيعُ تخفيفَ حكمِهِ على نفسِهِ.
 */
export function classifySearchDeadLetterSeverity(
  metric: Pick<
    SearchDeadLetterMetric,
    "ledgers" | "totalPoisoned" | "totalUnacknowledgedPoisoned"
  >,
  at: Date,
): SearchDeadLetterVerdict {
  const ages = {
    oldestPoisonedAgeSeconds: oldestSearchPoisonedAgeSeconds(metric, at),
    oldestUnacknowledgedPoisonedAgeSeconds: oldestUnacknowledgedSearchPoisonedAgeSeconds(
      metric,
      at,
    ),
  } as const;
  const openAgeSeconds = ages.oldestUnacknowledgedPoisonedAgeSeconds;

  if (metric.totalPoisoned < SEARCH_DEAD_LETTER_THRESHOLDS.warningPoisoned) {
    return { severity: "ok", because: "no_poisoned_rows", ...ages };
  }

  /*
   * مسمومٌ موجودٌ وكلُّهُ مُقَرٌّ بهِ: `ok` **بسببٍ مختلفٍ** لا بسببِ الخلوِّ.
   * والسببانِ لا يُدمَجانِ: «لا فقدَ» و«فقدٌ نظرَ فيهِ إنسانٌ وسمّاهُ» حالتانِ
   * مختلفتانِ في تحقيقٍ، ورمزٌ واحدٌ لهما كانَ سيخفي الثانيةَ.
   */
  if (metric.totalUnacknowledgedPoisoned < SEARCH_DEAD_LETTER_THRESHOLDS.warningPoisoned) {
    return { severity: "ok", because: "all_poisoned_acknowledged", ...ages };
  }

  /*
   * والعدُّ الحرِجُ يُقاسُ على **غيرِ المُقَرِّ بهِ** وحدَهُ: عشرةُ صفوفٍ نظرَ
   * فيها إنسانٌ وسمّاها ليست عيباً منهجيّاً جارياً، وتصعيدُها كانَ سيُعيدُ
   * الضجيجَ الذي تُلغيهِ هذهِ الموجةُ من بابٍ آخرَ.
   */
  if (metric.totalUnacknowledgedPoisoned >= SEARCH_DEAD_LETTER_THRESHOLDS.criticalPoisoned) {
    return {
      severity: "critical",
      because: "poisoned_count_at_or_above_critical",
      ...ages,
    };
  }

  if (
    openAgeSeconds !== null &&
    openAgeSeconds >= SEARCH_DEAD_LETTER_THRESHOLDS.criticalAgeSeconds
  ) {
    return {
      severity: "critical",
      because: "oldest_poisoned_at_or_above_critical_age",
      ...ages,
    };
  }

  return { severity: "warning", because: "poisoned_present", ...ages };
}
