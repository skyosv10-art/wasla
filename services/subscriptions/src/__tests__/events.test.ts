/**
 * أحداثُ الخدمةِ الستّة: **الشكلُ على السلك، وبصمةُ الطلب، وقراءةُ واقعةٍ غيرِ موثوقة**.
 *
 * لا قاعدةَ في هذا الملفّ: كلُّ ما يُقاس هنا نقيٌّ، ولذلك يُقاس بمساواةٍ **تامّة** على الكائن
 * كلِّه لا بفحصِ حقلٍ حقلاً. والفرقُ جوهريّ: حمولاتُ العقدِ `additionalProperties: false`،
 * فحقلٌ زائدٌ يُفشل مستهلكاً صارماً — و`toHaveProperty` كان سيمرّ عليه بهدوء.
 */

import { describe, expect, it } from "vitest";

import {
  REFERRAL_PUBLISHED_STATES,
  SUBSCRIPTION_AGGREGATE_TYPES,
  SUBSCRIPTION_EVENT_TYPES,
  activated,
  expired,
  movedToCommunity,
  referralQualified,
  referralRewarded,
  trialStarted,
} from "../domain/events.js";
import {
  EventPayloadIncompleteError,
  sequentialIdGenerator,
  toOutboxDraft,
  transitionEvent,
} from "../app/events.js";
import { fingerprint } from "../app/idempotency.js";
import { CONSUMED_EVENT_TYPE, parseReputationFact } from "../app/facts.js";
import type { TransitionRecord } from "../db/repository.js";

const META = { eventId: "evt-1", occurredAt: "2026-08-24T10:00:00.000Z", traceId: "req-7" } as const;

const TRANSITION_INPUT = {
  meta: META,
  driverPublicId: "WS-0123456789",
  subscriptionId: "11111111-1111-4111-8111-111111111111",
  fromState: null,
  toState: "trial",
  reasonCode: "trial_granted",
  stateSequence: 1,
  planCode: "saudi-driver-monthly",
  planVersion: 1,
  periodId: "22222222-2222-4222-8222-222222222222",
  expiresAt: "2026-09-07T10:00:00.000Z",
  transitionOccurredAt: "2026-08-24T09:00:00.000Z",
} as const;

describe("مغلَّفُ الحدثِ وحمولتُه", () => {
  it("بدءُ التجربة: الحمولةُ كاملةٌ بحقولٍ معدودةٍ ولا حقلَ زائدٍ واحد", () => {
    expect(trialStarted(TRANSITION_INPUT)).toEqual({
      event_id: "evt-1",
      event_type: "subscription.trial_started",
      event_version: "v1",
      occurred_at: "2026-08-24T10:00:00.000Z",
      producer: "subscriptions-service",
      aggregate: { type: "subscription", id: "11111111-1111-4111-8111-111111111111" },
      trace_id: "req-7",
      data: {
        driver_public_id: "WS-0123456789",
        subscription_id: "11111111-1111-4111-8111-111111111111",
        from_state: null,
        to_state: "trial",
        reason_code: "trial_granted",
        state_sequence: 1,
        plan_code: "saudi-driver-monthly",
        plan_version: 1,
        period_id: "22222222-2222-4222-8222-222222222222",
        expires_at: "2026-09-07T10:00:00.000Z",
        occurred_for: "2026-08-24T09:00:00.000Z",
      },
    });
  });

  it("`occurred_for` لحظةُ وقوعِ الانتقالِ لا لحظةُ إصدارِ الحدث — وهذا هو الفرقُ الذي يُخفيه التبسيط", () => {
    const event = expired({
      ...TRANSITION_INPUT,
      toState: "expired",
      reasonCode: "period_ended",
      transitionOccurredAt: "2026-08-20T03:00:00.000Z",
      meta: { ...META, occurredAt: "2026-08-24T03:10:00.000Z" },
    });
    expect(event.data.occurred_for).toBe("2026-08-20T03:00:00.000Z");
    expect(event.occurred_at).toBe("2026-08-24T03:10:00.000Z");
  });

  it("أثرُ الطلبِ يُنقَل كما هو، و`null` صريحةٌ حين لا أثرَ — لا حقلٌ غائب", () => {
    const event = movedToCommunity({
      ...TRANSITION_INPUT,
      toState: "community",
      reasonCode: "community_grace_ended",
      meta: { eventId: "evt-9", occurredAt: META.occurredAt },
    });
    expect(event.trace_id).toBeNull();
    expect(Object.keys(event)).toContain("trace_id");
  });

  it("التفعيلُ يحمل مصدرَ المُدّةِ وأيّامَها ومرجعَ الدفع، ولا مبلغَ ولا عملة", () => {
    const event = activated({
      ...TRANSITION_INPUT,
      fromState: "trial",
      toState: "active",
      reasonCode: "payment_activated",
      stateSequence: 2,
      expiresAt: "2026-10-07T10:00:00.000Z",
      periodSource: "payment",
      grantedDays: 30,
      paymentReference: "PAY-118",
    });
    expect(event.data).toEqual({
      driver_public_id: "WS-0123456789",
      subscription_id: "11111111-1111-4111-8111-111111111111",
      from_state: "trial",
      to_state: "active",
      reason_code: "payment_activated",
      state_sequence: 2,
      plan_code: "saudi-driver-monthly",
      plan_version: 1,
      period_id: "22222222-2222-4222-8222-222222222222",
      expires_at: "2026-10-07T10:00:00.000Z",
      occurred_for: "2026-08-24T09:00:00.000Z",
      period_source: "payment",
      granted_days: 30,
      payment_reference: "PAY-118",
    });
    const wire = JSON.stringify(event);
    for (const forbidden of ["amount", "currency", "sar", "price"]) {
      expect(wire.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("مكافأةُ الإحالة تُعلن مُدّةً مُنحت فعلاً — ولا كلمةَ رصيدٍ أو محفظةٍ في الحمولة", () => {
    const event = referralRewarded({
      meta: META,
      referralId: "33333333-3333-4333-8333-333333333333",
      rewardId: "44444444-4444-4444-8444-444444444444",
      beneficiaryPublicId: "WS-0123456789",
      grantedPeriodId: "55555555-5555-4555-8555-555555555555",
      rewardDays: 30,
      planCode: "saudi-driver-monthly",
      planVersion: 1,
      rewardedAt: "2026-08-24T09:30:00.000Z",
    });
    expect(event.aggregate).toEqual({ type: "referral", id: "33333333-3333-4333-8333-333333333333" });
    expect(event.data.granted_period_id).toBe("55555555-5555-4555-8555-555555555555");
    const wire = JSON.stringify(event).toLowerCase();
    for (const forbidden of ["balance", "credit", "wallet", "point"]) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it("التأهّلُ يُنشَر مع عتبتِه: العدُّ المطلوبُ من نسخةِ الخطّةِ لا من إعدادِ مستهلك", () => {
    const event = referralQualified({
      meta: META,
      referralId: "33333333-3333-4333-8333-333333333333",
      referralCode: "WSL-ABC123",
      referrerPublicId: "WS-0123456789",
      refereePublicId: "WS-9876543210",
      qualifyingFactCount: 5,
      requiredFactCount: 5,
      planCode: "saudi-driver-monthly",
      planVersion: 1,
      qualifiedAt: "2026-08-24T09:45:00.000Z",
    });
    expect(event.data.required_fact_count).toBe(5);
    expect(event.data.occurred_for).toBe("2026-08-24T09:45:00.000Z");
  });

  it("الأنواعُ الستّةُ وحدَها، وتجميعتان لا ثالثة، والرفضُ ليس حالةً تُنشَر", () => {
    expect([...SUBSCRIPTION_EVENT_TYPES]).toEqual([
      "subscription.trial_started",
      "subscription.activated",
      "subscription.expired",
      "subscription.moved_to_community",
      "referral.qualified",
      "referral.rewarded",
    ]);
    expect([...SUBSCRIPTION_AGGREGATE_TYPES]).toEqual(["subscription", "referral"]);
    expect([...REFERRAL_PUBLISHED_STATES]).toEqual(["qualified", "rewarded"]);
    expect(REFERRAL_PUBLISHED_STATES).not.toContain("rejected");
  });
});

describe("من حدثٍ إلى صفٍّ صادر", () => {
  it("الحمولةُ المحفوظةُ هي المغلَّفُ كاملاً، والأعمدةُ مُشتَقّةٌ منه لا مُخترَعة", () => {
    const event = trialStarted(TRANSITION_INPUT);
    expect(toOutboxDraft(event)).toEqual({
      eventId: "evt-1",
      eventType: "subscription.trial_started",
      aggregateType: "subscription",
      aggregateId: "11111111-1111-4111-8111-111111111111",
      payload: event,
      occurredAt: "2026-08-24T10:00:00.000Z",
      traceId: "req-7",
    });
  });

  it("مُعرِّفُ الحدثِ في الحمولةِ **هو** مفتاحُ الصفّ — ولا نسختان له", () => {
    const draft = toOutboxDraft(trialStarted(TRANSITION_INPUT));
    const payload = draft.payload as { readonly event_id: string };
    expect(payload.event_id).toBe(draft.eventId);
  });
});

describe("بناءُ حدثٍ من صفِّ انتقال", () => {
  const transition: TransitionRecord = {
    transitionId: "66666666-6666-4666-8666-666666666666",
    driverPublicId: "WS-0123456789",
    fromState: "expired",
    toState: "active",
    reasonCode: "payment_activated",
    periodId: "22222222-2222-4222-8222-222222222222",
    sequence: 4,
    occurredAt: "2026-08-24T09:00:00.000Z",
  };

  const governing = {
    periodId: "22222222-2222-4222-8222-222222222222",
    driverPublicId: "WS-0123456789",
    planCode: "saudi-driver-monthly",
    planVersion: 1,
    source: "payment",
    paymentReference: "PAY-118",
    grantedDays: 30,
    startsAt: "2026-08-24T09:00:00.000Z",
    endsAt: "2026-09-23T09:00:00.000Z",
  } as const;

  it("كلُّ حالةٍ تُنتج نوعَها، والتسلسلُ من الصفِّ لا من عدّادٍ في الكود", () => {
    const event = transitionEvent(transition, {
      meta: META,
      subscriptionId: "11111111-1111-4111-8111-111111111111",
      planCode: "saudi-driver-monthly",
      planVersion: 1,
      expiresAt: "2026-09-23T09:00:00.000Z",
      governing,
    });
    expect(event.event_type).toBe("subscription.activated");
    // الحمولةُ اتّحادٌ لأنّ الدالّةَ تُنتج ستّةَ أنواع؛ والتضييقُ بالنوعِ لا بـ`as any`:
    // `as any` كان سيُخفي يومَ يُحذف حقلٌ من الحمولةِ أنّ الاختبارَ يقرأ ما لم يبقَ.
    const data = event.data as { readonly state_sequence: number; readonly from_state: string | null };
    expect(data.state_sequence).toBe(4);
    expect(data.from_state).toBe("expired");
  });

  it("تفعيلٌ بلا مُدّةٍ حاكمةٍ يُرفَض صريحاً — ولا يُبنى حدثٌ بصفرِ أيّام", () => {
    expect(() =>
      transitionEvent(transition, {
        meta: META,
        subscriptionId: "11111111-1111-4111-8111-111111111111",
        planCode: "saudi-driver-monthly",
        planVersion: 1,
        expiresAt: "2026-09-23T09:00:00.000Z",
        governing: null,
      }),
    ).toThrow(EventPayloadIncompleteError);
  });

  it("تفعيلٌ بلا نهايةٍ يُرفَض: حدثٌ يقول «سارٍ» بلا انقضاءٍ يُغري بافتراضِ دوام", () => {
    expect(() =>
      transitionEvent(transition, {
        meta: META,
        subscriptionId: "11111111-1111-4111-8111-111111111111",
        planCode: "saudi-driver-monthly",
        planVersion: 1,
        expiresAt: null,
        governing,
      }),
    ).toThrow(EventPayloadIncompleteError);
  });
});

describe("مُوَلِّدُ المُعرِّفاتِ التسلسليّ", () => {
  it("يُعطي مُعرِّفاً جديداً في كلّ نداءٍ ولا يُعيد نفسَه", () => {
    const ids = sequentialIdGenerator("evt-");
    expect([ids.next(), ids.next(), ids.next()]).toEqual(["evt-1", "evt-2", "evt-3"]);
  });
});

describe("بصمةُ الطلب", () => {
  it("ترتيبُ المفاتيحِ لا يُغيّر البصمة — وإلّا رُفضت إعادةُ إرسالٍ سليمة", () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("تغيّرُ قيمةٍ واحدةٍ يُغيّر البصمة — وإلّا مرّ مُدخلٌ آخرُ بمفتاحٍ مستعمَل", () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it("الطولُ أربعٌ وستّون حرفاً سِتّةَ عشرَ أساساً — نفسُ حرسِ العمود", () => {
    expect(fingerprint({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ترتيبُ عناصرِ المصفوفةِ **يُغيّر** البصمة: القائمةُ معنىً لا مجموعة", () => {
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });
});

describe("قراءةُ واقعةِ سمعةٍ غيرِ موثوقة", () => {
  const payload = {
    event_id: "fact-evt-1",
    event_type: CONSUMED_EVENT_TYPE,
    trace_id: "req-9",
    data: {
      fact_id: "77777777-7777-4777-8777-777777777777",
      subject_type: "driver",
      subject_public_id: "WS-9876543210",
      fact_kind: "order_completed",
      order_public_id: "WO-1",
      occurred_for: "2026-08-24T08:00:00.000Z",
      source_sequence: 12,
    },
  };

  it("تُقرأ الحقولُ المطلوبةُ ويُتجاهَل الزائدُ: عقدُ المُنتِجِ يتطوّر ولا يكسرنا", () => {
    const event = parseReputationFact(payload);
    expect(event.data.fact_id).toBe("77777777-7777-4777-8777-777777777777");
    expect(event.data).not.toHaveProperty("source_sequence");
  });

  it("نوعٌ آخرُ يُرفَض صريحاً: اشتراكٌ خاطئٌ عطبُ ربطٍ لا واقعةٌ تُهمَل", () => {
    expect(() => parseReputationFact({ ...payload, event_type: "reputation.score_recomputed" })).toThrow();
  });

  it("حمولةٌ مشوّهةٌ تُرفَض بالاسمِ ولا تنفجر في منتصفِ معاملة", () => {
    expect(() => parseReputationFact(null)).toThrow();
    expect(() => parseReputationFact({ event_id: "x", event_type: CONSUMED_EVENT_TYPE })).toThrow();
    expect(() =>
      parseReputationFact({ ...payload, data: { ...payload.data, fact_id: "" } }),
    ).toThrow();
  });

  it("غيابُ الأثرِ يصير `null` لا `undefined`: العمودُ يقبل الفراغَ ولا يقبل الغياب", () => {
    const { trace_id: _omitted, ...withoutTrace } = payload;
    expect(parseReputationFact(withoutTrace).trace_id).toBeNull();
  });
});
