/**
 * `composeConflictAcknowledger` — تركيبُ اسمِ المُقِرِّ (المراجعةُ 18/N · §4.20).
 *
 * هذهِ دالّةٌ صغيرةٌ، لكنَّ ما تكتبُهُ يُقرأُ في **تحقيقٍ**: عمودُ
 * `acknowledged_by` هوَ الجوابُ على «مَن رأى هذهِ الحادثةَ وأغلقَها؟». فالدعاوى
 * المُختبَرةُ هنا ليست عن تسلسُلِ نصٍّ بل عن أربعةِ أخطاءٍ تُفسِدُ ذلكَ الجوابَ:
 *
 *   1. **الخدمةُ وحدَها ⇒ `service:<name>`** — وسابقةُ `service:` تُفرِّقُ بينَ
 *      إقرارٍ آليٍّ وإقرارٍ كُتِبَ على القاعدةِ باسمِ إنسانٍ.
 *   2. **الإنسانُ يُحمَلُ إن وُجِدَ** — رمزٌ فيهِ `obo` ثمَّ صفٌّ يقولُ «الخدمةُ
 *      أقرَّتْ» يُخفي الفاعلَ الحقيقيَّ، وهوَ عينُ ما يُسألُ عنهُ.
 *   3. **الطولُ يُرفَضُ ولا يُقتَطَعُ** — هويّةٌ مقتطعةٌ تُقرأُ هويّةً كاملةً
 *      خاطئةً، وهيَ أسوأُ من رفضٍ مُعلَنٍ.
 *   4. **الفراغُ يُرفَضُ** — والقاعدةُ تمنعُهُ بـ`ck_..._ack` أيضاً، فالمنعُ في
 *      موضعَينِ بقصدٍ.
 */

import { describe, expect, it } from "vitest";

import {
  CONFLICT_ACKNOWLEDGER_MAX_LENGTH,
  composeConflictAcknowledger,
} from "../domain/inventory-conflict.js";

describe("composeConflictAcknowledger — الصيغةُ", () => {
  it("خدمةٌ بلا فاعلٍ بشريٍّ ⇒ `service:<name>`", () => {
    expect(composeConflictAcknowledger({ serviceName: "core" })).toEqual({
      acknowledger: "composed",
      value: "service:core",
    });
  });

  it("خدمةٌ بفاعلٍ بشريٍّ ⇒ الاسمانِ معاً، والإنسانُ لا يُطمَسُ", () => {
    const result = composeConflictAcknowledger({
      serviceName: "ops-console",
      onBehalfOfPublicId: "US-0000000042",
    });
    expect(result).toEqual({
      acknowledger: "composed",
      value: "service:ops-console/on-behalf-of:US-0000000042",
    });
  });

  it("`onBehalfOfPublicId` غائبٌ أو فراغٌ ⇒ لا لاحقةَ معلَّقةً في النصِّ", () => {
    // الدعوى: `service:core/on-behalf-of:` لا يجوزُ أن يُكتَبَ أبداً — نصٌّ
    // يُوهِمُ بوجودِ إنسانٍ ثمَّ لا يُسمِّيهِ أسوأُ من نصٍّ لا يذكرُهُ.
    for (const onBehalfOfPublicId of [undefined, "", "   "]) {
      expect(composeConflictAcknowledger({ serviceName: "core", onBehalfOfPublicId })).toEqual({
        acknowledger: "composed",
        value: "service:core",
      });
    }
  });

  it("الأطرافُ تُقلَّمُ من الاسمَينِ كلَيهما", () => {
    expect(
      composeConflictAcknowledger({
        serviceName: "  core  ",
        onBehalfOfPublicId: "  US-0000000042  ",
      }),
    ).toEqual({ acknowledger: "composed", value: "service:core/on-behalf-of:US-0000000042" });
  });
});

describe("composeConflictAcknowledger — الرفضُ", () => {
  it("اسمُ خدمةٍ فارغٌ أو فراغاتٌ ⇒ `empty_service_name` لا نصٌّ ناقصٌ", () => {
    for (const serviceName of ["", "   ", "\t\n"]) {
      expect(composeConflictAcknowledger({ serviceName })).toEqual({
        acknowledger: "rejected",
        because: "empty_service_name",
      });
    }
  });

  it("طولٌ فوقَ الحدِّ ⇒ `too_long`، **ولا اقتطاعَ**", () => {
    const longPublicId = "U".repeat(CONFLICT_ACKNOWLEDGER_MAX_LENGTH);
    const result = composeConflictAcknowledger({
      serviceName: "core",
      onBehalfOfPublicId: longPublicId,
    });
    expect(result).toEqual({ acknowledger: "rejected", because: "too_long" });
    // والدعوى الحقيقيّةُ: لا حقلَ `value` في الجوابِ المرفوضِ أصلاً، فلا يمكنُ
    // لمُنادٍ أن «يستعملَ المتاحَ» من هويّةٍ لم تُركَّبْ.
    expect(result).not.toHaveProperty("value");
  });

  it("الحدُّ ذاتُهُ مقبولٌ — الرفضُ فوقَهُ لا عندَهُ", () => {
    const prefix = "service:core/on-behalf-of:";
    const fill = "U".repeat(CONFLICT_ACKNOWLEDGER_MAX_LENGTH - prefix.length);
    const result = composeConflictAcknowledger({
      serviceName: "core",
      onBehalfOfPublicId: fill,
    });
    expect(result.acknowledger).toBe("composed");
    if (result.acknowledger !== "composed") throw new Error("unreachable");
    expect(result.value).toHaveLength(CONFLICT_ACKNOWLEDGER_MAX_LENGTH);
    // و128 ليسَ رقماً مُختاراً هنا: هوَ حدُّ `CHECK` على العمودِ في
    // `contracts/schema.sql`، فما يُركَّبُ يُكتَبُ ولا يرتدُّ خطأَ قاعدةٍ 500.
    expect(CONFLICT_ACKNOWLEDGER_MAX_LENGTH).toBe(128);
  });
});
