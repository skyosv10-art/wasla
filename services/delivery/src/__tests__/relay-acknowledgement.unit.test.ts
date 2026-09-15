/**
 * إقرارُ المسمومِ — النطاقُ النقيُّ (المراجعةُ 24/N · ADR-026 §4.27).
 *
 * الدعاوى هنا هيَ **العقدُ الذي يمنعُ الإقرارَ من أن يصيرَ زرَّ إسكاتٍ**:
 *
 *   1. **الحدُّ الأدنى للسببِ اثنا عشرَ بالرقمِ** لا `toBeGreaterThan`: تخفيفُهُ
 *      يوماً يجبُ أن يُسقِطَ اختباراً باسمِهِ لا أن يمرَّ صامتاً.
 *   2. **التقليمُ قبلَ القياسِ**: اثنا عشرَ فراغاً ليسَ سبباً.
 *   3. **الطويلُ يُرفَضُ ولا يُقتَطَعُ**: سببٌ مقتطعٌ يُقرأُ جملةً تامّةً وهوَ
 *      نصفُ جملةٍ.
 *   4. **الأجوبةُ الثلاثةُ مُفرَّقةٌ**: `acknowledged` · `already_acknowledged`
 *      (بإقرارِ الأوّلِ كما هوَ) · `rejected` بسببَينِ مُفرَّقَينِ والحالةُ
 *      المقروءةُ منشورةٌ.
 *   5. **الإقرارُ الثاني لا يكتبُ فوقَ الأوّلِ** — سابقةُ §4.20 حرفاً.
 *   6. **ثلاثيٌّ ناقصٌ لا يُقرأُ إقراراً**: القاعدةُ تمنعُهُ بقيدٍ، والنطاقُ لا
 *      يُصدِّقُ نصفَ محضرٍ لو مرَّ من طريقٍ آخرَ.
 */

import { describe, expect, it } from "vitest";

import {
  RELAY_ACKNOWLEDGEMENT_REASON_MAX_LENGTH,
  RELAY_ACKNOWLEDGEMENT_REASON_MIN_LENGTH,
  decideRelayAcknowledgement,
  normalizeRelayAcknowledgementReason,
} from "../domain/relay-acknowledgement.js";
import { RELAY_POISONED_STATUS } from "../domain/relay-dead-letters.js";

const AT = "2026-09-15T10:00:00.000Z";
const BY = "service:ops-console/on-behalf-of:usr_01HQ";
const REASON = "منتِجٌ أُصلِحَ والحدثُ لا يُعادُ — قُيِّدَ في RISK-0021";

describe("حدودُ السببِ — أرقامٌ مُثبَتةٌ لا نطاقاتٌ", () => {
  it("الأدنى **اثنا عشرَ** والأقصى **خمسُ مئةٍ واثنا عشرَ**", () => {
    // نفسُ الرقمَينِ مكتوبانِ في قيدَي CHECK في الدفترَينِ؛ وانحرافُ أحدِهما
    // عن الآخرِ يُسقِطُ اختبارَ التكامُلِ على قاعدةٍ حقيقيّةٍ.
    expect(RELAY_ACKNOWLEDGEMENT_REASON_MIN_LENGTH).toBe(12);
    expect(RELAY_ACKNOWLEDGEMENT_REASON_MAX_LENGTH).toBe(512);
  });
});

describe("السببُ — تحقُّقٌ مُسبَّبٌ", () => {
  it("الغائبُ `missing` والفارغُ `null` كذلكَ — لا تُساوى بالنصِّ الفارغِ", () => {
    expect(normalizeRelayAcknowledgementReason(undefined)).toEqual({
      reason: "rejected",
      because: "missing",
    });
    expect(normalizeRelayAcknowledgementReason(null)).toEqual({
      reason: "rejected",
      because: "missing",
    });
  });

  it("غيرُ النصِّ `not_a_string` — رقمٌ أو كائنٌ لا يُقسَرُ على نصٍّ", () => {
    // القسرُ كانَ سيجعلُ `{}` سبباً مقبولاً باسمِ `[object Object]` — وطولُهُ
    // خمسةَ عشرَ حرفاً، أي أنَّهُ كانَ **يعبُرُ الحدَّ الأدنى**.
    expect(normalizeRelayAcknowledgementReason(42)).toEqual({
      reason: "rejected",
      because: "not_a_string",
    });
    expect(normalizeRelayAcknowledgementReason({})).toEqual({
      reason: "rejected",
      because: "not_a_string",
    });
    expect(normalizeRelayAcknowledgementReason(["a"])).toEqual({
      reason: "rejected",
      because: "not_a_string",
    });
  });

  it("**يُقلَّمُ ثمَّ يُقاسُ**: اثنا عشرَ فراغاً `too_short` لا مقبولٌ", () => {
    expect(normalizeRelayAcknowledgementReason("            ")).toEqual({
      reason: "rejected",
      because: "too_short",
    });
  });

  it("أحدَ عشرَ حرفاً يُرفَضُ واثنا عشرَ يُقبَلُ — الحدُّ مقيسٌ على الحرفِ", () => {
    expect(normalizeRelayAcknowledgementReason("x".repeat(11))).toEqual({
      reason: "rejected",
      because: "too_short",
    });
    expect(normalizeRelayAcknowledgementReason("x".repeat(12))).toEqual({
      reason: "accepted",
      value: "x".repeat(12),
    });
  });

  it("والمقبولُ يُعادُ **مُقلَّماً**: الفراغُ المحيطُ لا يُكتَبُ في الدفترِ", () => {
    expect(normalizeRelayAcknowledgementReason(`  ${REASON}  `)).toEqual({
      reason: "accepted",
      value: REASON,
    });
  });

  it("512 يُقبَلُ و513 **يُرفَضُ ولا يُقتَطَعُ**", () => {
    expect(normalizeRelayAcknowledgementReason("y".repeat(512))).toEqual({
      reason: "accepted",
      value: "y".repeat(512),
    });
    const tooLong = normalizeRelayAcknowledgementReason("y".repeat(513));
    expect(tooLong).toEqual({ reason: "rejected", because: "too_long" });
    // ولا قيمةَ في جوابِ الرفضِ أصلاً: لا مكانَ يُكتَبُ فيهِ نصفُ جملةٍ.
    expect(tooLong).not.toHaveProperty("value");
  });
});

describe("القرارُ — ثلاثةُ أجوبةٍ لا جوابانِ", () => {
  it("لا صفَّ ⇒ `not_found` والحالةُ المقروءةُ `null` **منشورةٌ**", () => {
    expect(
      decideRelayAcknowledgement({
        status: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementReason: null,
      }),
    ).toEqual({ outcome: "rejected", reason: "not_found", observedStatus: null });
  });

  it("صفٌّ بحالةٍ أخرى ⇒ `not_poisoned` **والحالةُ بعينِها** لا «غيرُ مسمومٍ»", () => {
    // مُشغِّلٌ في حادثةٍ يحتاجُ أن يعرِفَ أنَّ زميلَهُ أعادَ الصفَّ قبلَ ثانيةٍ
    // (`pending`) لا أن يُطارِدَ مُعرِّفاً يظنُّهُ منسوخاً خطأً.
    for (const status of ["pending", "applied", "skipped_stale"]) {
      expect(
        decideRelayAcknowledgement({
          status,
          acknowledgedAt: null,
          acknowledgedBy: null,
          acknowledgementReason: null,
        }),
      ).toEqual({ outcome: "rejected", reason: "not_poisoned", observedStatus: status });
    }
  });

  it("مسمومٌ بلا إقرارٍ ⇒ `acknowledged`", () => {
    expect(
      decideRelayAcknowledgement({
        status: RELAY_POISONED_STATUS,
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementReason: null,
      }),
    ).toEqual({ outcome: "acknowledged" });
  });

  it("مسمومٌ مُقَرٌّ بهِ ⇒ `already_acknowledged` **بإقرارِ الأوّلِ حرفاً**", () => {
    const decision = decideRelayAcknowledgement({
      status: RELAY_POISONED_STATUS,
      acknowledgedAt: AT,
      acknowledgedBy: BY,
      acknowledgementReason: REASON,
    });

    expect(decision).toEqual({
      outcome: "already_acknowledged",
      acknowledgedAt: AT,
      acknowledgedBy: BY,
      acknowledgementReason: REASON,
    });
  });

  it("**ثلاثيٌّ ناقصٌ لا يُقرأُ إقراراً** — النطاقُ لا يُصدِّقُ نصفَ محضرٍ", () => {
    // القاعدةُ تمنعُ هذا بقيدِ «كلٌّ أو لا شيءَ»؛ والنطاقُ لا يُبنى على أنَّ
    // القيدَ لن يُسقَطَ يوماً بهجرةٍ خاطئةٍ. والجوابُ حينَها **إقرارٌ جديدٌ
    // يُكمِلُ الثلاثيَّ** لا `already_acknowledged` بحقولٍ `null`.
    const halves = [
      { acknowledgedAt: AT, acknowledgedBy: null, acknowledgementReason: null },
      { acknowledgedAt: null, acknowledgedBy: BY, acknowledgementReason: null },
      { acknowledgedAt: AT, acknowledgedBy: BY, acknowledgementReason: null },
      { acknowledgedAt: null, acknowledgedBy: null, acknowledgementReason: REASON },
    ];
    for (const half of halves) {
      expect(
        decideRelayAcknowledgement({ status: RELAY_POISONED_STATUS, ...half }),
      ).toEqual({ outcome: "acknowledged" });
    }
  });

  it("والحالةُ تُقارَنُ بـ`RELAY_POISONED_STATUS` لا بنصٍّ مكتوبٍ هنا", () => {
    // دعوى على **وحدةِ المصدرِ**: لو تغيَّرَ الثابتُ يوماً سقطَ هذا الاختبارُ
    // إن بقيَ النطاقُ يقارِنُ نصّاً قديماً.
    expect(RELAY_POISONED_STATUS).toBe("poisoned");
    expect(
      decideRelayAcknowledgement({
        status: RELAY_POISONED_STATUS,
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementReason: null,
      }).outcome,
    ).toBe("acknowledged");
  });
});
