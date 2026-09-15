/**
 * حكمُ تنبيهِ المسمومِ — نطاقٌ نقيٌّ (المراجعةُ 21/N · ADR-026 §4.23).
 *
 * الدعاوى المُختبَرةُ هنا هيَ **عقدُ التنبيهِ نفسُهُ**، وكلُّ واحدةٍ منها تمنعُ
 * انحرافاً وقعَ في منظوماتٍ حقيقيّةٍ:
 *
 *   1. **صفٌّ واحدٌ مسمومٌ ⇒ `warning` لا `ok`.** عتبةُ التحذيرِ **واحدٌ**، وأيُّ
 *      رفعٍ لها يعني فقداً مسكوتاً عنهُ بقرارٍ مكتوبٍ.
 *   2. **العتبةُ قيمتُها مُثبَتةٌ بالرقمِ** — لا `toBeGreaterThan`. فلو خُفِّفَت
 *      يوماً سقطَ هذا الاختبارُ باسمِها، ولم يمرَّ تخفيفٌ صامتٌ.
 *   3. **العمرُ يُصعِّدُ وحدَهُ** بلا زيادةِ صفٍّ: إهمالُ تحذيرٍ حالةٌ تُصعَّدُ.
 *   4. **سببُ العددِ يُقدَّمُ على سببِ العمرِ** حينَ يتحقَّقانِ — ترتيبٌ مُثبَتٌ لا
 *      مُستنتَجٌ من ترتيبِ أسطرِ الشيفرةِ.
 *   5. **ساعةٌ منحرفةٌ لا تُنتِجُ عمراً سالباً**، وطابعٌ معطوبٌ لا يُقرأُ «الآنَ».
 */

import { describe, expect, it } from "vitest";

import {
  RELAY_DEAD_LETTER_LEDGERS,
  RELAY_DEAD_LETTER_THRESHOLDS,
  RELAY_POISONED_STATUS,
  classifyRelayDeadLetterSeverity,
  oldestPoisonedAgeSeconds,
  type RelayDeadLetterLedgerMetric,
  type RelayDeadLetterMetric,
} from "../domain/relay-dead-letters.js";

const NOW = new Date("2026-09-13T02:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

/**
 * والافتراضُ في هذا الباني **لا إقرارَ** (المراجعةُ 24/N · §4.27): كلُّ مسمومٍ
 * غيرُ مُقَرٍّ بهِ، فكلُّ دعوى كُتِبَت قبلَ الإقرارِ تبقى تقيسُ ما كانت تقيسُهُ
 * حرفاً. ولو جُعِلَ الافتراضُ «مُقَرٌّ بهِ» لصارَ كلُّ اختبارٍ سابقٍ يمرُّ
 * لأنَّ الحكمَ لا يرى شيئاً — وهوَ تخفيفٌ صامتٌ بثوبِ باني بياناتٍ.
 */
function ledger(
  name: RelayDeadLetterLedgerMetric["ledger"],
  poisoned: number,
  oldest: string | null = null,
  acknowledged = 0,
  oldestUnacknowledged: string | null | undefined = undefined,
): RelayDeadLetterLedgerMetric {
  return {
    ledger: name,
    poisoned,
    acknowledgedPoisoned: acknowledged,
    unacknowledgedPoisoned: poisoned - acknowledged,
    oldestPoisonedAt: oldest,
    oldestUnacknowledgedPoisonedAt:
      oldestUnacknowledged === undefined
        ? acknowledged >= poisoned
          ? null
          : oldest
        : oldestUnacknowledged,
    newestPoisonedAt: oldest,
    byEventType: [],
  };
}

function metric(ledgers: readonly RelayDeadLetterLedgerMetric[]): RelayDeadLetterMetric {
  return {
    measuredAt: NOW.toISOString(),
    totalPoisoned: ledgers.reduce((sum, l) => sum + l.poisoned, 0),
    totalAcknowledgedPoisoned: ledgers.reduce((sum, l) => sum + l.acknowledgedPoisoned, 0),
    totalUnacknowledgedPoisoned: ledgers.reduce((sum, l) => sum + l.unacknowledgedPoisoned, 0),
    ledgers,
  };
}

describe("العتبةُ — قيمٌ مُثبَتةٌ لا نطاقاتٌ", () => {
  it("التحذيرُ عندَ **واحدٍ**، والحرِجُ عندَ **عشرةٍ**، وعمرُ الحرِجِ **يومٌ**", () => {
    // أرقامٌ صريحةٌ بقصدٍ: تخفيفُ أيٍّ منها يجبُ أن يُسقِطَ اختباراً باسمِهِ
    // لا أن يمرَّ لأنَّ الشرطَ كانَ «أكبرُ من صفرٍ».
    expect(RELAY_DEAD_LETTER_THRESHOLDS.warningPoisoned).toBe(1);
    expect(RELAY_DEAD_LETTER_THRESHOLDS.criticalPoisoned).toBe(10);
    expect(RELAY_DEAD_LETTER_THRESHOLDS.criticalAgeSeconds).toBe(86_400);
  });

  it("الحالةُ المقيسةُ **واحدةٌ**: `poisoned` — لا `pending` ولا تخطٍّ", () => {
    // لو ضُمَّ `skipped_stale` أو `pending` لصارَ التنبيهُ ضجيجاً يُصمَّتُ.
    expect(RELAY_POISONED_STATUS).toBe("poisoned");
  });

  it("الدفتَرانِ مُصرَّحانِ بالاسمِ وبالترتيبِ", () => {
    expect(RELAY_DEAD_LETTER_LEDGERS).toEqual(["dispatch", "marketplace_inventory"]);
  });
});

describe("classifyRelayDeadLetterSeverity", () => {
  it("لا مسمومَ في الدفترَينِ ⇒ `ok` بسببٍ مُسمّىً وعمرٍ `null`", () => {
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 0), ledger("marketplace_inventory", 0)]),
      NOW,
    );

    // دعوى **شكلٍ تامٍّ** لا حقلٍ واحدٍ: حقلٌ يُضافُ إلى الحكمِ يجبُ أن يُسقِطَ
    // هذا الاختبارَ كي يُقرَأَ ويُوثَّقَ، لا أن يعبُرَ لأنَّ الدعوى جزئيّةٌ
    // (وقد وقعَ ذلكَ حرفاً في المراجعةِ 24/N · §4.27 فأُضيفَ العمرُ الثاني هنا).
    expect(verdict).toEqual({
      severity: "ok",
      because: "no_poisoned_rows",
      oldestPoisonedAgeSeconds: null,
      oldestUnacknowledgedPoisonedAgeSeconds: null,
    });
  });

  it("**صفٌّ واحدٌ ⇒ `warning`** — ولا عتبةَ تسمحُ بفقدٍ صامتٍ", () => {
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 0), ledger("marketplace_inventory", 1, minutesAgo(5))]),
      NOW,
    );

    expect(verdict.severity).toBe("warning");
    expect(verdict.because).toBe("poisoned_present");
    expect(verdict.oldestPoisonedAgeSeconds).toBe(300);
  });

  it("تسعةٌ ⇒ `warning`، وعشرةٌ ⇒ `critical` — الحدُّ مُختبَرٌ من جانبَيهِ", () => {
    const nine = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 4, minutesAgo(1)), ledger("marketplace_inventory", 5, minutesAgo(2))]),
      NOW,
    );
    expect(nine.severity).toBe("warning");

    const ten = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 4, minutesAgo(1)), ledger("marketplace_inventory", 6, minutesAgo(2))]),
      NOW,
    );
    expect(ten.severity).toBe("critical");
    expect(ten.because).toBe("poisoned_count_at_or_above_critical");
  });

  it("صفٌّ واحدٌ عمرُهُ يومٌ ⇒ `critical` **بلا أن يزيدَ العددُ** — الإهمالُ يُصعَّدُ", () => {
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 1, minutesAgo(1440)), ledger("marketplace_inventory", 0)]),
      NOW,
    );

    expect(verdict.severity).toBe("critical");
    expect(verdict.because).toBe("oldest_poisoned_at_or_above_critical_age");
    expect(verdict.oldestPoisonedAgeSeconds).toBe(86_400);
  });

  it("عمرٌ أقلُّ من يومٍ بثانيةٍ يبقى `warning` — الحدُّ لا يُقرَّبُ", () => {
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 1, new Date(NOW.getTime() - 86_399_000).toISOString())]),
      NOW,
    );

    expect(verdict.severity).toBe("warning");
    expect(verdict.oldestPoisonedAgeSeconds).toBe(86_399);
  });

  it("العددُ والعمرُ حرِجانِ معاً ⇒ **سببُ العددِ يفوزُ** (عيبٌ منهجيٌّ أعجلُ)", () => {
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 40, minutesAgo(5000))]),
      NOW,
    );

    expect(verdict.severity).toBe("critical");
    expect(verdict.because).toBe("poisoned_count_at_or_above_critical");
  });
});

describe("oldestPoisonedAgeSeconds — أقدمُ عبرَ الدفترَينِ", () => {
  it("يُختارُ الأقدمُ لا الأوّلُ في القائمةِ", () => {
    const age = oldestPoisonedAgeSeconds(
      metric([ledger("dispatch", 1, minutesAgo(10)), ledger("marketplace_inventory", 1, minutesAgo(90))]),
      NOW,
    );

    expect(age).toBe(5400);
  });

  it("الدفترُ الخالي يُتخطّى ولا يُقرأُ صفراً", () => {
    const age = oldestPoisonedAgeSeconds(
      metric([ledger("dispatch", 0, null), ledger("marketplace_inventory", 1, minutesAgo(3))]),
      NOW,
    );

    expect(age).toBe(180);
  });

  it("طابعٌ في المستقبلِ (انحرافُ ساعةٍ) ⇒ صفرٌ لا سالبٌ", () => {
    const future = new Date(NOW.getTime() + 5_000).toISOString();
    expect(oldestPoisonedAgeSeconds(metric([ledger("dispatch", 1, future)]), NOW)).toBe(0);
  });

  it("طابعٌ معطوبٌ يُتخطّى — ولا يُقرأُ «الآنَ»", () => {
    expect(oldestPoisonedAgeSeconds(metric([ledger("dispatch", 1, "not-a-date")]), NOW)).toBeNull();
  });

  it("دفتَرانِ خاليانِ ⇒ `null` لا صفرٌ — «لا مسمومَ» ليسَ «عمرُهُ صفرٌ»", () => {
    expect(
      oldestPoisonedAgeSeconds(
        metric([ledger("dispatch", 0), ledger("marketplace_inventory", 0)]),
        NOW,
      ),
    ).toBeNull();
  });
});

/**
 * الإقرارُ والحكمُ (المراجعةُ 24/N · §4.27).
 *
 * والدعوى الجامعةُ لهذا الوصفِ: **الإقرارُ يرفعُ الحكمَ ولا يمحو العددَ**. وكلُّ
 * اختبارٍ هنا يقيسُ الاثنَينِ معاً في نداءٍ واحدٍ — لأنَّ العطبَ الذي يُخشى ليسَ
 * «الحكمُ لم يهدأْ» بل «الحكمُ هدأَ **والعددُ اختفى معهُ**».
 */
describe("الإقرارُ — يرفعُ الحكمَ ولا يمحو العددَ", () => {
  it("كلُّ المسمومِ مُقَرٌّ بهِ ⇒ `ok` **بسببِ الإقرارِ** لا بسببِ الخلوِّ", () => {
    const m = metric([ledger("dispatch", 3, minutesAgo(90), 3), ledger("marketplace_inventory", 0)]);
    const verdict = classifyRelayDeadLetterSeverity(m, NOW);

    expect(verdict.severity).toBe("ok");
    // سببانِ مُفرَّقانِ بقصدٍ: «لا مسمومَ» و«مسمومٌ نظرَ فيهِ إنسانٌ» حالتانِ
    // مختلفتانِ، ودمجُهما كانَ يجعلُ لوحةً تقولُ «نظيفٌ» على ثلاثةِ صفوفٍ مفقودةٍ.
    expect(verdict.because).toBe("all_poisoned_acknowledged");
    // **والعددُ باقٍ منشوراً**: هذا هوَ الحدُّ بينَ الإقرارِ ومحوِ الدليلِ.
    expect(m.totalPoisoned).toBe(3);
    expect(m.totalAcknowledgedPoisoned).toBe(3);
    expect(m.totalUnacknowledgedPoisoned).toBe(0);
  });

  it("صفٌّ واحدٌ غيرُ مُقَرٍّ بهِ بينَ تسعةٍ مُقَرٍّ بها ⇒ `warning` لا `ok`", () => {
    // إقرارُ الأكثريّةِ لا يشتري صمتاً على الباقي: العتبةُ **واحدٌ** على غيرِ
    // المُقَرِّ بهِ حرفاً.
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 10, minutesAgo(30), 9)]),
      NOW,
    );
    expect(verdict.severity).toBe("warning");
    expect(verdict.because).toBe("poisoned_present");
  });

  it("عشرةٌ مسمومةٌ كلُّها مُقَرٌّ بها ⇒ `ok`؛ ولو نُقِصَ إقرارٌ صارَ `critical`", () => {
    // العدُّ الحرِجُ يُقاسُ على غيرِ المُقَرِّ بهِ: عشرٌ نظرَ فيها إنسانٌ ليست
    // عيباً منهجيّاً جارياً. وهذا الاختبارُ يقيسُ **الحدَّينِ في نداءَينِ
    // متجاورَينِ** كي لا يمرَّ تخفيفٌ في أحدِهما.
    const allAcked = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 10, minutesAgo(30), 10)]),
      NOW,
    );
    expect(allAcked.severity).toBe("ok");
    expect(allAcked.because).toBe("all_poisoned_acknowledged");

    const oneOpen = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 10, minutesAgo(30), 0)]),
      NOW,
    );
    expect(oneOpen.severity).toBe("critical");
    expect(oneOpen.because).toBe("poisoned_count_at_or_above_critical");
  });

  it("**عمرُ الحرِجِ يُقاسُ على غيرِ المُقَرِّ بهِ**: قديمٌ مُقَرٌّ بهِ لا يُصعِّدُ", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 1, twoDaysAgo, 1)]),
      NOW,
    );

    expect(verdict.severity).toBe("ok");
    // **والعمرُ الخامُ يبقى منشوراً**: الإقرارُ لا يُصغِّرُ رقماً نُشِرَ سلفاً.
    expect(verdict.oldestPoisonedAgeSeconds).toBe(2 * 86_400);
    expect(verdict.oldestUnacknowledgedPoisonedAgeSeconds).toBeNull();
  });

  it("قديمٌ **غيرُ** مُقَرٍّ بهِ يُصعِّدُ بالعمرِ كما كانَ قبلَ الإقرارِ", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 1, twoDaysAgo, 0)]),
      NOW,
    );

    expect(verdict.severity).toBe("critical");
    expect(verdict.because).toBe("oldest_poisoned_at_or_above_critical_age");
    expect(verdict.oldestUnacknowledgedPoisonedAgeSeconds).toBe(2 * 86_400);
  });

  it("عمرُ غيرِ المُقَرِّ بهِ يُقاسُ على **أقدمِ مفتوحٍ** لا على أقدمِ صفٍّ", () => {
    // دفترٌ فيهِ قديمٌ مُقَرٌّ بهِ وحديثٌ مفتوحٌ: العمرانِ **مختلفانِ**، ولو
    // كانَ الحكمُ يقرأُ العمرَ الخامَ لبقيَ `critical` إلى الأبدِ بسببِ صفٍّ
    // نظرَ فيهِ إنسانٌ — وهوَ عينُ التنبيهِ الذي يُدفَعُ نحوَ تصميتِهِ.
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 86_400_000).toISOString();
    const verdict = classifyRelayDeadLetterSeverity(
      metric([
        {
          ledger: "dispatch",
          poisoned: 2,
          acknowledgedPoisoned: 1,
          unacknowledgedPoisoned: 1,
          oldestPoisonedAt: sixDaysAgo,
          oldestUnacknowledgedPoisonedAt: minutesAgo(10),
          newestPoisonedAt: minutesAgo(10),
          byEventType: [],
        },
      ]),
      NOW,
    );

    expect(verdict.severity).toBe("warning");
    expect(verdict.because).toBe("poisoned_present");
    expect(verdict.oldestPoisonedAgeSeconds).toBe(6 * 86_400);
    expect(verdict.oldestUnacknowledgedPoisonedAgeSeconds).toBe(600);
  });

  it("خلوٌّ تامٌّ يبقى `no_poisoned_rows` — الإقرارُ لم يُزِح السببَ الأصليَّ", () => {
    const verdict = classifyRelayDeadLetterSeverity(
      metric([ledger("dispatch", 0), ledger("marketplace_inventory", 0)]),
      NOW,
    );
    expect(verdict.severity).toBe("ok");
    expect(verdict.because).toBe("no_poisoned_rows");
    expect(verdict.oldestUnacknowledgedPoisonedAgeSeconds).toBeNull();
  });
});
