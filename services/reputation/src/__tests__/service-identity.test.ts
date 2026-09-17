/**
 * إثباتُ الفرضِ على **حدِّ السمعة** (`M1-04` · الموجةُ الحاديةَ عشرةَ · `CLM-0199`).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ** أو بتوقيعٍ صريحٍ مُخالِفٍ؛
 * فبقيّةُ اختباراتِ HTTP يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها
 * لأُثبِتَ **السندُ** لا الحدُّ. وهذا هوَ الفرقُ بينَ اختبارٍ يطمئنُ واختبارٍ
 * يشهدُ.
 *
 * المصفوفةُ المطلوبةُ (ADR-020 · ADR-021): لا هويّةَ → 401 · منتحلةٌ → 401 ·
 * صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403 · بلا مُنتَفِعٍ → 403 · مسارٌ مجهولٌ →
 * 401 قبلَ 404 · و`/health` مفتوحٌ بقصدٍ مكتوبٍ.
 *
 * **وما يخصُّ هذا الحدَّ وحدَهُ:** مُنتَفِعٌ في الرمزِ يخالفُ `:subjectPublicId`
 * في المسارِ → **404 لا 403** (ADR-009).
 */

import {
  ServiceTokenReplayStoreUnavailableError,
  serviceAuthHeaders,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createReputationApp } from "../http/app.js";
import { REPUTATION_SCOPES } from "../http/service-identity.js";
import { createDirectReputationRunner } from "../runner.js";
import { recordFact } from "../use-cases/record-fact.js";

import { deps, CUSTOMER, DRIVER, factDraft, T0 } from "./helpers.js";
import {
  ALL_REPUTATION_SCOPES,
  buildSignedReputationApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";

/** رمزُ الرفضِ بلا سابقةِ `REPUTATION_` — مفرداتُ ADR-020 لا مفرداتُ خدمةٍ. */
const UNAUTHENTICATED = "AUTHN_UNAUTHENTICATED";

const SCORE_URL = `/reputation/scores/customer/${CUSTOMER}`;

/** سندٌ بنتيجةٍ مزروعةٍ: كي يكونَ جوابُ العبورِ 200 لا 404 فيُقاسَ العبورُ. */
async function harnessApp() {
  const dependencies = deps();
  // Seed a fact so a score exists for CUSTOMER — the beneficiary check can then
  // reach the domain (200, not 404) and the enforcement proof is about identity,
  // not about whether data exists.
  const runner = createDirectReputationRunner(dependencies);
  await runner.write(async (depsRunner) => {
    await recordFact(depsRunner, {
      draft: factDraft({
        subjectType: "customer",
        subjectPublicId: CUSTOMER,
        factKind: "order_completed",
        orderPublicId: "ORD-0000000001",
        sourceEventId: "seed-event-1",
        sourceSequence: 1,
        occurredAt: T0,
      }),
    });
  });
  return buildSignedReputationApp({ runner });
}

/** تطبيقٌ بمخزنِ آثارٍ يُقرِّرُهُ الاختبارُ — لإثباتِ الإغلاقِ عندَ العجزِ. */
async function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const dependencies = deps();
  const runner = createDirectReputationRunner(dependencies);
  await runner.write(async (depsRunner) => {
    await recordFact(depsRunner, {
      draft: factDraft({
        subjectType: "customer",
        subjectPublicId: CUSTOMER,
        factKind: "order_completed",
        orderPublicId: "ORD-0000000001",
        sourceEventId: "seed-event-1",
        sourceSequence: 1,
        occurredAt: T0,
      }),
    });
  });
  const keys = createTestKeyRegistry();
  const app = createReputationApp({
    runner,
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

describe("حد السمعة — مصفوفة المصادقة الداخلة", () => {
  it("لا هوية → 401 بمغلف عقد السمعة (error.code مُعشَّش) ولا يُسمّى سبب الرفض", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({ method: "GET", url: SCORE_URL });

    expect(response.statusCode).toBe(401);
    const body = response.json() as Record<string, unknown>;
    // شكلُ العقدِ المنشورِ لهذا الحدِّ: `error.code` **مُعشَّشٌ** و`trace_id`.
    expect(body.error).toBeDefined();
    expect((body.error as Record<string, unknown>).code).toBe(UNAUTHENTICATED);
    expect(body.trace_id).toBeTruthy();
    expect(String((body.error as Record<string, unknown>).message)).not.toMatch(
      /توقيع|منته|kid|صلاحي|جمهور/u,
    );
    await app.close();
  });

  it("هوية منتحلة بسر آخر → 401 لا 403 ولا 500", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: SCORE_URL,
      headers: signFor("GET", SCORE_URL, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز منتهٍ → 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: SCORE_URL,
      headers: signFor("GET", SCORE_URL, { keys, now: new Date(Date.now() - 3_600_000) }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("جمهور آخر → 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const headers = serviceAuthHeaders({
      serviceName: "orders",
      audience: "orders",
      method: "GET",
      path: SCORE_URL,
      keys,
      now: new Date(),
      scopes: ALL_REPUTATION_SCOPES,
      onBehalfOfPublicId: CUSTOMER,
    });
    const response = await rawInject({ method: "GET", url: SCORE_URL, headers });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز موقَّع لمسار آخر → 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: SCORE_URL,
      headers: signFor("GET", `/reputation/scores/driver/${DRIVER}`, { keys }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("هوية صحيحة بالصلاحية والمُنتَفِع → يعبر الطلب إلى المجال (200)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: SCORE_URL,
      headers: signFor("GET", SCORE_URL, { keys, scopes: [REPUTATION_SCOPES.scoreRead] }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().subject_public_id).toBe(CUSTOMER);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "POST",
      url: "/reputation/facts",
      headers: {
        ...signFor("POST", "/reputation/facts", { keys, scopes: [REPUTATION_SCOPES.scoreRead] }),
        "idempotency-key": "idem-key-test-001",
        "content-type": "application/json",
      },
      payload: {
        subject_type: "customer",
        subject_public_id: CUSTOMER,
        fact_kind: "order_completed",
        order_public_id: "ORD-0000000002",
        source_event_type: "order.completed",
        source_event_id: "11111111-1111-4111-8111-111111111112",
        source_sequence: 1,
        actor_type: "system",
        reason_code: null,
        occurred_at: T0,
      },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("رمز صحيح بلا مُنتَفِع → 403 عند الوسيط قبل أن يُسأل المخزن", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: SCORE_URL,
      headers: signFor("GET", SCORE_URL, { keys, onBehalfOfPublicId: null }),
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("مُنتَفِعٌ يخالف :subjectPublicId → 404 لا 403 ولا 200 (ADR-009)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: SCORE_URL,
      headers: signFor("GET", SCORE_URL, { keys, onBehalfOfPublicId: "WS-9999999999" }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية (إعادة · ADR-021)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const headers = signFor("GET", SCORE_URL, { keys, scopes: [REPUTATION_SCOPES.scoreRead] });
    const first = await rawInject({ method: "GET", url: SCORE_URL, headers });
    const second = await rawInject({ method: "GET", url: SCORE_URL, headers });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 برمز الحدّ لا برمز تعذّرِ السمعة", async () => {
    const { app, keys } = await appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.inject({
      method: "GET",
      url: SCORE_URL,
      headers: signFor("GET", SCORE_URL, { keys }),
    });

    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("مسار مجهول → 401 قبل 404", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: "/reputation/there-is-no-such-route",
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("/health مفتوحٌ بقصدٍ: يُجيب بلا هوية", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("مسارٌ داخليٌّ (POST /reputation/tick) يفرضُ الصلاحيّةَ بلا مُنتَفِعٍ", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "POST",
      url: "/reputation/tick",
      headers: {
        ...signFor("POST", "/reputation/tick", { keys, scopes: [REPUTATION_SCOPES.scoreRead] }),
        "idempotency-key": "tick-idem-key-001",
      },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("POST /reputation/ratings: المُنتَفِعُ من الجسمِ (rater_public_id)", async () => {
    const { app } = await harnessApp();
    // Seed a completed order fact for both customer and driver so the rating can proceed
    const dependencies = deps();
    const seedRunner = createDirectReputationRunner(dependencies);
    await seedRunner.write(async (depsRunner) => {
      await recordFact(depsRunner, {
        draft: factDraft({
          subjectType: "customer",
          subjectPublicId: CUSTOMER,
          factKind: "order_completed",
          orderPublicId: "ORD-0000000003",
          sourceEventId: "seed-c-3",
          sourceSequence: 1,
          occurredAt: T0,
        }),
      });
      await recordFact(depsRunner, {
        draft: factDraft({
          subjectType: "driver",
          subjectPublicId: DRIVER,
          factKind: "order_completed",
          orderPublicId: "ORD-0000000003",
          sourceEventId: "seed-d-3",
          sourceSequence: 1,
          occurredAt: T0,
        }),
      });
    });

    const { app: app2 } = buildSignedReputationApp({
      runner: seedRunner,
    });

    // `app2.inject` is auto-signed by `attachSigningInject`: the signing wrapper
    // extracts the beneficiary from `rater_public_id` in the body and signs the
    // token with the correct key registry for this app.
    const response = await app2.inject({
      method: "POST",
      url: "/reputation/ratings",
      headers: {
        "idempotency-key": "rating-idem-key-001",
        "content-type": "application/json",
      },
      payload: {
        order_public_id: "ORD-0000000003",
        rater_type: "customer",
        rater_public_id: CUSTOMER,
        subject_public_id: DRIVER,
        stars: 5,
        reason_code: null,
      },
    });

    expect(response.statusCode).toBe(201);
    await app.close();
    await app2.close();
  });
});
