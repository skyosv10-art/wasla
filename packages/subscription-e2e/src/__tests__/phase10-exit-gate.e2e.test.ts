/**
 * بوابةُ خروج Phase 10 — ثلاثةُ توكيداتٍ لا يُثبتها اختبارُ خدمةٍ واحدة.
 *
 * ولمَ ثلاثةٌ فقط؟ لأنّ البوابةَ ليست نسخةً ثانيةً من 267 اختباراً؛ هي الطبقةُ التي تسأل
 * ما لا يستطيع اختبارُ خدمةٍ سؤالَه: هل يُبلَغ ما وُعد به **بالزمنِ** على قاعدةٍ حقيقيّة؟
 * وهل ما يعبر الحدَّ بين الخدمتَين هو ما يُصدره صاحبُه فعلاً؟ وهل يصمد الجوابُ المحفوظُ
 * على مُستمعٍ حقيقيٍّ لا على مِقبضٍ داخليّ؟ وكلُّ توكيدٍ زائدٍ فوق ذلك يُكرّر حارساً قائماً
 * فيصير عبئاً يُعدَّل مرّتَين.
 *
 * Related Docs: docs/12-testing/PHASE10_EXIT_GATE_E2E.md
 */
import {
  REFERRAL_QUALIFYING_FACT_COUNT,
  REFERRAL_WINDOW_DAYS,
  SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS,
  SUBSCRIPTION_LAUNCH_PLAN_CODE,
  SUBSCRIPTION_LAUNCH_PLAN_VERSION,
  SUBSCRIPTION_LAUNCH_TRIAL_DAYS,
} from "@wasla/contracts-subscription";
import { referralCodeFor } from "@wasla/subscriptions-service/app";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  callReputation,
  callSubscriptions,
  countRows,
  nextKey,
  PG_ENABLED,
  seededUuid,
  startGate,
  waslaId,
  type GateContext,
} from "../harness.js";

/** جسمُ بدءِ تجربةٍ بخطّةِ الإطلاقِ كما يُعلنها العقدُ لا كما تُقرأ من صفٍّ. */
const startBody = (driver: string, requestedAt: string) => ({
  driver_public_id: driver,
  plan_code: SUBSCRIPTION_LAUNCH_PLAN_CODE,
  plan_version: SUBSCRIPTION_LAUNCH_PLAN_VERSION,
  requested_at: requestedAt,
});

const stateOf = (body: Record<string, unknown>): Record<string, unknown> =>
  (body.subscription ?? body) as Record<string, unknown>;

describe.skipIf(!PG_ENABLED)("بوابةُ خروج Phase 10 · الاشتراكُ على قاعدةٍ حقيقيّة", () => {
  let gate: GateContext;

  beforeAll(async () => {
    gate = await startGate();
  });

  afterAll(async () => {
    await gate?.close();
  });

  it("الحالاتُ الأربعُ تُبلَغ بمضيِّ الزمنِ ونبضةٍ حقيقيّة، لا بنداءٍ يُعلن الحالة", async () => {
    const driver = waslaId(1_000_000_101);

    // 1) تجربةٌ: الحالةُ مُشتقّةٌ من مدّةٍ مصدرُها `trial`، وانتهاؤها معلومٌ من العقدِ لا من الجواب.
    const started = await callSubscriptions(gate, {
      method: "POST",
      path: "/subscriptions",
      idempotencyKey: nextKey("gate-trial"),
      body: startBody(driver, gate.clock.now()),
    });
    expect(started.status).toBe(201);
    expect(stateOf(started.body).state).toBe("trial");

    const read = await callSubscriptions(gate, {
      method: "GET",
      path: `/subscriptions/${driver}`,
    });
    expect(read.status).toBe(200);
    expect(read.body.state).toBe("trial");
    expect(read.body.is_stale).toBe(false);
    const trialSequence = read.body.state_sequence as number;

    // 2) انقضاءٌ: يومٌ واحدٌ بعد نهايةِ التجربة. والنبضةُ هي التي تُثبّت الحُكم — قبلها
    //    الصفُّ المُتحقِّق يقول `trial` وهو قديمٌ لا كاذب، ولذلك يُقرأ `is_stale`.
    gate.clock.advanceDays(SUBSCRIPTION_LAUNCH_TRIAL_DAYS + 1);
    const firstTick = await callSubscriptions(gate, {
      method: "POST",
      path: "/subscriptions/tick",
      idempotencyKey: nextKey("gate-tick-expire"),
    });
    expect(firstTick.status).toBe(200);
    expect(firstTick.body.subscriptions_expired as number).toBeGreaterThanOrEqual(1);

    const expired = await callSubscriptions(gate, {
      method: "GET",
      path: `/subscriptions/${driver}`,
    });
    expect(expired.body.state).toBe("expired");
    expect(expired.body.expires_at).toBeNull();
    expect(expired.body.state_sequence as number).toBeGreaterThan(trialSequence);

    // 3) مجتمعٌ: بعد مهلةِ المجتمع. وهي **أرضيّةٌ لا عقوبة** — والتوكيدُ على ذلك أدناه
    //    ليس تجميلاً: عمودٌ يُسمّى `is_suspended` يوماً ما يُسقط هذا السطرَ قبل الدمج.
    gate.clock.advanceDays(SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS + 1);
    const secondTick = await callSubscriptions(gate, {
      method: "POST",
      path: "/subscriptions/tick",
      idempotencyKey: nextKey("gate-tick-community"),
    });
    expect(secondTick.status).toBe(200);
    expect(secondTick.body.subscriptions_moved_to_community as number).toBeGreaterThanOrEqual(1);

    const community = await callSubscriptions(gate, {
      method: "GET",
      path: `/subscriptions/${driver}`,
    });
    expect(community.body.state).toBe("community");
    const entitlements = community.body.entitlements as { readonly entitlement_code: string }[];
    const codes = entitlements.map((entitlement) => entitlement.entitlement_code);
    expect(codes).toContain("accept_orders");
    expect(JSON.stringify(community.body)).not.toMatch(/suspend|block|ban|throttle/i);

    // 4) تفعيلٌ: الدفعُ مرجعٌ مُبهَمٌ لا مالٌ في هذا الحدّ (Phase 17 تملك المال).
    const activated = await callSubscriptions(gate, {
      method: "POST",
      path: `/subscriptions/${driver}/activate`,
      idempotencyKey: nextKey("gate-activate"),
      body: {
        payment_reference: "gate-pay-0001",
        plan_code: SUBSCRIPTION_LAUNCH_PLAN_CODE,
        plan_version: SUBSCRIPTION_LAUNCH_PLAN_VERSION,
        activated_at: gate.clock.now(),
      },
    });
    expect(activated.status).toBe(200);
    expect(stateOf(activated.body).state).toBe("active");

    // والدفترُ هو الحقيقة: أربعُ مُدَدٍ لا أربعةُ تحديثاتٍ لعمودِ حالة. مُدّتان فقط هنا
    // (تجربةٌ ودفعٌ) لأنّ `expired` و`community` **تُشتقّان** من فراغِ التغطيةِ ولا مُدّةَ
    // لهما — وهذا بيتُ القصيدِ في ADR-015 القرار 2.
    const periods = await callSubscriptions(gate, {
      method: "GET",
      path: `/subscriptions/${driver}/periods`,
    });
    const rows = periods.body.periods as { readonly source: string }[];
    expect(rows.map((row) => row.source).sort()).toEqual(["payment", "trial"]);

    // وإعادةُ الحسابِ من الدفترِ وحدَه تُعيد نفسَ الحالة: حذفُ الصفِّ المُتحقِّقِ عملٌ بلا خسارة.
    const recomputed = await callSubscriptions(gate, {
      method: "POST",
      path: `/subscriptions/${driver}/recompute`,
      idempotencyKey: nextKey("gate-recompute"),
    });
    expect(recomputed.status).toBe(200);
    expect(stateOf(recomputed.body).state).toBe("active");
  });

  it("وقائعُ محرّكِ السمعةِ تعبر الحدَّ كما أصدرها هو، وإحالةٌ دون النصابِ لا تُكافأ", async () => {
    const referrer = waslaId(1_000_000_201);
    const referee = waslaId(1_000_000_202);

    await callSubscriptions(gate, {
      method: "POST",
      path: "/subscriptions",
      idempotencyKey: nextKey("gate-ref-owner"),
      body: startBody(referrer, gate.clock.now()),
    });

    const claimed = await callSubscriptions(gate, {
      method: "POST",
      path: "/referrals",
      idempotencyKey: nextKey("gate-ref-claim"),
      body: {
        referral_code: referralCodeFor(referrer),
        referee_public_id: referee,
        claimed_at: gate.clock.now(),
      },
    });
    expect(claimed.status).toBe(201);
    const referral = claimed.body.referral as Record<string, unknown>;
    expect(referral.state).toBe("pending");
    expect(referral.qualifying_fact_count).toBe(0);
    expect(referral.reward).toBeNull();

    // وقائعٌ **دون** النصابِ بواحدة، ومُسجَّلةٌ في خدمةِ السمعةِ الحقيقيّةِ عبر مِقبضِها.
    const below = REFERRAL_QUALIFYING_FACT_COUNT - 1;
    const factIds: string[] = [];
    for (let index = 0; index < below; index += 1) {
      const recorded = await callReputation(gate, {
        method: "POST",
        path: "/reputation/facts",
        idempotencyKey: nextKey("gate-fact"),
        body: {
          subject_type: "driver",
          subject_public_id: referee,
          fact_kind: "order_completed",
          order_public_id: `ORD-${String(9_000_000_001 + index).padStart(10, "0")}`,
          source_event_type: "order.status_changed",
          source_event_id: seededUuid(index + 1),
          source_sequence: index + 1,
          actor_type: "system",
          occurred_at: gate.clock.now(),
        },
      });
      expect(recorded.status).toBe(201);
      // `id` في السلك و`fact_id` في الحدث: نفسُ القيمةِ باسمَين، والبوابةُ تربطهما
      // صراحةً كي يُقرأ الفرقُ هنا لا يُكتشف في مُتكامِل.
      factIds.push((recorded.body.fact as Record<string, unknown>).id as string);
    }

    // الحمولةُ تُقرأ من صندوقِ صادرِ السمعةِ **كما وضعها هو** ولا تُكتب هنا بيدٍ: اسمُ حقلٍ
    // يختلف بين الخدمتَين يُسقط هذا السطرَ، وهو أرخصُ موضعٍ لسقوطه.
    const emitted = gate.reputation.outbox.appended
      .map((row) => row.event)
      .filter((event) => event.event_type === "reputation.fact_recorded")
      .filter((event) =>
        factIds.includes((event.data as { readonly fact_id: string }).fact_id),
      );
    expect(emitted).toHaveLength(below);

    for (const event of emitted) {
      const outcome = await gate.facts.record(event);
      expect(outcome.verdict).toBe("counted");
    }

    // النصابُ لم يُبلَغ: الإحالةُ تبقى `pending` والعدُّ يُقرأ، ولا صفَّ مكافأةٍ في القاعدة.
    const listed = await callSubscriptions(gate, {
      method: "GET",
      path: `/referrals?referee_public_id=${referee}`,
    });
    expect(listed.status).toBe(200);
    const referrals = listed.body.referrals as Record<string, unknown>[];
    expect(referrals).toHaveLength(1);
    expect(referrals[0]!.state).toBe("pending");
    expect(referrals[0]!.qualifying_fact_count).toBe(below);
    expect(await countRows(gate.pool, "referral_rewards")).toBe(0);

    // والنافذةُ مُعلَنةٌ في الجوابِ لا مُستنتَجة — قيمتُها من حزمةِ العقدِ لا من حسابٍ ثانٍ هنا.
    expect(typeof referrals[0]!.window_ends_at).toBe("string");
    expect(REFERRAL_WINDOW_DAYS).toBeGreaterThan(0);

    // وإعادةُ نفسِ الحمولةِ لا تُعدّ ثانيةً: مفتاحُ الواقعةِ `fact:<fact_id>` يحرسها.
    const replayed = await gate.facts.record(emitted[0]!);
    expect(replayed.verdict).toBe("duplicate");
    const after = await callSubscriptions(gate, {
      method: "GET",
      path: `/referrals?referee_public_id=${referee}`,
    });
    expect((after.body.referrals as Record<string, unknown>[])[0]!.qualifying_fact_count).toBe(
      below,
    );
  });

  it("مفتاحٌ مُعادٌ على مُستمعٍ حقيقيٍّ يُعيد نفسَ البايتاتِ ولا يمنح مُدّةً ثانية", async () => {
    const driver = waslaId(1_000_000_301);
    const key = nextKey("gate-idem");
    const body = startBody(driver, gate.clock.now());

    const first = await callSubscriptions(gate, {
      method: "POST",
      path: "/subscriptions",
      idempotencyKey: key,
      body,
    });
    expect(first.status).toBe(201);
    const periods = await countRows(gate.pool, "subscription_periods");
    const outbox = await countRows(gate.pool, "subscription_outbox");

    const replay = await callSubscriptions(gate, {
      method: "POST",
      path: "/subscriptions",
      idempotencyKey: key,
      body,
    });
    // `201` المحفوظةُ لا `200`: الجوابُ يُعاد كما كان، ولا يُعاد بناؤه بحكمٍ جديد.
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(await countRows(gate.pool, "subscription_periods")).toBe(periods);
    expect(await countRows(gate.pool, "subscription_outbox")).toBe(outbox);

    // ونفسُ المفتاحِ لجسمٍ آخرَ تعارضٌ مُسمّىً لا كتابةٌ صامتة.
    const reused = await callSubscriptions(gate, {
      method: "POST",
      path: "/subscriptions",
      idempotencyKey: key,
      body: startBody(waslaId(1_000_000_302), gate.clock.now()),
    });
    expect(reused.status).toBe(409);
    expect((reused.body.error as Record<string, unknown>).code).toBe(
      "SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED",
    );
  });
});
