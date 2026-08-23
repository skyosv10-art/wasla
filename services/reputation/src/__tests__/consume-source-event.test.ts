/**
 * استهلاكُ حدثٍ من محرّك الطلب من طرفه إلى طرفه — على مخازن الذاكرة.
 *
 * الملفُّ السابق (`inbound-translate.test.ts`) يفحص الترجمةَ نقيّةً بلا مخزن. وهذا
 * الملفُّ يفحص ما لا تراه الترجمة: **ماذا يبقى في الدفتر بعد أن يمرّ الحدث**، وماذا يبقى
 * فيه إذا مرّ الحدثُ مرّتين، وماذا يحدث حين ترفض واقعةٌ من واقعتين.
 *
 * ## السؤالُ الذي يحكم هذا الملفّ
 *
 * «هل يُستهلَك الحدثُ أم يُعاد تسليمُه؟» — والعقدُ سطرٌ واحد: رجوعٌ عاديٌّ يعني استُهلك،
 * ورفعُ خطأٍ يعني أعِد التسليم. وكلُّ اختبارٍ هنا يُثبّت أحدَ طرفي هذا السطر، لأنّ خلطَهما
 * يُنتج أحدَ عطلين لا ثالثَ لهما: حدثٌ صحيحٌ يُعاد تسليمُه إلى الأبد فيُغرق الطابور، أو
 * عطلُ اتصالٍ يُبلَع فتُفقَد واقعةٌ بلا أثر.
 *
 * Scope: خدمة السمعة · مستهلكُ أحداث محرّك الطلب
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: src/inbound/consume-source-event.ts
 * Related Team: Reputation & Trust
 */

import { describe, expect, it } from "vitest";

import { LAUNCH_RULESET_VERSION, SEEDED_RULESETS } from "../domain/ruleset.js";
import { consumeSourceEvent } from "../inbound/consume-source-event.js";
import {
  createInMemoryReputationDependencies,
  type InMemoryReputationDependencies,
} from "../infrastructure/in-memory.js";
import type { ReputationDependencies } from "../ports.js";
import type { ReputationRunner } from "../runner.js";

/**
 * نقطةُ البداية تُقرأ من النسخة المزروعة لا تُكتب رقماً في الاختبار.
 *
 * نتيجةُ من لا واقعةَ له = `startingScore` بالضبط، والواقعةُ تُضاف إليها. ورقمٌ مكتوبٌ
 * بيدنا هنا (63) كان سيسقط يومَ تُغيَّر نقطةُ البداية في النسخة — فيُقرأ الفشلُ عطلَ
 * اختبارٍ لا قراراً تغيّر، ويُصلَّح بتعديل الرقم بلا أن يسأل أحدٌ عن الأثر.
 */
const LAUNCH = SEEDED_RULESETS.find((ruleset) => ruleset.rulesetVersion === LAUNCH_RULESET_VERSION);
if (LAUNCH === undefined) throw new Error("نسخةُ الانطلاق غير مزروعة");
const START = LAUNCH.startingScore;

const ORDER = "ORD-0000000123";
const CUSTOMER = "WS-0000000001";
const DRIVER = "WS-0000000002";

/**
 * مُشغّلٌ مباشرٌ مكتوبٌ هنا لا مستوردٌ من `runner.ts`.
 *
 * و`runner.ts` يستورد `PostgresReputationUnitOfWork` **قيمةً لا نوعاً**، فاستيرادُ
 * `createDirectReputationRunner` منه كان سيجرّ `pg` إلى اختبارٍ لا قاعدةَ له — وهو نفسُ
 * السببِ الذي يمنع `index.ts` من تصدير `runner.js` (`purity.test.ts`).
 */
function directRunner(deps: ReputationDependencies): ReputationRunner {
  return {
    async write<T>(work: (d: ReputationDependencies) => Promise<T>): Promise<T> {
      return work(deps);
    },
    async read<T>(work: (d: ReputationDependencies) => Promise<T>): Promise<T> {
      return work(deps);
    },
  };
}

function setup(): { deps: InMemoryReputationDependencies; runner: ReputationRunner } {
  const deps = createInMemoryReputationDependencies({ startAt: "2026-03-01T09:00:00.000Z" });
  return { deps, runner: directRunner(deps) };
}

function completedOrder(overrides: Record<string, unknown> = {}): unknown {
  return {
    event_id: "6f1a0f7e-9d0c-4f2a-9b3e-1c2d3e4f5a6b",
    event_type: "order.status_changed",
    event_version: "v1",
    occurred_at: "2026-03-01T08:00:00.000Z",
    trace_id: "trace-consume-1",
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

describe("الطلبُ المكتمل: واقعتان في الدفتر ونتيجتان محسوبتان", () => {
  it("يُسجّل +3 للعميل و+4 للسائق بأوزان `saudi-launch-v1`", async () => {
    /**
     * الأوزانُ ليست تفصيلاً في اختبارٍ آخر: هي بعينها ما يجعل الاستهلاكَ ذا معنى. ولو
     * سُجّلت الواقعتان بلا أن تُحتسب النتيجة لكان الدفترُ صحيحاً والسمعةُ صفراً — وذاك
     * عطلٌ لا يُظهره أيُّ سجلّ لأنّ كلَّ نداءٍ «نجح».
     */
    const { runner } = setup();
    const result = await consumeSourceEvent(runner, completedOrder());
    if (result.kind !== "consumed") expect.unreachable("توقّعنا استهلاكاً");

    expect(result.ignored).toEqual([]);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]).toMatchObject({
      kind: "recorded",
      scorePoints: START + 3,
      draft: { subjectType: "customer", subjectPublicId: CUSTOMER },
    });
    expect(result.outcomes[1]).toMatchObject({
      kind: "recorded",
      scorePoints: START + 4,
      draft: { subjectType: "driver", subjectPublicId: DRIVER },
    });
  });

  it("والرتبةُ `new` لأنّ الحدَّ الأدنى خمسُ وقائع لم يُبلَغ", async () => {
    /**
     * `min_facts = 5` في النسخة، فواقعةٌ واحدةٌ لا تُرقّي أحداً. وهذا السطرُ يحمي قراراً
     * أخلاقيّاً في القاعدة الحاكمة: رتبةٌ تُمنَح من واقعةٍ واحدةٍ تُنتج «موثوقاً» بعد
     * أوّلِ طلبٍ ناجح، وذاك حكمٌ على الناس بلا دليلٍ كافٍ.
     */
    const { runner } = setup();
    const result = await consumeSourceEvent(runner, completedOrder());
    if (result.kind !== "consumed") expect.unreachable("توقّعنا استهلاكاً");
    for (const outcome of result.outcomes) {
      expect(outcome).toMatchObject({ kind: "recorded", tier: "new" });
    }
  });

  it("ومُعرّفُ التتبّع يعبُر إلى حدثِ الصندوق بلا توليدٍ جديد", async () => {
    /**
     * HANDOFF §16-ي البند 4، وهذا آخرُ موضعٍ يمكن قياسُه فيه داخل الخدمة: من الحدث
     * الوارد إلى الواقعة إلى الحدث الصادر. وتوليدُ مُعرّفٍ عند كلِّ حدٍّ كان يجعل تتبُّعَ
     * طلبٍ واحدٍ ثلاثةَ تتبّعاتٍ لا تلتقي في أيِّ لوحة.
     */
    const { deps, runner } = setup();
    await consumeSourceEvent(runner, completedOrder());
    expect(deps.outbox.appended.length).toBeGreaterThan(0);
    for (const entry of deps.outbox.appended) {
      expect(entry.event.trace_id).toBe("trace-consume-1");
    }
  });
});

describe("إعادةُ التسليم: لا واقعةَ ثانية", () => {
  it("نفسُ الحدث مرّتين يُنتج `duplicate` بنفس مُعرّفِ الواقعة", async () => {
    /**
     * الحمايةُ من `ux_reputation_facts_source` لا من `if` في المستهلك، ولذلك يُفحَص
     * **مُعرّفُ الواقعة** لا مجرّدُ نوعِ النتيجة: مُعرّفٌ مختلفٌ كان يعني واقعةً ثانيةً
     * كُتبت فعلاً ثمّ سُمّيت تكراراً.
     */
    const { runner } = setup();
    const first = await consumeSourceEvent(runner, completedOrder());
    const second = await consumeSourceEvent(runner, completedOrder());
    if (first.kind !== "consumed" || second.kind !== "consumed") {
      expect.unreachable("توقّعنا استهلاكاً في المرّتين");
    }

    /**
     * `factId` لا يوجد على فرع `rejected`، ولذلك يُضيَّق النوعُ صريحاً قبل قراءته: قراءةٌ
     * بـ`as` كانت ستُخفي يومَ يتحوّل التكرارُ رفضاً — وهو بعينه ما نقيسه هنا.
     */
    const ids = (outcomes: typeof first.outcomes): readonly (string | null)[] =>
      outcomes.map((outcome) => (outcome.kind === "rejected" ? null : outcome.factId));

    expect(second.outcomes.map((outcome) => outcome.kind)).toEqual(["duplicate", "duplicate"]);
    expect(ids(second.outcomes)).toEqual(ids(first.outcomes));
    expect(ids(second.outcomes).every((id) => typeof id === "string")).toBe(true);
  });

  it("ولا نتيجةَ تُحتسب مرّتين: النقاطُ تبقى كما هي", async () => {
    /**
     * أخطرُ عطلٍ ممكنٍ في هذا المسار: تكرارٌ يُكتشف في الدفتر لكنّ النتيجةَ تُحدَّث مرّةً
     * ثانية، فتصير سمعةُ من أكمل طلباً واحداً ستّ نقاطٍ لأنّ الناقلَ أعاد التسليم. ولذلك
     * تُقرأ النتيجةُ من المخزن بعد المرّتين لا من جوابِ النداء.
     */
    const { deps, runner } = setup();
    await consumeSourceEvent(runner, completedOrder());
    await consumeSourceEvent(runner, completedOrder());
    const score = await deps.scores.find("customer", CUSTOMER);
    expect(score?.scorePoints).toBe(START + 3);
    expect(score?.factCount).toBe(1);
  });
});

describe("الرفضُ المُسمّى يُجمَع ولا يُرفَع", () => {
  it("وزنٌ غائبٌ لجانبٍ واحدٍ لا يُبطل الجانبَ الآخر", async () => {
    /**
     * `order_cancelled_by_customer` لها وزنٌ للعميل ولا وزنَ للسائق — قرارٌ مقصودٌ في
     * النسخة. والترجمةُ لا تُنتج مسوّدةَ سائقٍ لهذه الحالة أصلاً، فالمقياسُ هنا أنّ
     * الاستهلاكَ يمضي ويُسجّل واقعةَ العميل ولا يرفع شيئاً.
     */
    const { runner } = setup();
    const result = await consumeSourceEvent(
      runner,
      completedOrder({ to_status: "customer_cancelled" }),
    );
    if (result.kind !== "consumed") expect.unreachable("توقّعنا استهلاكاً");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      kind: "recorded",
      scorePoints: START - 6,
      draft: { subjectType: "customer", factKind: "order_cancelled_by_customer" },
    });
  });

  it("وحدثٌ متأخّرٌ (تسلسلٌ أقدم) يُردّ رفضاً مُسمّى ولا يُعاد تسليمُه", async () => {
    /**
     * حرسُ التأخّر يُرفَض `422`، وهو قرارٌ مستقرٌّ لن يتغيّر بمحاولةٍ ثانية. ورفعُه إلى
     * الناقل كان سيُنتج حلقةً لا تنتهي على حدثٍ واحدٍ فتُغرق الطابورَ وتُؤخّر الصحيح —
     * ولذلك يُجمَع في `outcomes` ويُرجَع عاديّاً.
     */
    const { runner } = setup();
    await consumeSourceEvent(runner, completedOrder({ sequence: 9 }));
    const stale = await consumeSourceEvent(
      runner,
      completedOrder({
        sequence: 4,
        to_status: "customer_cancelled",
      }),
    );
    if (stale.kind !== "consumed") expect.unreachable("توقّعنا استهلاكاً");
    expect(stale.outcomes).toHaveLength(1);
    const outcome = stale.outcomes[0];
    expect(outcome?.kind).toBe("rejected");
    if (outcome?.kind !== "rejected") return;
    expect(outcome.errorCode).toBe("REPUTATION_SOURCE_EVENT_STALE");
    /** رمزُه 422 لا 409: رفضُ حمولةٍ لا تعارضُ حالة — يُثبَّت هنا لا يُفترَض. */
    expect(outcome.httpStatus).toBe(422);
  });
});

describe("ما لا يُستهلَك", () => {
  it("نوعٌ لا يعنينا يُردّ `unsupported` بلا لمسِ الدفتر", async () => {
    const { deps, runner } = setup();
    const result = await consumeSourceEvent(runner, {
      event_type: "order.assignment_offered",
      data: {},
    });
    expect(result).toEqual({ kind: "unsupported", eventType: "order.assignment_offered" });
    expect(deps.outbox.appended).toEqual([]);
  });

  it("وحالةٌ لا تعني السمعةَ تُستهلَك بسببٍ مُسمّى ولا وقائع", async () => {
    /**
     * «استُهلك ولا واقعة» حالةٌ سليمةٌ لا عطل: معظمُ أحداث المحرّك مراحلُ رحلةٍ لا وقائعُ
     * سلوك. والفرقُ عن `unsupported` أنّ الحدثَ يعنينا ونوعُه صحيحٌ، ولذلك يُعَدّ سببُ
     * الإهمال في لوحةٍ بدل أن يُطرَح مع أحداث الخدمات الأخرى.
     */
    const { deps, runner } = setup();
    const result = await consumeSourceEvent(runner, completedOrder({ to_status: "arrived" }));
    if (result.kind !== "consumed") expect.unreachable("توقّعنا استهلاكاً");
    expect(result.outcomes).toEqual([]);
    expect(result.ignored).toEqual(["status_not_reputable"]);
    expect(deps.outbox.appended).toEqual([]);
  });

  it("وحمولةٌ غيرُ صالحةٍ تُرفَع خطأً — لا تُبلَع ولا تُعَدّ مُستهلَكة", async () => {
    /**
     * الطرفُ الآخر من العقد. حمولةٌ فاسدةٌ تُرجَع «استُهلكت» كانت ستُسقط الحدثَ من الطابور
     * بلا أن يُسجَّل شيءٌ ولا أن يشتكي أحد — وهو أسوأُ من إعادةِ تسليمٍ فاشلةٍ تُقرأ في
     * السجلّ. ورفعُ الخطأ هنا يترك القرارَ لمن يربط الناقل: طابورُ موتى أو تنبيه.
     */
    const { runner } = setup();
    await expect(
      consumeSourceEvent(runner, completedOrder({ order_public_id: "ORD-x" })),
    ).rejects.toThrow();
  });
});
