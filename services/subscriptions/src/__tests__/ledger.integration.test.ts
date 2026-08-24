/**
 * دفترُ المُدد والانتقالات على Postgres: **إضافةٌ فقط، والحالةُ تُشتقّ بعد القراءة**.
 *
 * ما يُثبته هذا الملفُّ بالتحديد:
 *
 *  1. **مطابقةُ المُهيئين**: `deriveState` على مُددٍ قُرئت من القاعدة يُعطي **نفسَ** الحالة
 *     التي يُعطيها على المسوّدات في الذاكرة. فلو أخطأت الترجمةُ في حقلٍ واحدٍ (لحظةٌ بغير
 *     ISO · `granted_days` مفقود) لاختلف الجوابان — وهذا هو الاختبارُ الذي يجعل الترجمةَ
 *     مُثبَتةً لا موصوفة.
 *  2. **التجديدُ ليس انتقالاً** (القرار 3): مُدّةٌ ثانيةٌ تُضاف ودفترُ الانتقالات لا يزيد،
 *     والصفُّ الأوّلُ يبقى كما هو حرفاً بحرف — لا `UPDATE` على ما مضى.
 *  3. **القاعدةُ تحرس ما يحرسه المجال**: `active → active` والإنشاءُ إلى غيرِ `trial`
 *     ومرجعُ الدفعِ في غير موضعه — كلُّها تُرفض في القاعدة وتُترجَم إلى **نفس رمز** المجال،
 *     فمن جاوز الدالّةَ النقيّةَ لم يُجاوز المخزن.
 *  4. **التسلسلُ متفرّدٌ لكلّ سائق**: 1 ثمّ 2 لسائق، ويبدأ من 1 لسائقٍ آخر.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isSubscriptionError } from "../domain/errors.js";
import { draftPaymentPeriod, draftTrialPeriod } from "../domain/periods.js";
import { LAUNCH_PLAN } from "../domain/plans.js";
import { currentCoverageEnd, deriveState } from "../domain/state.js";
import { addDays } from "../domain/time.js";
import { draftTransition } from "../domain/transitions.js";
import type { Period, TransitionDraft } from "../domain/model.js";
import {
  DRIVER,
  OTHER_DRIVER,
  PG_ENABLED,
  T0,
  countRows,
  resetData,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe.skipIf(!PG_ENABLED)("دفترُ الاشتراك على Postgres", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
  });

  afterAll(async () => {
    await pg?.close();
  });

  // -------------------------------------------------------------------------
  // المُدد: مُعرّفٌ من المحرّك وترجمةٌ حقلاً حقلاً
  // -------------------------------------------------------------------------

  it("المُعرّفُ يأتي من المحرّك، والحقولُ الباقيةُ هي المسوّدةُ نفسُها", async () => {
    const draft = draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 });
    const stored = await pg.ledger.insertPeriod(draft);

    expect(stored.periodId).toMatch(UUID);
    expect(stored).toEqual({ ...draft, periodId: stored.periodId });
  });

  it("ومُعرّفان لا يتساويان — فالمحرّكُ يُولّد ولا يُعيد ثابتاً", async () => {
    const first = await pg.ledger.insertPeriod(
      draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 }),
    );
    const second = await pg.ledger.insertPeriod(
      draftTrialPeriod({ driverPublicId: OTHER_DRIVER, plan: LAUNCH_PLAN, now: T0 }),
    );
    expect(first.periodId).not.toBe(second.periodId);
  });

  it("والقراءةُ تُعيد ما كُتب بترتيب البداية، ولسائقٍ آخر لا شيء", async () => {
    const trial = draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 });
    const written = await pg.ledger.insertPeriod(trial);

    expect(await pg.ledger.listPeriods(DRIVER)).toEqual([written]);
    expect(await pg.ledger.listPeriods(OTHER_DRIVER)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // مطابقةُ الاشتقاق: القاعدةُ والذاكرةُ تُعطيان نفسَ الحالة
  // -------------------------------------------------------------------------

  it("deriveState على صفوف القاعدة = deriveState على المسوّدات في الذاكرة", async () => {
    const trialDraft = draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 });
    const written = await pg.ledger.insertPeriod(trialDraft);

    const fromDb = await pg.ledger.listPeriods(DRIVER);
    const inMemory: ReadonlyArray<Period> = [{ ...trialDraft, periodId: written.periodId }];
    const now = addDays(T0, 1);

    expect(deriveState(fromDb, LAUNCH_PLAN, now)).toEqual(
      deriveState(inMemory, LAUNCH_PLAN, now),
    );
    expect(deriveState(fromDb, LAUNCH_PLAN, now)?.state).toBe("trial");
  });

  it("والتجديدُ يُقرأ من الدفتر تغطيةً متّصلةً لا حالةً محفوظة", async () => {
    await pg.ledger.insertPeriod(
      draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 }),
    );
    const afterTrial = await pg.ledger.listPeriods(DRIVER);

    await pg.ledger.insertPeriod(
      draftPaymentPeriod({
        driverPublicId: DRIVER,
        plan: LAUNCH_PLAN,
        paymentReference: "PR-000001",
        currentCoverageEnd: currentCoverageEnd(afterTrial),
        now: addDays(T0, 2),
      }),
    );

    const ledger = await pg.ledger.listPeriods(DRIVER);
    expect(ledger).toHaveLength(2);
    // التجربةُ تنتهي ثمّ يبدأ المدفوعُ من نهايتها: تغطيةٌ واحدةٌ متّصلة، والحالةُ `active`.
    const state = deriveState(ledger, LAUNCH_PLAN, addDays(T0, LAUNCH_PLAN.trialDays + 1));
    expect(state?.state).toBe("active");
    expect(state?.expiresAt).toBe(ledger[1]!.endsAt);
  });

  it("والتجديدُ لا يمسّ الصفَّ الأوّل ولا يُضيف انتقالاً (القرار 3)", async () => {
    const trial = await pg.ledger.insertPeriod(
      draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 }),
    );
    await pg.ledger.insertTransition({
      driverPublicId: DRIVER,
      draft: draftTransition(null, "trial", "trial", T0),
      periodId: trial.periodId,
    });

    const before = await pg.ledger.listPeriods(DRIVER);
    await pg.ledger.insertPeriod(
      draftPaymentPeriod({
        driverPublicId: DRIVER,
        plan: LAUNCH_PLAN,
        paymentReference: "PR-000002",
        currentCoverageEnd: currentCoverageEnd(before),
        now: addDays(T0, 3),
      }),
    );

    const after = await pg.ledger.listPeriods(DRIVER);
    expect(after[0]).toEqual(before[0]);
    expect(after).toHaveLength(2);
    // مُدّتان وانتقالٌ واحد: التجديدُ مُدّةٌ لا تغييرُ حالة.
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(1);
  });

  // -------------------------------------------------------------------------
  // الانتقالات: تسلسلٌ متفرّدٌ وحرّاسٌ في القاعدة
  // -------------------------------------------------------------------------

  it("التسلسلُ يبدأ من 1 ويتصاعد لكلّ سائقٍ على حِدة", async () => {
    const genesis = await pg.ledger.insertTransition({
      driverPublicId: DRIVER,
      draft: draftTransition(null, "trial", "trial", T0),
    });
    const second = await pg.ledger.insertTransition({
      driverPublicId: DRIVER,
      draft: draftTransition("trial", "expired", null, addDays(T0, 14)),
    });
    const otherGenesis = await pg.ledger.insertTransition({
      driverPublicId: OTHER_DRIVER,
      draft: draftTransition(null, "trial", "trial", T0),
    });

    expect([genesis.sequence, second.sequence]).toEqual([1, 2]);
    expect(otherGenesis.sequence).toBe(1);
    expect(genesis.reasonCode).toBe("trial_granted");
    expect(second.reasonCode).toBe("period_ended");
    expect((await pg.ledger.listTransitions(DRIVER)).map((row) => row.sequence)).toEqual([1, 2]);
  });

  it("و`active → active` ترفضه القاعدةُ بنفس رمزِ المجال", async () => {
    await pg.ledger.insertTransition({
      driverPublicId: DRIVER,
      draft: draftTransition(null, "trial", "trial", T0),
    });
    await pg.ledger.insertTransition({
      driverPublicId: DRIVER,
      draft: draftTransition("trial", "active", "payment", addDays(T0, 1)),
    });

    // مسوّدةٌ مُلفّقةٌ بيدٍ: `draftTransition` كان سيرفضها قبل القاعدة، والمقصودُ هنا فحصُ
    // الحارسِ الثاني — من جاوز الدالّةَ النقيّةَ (مسارٌ جديدٌ · نسخةٌ ثانيةٌ من الكود) لا يُجاوز المخزن.
    const forged: TransitionDraft = {
      fromState: "active",
      toState: "active",
      reasonCode: "payment_activated",
      occurredAt: addDays(T0, 2),
    };

    await expect(
      pg.ledger.insertTransition({ driverPublicId: DRIVER, draft: forged }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_TRANSITION_NOT_ALLOWED" });
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(2);
  });

  it("والإنشاءُ إلى غيرِ `trial` ترفضه القاعدةُ كذلك", async () => {
    const forged: TransitionDraft = {
      fromState: null,
      toState: "active",
      reasonCode: "payment_activated",
      occurredAt: T0,
    };

    const raised = await pg.ledger
      .insertTransition({ driverPublicId: DRIVER, draft: forged })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(isSubscriptionError(raised)).toBe(true);
    expect(raised).toMatchObject({ code: "SUBSCRIPTION_TRANSITION_NOT_ALLOWED" });
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(0);
  });

  // -------------------------------------------------------------------------
  // المال: مرجعٌ opaque في موضعه وحدَه (القرار 6)
  // -------------------------------------------------------------------------

  it("مُدّةُ دفعٍ بلا مرجعٍ ترفضها القاعدةُ باسم القيد", async () => {
    const draft = draftPaymentPeriod({
      driverPublicId: DRIVER,
      plan: LAUNCH_PLAN,
      paymentReference: "PR-000003",
      currentCoverageEnd: null,
      now: T0,
    });

    await expect(
      pg.ledger.insertPeriod({ ...draft, paymentReference: null }),
    ).rejects.toMatchObject({
      code: "SUBSCRIPTION_VALIDATION_FAILED",
      details: { field: "payment_reference" },
    });
    expect(await countRows(pg.pool, "subscription_periods")).toBe(0);
  });

  it("ومُدّةُ تجربةٍ تحمل مرجعَ دفعٍ تُرفَض كذلك — المنعُ في الاتجاهين", async () => {
    const draft = draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 });

    await expect(
      pg.ledger.insertPeriod({ ...draft, paymentReference: "PR-000004" }),
    ).rejects.toMatchObject({
      code: "SUBSCRIPTION_VALIDATION_FAILED",
      details: { field: "payment_reference" },
    });
    expect(await countRows(pg.pool, "subscription_periods")).toBe(0);
  });

  it("ومُدّةٌ تنتهي قبل أن تبدأ تُرفَض — لا أيّامَ بالسالب", async () => {
    const draft = draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 });

    await expect(
      // لحظةٌ مكتوبةٌ بيدٍ سابقةٌ لـ`T0`: `addDays` كان سيرفض السالبَ قبل القاعدة، والمقصودُ
      // فحصُ الحارس في المحرّك لا في الدالّة النقيّة.
      pg.ledger.insertPeriod({ ...draft, endsAt: "2026-02-28T00:00:00.000Z" }),
    ).rejects.toMatchObject({
      code: "SUBSCRIPTION_VALIDATION_FAILED",
      details: { field: "ends_at" },
    });
  });
});
