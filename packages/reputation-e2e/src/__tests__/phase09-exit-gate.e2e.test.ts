/**
 * بوابةُ خروج Phase 09 — «السمعةُ تُبنى من أحداثِ المحرّكِ الحقيقيّة، لا من أحداثٍ نكتبها».
 *
 * # السؤالُ الذي تُجيبه هذه البوابةُ وحدها
 *
 * الطَورُ التاسع أعلن قاعدتَه: «السمعةُ نتيجةٌ مُشتقّة من دفتر وقائع، والاحتيالُ إشاراتٌ
 * مُسمّاة لا حُكم، والخدمةُ لا تعاقب أحداً». وقد قِيست هذه القاعدةُ في 282 اختباراً داخل
 * الخدمة. لكنّ كلَّ تلك الاختباراتِ تُغذّي أحداثاً **مكتوبةً في ملفّ الاختبار**، فتُثبت
 * أنّ الخدمةَ صحيحةٌ بالنسبة لفهمِنا للعقد، لا بالنسبة للعقدِ الذي يُصدره محرّكُ الطلب.
 *
 * فهذا الملفُّ لا يكتب حمولةَ حدثٍ واحدة. يسوق طلباتٍ عبر HTTP في المحرّكِ الحقيقيّ، ثمّ
 * يقرأ **صفَّ صادرِ المحرّك** فيأخذ ما أصدره هو، ويُمرِّره كما هو إلى مُستهلكِ السمعة،
 * ثمّ يقرأ النتيجةَ من `GET /reputation/scores/...` على مِقبضٍ حقيقيّ، ثمّ يُصرِّف صفَّ
 * صادرِ السمعة إلى مصرفٍ مُسجِّل. فإن أعاد أحدُهما تسميةَ حقلٍ سقط `pnpm -r test`.
 *
 * # حدودُ هذه البوابة — ما لا تُثبته
 *
 * 1. **لا ناقلَ حقيقيّاً بينهما.** المُشتركُ الذي سيُنادي `consumeSourceEvent` ومُجدولُ
 *    التصريف كلاهما دَينٌ مُعلَنٌ في MR 5/6، وقرارُ الناقل نفسُه من Phase 11. فالبوابةُ
 *    تُنادي المُستهلكَ مباشرةً بالحمولةِ الفعليّة: تُثبت العقدَ لا وسيطَه.
 * 2. **لا Postgres.** الخدمتان على مُهيئي الذاكرة كي تركض البوابةُ في كلّ اختبار. ومخزنُ
 *    التصريفِ على Postgres (`PostgresOutboxDrainStore`) يبقى دَيناً مُعلَناً حتى تُقاس
 *    عليه حزمةُ التكامل بقاعدةٍ حقيقيّة.
 *
 * Scope: Phase 09 · MR 6/6
 * Related Docs: docs/12-testing/PHASE09_EXIT_GATE_E2E.md
 * Related Team: Reputation & Trust · Order Engine
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  callReputation,
  driveTo,
  drain,
  emittedEvents,
  feed,
  intakeOrder,
  resolveAssignment,
  startGate,
  type GateContext,
  type GateOrder,
} from "../harness.js";

let gate: GateContext;

beforeAll(async () => {
  gate = await startGate();
});

afterAll(async () => {
  await gate.close();
});

/** آخرُ حدثِ تغيُّرِ حالةٍ أصدره المحرّكُ لهذا الطلب بحالةٍ مطلوبة. */
async function statusEvent(order: GateOrder, toStatus: string): Promise<Record<string, unknown>> {
  const events = await emittedEvents(gate, "order.status_changed", order.orderPublicId);
  const match = events.find(
    (event) => (event.data as { to_status?: string }).to_status === toStatus,
  );
  if (match === undefined) {
    throw new Error(`the engine emitted no status_changed to ${toStatus}`);
  }
  return match as unknown as Record<string, unknown>;
}

/** آخرُ حدثِ حلِّ إسنادٍ أصدره المحرّكُ لهذا الطلب. */
async function assignmentEvent(order: GateOrder): Promise<Record<string, unknown>> {
  const events = await emittedEvents(gate, "order.assignment_resolved", order.orderPublicId);
  const last = events.at(-1);
  if (last === undefined) throw new Error("the engine emitted no assignment_resolved");
  return last as unknown as Record<string, unknown>;
}

describe("بوابة Phase 09 · العقد بين المحرّك والسمعة", () => {
  it("حمولةُ المحرّكِ الفعليّةُ تحمل كلَّ حقلٍ يقرؤه مُستهلكُ السمعة", async () => {
    const order = await intakeOrder(gate, 1);
    await driveTo(gate, order, "completed");
    const event = await statusEvent(order, "completed");

    // المغلّفُ: ما يقرؤه `parseSourceEvent` قبل أن ينظر في البيانات.
    expect(Object.keys(event)).toEqual(
      expect.arrayContaining(["event_id", "event_type", "event_version", "occurred_at", "data"]),
    );
    expect(event.event_version).toBe("v1");

    // البياناتُ: أسماءُ الحقولِ التي لو تغيّر واحدٌ منها لصار كلُّ حدثٍ رفضاً بـ400.
    expect(Object.keys(event.data as Record<string, unknown>)).toEqual(
      expect.arrayContaining([
        "order_public_id",
        "customer_public_id",
        "to_status",
        "sequence",
        "reason_code",
        "actor_type",
        "driver_public_id",
      ]),
    );
  });

  it("إكمالُ طلبٍ حقيقيٍّ يُنتج واقعتَين: للعميل وللسائق", async () => {
    const order = await intakeOrder(gate, 2);
    await driveTo(gate, order, "completed");
    const consumption = await feed(gate, await statusEvent(order, "completed"));

    expect(consumption.kind).toBe("consumed");
    if (consumption.kind !== "consumed") return;
    expect(consumption.ignored).toEqual([]);
    expect(consumption.outcomes).toHaveLength(2);
    expect(consumption.outcomes.every((outcome) => outcome.kind === "recorded")).toBe(true);

    const subjects = consumption.outcomes.map((outcome) => ({
      subjectType: outcome.draft.subjectType,
      subjectPublicId: outcome.draft.subjectPublicId,
      factKind: outcome.draft.factKind,
    }));
    expect(subjects).toEqual([
      {
        subjectType: "customer",
        subjectPublicId: order.customerPublicId,
        factKind: "order_completed",
      },
      { subjectType: "driver", subjectPublicId: order.driverPublicId, factKind: "order_completed" },
    ]);
  });

  it("النتيجةُ تُقرأ من المسارِ المُعلَن بنفس ما قاله المُستهلك", async () => {
    const order = await intakeOrder(gate, 3);
    await driveTo(gate, order, "completed");
    const consumption = await feed(gate, await statusEvent(order, "completed"));
    if (consumption.kind !== "consumed") throw new Error("event was not consumed");

    for (const outcome of consumption.outcomes) {
      if (outcome.kind !== "recorded") throw new Error(`unexpected outcome: ${outcome.kind}`);
      const read = await callReputation(gate, {
        method: "GET",
        path: `/reputation/scores/${outcome.draft.subjectType}/${outcome.draft.subjectPublicId}`,
      });
      expect(read.status).toBe(200);
      expect(read.body.score_points).toBe(outcome.scorePoints);
      expect(read.body.tier).toBe(outcome.tier);
      expect(read.body.fact_count).toBe(1);
      expect(read.body.ruleset_version).toBe(1);
    }
  });

  it("وزنُ الإكمالِ المُعلَن يظهر في النتيجة: العميلُ 63 والسائقُ 64", async () => {
    const order = await intakeOrder(gate, 4);
    await driveTo(gate, order, "completed");
    const consumption = await feed(gate, await statusEvent(order, "completed"));
    if (consumption.kind !== "consumed") throw new Error("event was not consumed");

    const points = consumption.outcomes.map((outcome) =>
      outcome.kind === "recorded" ? outcome.scorePoints : -1,
    );
    expect(points).toEqual([63, 64]);
  });

  it("الواقعةُ تظهر في دفترِ الوقائعِ بمصدرِها لا بمصدرٍ مُخترَع", async () => {
    const order = await intakeOrder(gate, 5);
    await driveTo(gate, order, "completed");
    const event = await statusEvent(order, "completed");
    await feed(gate, event);

    const read = await callReputation(gate, {
      method: "GET",
      path: `/reputation/facts?subjectType=driver&subjectPublicId=${order.driverPublicId}`,
    });
    expect(read.status).toBe(200);
    const facts = read.body.facts as Record<string, unknown>[];
    expect(facts).toHaveLength(1);
    expect(facts[0]!.source_event_type).toBe("order.status_changed");
    expect(facts[0]!.source_event_id).toBe(event.event_id);
    expect(facts[0]!.order_public_id).toBe(order.orderPublicId);
  });
});

describe("بوابة Phase 09 · كلُّ ما يُصدره المحرّكُ مقروءٌ أو مُعلَنُ التجاهل", () => {
  it("لا حدثٌ واحدٌ من دورةِ حياةٍ كاملةٍ يُرفَض", async () => {
    const order = await intakeOrder(gate, 6);
    await driveTo(gate, order, "completed");
    const events = await gate.engineEvents();
    const mine = events.filter(
      (event) =>
        (event.data as { order_public_id?: string }).order_public_id === order.orderPublicId,
    );
    // دورةٌ كاملةٌ تُصدر: إنشاءً، وعرضَ إسنادٍ، وحلَّه، وسلسلةَ تغيُّراتِ حالة.
    expect(mine.length).toBeGreaterThanOrEqual(4);

    for (const event of mine) {
      const consumption = await feed(gate, event);
      if (consumption.kind === "unsupported") {
        // نوعٌ لا يعنينا: يُعَدّ ولا يُرفَض. وهذان هما الاثنان الوحيدان المتوقّعان.
        expect(["order.created", "order.assignment_offered"]).toContain(consumption.eventType);
        continue;
      }
      const rejected = consumption.outcomes.filter((outcome) => outcome.kind === "rejected");
      expect(rejected).toEqual([]);
    }
  });

  it("حالةٌ لا يملكها طرفٌ تُتجاهَل بسببٍ مُسمّىً لا بخطأ", async () => {
    const order = await intakeOrder(gate, 7);
    await driveTo(gate, order, "expired");
    const consumption = await feed(gate, await statusEvent(order, "expired"));

    expect(consumption.kind).toBe("consumed");
    if (consumption.kind !== "consumed") return;
    expect(consumption.outcomes).toEqual([]);
    expect(consumption.ignored).toEqual(["status_owned_by_no_party"]);
  });

  it("إلغاءُ العميلِ يُسجَّل عليه هو، وتنزل نتيجتُه بالوزنِ المُعلَن", async () => {
    const order = await intakeOrder(gate, 8);
    await driveTo(gate, order, "customer_cancelled");
    const consumption = await feed(gate, await statusEvent(order, "customer_cancelled"));

    if (consumption.kind !== "consumed") throw new Error("event was not consumed");
    expect(consumption.outcomes).toHaveLength(1);
    const outcome = consumption.outcomes[0]!;
    if (outcome.kind !== "recorded") throw new Error(`unexpected outcome: ${outcome.kind}`);
    expect(outcome.draft.subjectType).toBe("customer");
    expect(outcome.draft.subjectPublicId).toBe(order.customerPublicId);
    expect(outcome.draft.factKind).toBe("order_cancelled_by_customer");
    expect(outcome.scorePoints).toBe(54);
  });

  it("حلُّ إسنادٍ بالقبولِ يُسجَّل على السائقِ وحده", async () => {
    const order = await intakeOrder(gate, 9);
    const resolved = await resolveAssignment(gate, order, "accepted");
    expect(resolved.status).toBe(200);
    const consumption = await feed(gate, await assignmentEvent(order));

    if (consumption.kind !== "consumed") throw new Error("event was not consumed");
    expect(consumption.outcomes).toHaveLength(1);
    const outcome = consumption.outcomes[0]!;
    if (outcome.kind !== "recorded") throw new Error(`unexpected outcome: ${outcome.kind}`);
    expect(outcome.draft.subjectType).toBe("driver");
    expect(outcome.draft.factKind).toBe("assignment_accepted");
    expect(outcome.scorePoints).toBe(61);
  });

  it("الرفضُ حقٌّ لا مخالفة: يُسجَّل بوزنٍ صفرٍ فلا تنزل النتيجة", async () => {
    const order = await intakeOrder(gate, 10);
    const resolved = await resolveAssignment(gate, order, "rejected");
    expect(resolved.status).toBe(200);
    const consumption = await feed(gate, await assignmentEvent(order));

    if (consumption.kind !== "consumed") throw new Error("event was not consumed");
    const outcome = consumption.outcomes[0]!;
    if (outcome.kind !== "recorded") throw new Error(`unexpected outcome: ${outcome.kind}`);
    expect(outcome.draft.factKind).toBe("assignment_rejected");
    expect(outcome.scorePoints).toBe(60);
  });
});

describe("بوابة Phase 09 · صفُّ الصادرِ يُسلَّم مرّةً واحدة", () => {
  it("كلُّ واقعةٍ مُسجَّلةٍ تُنتج صفَّ صادرٍ واحداً يُسلَّم ثمّ لا يُعاد", async () => {
    const order = await intakeOrder(gate, 11);
    await driveTo(gate, order, "completed");
    const event = await statusEvent(order, "completed");

    // نُفرّغ ما تراكم من الاختبارات السابقة كي يكون العددُ عن هذا الطلبِ وحده.
    await drain(gate, 500);

    const consumption = await feed(gate, event);
    if (consumption.kind !== "consumed") throw new Error("event was not consumed");
    expect(consumption.outcomes).toHaveLength(2);

    const first = await drain(gate);
    /**
     * لا يُكتَب عددٌ كلّيٌّ بيدٍ هنا. الواقعةُ الواحدةُ تُنتج أكثرَ من حدثٍ (تسجيلُ
     * الواقعة، وإعادةُ حساب النتيجة، وتغيُّرُ الفئةِ إن تغيّرت)، وعددُ الثالثِ يتبع
     * الفئةَ السابقةَ للشخص. فتوكيدُ «6» كان سيُقاس على تفصيلٍ داخليٍّ ويسقط يومَ
     * يُضاف حدثٌ مشروع. والمقيسُ هنا ثلاثةٌ لا تتغيّر: أنّ كلَّ ما طُولب به سُلِّم،
     * وأنّ المُسلَّمَ هو نفسُه ما وصل المصرفَ، وأنّ لكلِّ جانبٍ واقعةً واحدةً بالضبط.
     */
    expect(first.report.failed).toEqual([]);
    expect(first.report.published).toBe(first.report.claimed);
    expect(first.sink.delivered).toHaveLength(first.report.claimed);
    expect(first.sink.countOfType("reputation.fact_recorded")).toBe(2);
    expect(first.sink.countOfType("reputation.score_recomputed")).toBe(2);

    // تصريفٌ ثانٍ بلا واقعةٍ جديدة: لا شيءَ يُطالَب به ولا شيءَ يُسلَّم.
    const second = await drain(gate);
    expect(second.report.claimed).toBe(0);
    expect(second.sink.delivered).toEqual([]);
  });

  it("إعادةُ تسليمِ نفسِ الحدثِ تكرارٌ مُسمّى، ولا صفَّ صادرٍ ثانياً له", async () => {
    const order = await intakeOrder(gate, 12);
    await driveTo(gate, order, "completed");
    const event = await statusEvent(order, "completed");

    await feed(gate, event);
    await drain(gate, 500);

    const replay = await feed(gate, event);
    if (replay.kind !== "consumed") throw new Error("replay was not consumed");
    expect(replay.outcomes).toHaveLength(2);
    expect(replay.outcomes.every((outcome) => outcome.kind === "duplicate")).toBe(true);

    const after = await drain(gate);
    expect(after.report.claimed).toBe(0);
    expect(after.sink.delivered).toEqual([]);
  });
});
