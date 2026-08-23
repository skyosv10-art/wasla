/**
 * قراءةُ حدثٍ خامٍّ وترجمتُه إلى مسوّداتِ وقائع — بلا مخزنٍ وبلا مُشغّل.
 *
 * الدالّتان المفحوصتان هنا نقيّتان تماماً: `parseSourceEvent` تُحوّل `unknown` إلى شكلٍ
 * موثوق، و`translateSourceEvent` تُحوّل الشكلَ الموثوق إلى مسوّدات. ولا ساعةَ ولا قاعدةَ
 * ولا مُعرّفاتٍ مولّدة، ولذلك كلُّ سؤالٍ هنا يُجاب بمساواةِ قيمٍ لا بترتيبِ نداءات.
 *
 * ## السؤالُ الذي يحكم هذا الملفّ
 *
 * ليس «هل تعمل الترجمة»، بل: **أيُّ حدثٍ يُنتج أيَّ وقائعَ على من، ولماذا لا شيءَ غيرها؟**
 * ولذلك يُفحَص الإهمالُ بنفس صرامة التسجيل: حدثٌ يُهمَل بصمتٍ ولا اختبارَ يُثبّت سببَه
 * هو بعينه ما ينتهي إلى «سمعةٌ لا تنمو ولا أحدَ يعرف لماذا».
 *
 * Scope: خدمة السمعة · حدُّ الأحداث الواردة
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: src/inbound/source-events.ts · src/inbound/translate.ts
 * Related Team: Reputation & Trust
 */

import { describe, expect, it } from "vitest";

import { isReputationError } from "../domain/errors.js";
import { parseSourceEvent } from "../inbound/source-events.js";
import { SOURCE_EVENT_IGNORE_REASONS, translateSourceEvent } from "../inbound/translate.js";

const EVENT_ID = "6f1a0f7e-9d0c-4f2a-9b3e-1c2d3e4f5a6b";
const ORDER = "ORD-0000000123";
const CUSTOMER = "WS-0000000001";
const DRIVER = "WS-0000000002";

function statusChanged(overrides: Record<string, unknown> = {}): unknown {
  return {
    event_id: EVENT_ID,
    event_type: "order.status_changed",
    event_version: "v1",
    occurred_at: "2026-03-01T09:00:00.000Z",
    trace_id: "trace-abc",
    data: {
      order_public_id: ORDER,
      customer_public_id: CUSTOMER,
      to_status: "completed",
      sequence: 7,
      actor_type: "system",
      driver_public_id: DRIVER,
      ...overrides,
    },
  };
}

function assignmentResolved(overrides: Record<string, unknown> = {}): unknown {
  return {
    event_id: EVENT_ID,
    event_type: "order.assignment_resolved",
    event_version: "v1",
    occurred_at: "2026-03-01T09:05:00.000Z",
    trace_id: "trace-xyz",
    data: {
      order_public_id: ORDER,
      driver_public_id: DRIVER,
      sequence: 3,
      assignment_state: "accepted",
      resolved_at: "2026-03-01T09:04:30.000Z",
      ...overrides,
    },
  };
}

/** يقرأ ثمّ يُترجم — الطريقُ الذي يسلكه المستهلكُ فعلاً. */
function translate(raw: unknown) {
  const parsed = parseSourceEvent(raw);
  if (parsed.kind !== "event") throw new Error(`توقّعنا حدثاً فحصلنا ${parsed.kind}`);
  return translateSourceEvent(parsed.event);
}

function expectValidationFailure(raw: unknown, field: string): void {
  try {
    parseSourceEvent(raw);
    expect.unreachable(`كان يجب رفضُ ${field}`);
  } catch (error) {
    if (!isReputationError(error)) throw error;
    expect(error.code).toBe("REPUTATION_VALIDATION_FAILED");
    /** `REPUTATION_VALIDATION_FAILED` رمزُه 400 في هذه الخدمة — يُثبَّت هنا لا يُفترَض. */
    expect(error.httpStatus).toBe(400);
    expect(error.details).toMatchObject({ field });
  }
}

describe("القراءة: ما يُرفَض عند الباب", () => {
  it("مُعرّفُ حدثٍ ليس UUID يُرفَض قبل أن يمسّ القاعدة", () => {
    /**
     * أهمُّ سطرٍ في القراءة. `source_event_id` عمودُ `UUID NOT NULL`، ومُعرّفٌ مُركّبٌ
     * مثل `evt-7` يمرّ في مُهيئ الذاكرة كلَّه ثمّ يسقط على Postgres بـ`22P02` **بلا اسمِ
     * قيد** — فلا `translate` يُترجمه ولا رسالةَ تقول أيُّ حقلٍ العلّة. الرفضُ هنا يُنتج
     * `400` باسم الحقل، والفرقُ بين الاثنين ساعاتُ تحقيق.
     */
    expectValidationFailure({ ...(statusChanged() as object), event_id: "evt-7" }, "event.event_id");
  });

  it("نسخةُ حدثٍ لا تُطابق `^v[0-9]+$` تُرفَض", () => {
    expectValidationFailure({ ...(statusChanged() as object), event_version: "1" }, "event.event_version");
  });

  it("تسلسلٌ صفريٌّ أو سالبٌ يُرفَض — التسلسلُ يبدأ من واحد", () => {
    /**
     * حرسُ التأخّر يقارن التسلسلات، وصفرٌ مقبولٌ كان سيجعل حدثاً بلا تسلسلٍ حقيقيٍّ
     * يُعيد كتابةَ تاريخٍ صحيح.
     */
    expectValidationFailure(statusChanged({ sequence: 0 }), "event.data.sequence");
  });

  it("عرضُ إسنادٍ بلا سائقٍ يُرفَض — بخلاف تغيّرِ الحالة", () => {
    expectValidationFailure(
      assignmentResolved({ driver_public_id: null }),
      "event.data.driver_public_id",
    );
  });

  it("نتيجةُ إسنادٍ خارج الأربعة تُرفَض ولا تُخمَّن", () => {
    expectValidationFailure(
      assignmentResolved({ assignment_state: "maybe" }),
      "event.data.assignment_state",
    );
  });

  it("ونوعٌ لا يعنينا يُردّ `unsupported` بنوعِه ولا يُرفَع خطأً", () => {
    /**
     * الفرقُ بين `unsupported` و`invalid` هو الفرقُ بين «استُهلك وأُسقط» و«أعِد التسليم».
     * وخلطُهما يُنتج طابوراً يُعيد تسليمَ حدثِ خدمةٍ أخرى إلى الأبد.
     */
    const parsed = parseSourceEvent({ event_type: "order.created", data: {} });
    expect(parsed).toEqual({ kind: "unsupported", eventType: "order.created" });
  });

  it("ونوعٌ غيرُ نصٍّ ليس `unsupported` بل خطأُ حمولة", () => {
    expectValidationFailure({ event_type: 7 }, "event.event_type");
  });
});

describe("الإكمال: واقعتان لا واحدة", () => {
  it("طلبٌ مكتملٌ يُنتج واقعةً للعميل وواقعةً للسائق بهذا الترتيب", () => {
    /**
     * الوزنان مُعلَنان في `saudi-launch-v1`: العميلُ +3 والسائقُ +4. وتسجيلُ واحدةٍ فقط
     * كان يعني أنّ أحدَ الجانبين لا تنمو سمعتُه من نفس العمل — وهو عطلٌ لا يظهر في أيِّ
     * سجلٍّ لأنّ كلَّ ما جرى «نجح».
     */
    const { drafts, ignored } = translate(statusChanged());
    expect(ignored).toEqual([]);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      subjectType: "customer",
      subjectPublicId: CUSTOMER,
      factKind: "order_completed",
      orderPublicId: ORDER,
      sourceEventType: "order.status_changed",
      sourceEventId: EVENT_ID,
      sourceSequence: 7,
    });
    expect(drafts[1]).toMatchObject({
      subjectType: "driver",
      subjectPublicId: DRIVER,
      factKind: "order_completed",
      sourceSequence: 7,
    });
  });

  it("ولحظةُ الواقعتين هي لحظةُ المغلَّف، ومُعرّفُ التتبّع يمرّ كما هو", () => {
    /**
     * HANDOFF §16-ي البند 4: `x-request-id` يعبُر الحدثَ إلى الواقعة إلى الحدث الخارج
     * بلا توليدٍ جديد. وتوليدُ مُعرّفٍ عند كل حدٍّ كان يجعل تتبُّعَ طلبٍ واحدٍ ثلاثةَ
     * تتبّعاتٍ لا تلتقي.
     */
    const { drafts } = translate(statusChanged());
    for (const draft of drafts) {
      expect(draft.occurredAt).toBe("2026-03-01T09:00:00.000Z");
      expect(draft.traceId).toBe("trace-abc");
    }
  });

  it("إكمالٌ بلا سائقٍ في الحمولة: واقعةُ العميل تُسجَّل والغيابُ يُسمّى", () => {
    /**
     * ولا يُخمَّن سائقٌ ولا تُهمَل الواقعتان معاً: إسقاطُ واقعةِ العميل لأنّ حقلَ السائق
     * ناقصٌ كان سيُعاقب العميلَ على عطلٍ في المصدر.
     */
    const { drafts, ignored } = translate(statusChanged({ driver_public_id: null }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.subjectType).toBe("customer");
    expect(ignored).toEqual(["driver_absent_in_payload"]);
  });
});

describe("الإلغاء: على فاعلِه وحده", () => {
  it("إلغاءُ العميل واقعةٌ على العميل فقط", () => {
    const { drafts, ignored } = translate(statusChanged({ to_status: "customer_cancelled" }));
    expect(ignored).toEqual([]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      subjectType: "customer",
      factKind: "order_cancelled_by_customer",
    });
  });

  it("إلغاءُ السائق واقعةٌ على السائق فقط — ولا شيءَ على العميل", () => {
    /**
     * الوزنُ −9 وهو أثقلُ وزنٍ في النسخة. ونسبتُه إلى العميل خطأً تُنتج رقماً خاطئاً في
     * دفترٍ لا يُعدَّل — ولذلك يُفحَص **غيابُ** واقعةِ العميل لا وجودُ واقعةِ السائق وحده.
     */
    const { drafts } = translate(statusChanged({ to_status: "driver_cancelled" }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      subjectType: "driver",
      subjectPublicId: DRIVER,
      factKind: "order_cancelled_by_driver",
    });
  });

  it("وإلغاءُ سائقٍ بلا مُعرّفِ سائقٍ لا يُنسَب إلى أحد", () => {
    const { drafts, ignored } = translate(
      statusChanged({ to_status: "driver_cancelled", driver_public_id: null }),
    );
    expect(drafts).toEqual([]);
    expect(ignored).toEqual(["driver_absent_in_payload"]);
  });
});

describe("الإهمال: بسببٍ مُسمّى لا بصمت", () => {
  it("حالاتُ الرحلة تُهمَل بـ`status_not_reputable`", () => {
    for (const status of ["assigned", "driver_en_route", "arrived", "in_progress", "negotiating"]) {
      const { drafts, ignored } = translate(statusChanged({ to_status: status }));
      expect(drafts, status).toEqual([]);
      expect(ignored, status).toEqual(["status_not_reputable"]);
    }
  });

  it("والنهائياتُ التي لا يملكها طرفٌ تُهمَل بسببٍ آخرَ يُعَدّ منفصلاً", () => {
    /**
     * سببان لا سبب: «مرحلةُ رحلة» و«نهائيّةٌ بلا مالك» عددان مختلفان في لوحةِ من يُشغّل
     * المستهلك. وجمعُهما في سببٍ واحدٍ كان سيُخفي أنّ طلباتٍ كثيرةً تنتهي بلا سائق.
     */
    for (const status of [
      "expired",
      "no_driver_found",
      "driver_rejected",
      "driver_timeout",
      "partner_cancelled",
      "blocked",
      "failed",
      "payment_disputed",
      "under_review",
    ]) {
      const { drafts, ignored } = translate(statusChanged({ to_status: status }));
      expect(drafts, status).toEqual([]);
      expect(ignored, status).toEqual(["status_owned_by_no_party"]);
    }
  });

  it("وكلُّ سببٍ مُعلَنٍ في القائمة يُنتجه فرعٌ حقيقيّ — لا سببَ ميّت", () => {
    /**
     * القائمةُ المقفلة تُغري بأسماءٍ تبقى بعد أن يزول فرعُها. وهذا الاختبارُ يُثبت أنّ
     * الأربعةَ كلَّها تُنتَج فعلاً، فلو حُذف فرعٌ يوماً وبقي اسمُه لسقط البناء.
     */
    const produced = new Set<string>([
      ...translate(statusChanged({ to_status: "assigned" })).ignored,
      ...translate(statusChanged({ to_status: "expired" })).ignored,
      ...translate(statusChanged({ driver_public_id: null })).ignored,
      ...translate(assignmentResolved({ assignment_state: "cancelled" })).ignored,
    ]);
    expect([...produced].sort()).toEqual([...SOURCE_EVENT_IGNORE_REASONS].sort());
  });
});

describe("نتائجُ الإسناد: الفاعلُ يُشتقّ من النتيجة", () => {
  const CASES = [
    { state: "accepted", factKind: "assignment_accepted", actorType: "driver" },
    { state: "rejected", factKind: "assignment_rejected", actorType: "driver" },
    { state: "expired", factKind: "assignment_timed_out", actorType: "system" },
  ] as const;

  for (const testCase of CASES) {
    it(`${testCase.state} → ${testCase.factKind} بفاعلٍ ${testCase.actorType}`, () => {
      const { drafts, ignored } = translate(assignmentResolved({ assignment_state: testCase.state }));
      expect(ignored).toEqual([]);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        subjectType: "driver",
        subjectPublicId: DRIVER,
        factKind: testCase.factKind,
        actorType: testCase.actorType,
        sourceEventType: "order.assignment_resolved",
      });
    });
  }

  it("و`cancelled` تُهمَل: إلغاءُ العرض ليس فعلاً للسائق", () => {
    const { drafts, ignored } = translate(assignmentResolved({ assignment_state: "cancelled" }));
    expect(drafts).toEqual([]);
    expect(ignored).toEqual(["assignment_cancelled_by_system"]);
  });

  it("ولحظةُ الواقعة `resolved_at` لا لحظةُ إنتاج الحدث", () => {
    /**
     * التلاشي في `score.ts` يُحسب بعمر الواقعة، فخلطُ اللحظتين كان يجعل تأخُّرَ ناشرٍ
     * دقيقةً يُغيّر نتيجةَ حسابٍ لا علاقة له به — وهو أسوأُ عطلٍ ممكن: صحيحٌ اليوم
     * وخاطئٌ يومَ يتأخّر الطابور.
     */
    const { drafts } = translate(assignmentResolved());
    expect(drafts[0]?.occurredAt).toBe("2026-03-01T09:04:30.000Z");
  });

  it("ورمزُ السببِ يُمرَّر إن وُجد ويبقى `null` إن غاب", () => {
    const withReason = translate(assignmentResolved({ reason_code: "driver_busy" }));
    expect(withReason.drafts[0]?.reasonCode).toBe("driver_busy");
    const withoutReason = translate(assignmentResolved());
    expect(withoutReason.drafts[0]?.reasonCode).toBeNull();
  });
});
