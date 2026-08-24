/**
 * المُهاجرةُ على محرّكٍ حقيقيّ: **المخطّطُ طُبّق، والبذرةُ تُطابق الكتالوجَ حقلاً حقلاً**.
 *
 * هذا الملفُّ هو بوّابةُ المراجعة 3/6 بعينها. ولذلك لا يقرأ `schema.sql` نصّاً ولا يؤكّد أنّه
 * يحتوي كلمةً: يُشغّل المُهاجرةَ على Postgres ثمّ يسأل **القاعدةَ** عمّا فيها — الجداولُ
 * العشرةُ بأسمائها، والقيودُ المُسمّاةُ بأسمائها، وصفوفُ الخطّةِ كما بذرتها المُهاجرة. فما
 * يمرّ من هنا مُثبَتٌ لا موصوف.
 *
 * وكلُّ موجَبٍ هنا بجواره نقيضُه (HANDOFF §16-ب): الجدولُ موجودٌ **و**مُدّةٌ إلى نسخةِ خطّةٍ
 * غيرِ مبذورةٍ تُرفَض؛ والبذرةُ تُطابق **و**إعادةُ المُهاجرةِ لا تُنشئ صفّاً ثانياً.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOT_MIRRORED_TABLES } from "../db/schema.js";
import { migrateSubscriptions } from "../db/migrate.js";
import { LAUNCH_PLAN } from "../domain/plans.js";
import { draftTrialPeriod } from "../domain/periods.js";
import { isSubscriptionError } from "../domain/errors.js";
import {
  DRIVER,
  FROZEN_AT,
  PG_ENABLED,
  T0,
  TABLES,
  constraintNames,
  countRows,
  setupPostgres,
  tableNames,
  type PgFixture,
} from "./pg-harness.js";

/** القيودُ المُسمّاةُ التي يُبنى عليها سلوكٌ في هذه الخدمة — تُسمّى كي يفشل غيابُها. */
const NAMED_CONSTRAINTS = [
  "ck_subscription_periods_payment_reference",
  "ck_subscription_periods_window",
  "ck_subscription_plans_frozen_at",
  "ck_subscription_transitions_genesis",
  "ck_subscription_transitions_state_changes",
  "ck_subscriptions_period_state",
  "fk_subscription_periods_plan",
  "fk_subscription_plan_entitlements_plan",
  "ux_subscription_transitions_sequence",
  "ux_subscriptions_driver",
] as const;

describe.skipIf(!PG_ENABLED)("المُهاجرة على محرّكٍ حقيقيّ", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("الجداولُ العشرةُ كلُّها موجودةٌ بعد تطبيق العقد", async () => {
    const present = await tableNames(pg.pool);
    for (const table of TABLES) expect(present).toContain(table);
  });

  it("والقيودُ المُسمّاةُ موجودةٌ بأسمائها — لا بأسماءٍ تُولّدها Postgres", async () => {
    const present = await constraintNames(pg.pool);
    for (const name of NAMED_CONSTRAINTS) expect(present).toContain(name);
  });

  it("صفُّ الخطّةِ في القاعدة يُطابق LAUNCH_PLAN حقلاً حقلاً", async () => {
    const stored = await pg.ledger.readPlanVersion(LAUNCH_PLAN.planCode, LAUNCH_PLAN.planVersion);
    expect(stored).toEqual(LAUNCH_PLAN);
  });

  it("ولحظةُ التجميدِ هي التي أُعطيت للمُهاجرة لا لحظةً اختُرعت", async () => {
    const frozenAt = await pg.ledger.readPlanFrozenAt(
      LAUNCH_PLAN.planCode,
      LAUNCH_PLAN.planVersion,
    );
    expect(frozenAt).toBe(FROZEN_AT);
  });

  it("والاستحقاقاتُ أربعةُ صفوفٍ لا حمولةٌ واحدة", async () => {
    expect(await countRows(pg.pool, "subscription_plan_entitlements")).toBe(
      LAUNCH_PLAN.entitlements.length,
    );
  });

  it("إعادةُ المُهاجرةِ لا تُنشئ صفّاً ثانياً ولا تُغيّر لحظةَ التجميد", async () => {
    await migrateSubscriptions(pg.pool, pg.db, "2027-01-01T00:00:00.000Z");
    expect(await countRows(pg.pool, "subscription_plans")).toBe(1);
    expect(await countRows(pg.pool, "subscription_plan_entitlements")).toBe(
      LAUNCH_PLAN.entitlements.length,
    );
    expect(
      await pg.ledger.readPlanFrozenAt(LAUNCH_PLAN.planCode, LAUNCH_PLAN.planVersion),
    ).toBe(FROZEN_AT);
  });

  it("ونسخةُ خطّةٍ غيرُ مبذورةٍ لا تُقرأ — فالمُطابقةُ ليست مصادفةً", async () => {
    expect(await pg.ledger.readPlanVersion(LAUNCH_PLAN.planCode, 99)).toBeNull();
  });

  it("ومُدّةٌ إلى نسخةٍ غيرِ موجودةٍ يرفضها المفتاحُ الأجنبيّ في القاعدة", async () => {
    const draft = draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: T0 });
    const orphan = { ...draft, planVersion: 99 };

    let raised: unknown;
    try {
      await pg.ledger.insertPeriod(orphan);
    } catch (error) {
      raised = error;
    }

    expect(raised).toBeDefined();
    // خطأٌ لم يُترجَم يصعد بصورته الأولى: مفتاحٌ أجنبيٌّ مكسورٌ عطبُ ترحيلٍ لا خطأُ مُرسِل.
    expect(isSubscriptionError(raised)).toBe(false);
    expect(await countRows(pg.pool, "subscription_periods")).toBe(0);
  });

  it("والجداولُ غيرُ المُنعكسةِ موجودةٌ في القاعدة — القائمةُ اعترافٌ لا نقص", async () => {
    const present = await tableNames(pg.pool);
    for (const table of NOT_MIRRORED_TABLES) expect(present).toContain(table);
  });
});
