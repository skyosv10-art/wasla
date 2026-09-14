/**
 * قرارُ إعادةِ صفٍّ مسمومٍ — الدالّةُ النقيّةُ وحدَها (المراجعةُ 22/N · `M5-13R`).
 *
 * هذا الملفُّ **لا يلمسُ قاعدةً**: يُثبِتُ أنَّ التفريقَ بينَ «لا صفَّ» و«صفٌّ
 * ليسَ مسموماً» قرارٌ صريحٌ — وهوَ التفريقُ الذي لا يستطيعُهُ عددُ الصفوفِ
 * المُعدَّلةِ في `UPDATE … WHERE consumed_status = 'poisoned'`. والإثباتُ
 * التكامُليُّ (الذرّيّةُ والإرجاعُ وبقاءُ الدليلِ) في
 * `relay-requeue.integration.test.ts` على PostgreSQL حقيقيّةٍ.
 */

import { describe, expect, it } from "vitest";
import {
  RELAY_REQUEUE_TARGET_STATUS,
  decideRelayRequeue,
} from "../domain/relay-reprocess.js";

describe("decideRelayRequeue — القرارُ من الحالةِ المقروءةِ وحدَها", () => {
  it("يُعيدُ المسمومَ، ويُصرِّحُ بالحالةِ السابقةِ", () => {
    const decision = decideRelayRequeue("poisoned");
    expect(decision).toEqual({ outcome: "requeued", previousStatus: "poisoned" });
  });

  it("«لا صفَّ» رفضٌ بسببٍ خاصٍّ — لا نجاحٌ صامتٌ", () => {
    // النجاحُ الصامتُ هوَ العطبُ المقصودُ هنا: مُشغِّلٌ أخطأَ نسخَ مُعرِّفٍ
    // ويقرأُ 202 يظنُّ أنَّهُ أعادَ صفّاً، والفقدُ الحقيقيُّ باقٍ في الدفترِ.
    expect(decideRelayRequeue(null)).toEqual({
      outcome: "rejected",
      reason: "not_found",
      observedStatus: null,
    });
  });

  /*
   * كلُّ حالةٍ غيرِ مسمومةٍ تُرفَضُ — و**الحالةُ المقروءةُ تُنشَرُ** في الرفضِ.
   *
   * ونشرُها هوَ الفائدةُ: «مرفوضٌ» وحدَهُ يجعلُ مُشغِّلاً في حادثةٍ يفتحُ psql
   * ليعرِفَ أسبقَهُ زميلُهُ (`pending`) أم أنَّ الحدثَ طُبِّقَ أصلاً (`applied`).
   */
  it.each([
    ["pending"],
    ["applied"],
    ["skipped_stale"],
    ["ignored"],
    ["ignored_foreign"],
  ])("يرفضُ الحالةَ «%s» ويُصرِّحُ بها", (status) => {
    expect(decideRelayRequeue(status)).toEqual({
      outcome: "rejected",
      reason: "not_poisoned",
      observedStatus: status,
    });
  });

  it("حالةٌ غيرُ معروفةٍ تُرفَضُ ولا تُعامَلُ مُعامَلةَ المسمومِ", () => {
    // انفتاحُ الشرطِ على «كلِّ ما ليسَ مسموماً» مقصودٌ: قيدُ `CHECK` قد يُوسَّعُ
    // بهجرةٍ، والافتراضُ الآمِنُ أن تُرفَضَ الحالةُ الجديدةُ حتّى يُنظَرَ فيها،
    // لا أن تُعادَ لأنَّها «ليست في قائمةِ المرفوضِ».
    expect(decideRelayRequeue("quarantined_v2")).toEqual({
      outcome: "rejected",
      reason: "not_poisoned",
      observedStatus: "quarantined_v2",
    });
  });

  it("الحالةُ الهدفُ غيرُ نهائيّةٍ — وإلّا لما قُرِئَ الصفُّ ثانيةً أبداً", () => {
    // الدعوى ليست «القيمةُ pending» بل **لِمَ** هيَ كذلكَ: لو كانت الحالةُ
    // الهدفُ نهائيّةً لعادَ `relay.ts` يُقصِّرُ الدورةَ عليها، فتكونُ الإعادةُ
    // كتابةً بلا أثرٍ — وهوَ العطبُ الصامتُ الذي بُنِيَ هذا المسارُ لمنعِهِ.
    expect(RELAY_REQUEUE_TARGET_STATUS).toBe("pending");
  });
});
