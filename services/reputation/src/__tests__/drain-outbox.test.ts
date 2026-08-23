/**
 * تصريفُ صندوق الصادر — ثلاثةُ ضماناتٍ تُقاس، وواحدةٌ تُعلَن ولا تُدَّعى.
 *
 * ## ما يُقاس هنا
 *
 *   1. **الترتيب**: يُسلَّم الأقدمُ أوّلاً بلحظة **وقوعِ** الحدث لا بلحظة كتابته.
 *   2. **فشلُ التسليم لا يُبطل الكتابة**: الصفُّ يبقى، و`attempts` يزيد، و`last_error`
 *      يحمل رسالةَ العطل نفسَه لا نصّاً من عندنا.
 *   3. **إعادةُ المحاولة لا تُنتج نشرتين**: منفذٌ يفشل ثمّ ينجح يُنتج تسليماً **واحداً**
 *      ناجحاً وصفّاً معلَّماً مرّةً واحدة.
 *
 * ## وما يُعلَن ولا يُدَّعى
 *
 * التسليمُ at-least-once لا at-most-once، وهو مكتوبٌ في ترويسة `drain-outbox.ts`. ولا
 * يمكن لاختبارٍ في الذاكرة أن يُثبت نفيَه، وكتابةُ اختبارٍ يوحي بأنّه أثبته أسوأُ من
 * غيابه: بوّابةٌ كاذبةٌ تُقرأ ضماناً وليست ضماناً.
 *
 * Scope: خدمة السمعة · تصريفُ صندوق الصادر
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: src/outbound/drain-outbox.ts · src/outbound/event-sink.ts
 * Related Team: Reputation & Trust
 */

import { describe, expect, it } from "vitest";

import type { ReputationDomainEvent } from "../domain/events.js";
import {
  FlakyEventSink,
  InMemoryOutbox,
  ManualClock,
  RecordingEventSink,
} from "../infrastructure/in-memory.js";
import {
  createDirectOutboxDrainRunner,
  drainOutbox,
} from "../outbound/drain-outbox.js";
import {
  EventSinkUnconfiguredError,
  unconfiguredEventSink,
  type EventSinkPort,
  type OutboxRecord,
} from "../outbound/event-sink.js";

const NOW = "2026-03-01T12:00:00.000Z";

function event(overrides: {
  readonly id: string;
  readonly occurredAt: string;
  readonly eventType?: string;
  readonly traceId?: string | null;
}): ReputationDomainEvent {
  return {
    event_id: overrides.id,
    event_type: overrides.eventType ?? "reputation.fact_recorded",
    event_version: "v1",
    occurred_at: overrides.occurredAt,
    producer: "reputation-service",
    aggregate: { type: "reputation_subject", id: "WS-0000000001" },
    trace_id: overrides.traceId ?? "trace-drain",
    data: { subject_type: "customer", subject_public_id: "WS-0000000001" },
  } as unknown as ReputationDomainEvent;
}

function uuid(tail: string): string {
  return `6f1a0f7e-9d0c-4f2a-9b3e-1c2d3e4f5a${tail}`;
}

function setup(): {
  outbox: InMemoryOutbox;
  runner: ReturnType<typeof createDirectOutboxDrainRunner>;
  clock: ManualClock;
} {
  const outbox = new InMemoryOutbox();
  return {
    outbox,
    runner: createDirectOutboxDrainRunner(outbox),
    clock: new ManualClock(NOW),
  };
}

describe("الدفعةُ الناجحة", () => {
  it("تُسلّم كلَّ صفٍّ مرّةً واحدةً وتُعلّمه منشوراً", async () => {
    const { outbox, runner, clock } = setup();
    await outbox.append(
      [
        event({ id: uuid("01"), occurredAt: "2026-03-01T10:00:00.000Z" }),
        event({ id: uuid("02"), occurredAt: "2026-03-01T10:05:00.000Z" }),
      ],
      "2026-03-01T11:00:00.000Z",
    );
    const sink = new RecordingEventSink();

    const report = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(report).toMatchObject({ claimed: 2, published: 2, alreadyPublished: 0 });
    expect(report.failed).toEqual([]);
    expect(sink.delivered).toHaveLength(2);
    expect(outbox.unpublishedCount()).toBe(0);
    expect(outbox.publishedCount()).toBe(2);
  });

  it("ودفعةٌ ثانيةٌ بعدها لا تُسلّم شيئاً — لا نشرةَ مضاعفة", async () => {
    /**
     * أوّلُ عطلٍ يظهر لو نُسي شرطُ `published_at IS NULL` في الاحتجاز: كلُّ دورةٍ تُعيد
     * تسليمَ **كلِّ** تاريخ الصندوق. ولا يُلاحَظ في اختبارٍ يُصرّف مرّةً واحدة.
     */
    const { outbox, runner, clock } = setup();
    await outbox.append([event({ id: uuid("03"), occurredAt: "2026-03-01T10:00:00.000Z" })], NOW);
    const sink = new RecordingEventSink();

    await drainOutbox(runner, sink, { limit: 10, clock });
    const second = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(second).toMatchObject({ claimed: 0, published: 0, alreadyPublished: 0 });
    expect(sink.delivered).toHaveLength(1);
  });

  it("ولحظةُ النشر تأتي من الساعة المحقونة لا من ساعة النظام", async () => {
    /**
     * `purity.test.ts` يمنع `Date.now(` في كل الخدمة، وهذا الاختبارُ يُقيس الأثرَ لا
     * الشكل: لحظةٌ من ساعة النظام كانت ستجعل اختبارَ نبضةٍ يعتمد على وقت التشغيل.
     */
    const { outbox, runner, clock } = setup();
    await outbox.append([event({ id: uuid("04"), occurredAt: "2026-03-01T10:00:00.000Z" })], NOW);
    /** منفذٌ يقرأ `attempts` ليُثبت أنّ الصفَّ يُسلَّم بمحاولاتٍ صفر في أوّل مرّة. */
    const seen: number[] = [];
    const sink: EventSinkPort = {
      async deliver(record: OutboxRecord): Promise<void> {
        seen.push(record.attempts);
      },
    };

    await drainOutbox(runner, sink, { limit: 10, clock });

    expect(seen).toEqual([0]);
    expect(clock.now()).toBe(NOW);
  });
});

describe("الترتيبُ والحدّ", () => {
  it("الأقدمُ وقوعاً أوّلاً — لا الأقدمُ كتابةً", async () => {
    /**
     * حدثان يُكتبان في لحظةٍ واحدة (نفس المعاملة) ويقعان في لحظتين مختلفتين. والترتيبُ
     * بلحظة الكتابة كان سيبدو صحيحاً هنا بالمصادفة، ولذلك يُكتب الأحدثُ وقوعاً **أوّلاً**
     * في الصندوق: لو كان الترتيبُ بالإدراج لَخرج معكوساً.
     */
    const { outbox, runner, clock } = setup();
    await outbox.append(
      [
        event({ id: uuid("06"), occurredAt: "2026-03-01T10:30:00.000Z" }),
        event({ id: uuid("05"), occurredAt: "2026-03-01T09:00:00.000Z" }),
      ],
      NOW,
    );
    const sink = new RecordingEventSink();

    await drainOutbox(runner, sink, { limit: 10, clock });

    expect(sink.delivered.map((record) => record.occurredAt)).toEqual([
      "2026-03-01T09:00:00.000Z",
      "2026-03-01T10:30:00.000Z",
    ]);
  });

  it("و`limit` يُحترَم: البقيةُ تبقى غيرَ منشورةٍ للدورة التالية", async () => {
    /**
     * الحدُّ ليس تحسيناً بل حرسُ معاملة: التسليمُ يقع **داخل** المعاملة، ودفعةٌ من ألفٍ
     * تُبقي معاملةً مفتوحةً دقائق فتُعطّل `VACUUM` وتُطيل الأقفال.
     */
    const { outbox, runner, clock } = setup();
    await outbox.append(
      [
        event({ id: uuid("07"), occurredAt: "2026-03-01T09:00:00.000Z" }),
        event({ id: uuid("08"), occurredAt: "2026-03-01T09:01:00.000Z" }),
        event({ id: uuid("09"), occurredAt: "2026-03-01T09:02:00.000Z" }),
      ],
      NOW,
    );
    const sink = new RecordingEventSink();

    const first = await drainOutbox(runner, sink, { limit: 2, clock });
    expect(first).toMatchObject({ claimed: 2, published: 2 });
    expect(outbox.unpublishedCount()).toBe(1);

    const second = await drainOutbox(runner, sink, { limit: 2, clock });
    expect(second).toMatchObject({ claimed: 1, published: 1 });
    expect(outbox.unpublishedCount()).toBe(0);
  });

  it("وحدٌّ غيرُ موجبٍ يُرفَض ولا يُصحَّح", async () => {
    /**
     * `limit: 0` كان سيُنتج دفعةً فارغةً تُقرأ «الصندوق نظيف» — وهو أسوأُ جوابٍ ممكن على
     * خطأِ ربطٍ صامت. والتصحيحُ إلى 1 كان سيُخفي الخطأَ إلى الأبد.
     */
    const { runner, clock } = setup();
    const sink = new RecordingEventSink();
    await expect(drainOutbox(runner, sink, { limit: 0, clock })).rejects.toThrow(RangeError);
    await expect(drainOutbox(runner, sink, { limit: -3, clock })).rejects.toThrow(RangeError);
  });
});

describe("فشلُ التسليم لا يُبطل الكتابة", () => {
  it("الصفُّ يبقى غيرَ منشورٍ و`attempts` يزيد و`last_error` يحمل سببَ العطل", async () => {
    const { outbox, runner, clock } = setup();
    const id = uuid("10");
    await outbox.append([event({ id, occurredAt: "2026-03-01T09:00:00.000Z" })], NOW);
    const sink = new FlakyEventSink(1, "bus refused connection");

    const report = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(report).toMatchObject({ claimed: 1, published: 0 });
    expect(report.failed).toEqual([
      { id, eventType: "reputation.fact_recorded", reason: "bus refused connection" },
    ]);
    expect(outbox.unpublishedCount()).toBe(1);
    expect(outbox.attemptsOf(id)).toBe(1);
    /**
     * الرسالةُ من العطل نفسِه. ونصٌّ من عندنا مثل «فشل التسليم» كان سيُقرأ بعد أسبوعين
     * فلا يقول شيئاً، ويُفتح له تحقيقٌ ينتهي إلى أنّ السببَ كان مكتوباً ومُلغىً.
     */
    expect(outbox.lastErrorOf(id)).toBe("bus refused connection");
  });

  it("وصفٌّ فاسدٌ لا يسدّ الطابور: الدفعةُ تمضي إلى ما بعده", async () => {
    /**
     * لو أوقف الفشلُ الحلقةَ لَصار أوّلُ صفٍّ لا يُسلَّم سدّاً يمنع كلَّ ما بعده إلى
     * الأبد — وهو أسوأُ من تأخّر صفٍّ واحد، لأنّه يُحوّل عطلاً في حدثٍ إلى عطلٍ في
     * الخدمة كلِّها.
     */
    const { outbox, runner, clock } = setup();
    const bad = uuid("11");
    const good = uuid("12");
    await outbox.append(
      [
        event({ id: bad, occurredAt: "2026-03-01T09:00:00.000Z" }),
        event({ id: good, occurredAt: "2026-03-01T09:01:00.000Z" }),
      ],
      NOW,
    );
    /** يفشل الأوّلَ وحده — والفشلُ الأوّلُ يقع على الأقدم وقوعاً بحكم الترتيب. */
    const sink = new FlakyEventSink(1, "payload rejected");

    const report = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(report.claimed).toBe(2);
    expect(report.published).toBe(1);
    expect(report.failed.map((failure) => failure.id)).toEqual([bad]);
    expect(sink.delivered.map((record) => record.id)).toEqual([good]);
  });
});

describe("إعادةُ المحاولة لا تُنتج نشرتين", () => {
  it("فشلٌ ثمّ نجاحٌ = تسليمٌ ناجحٌ واحدٌ وصفٌّ معلَّمٌ مرّةً واحدة", async () => {
    /**
     * البندُ الثالثُ في HANDOFF §16-ي مقيساً كاملاً: المنفذُ يُنادى مرّتين (وهو معنى
     * at-least-once)، لكنّ التسليمَ **الناجح** واحد، و`published` واحدٌ لا اثنان،
     * و`alreadyPublished` صفرٌ — أي لم يُعلَّم الصفُّ مرّتين.
     */
    const { outbox, runner, clock } = setup();
    const id = uuid("13");
    await outbox.append([event({ id, occurredAt: "2026-03-01T09:00:00.000Z" })], NOW);
    const sink = new FlakyEventSink(1, "temporary outage");

    const first = await drainOutbox(runner, sink, { limit: 10, clock });
    expect(first.published).toBe(0);

    const second = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(second).toMatchObject({ claimed: 1, published: 1, alreadyPublished: 0 });
    expect(sink.delivered.map((record) => record.id)).toEqual([id]);
    expect(outbox.attemptsOf(id)).toBe(1);
    expect(outbox.publishedCount()).toBe(1);
  });

  it("والتعليمُ الشرطيُّ يُبلّغ عن نشرةٍ ثانيةٍ ولا يبتلعها", async () => {
    /**
     * محاكاةُ ما لا يجوز أن يحدث: صفٌّ معلَّمٌ يُسلَّم ثانيةً. والمقياسُ أنّ ذلك يظهر في
     * `alreadyPublished` بدل أن يُعَدّ نشراً ناجحاً. ولو كان `markPublished` يُرجع `void`
     * لكان الرقمان متساويين، ولانعدم الفرقُ بين تصريفٍ سليمٍ وتصريفٍ يُسلّم مرّتين.
     */
    const { outbox, clock } = setup();
    const id = uuid("14");
    await outbox.append([event({ id, occurredAt: "2026-03-01T09:00:00.000Z" })], NOW);
    /** مخزنٌ يُحرّر القفلَ فيسمح باحتجازِ نفسِ الصفِّ ثانيةً بعد نشره — أي غيابُ القفل. */
    const leakyRunner = createDirectOutboxDrainRunner({
      claimUnpublished: async (limit) => {
        const claimed = await outbox.claimUnpublished(limit);
        if (claimed.length > 0) return claimed;
        /** لا شيءَ غيرُ منشور: نُعيد الصفَّ المنشورَ عنوةً كما لو أنّ القفلَ لم يُطبَّق. */
        return [
          {
            id,
            aggregateType: "reputation_subject",
            aggregateId: "WS-0000000001",
            eventType: "reputation.fact_recorded",
            eventVersion: "v1",
            payload: {},
            occurredAt: "2026-03-01T09:00:00.000Z",
            attempts: 0,
            traceId: "trace-drain",
          },
        ];
      },
      markPublished: (rowId, publishedAt) => outbox.markPublished(rowId, publishedAt),
      recordDeliveryFailure: (rowId, reason) => outbox.recordDeliveryFailure(rowId, reason),
    });
    const sink = new RecordingEventSink();

    await drainOutbox(leakyRunner, sink, { limit: 10, clock });
    const second = await drainOutbox(leakyRunner, sink, { limit: 10, clock });

    expect(second).toMatchObject({ claimed: 1, published: 0, alreadyPublished: 1 });
    expect(outbox.publishedCount()).toBe(1);
  });
});

describe("منفذٌ غيرُ مُهيَّأ", () => {
  it("يُعلن عطلَه في كل صفٍّ ولا يُفرِغ الصندوقَ بصمت", async () => {
    /**
     * النسخةُ الخاطئةُ الأرخص: منفذٌ لا يفعل شيئاً ويُرجع بنجاح. حينئذٍ يُفرَغ الصندوقُ
     * ويُكتب `published_at` ولا مستهلكَ يستلم شيئاً — أي فقدانُ أحداثٍ صامتٌ يُكتشف بعد
     * شهرٍ في لوحةٍ ناقصةٍ ولا سبيلَ لاستعادته.
     */
    const { outbox, runner, clock } = setup();
    const id = uuid("15");
    await outbox.append([event({ id, occurredAt: "2026-03-01T09:00:00.000Z" })], NOW);

    const report = await drainOutbox(runner, unconfiguredEventSink("REPUTATION_BUS_URL missing"), {
      limit: 10,
      clock,
    });

    expect(report).toMatchObject({ claimed: 1, published: 0 });
    expect(outbox.unpublishedCount()).toBe(1);
    expect(outbox.lastErrorOf(id)).toContain("REPUTATION_BUS_URL missing");
  });

  it("ونداؤه مباشرةً يرفع خطأً باسمه", async () => {
    await expect(
      unconfiguredEventSink("no sink").deliver({
        id: uuid("16"),
        aggregateType: "reputation_subject",
        aggregateId: "WS-0000000001",
        eventType: "reputation.fact_recorded",
        eventVersion: "v1",
        payload: {},
        occurredAt: "2026-03-01T09:00:00.000Z",
        attempts: 0,
        traceId: null,
      }),
    ).rejects.toBeInstanceOf(EventSinkUnconfiguredError);
  });
});

describe("ما يراه المنفذ", () => {
  it("مُعرّفُ الصفِّ هو `event_id` نفسُه — وبه تُزال التكرارات", async () => {
    /**
     * هذا هو الثمنُ المدفوعُ مقابل at-least-once. ولو كان للصفِّ مُعرّفٌ خاصٌّ به لَكان
     * تسليمان لنفس الحدث حدثين مختلفين في نظر المستهلك — فيُحتسب مرّتين ولا سبيلَ لكشفه.
     */
    const { outbox, runner, clock } = setup();
    const id = uuid("17");
    await outbox.append([event({ id, occurredAt: "2026-03-01T09:00:00.000Z" })], NOW);
    const sink = new RecordingEventSink();

    await drainOutbox(runner, sink, { limit: 10, clock });

    expect(sink.delivered[0]?.id).toBe(id);
  });

  it("ومُعرّفُ التتبّع يُسلَّم صريحاً لا مُنتزَعاً من الحمولة", async () => {
    /**
     * انتزاعُه من `payload` كان سيُلزم المُصرّفَ بمعرفة شكلِ حمولةٍ خرجت من القاعدة وقد
     * كُتبت بنسخةٍ أقدمَ من الكود — وهو بعينه ما يمنعه كونُ `payload` من نوع `unknown`.
     */
    const { outbox, runner, clock } = setup();
    await outbox.append(
      [event({ id: uuid("18"), occurredAt: "2026-03-01T09:00:00.000Z", traceId: "trace-passthrough" })],
      NOW,
    );
    const sink = new RecordingEventSink();

    await drainOutbox(runner, sink, { limit: 10, clock });

    expect(sink.delivered[0]?.traceId).toBe("trace-passthrough");
  });
});
