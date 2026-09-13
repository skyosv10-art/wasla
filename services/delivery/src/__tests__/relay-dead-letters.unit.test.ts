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

function ledger(
  name: RelayDeadLetterLedgerMetric["ledger"],
  poisoned: number,
  oldest: string | null = null,
): RelayDeadLetterLedgerMetric {
  return {
    ledger: name,
    poisoned,
    oldestPoisonedAt: oldest,
    newestPoisonedAt: oldest,
    byEventType: [],
  };
}

function metric(ledgers: readonly RelayDeadLetterLedgerMetric[]): RelayDeadLetterMetric {
  return {
    measuredAt: NOW.toISOString(),
    totalPoisoned: ledgers.reduce((sum, l) => sum + l.poisoned, 0),
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

    expect(verdict).toEqual({
      severity: "ok",
      because: "no_poisoned_rows",
      oldestPoisonedAgeSeconds: null,
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
