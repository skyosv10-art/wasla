/**
 * مقياسُ الرسائلِ المسمومةِ وحُكمُ تنبيهِها (المراجعةُ 21/N · ADR-026 §4.23).
 *
 * ## المشكلةُ التي يرفعُها هذا الملفُّ
 *
 * مُرحِّلا التوصيلِ — مُرحِّلُ `dispatch` ومُرحِّلُ مخزونِ السوقِ — كلاهما يملكُ
 * مخرجاً نهائيّاً واحداً للحدثِ الذي عجزَ عنهُ: يُكتَبُ `consumed_status =
 * 'poisoned'` في دفترِ الاستهلاكِ، **وتتقدَّمُ نقطةُ التقدُّمِ فوقَهُ**. وهذا
 * صحيحٌ ومقصودٌ: حدثٌ واحدٌ فاسدٌ لا يجوزُ أن يُوقِفَ الطابورَ كلَّهُ
 * (`marketplace-inventory-relay.ts`). لكنَّهُ يعني أنَّ **الفقدَ صامتٌ**: الصفُّ
 * موجودٌ في القاعدةِ، والمُرحِّلُ يمضي، ولا عينَ تسألُ الجدولَ أبداً.
 *
 * وبعدَ إقفالِ `RISK-0035` صارَ هذا الفقدُ **مُحصَّناً باختبارٍ** — نعلمُ يقيناً
 * أنَّ المسمومَ يُكتَبُ ولا يُعادُ — **ومكشوفاً في إنتاجٍ بلا عينٍ**. فالاختبارُ
 * يُثبِتُ أنَّ الآلةَ تفعلُ ما قُرِّرَ، ولا يُثبِتُ أنَّ أحداً سيعلمُ حينَ تفعلُهُ.
 *
 * ## ولمَ **جدولٌ** لا عدّادٌ في العمليّةِ؟
 *
 * سابقةٌ مُلزِمةٌ في هذهِ الخدمةِ: الدفترُ هوَ مصدرُ الحقيقةِ لا ذاكرةُ نُسخةٍ.
 * وعدّادٌ في العمليّةِ يُصفَّرُ بإعادةِ نشرٍ، ويتضاعفُ بعددِ النُّسَخِ، ويكذبُ
 * بعدَ انهيارٍ — فيقرأُ المُشغِّلُ صفراً ويظنُّهُ نظافةً وفي القاعدةِ أربعونَ
 * صفّاً مسموماً. والصفرُ الكاذبُ هوَ نفسُ العيبِ الذي مَنعَ §4.15 و§4.18
 * من الإجابةِ بقائمةٍ فارغةٍ حينَ لا منفذَ.
 *
 * ## ولمَ يُحسَبُ **الحكمُ** هنا لا في المراقبِ؟
 *
 * لأنَّ عتبةً مكتوبةً في لوحةِ مراقبةٍ ثانيةٍ تصيرُ **مصدرَ حقيقةٍ مُكرَّراً**:
 * تُعدَّلُ في موضعٍ ويبقى الموضعُ الآخرُ، فلا يُدرى أيُّهما نافذٌ، ولا اختبارَ
 * يحرسُها. فالعتبةُ ثابتةٌ هنا، والحكمُ دالّةٌ نقيّةٌ مُختبَرةٌ، والمراقبُ
 * الخارجيُّ **يُنبِّهُ على `severity` ولا يُعيدُ حسابَهُ**. وهذا هوَ المسارُ
 * الذي يُحقِّقُ «أقلَّ مصادرِ حقيقةٍ مُكرَّرةٍ» و«أقوى إنفاذٍ آليٍّ» معاً.
 *
 * ## وحدٌّ صريحٌ: **مُعلِمٌ لا حاكمٌ**
 *
 * هذا المقياسُ **لا يمسُّ `GET /delivery/ready` أبداً** — على سابقةِ §4.17
 * حرفاً (`gates_readiness: false`). صفٌّ مسمومٌ واحدٌ خبرٌ يستحقُّ إنساناً، وليسَ
 * سبباً لإخراجِ نُسَخِ التوصيلِ كلِّها من الدورةِ: الخدمةُ تخدمُ الطلباتِ
 * الحاضرةَ بلا نقصٍ، والمسمومُ حدثٌ ماضٍ فُقِدَ. وربطُهُما كانَ سيجعلَ حدثاً
 * فاسداً واحداً **انقطاعَ خدمةٍ**.
 */

/* ════════════════════════════════════════════════════════════════════════
 * 1) الدفتران — قائمةٌ مُصرَّحةٌ لا استكشافٌ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * أسماءُ الدفاترِ في **لغةِ المُشغِّلِ** لا أسماءُ الجداولِ.
 *
 * والفصلُ بينَهُما مقصودٌ: `delivery_relay_consumed_events` اسمُ تنفيذٍ قد
 * يُهاجَرُ، و`dispatch` هوَ ما يقرأُهُ المُشغِّلُ في تنبيهٍ عندَ الثالثةِ صباحاً.
 * والربطُ بينَهُما في المُحوِّلِ وحدَهُ (`infrastructure/relay-dead-letter-store.ts`)
 * وعليهِ حارسُ انحرافٍ يُطابِقُ هذهِ القائمةَ بالمخطَّطِ.
 */
export const RELAY_DEAD_LETTER_LEDGERS = ["dispatch", "marketplace_inventory"] as const;

export type RelayDeadLetterLedger = (typeof RELAY_DEAD_LETTER_LEDGERS)[number];

/**
 * الحالةُ النهائيّةُ المقيسةُ — **واحدةٌ لا اثنتانِ**.
 *
 * `skipped_stale` و`ignored` و`ignored_foreign` ليست فقداً: الأولى تخطٍّ
 * بقِدَمٍ صحيحٍ، والأخريانِ حدثٌ ليسَ لنا. و`pending` ليست نهائيّةً أصلاً —
 * وعدُّها مسموماً كانَ سيُنبِّهُ على كلِّ دفعةٍ جاريةٍ فيصيرُ التنبيهُ ضجيجاً
 * يُصمَّتُ، وهذا أسوأُ من غيابِهِ.
 */
export const RELAY_POISONED_STATUS = "poisoned" as const;

/* ════════════════════════════════════════════════════════════════════════
 * 2) شكلُ المقياسِ
 * ════════════════════════════════════════════════════════════════════════ */

/** تفصيلُ نوعِ الحدثِ داخلَ دفترٍ واحدٍ — أعلى أوّلاً ثمَّ بالاسمِ. */
export interface RelayDeadLetterEventTypeCount {
  readonly eventType: string;
  readonly poisoned: number;
}

export interface RelayDeadLetterLedgerMetric {
  readonly ledger: RelayDeadLetterLedger;
  readonly poisoned: number;
  /** ISO-8601، أو `null` حينَ لا مسمومَ في هذا الدفترِ. */
  readonly oldestPoisonedAt: string | null;
  readonly newestPoisonedAt: string | null;
  readonly byEventType: readonly RelayDeadLetterEventTypeCount[];
}

/**
 * المقياسُ كاملاً.
 *
 * و**كلُّ دفترٍ يُذكَرُ دائماً وإن كانَ صفراً**: دفترٌ يغيبُ عن الجوابِ حينَ
 * يخلو لا يُفرَّقُ عن دفترٍ نُسِيَ من الاستعلامِ، فيُقرأُ الغيابُ نظافةً. والصفرُ
 * المقيسُ **يُذكَرُ صريحاً** لأنَّهُ جوابٌ، أمّا «لا أدري» فمخرجُهُ خطأٌ لا صفرٌ
 * (سابقةُ §4.15 · §4.18).
 */
export interface RelayDeadLetterMetric {
  readonly measuredAt: string;
  readonly totalPoisoned: number;
  readonly ledgers: readonly RelayDeadLetterLedgerMetric[];
}

/* ════════════════════════════════════════════════════════════════════════
 * 3) العتبةُ — موضعٌ واحدٌ في المنظومةِ كلِّها
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * **`warningPoisoned = 1`، ولا مساومةَ.**
 *
 * عتبةٌ أعلى (خمسةٌ مثلاً) تعني أنَّ أربعةَ أحداثٍ تُفقَدُ **بقرارٍ مكتوبٍ** بلا
 * أن يعلمَ أحدٌ. وليسَ لدينا ما يُبرِّرُ ذلكَ: المسمومُ ليسَ تقلُّباً طبيعيّاً في
 * حِملٍ بل حدثٌ استنفدَ خمسَ محاولاتٍ (`maxAttempts: 5`) ثمَّ تُخُطِّيَ نهائيّاً.
 * فواحدٌ خبرٌ.
 *
 * **و`criticalPoisoned = 10`** تفرِّقُ بينَ حادثةٍ مفردةٍ (بيانٌ فاسدٌ واحدٌ)
 * وبينَ **عيبٍ منهجيٍّ** (تغييرُ مخطَّطٍ أعلى المَجرى يُسمِّمُ كلَّ حدثٍ): العلاجُ
 * مختلفٌ، فدرجةُ التنبيهِ مختلفةٌ.
 *
 * **و`criticalAgeSeconds = 86_400`** تُدرِكُ ما يفوتُ العددَ وحدَهُ: صفٌّ مسمومٌ
 * واحدٌ عمرُهُ يومٌ يعني أنَّ تنبيهَ التحذيرِ **أُهمِلَ**، والإهمالُ حالةٌ تُصعَّدُ
 * لا تُنتظَرُ. فعتبةُ العمرِ تُصعِّدُ بغيرِ أن يزيدَ العددُ صفّاً واحداً.
 */
export const RELAY_DEAD_LETTER_THRESHOLDS = {
  warningPoisoned: 1,
  criticalPoisoned: 10,
  criticalAgeSeconds: 86_400,
} as const;

export type RelayDeadLetterSeverity = "ok" | "warning" | "critical";

/**
 * حكمٌ مُسبَّبٌ لا درجةٌ عارية.
 *
 * و`because` رمزٌ ثابتٌ لا نصٌّ حرٌّ: مَن يقرأُ تنبيهاً يحتاجُ أن يعرفَ **أيُّ
 * عتبةٍ** أطلقتْهُ قبلَ أن يفتحَ لوحةً، ولوحةٌ تُصنِّفُ الحوادثَ تحتاجُ قيمةً
 * تُجمَّعُ. ونصٌّ عربيٌّ حرٌّ كانَ سيُترجَمُ في كلِّ مراقبٍ ويتغيَّرُ بكلِّ تحريرٍ.
 */
export type RelayDeadLetterVerdictReason =
  | "no_poisoned_rows"
  | "poisoned_present"
  | "poisoned_count_at_or_above_critical"
  | "oldest_poisoned_at_or_above_critical_age";

export interface RelayDeadLetterVerdict {
  readonly severity: RelayDeadLetterSeverity;
  readonly because: RelayDeadLetterVerdictReason;
  /** عمرُ أقدمِ صفٍّ مسمومٍ بالثواني، أو `null` حينَ لا مسمومَ في الدفاترِ كلِّها. */
  readonly oldestPoisonedAgeSeconds: number | null;
}

/* ════════════════════════════════════════════════════════════════════════
 * 4) الحسابُ — دالّتانِ نقيّتانِ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * عمرُ أقدمِ صفٍّ مسمومٍ عبرَ الدفاترِ كلِّها.
 *
 * **ويُقصُّ عندَ الصفرِ ولا يُعادُ سالباً.** والسببُ واقعيٌّ لا تجميليٌّ: ساعةُ
 * القاعدةِ وساعةُ العمليّةِ قد تختلفانِ بأجزاءٍ من الثانيةِ، وعمرٌ سالبٌ كانَ
 * سيُقارَنُ بعتبةٍ ويُقرأُ في لوحةٍ — وطرحُ ثانيةٍ من ساعةٍ منحرفةٍ ليسَ خبراً
 * عن المسمومِ. وطابعٌ لا يُفهَمُ زمناً يُعادُ `null` لا صفراً: الصفرُ يُقرأُ
 * «الآنَ» وهوَ ادّعاءٌ لم يُقَسْ.
 */
export function oldestPoisonedAgeSeconds(
  metric: Pick<RelayDeadLetterMetric, "ledgers">,
  at: Date,
): number | null {
  let oldestMs: number | null = null;
  for (const ledger of metric.ledgers) {
    if (ledger.oldestPoisonedAt === null) continue;
    const parsed = Date.parse(ledger.oldestPoisonedAt);
    if (!Number.isFinite(parsed)) continue;
    if (oldestMs === null || parsed < oldestMs) oldestMs = parsed;
  }
  if (oldestMs === null) return null;
  return Math.max(0, Math.floor((at.getTime() - oldestMs) / 1000));
}

/**
 * الحكمُ. **الأشدُّ يفوزُ، وسببُ العددِ يُقدَّمُ على سببِ العمرِ** حينَ يتحقَّقانِ:
 * تجاوُزُ العددِ يدلُّ على عيبٍ منهجيٍّ جارٍ، وتجاوُزُ العمرِ يدلُّ على إهمالِ
 * تنبيهٍ — وأوّلُهما أعجلُ في العلاجِ. والترتيبُ مُثبَتٌ باختبارٍ لا مُستنتَجٌ
 * من ترتيبِ الأسطرِ.
 *
 * **والعتبةُ تُقرأُ من الثابتِ ولا تُمرَّرُ مُعامِلاً**: عتبةٌ قابلةٌ للحَقنِ من
 * نداءٍ تعني مسارَ تشغيلٍ يستطيعُ تخفيفَ حكمِهِ على نفسِهِ.
 */
export function classifyRelayDeadLetterSeverity(
  metric: Pick<RelayDeadLetterMetric, "ledgers" | "totalPoisoned">,
  at: Date,
): RelayDeadLetterVerdict {
  const ageSeconds = oldestPoisonedAgeSeconds(metric, at);

  if (metric.totalPoisoned < RELAY_DEAD_LETTER_THRESHOLDS.warningPoisoned) {
    return { severity: "ok", because: "no_poisoned_rows", oldestPoisonedAgeSeconds: ageSeconds };
  }

  if (metric.totalPoisoned >= RELAY_DEAD_LETTER_THRESHOLDS.criticalPoisoned) {
    return {
      severity: "critical",
      because: "poisoned_count_at_or_above_critical",
      oldestPoisonedAgeSeconds: ageSeconds,
    };
  }

  if (ageSeconds !== null && ageSeconds >= RELAY_DEAD_LETTER_THRESHOLDS.criticalAgeSeconds) {
    return {
      severity: "critical",
      because: "oldest_poisoned_at_or_above_critical_age",
      oldestPoisonedAgeSeconds: ageSeconds,
    };
  }

  return {
    severity: "warning",
    because: "poisoned_present",
    oldestPoisonedAgeSeconds: ageSeconds,
  };
}
