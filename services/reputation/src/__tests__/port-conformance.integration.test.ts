/**
 * حزمةُ مطابقة المُهيئَين — الذاكرةُ وPostgreSQL تحت **نفس** الاختبارات.
 *
 * هذا هو المعيارُ المُلزم للمراجعة 3/6 (HANDOFF §16-و البند 1): «نفسُ الاختبارات على
 * المُهيئين، وتأكيدُ رمز الخطأ **واسم القيد**». والسببُ أنّ الذاكرةَ تُصبح كذبةً مفيدةً
 * إن لم تُقاس: مئةُ اختبارٍ أخضرَ عليها لا تُثبت شيئاً عن الإنتاج إن كان مخزنُها يقبل ما
 * ترفضه القاعدة، أو يرفضه باسمٍ آخر فيُترجَم إلى رمزٍ آخر على حدّ HTTP.
 *
 * وفيها جزآن:
 *
 *  1. **جدولُ القيود** — لكلّ اسمٍ في `ENFORCED_CONSTRAINTS` محرِّضٌ في كلّ مُهيئ، ويُؤكَّد
 *     أنّ الاثنين يُنتجان نفسَ الاسم (أو يستوعبانه معاً حين يكون القيدُ مفتاحاً يُدمَج
 *     عليه). ويُغلق الجدولُ باختبار تغطيةٍ: خمسةَ عشرَ قيداً، لا أربعةَ عشر.
 *  2. **سيناريو كاملٌ مرّتين** — نفسُ العمل على المُهيئين ثمّ **مقارنةٌ تامّة** لما خرج.
 *     والساعةُ والمُعرّفاتُ متطابقتان بالبناء (`ManualClock` و`SequentialIdGenerator`)،
 *     فأيُّ فرقٍ في النتيجة فرقُ استمراريّةٍ لا فرقُ بيئة — ولذلك تُقارَن الصفوفُ حرفياً
 *     لا «بالشكل العام».
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReputationError } from "../domain/errors.js";
import type {
  FraudSignalRow,
  ReputationFactRow,
  ReputationRatingRow,
  ReputationRulesetRow,
  ReputationScoreRow,
} from "../domain/model.js";
import { SEEDED_RULESETS } from "../domain/ruleset.js";
import { ENFORCED_CONSTRAINTS, type EnforcedConstraint } from "../infrastructure/constraints.js";
import { postgresError, readOutbox } from "../infrastructure/drizzle/repository.js";
import {
  InMemoryFactRepository,
  InMemoryFraudSignalRepository,
  InMemoryRatingRepository,
  InMemoryRulesetRepository,
  InMemoryScoreRepository,
  createInMemoryReputationDependencies,
} from "../infrastructure/in-memory.js";
import type { ReputationRunner } from "../runner.js";
import { listFraudSignals, listRatings, readScore } from "../use-cases/reads.js";
import { recomputeScore } from "../use-cases/recompute-score.js";
import { runTick } from "../use-cases/run-tick.js";
import { submitRating } from "../use-cases/submit-rating.js";
import { CUSTOMER, DRIVER, T0, order } from "./helpers.js";
import {
  PG_ENABLED,
  completeOrderWith,
  createPgHarness,
  memoryRunner,
  resetData,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

// ---------------------------------------------------------------------------
// أدواتُ الفحص
// ---------------------------------------------------------------------------

const T1 = "2026-03-01T13:00:00.000Z";

function rowId(index: number): string {
  return `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
}

function sourceUuid(index: number): string {
  return `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`;
}

/**
 * اسمُ القيد المكسور، أيّاً كان مصدرُ الخطأ.
 *
 * مُهيئُ الذاكرة يرمي `ReputationError` باسمٍ في `details.constraint`، وPostgres يرمي
 * خطأَ سائقٍ باسمٍ في `constraint` — والمُترجِمُ في المستودع يُحوّل الثاني إلى الأوّل لكلّ
 * قيدٍ مُعلَن. وهذه الدالّةُ تقرأ الاثنين كي يكون الفشلُ في الحزمة فشلَ **مطابقةٍ** لا
 * فشلَ قراءةِ شكلِ خطأ.
 */
function brokenConstraintOf(error: unknown): string | undefined {
  if (error instanceof ReputationError) return error.details.constraint;
  return postgresError(error).constraint;
}

async function captureError(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("كان متوقَّعاً أن يُرفض هذا العمل، فمرّ");
}

// ---------------------------------------------------------------------------
// صفوفٌ حتميّة
// ---------------------------------------------------------------------------

function factRow(index: number, overrides: Partial<ReputationFactRow> = {}): ReputationFactRow {
  return {
    id: rowId(index),
    subjectType: "customer",
    subjectPublicId: CUSTOMER,
    factKind: "order_completed",
    orderPublicId: order(1),
    sourceEventType: "order.completed",
    sourceEventId: sourceUuid(index),
    sourceSequence: 1,
    actorType: "system",
    reasonCode: null,
    occurredAt: T0,
    recordedAt: T0,
    traceId: null,
    ...overrides,
  };
}

function scoreRow(overrides: Partial<ReputationScoreRow> = {}): ReputationScoreRow {
  return {
    subjectType: "customer",
    subjectPublicId: CUSTOMER,
    rulesetVersion: 1,
    scorePoints: 63,
    tier: "standard",
    factCount: 5,
    computedThroughFactId: rowId(1),
    computedAt: T0,
    nextRecomputeAt: T1,
    traceId: null,
    ...overrides,
  };
}

function ratingRow(index: number, overrides: Partial<ReputationRatingRow> = {}): ReputationRatingRow {
  return {
    id: rowId(index),
    orderPublicId: order(1),
    raterType: "customer",
    raterPublicId: CUSTOMER,
    subjectType: "driver",
    subjectPublicId: DRIVER,
    stars: 5,
    reasonCode: "on_time",
    rulesetVersion: 1,
    submittedAt: T0,
    traceId: null,
    ...overrides,
  };
}

function signalRow(index: number, overrides: Partial<FraudSignalRow> = {}): FraudSignalRow {
  return {
    id: rowId(index),
    subjectType: "driver",
    subjectPublicId: DRIVER,
    ruleCode: "repeated_driver_cancellation",
    severity: "medium",
    windowStartedAt: T0,
    windowEndedAt: T1,
    observedCount: 6,
    thresholdCount: 4,
    rulesetVersion: 1,
    raisedAt: T1,
    traceId: null,
    ...overrides,
  };
}

/** نسخةُ قواعدٍ مبنيّةٌ على النسخة 1 بتعديلٍ واحدٍ يكسر قيداً واحداً. */
function rulesetWith(overrides: Partial<ReputationRulesetRow>): ReputationRulesetRow {
  return { ...(SEEDED_RULESETS[0] as ReputationRulesetRow), ...overrides };
}

const RULESET_COLUMNS = [
  "ruleset_version",
  "label",
  "score_floor",
  "score_ceiling",
  "starting_score",
  "min_facts_for_score",
  "decay_half_life_days",
  "tier_standard_at",
  "tier_trusted_at",
  "tier_under_watch_below",
  "rating_window_hours",
  "fraud_window_days",
  "recompute_interval_hours",
  "is_frozen",
].join(", ");

describe.skipIf(!PG_ENABLED)("مطابقةُ المُهيئَين: الذاكرة ↔ PostgreSQL", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
  });

  /**
   * إدراجُ نسخةِ قواعدٍ خامٍ داخل معاملةٍ تُلغى دائماً.
   *
   * جداولُ نسخة القواعد لا تُمسح بين الاختبارات (بذرةُ العقد)، فإدراجُ نسخةٍ ثانيةٍ
   * والالتزامُ بها كان سيُغيّر النسخةَ النشطة لبقيّة الملفّ. والتراجعُ الدائم يجعل الفحصَ
   * بلا أثرٍ جانبيّ، وهو الشرطُ الذي يسمح بقياس قيودِ جدولٍ لا مستودعَ كتابةٍ له.
   */
  async function rawRulesetInsert(values: readonly (string | number | boolean)[]): Promise<void> {
    const client = await pg.pool.connect();
    try {
      await client.query("BEGIN");
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      await client.query(
        `INSERT INTO reputation_rulesets (${RULESET_COLUMNS}) VALUES (${placeholders})`,
        [...values],
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** إدراجُ صفٍّ خامٍ في جدولٍ من جداول البذرة، داخل معاملةٍ تُلغى دائماً. */
  async function rawSeedInsert(statement: string): Promise<void> {
    const client = await pg.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(statement);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // 1) جدولُ القيود الخمسةَ عشر
  // -------------------------------------------------------------------------

  interface ParityCase {
    readonly constraint: EnforcedConstraint;
    /** `violation`: يُرفَض في المُهيئين باسمٍ واحد. `absorbed`: يُدمَج عليه بلا خطأ. */
    readonly kind: "violation" | "absorbed";
    readonly memory: () => Promise<unknown>;
    readonly postgres: () => Promise<unknown>;
  }

  function parityCases(): readonly ParityCase[] {
    return [
      {
        constraint: "ck_reputation_rulesets_score_bounds",
        kind: "violation",
        memory: async () => {
          new InMemoryRulesetRepository([
            rulesetWith({ scoreFloor: 50, scoreCeiling: 50, startingScore: 50 }),
          ]);
        },
        postgres: () =>
          rawRulesetInsert([2, "parity", 50, 50, 50, 5, 180, 50, 80, 35, 72, 30, 24, false]),
      },
      {
        constraint: "ck_reputation_rulesets_start_in_bounds",
        kind: "violation",
        memory: async () => {
          new InMemoryRulesetRepository([rulesetWith({ startingScore: 101 })]);
        },
        postgres: () =>
          rawRulesetInsert([2, "parity", 0, 100, 101, 5, 180, 50, 80, 35, 72, 30, 24, false]),
      },
      {
        constraint: "ck_reputation_rulesets_tier_order",
        kind: "violation",
        memory: async () => {
          new InMemoryRulesetRepository([
            rulesetWith({ tierStandardAt: 80, tierTrustedAt: 50 }),
          ]);
        },
        postgres: () =>
          rawRulesetInsert([2, "parity", 0, 100, 60, 5, 180, 80, 50, 35, 72, 30, 24, false]),
      },
      {
        constraint: "pk_reputation_rule_weights",
        kind: "violation",
        memory: async () => {
          const weight = { rulesetVersion: 1, subjectType: "customer", factKind: "order_completed", weightPoints: 3 } as const;
          new InMemoryRulesetRepository([rulesetWith({ weights: [weight, weight] })]);
        },
        postgres: () =>
          rawSeedInsert(
            `INSERT INTO reputation_rule_weights (ruleset_version, subject_type, fact_kind, weight_points)
             VALUES (1, 'customer', 'order_completed', 3)`,
          ),
      },
      {
        constraint: "pk_reputation_fraud_thresholds",
        kind: "violation",
        memory: async () => {
          const threshold = {
            rulesetVersion: 1,
            ruleCode: "accept_then_abandon",
            subjectType: "driver",
            thresholdCount: 3,
            severity: "high",
          } as const;
          new InMemoryRulesetRepository([rulesetWith({ fraudThresholds: [threshold, threshold] })]);
        },
        postgres: () =>
          rawSeedInsert(
            `INSERT INTO reputation_fraud_thresholds (ruleset_version, rule_code, subject_type, threshold_count, severity)
             VALUES (1, 'accept_then_abandon', 'driver', 3, 'high')`,
          ),
      },
      {
        constraint: "ux_reputation_facts_source",
        kind: "violation",
        memory: async () => {
          const facts = new InMemoryFactRepository();
          await facts.insert(factRow(1));
          return facts.insert(factRow(2));
        },
        postgres: async () => {
          await pg.facts.insert(factRow(1));
          return pg.facts.insert(factRow(2));
        },
      },
      {
        constraint: "pk_reputation_scores",
        kind: "absorbed",
        memory: async () => {
          const scores = new InMemoryScoreRepository();
          await scores.upsert(scoreRow());
          await scores.upsert(scoreRow({ scorePoints: 81, tier: "trusted" }));
          return scores.find("customer", CUSTOMER);
        },
        postgres: async () => {
          await pg.scores.upsert(scoreRow());
          await pg.scores.upsert(scoreRow({ scorePoints: 81, tier: "trusted" }));
          return pg.scores.find("customer", CUSTOMER);
        },
      },
      {
        constraint: "ck_reputation_scores_non_negative",
        kind: "violation",
        memory: () => new InMemoryScoreRepository().upsert(scoreRow({ scorePoints: -1 })),
        postgres: () => pg.scores.upsert(scoreRow({ scorePoints: -1 })),
      },
      {
        constraint: "ck_reputation_scores_new_has_no_history",
        kind: "violation",
        memory: () =>
          new InMemoryScoreRepository().upsert(
            scoreRow({ tier: "new", factCount: 3, computedThroughFactId: null }),
          ),
        postgres: () =>
          pg.scores.upsert(scoreRow({ tier: "new", factCount: 3, computedThroughFactId: null })),
      },
      {
        constraint: "ux_reputation_ratings_order_pair",
        kind: "violation",
        memory: async () => {
          const ratings = new InMemoryRatingRepository();
          await ratings.insert(ratingRow(1));
          return ratings.insert(ratingRow(2));
        },
        postgres: async () => {
          await pg.ratings.insert(ratingRow(1));
          return pg.ratings.insert(ratingRow(2));
        },
      },
      {
        constraint: "ck_reputation_ratings_no_self",
        kind: "violation",
        memory: () =>
          new InMemoryRatingRepository().insert(
            ratingRow(1, { subjectType: "driver", subjectPublicId: CUSTOMER }),
          ),
        postgres: () =>
          pg.ratings.insert(ratingRow(1, { subjectType: "driver", subjectPublicId: CUSTOMER })),
      },
      {
        constraint: "ck_reputation_ratings_cross_side",
        kind: "violation",
        memory: () =>
          new InMemoryRatingRepository().insert(
            ratingRow(1, { subjectType: "customer", subjectPublicId: DRIVER }),
          ),
        postgres: () =>
          pg.ratings.insert(ratingRow(1, { subjectType: "customer", subjectPublicId: DRIVER })),
      },
      {
        constraint: "ck_fraud_signals_window_order",
        kind: "violation",
        memory: () =>
          new InMemoryFraudSignalRepository().insert(
            signalRow(1, { windowStartedAt: T1, windowEndedAt: T0 }),
          ),
        postgres: () =>
          pg.fraudSignals.insert(signalRow(1, { windowStartedAt: T1, windowEndedAt: T0 })),
      },
      {
        constraint: "ck_fraud_signals_over_threshold",
        kind: "violation",
        memory: () =>
          new InMemoryFraudSignalRepository().insert(
            signalRow(1, { observedCount: 2, thresholdCount: 4 }),
          ),
        postgres: () => pg.fraudSignals.insert(signalRow(1, { observedCount: 2, thresholdCount: 4 })),
      },
      {
        constraint: "ux_fraud_signals_rule_window",
        kind: "violation",
        memory: async () => {
          const signals = new InMemoryFraudSignalRepository();
          await signals.insert(signalRow(1));
          return signals.insert(signalRow(2));
        },
        postgres: async () => {
          await pg.fraudSignals.insert(signalRow(1));
          return pg.fraudSignals.insert(signalRow(2));
        },
      },
    ];
  }

  describe("جدولُ القيود المفروضة", () => {
    it("يُغطّي كلَّ اسمٍ في `ENFORCED_CONSTRAINTS` مرّةً واحدة", () => {
      const covered = parityCases().map((entry) => entry.constraint);

      expect([...covered].sort()).toEqual([...ENFORCED_CONSTRAINTS].sort());
      expect(new Set(covered).size).toBe(ENFORCED_CONSTRAINTS.length);
    });

    it.each(parityCases().filter((entry) => entry.kind === "violation"))(
      "$constraint يُرفَض في المُهيئين معاً بنفس الاسم",
      async ({ constraint, memory, postgres }) => {
        const fromMemory = await captureError(memory);
        const fromPostgres = await captureError(postgres);

        expect(fromMemory).toBeInstanceOf(ReputationError);
        expect((fromMemory as ReputationError).code).toBe("REPUTATION_VALIDATION_FAILED");
        expect(brokenConstraintOf(fromMemory)).toBe(constraint);
        expect(brokenConstraintOf(fromPostgres)).toBe(constraint);
      },
    );

    it.each(parityCases().filter((entry) => entry.kind === "absorbed"))(
      "$constraint يُدمَج عليه في المُهيئين معاً بنفس النتيجة",
      async ({ memory, postgres }) => {
        expect(await memory()).toEqual(await postgres());
      },
    );
  });

  // -------------------------------------------------------------------------
  // 2) سيناريو كاملٌ مرّتين، ومقارنةٌ تامّة
  // -------------------------------------------------------------------------

  interface ScenarioSnapshot {
    readonly score: unknown;
    readonly facts: readonly unknown[];
    readonly ratings: readonly unknown[];
    readonly signals: readonly unknown[];
    readonly tick: unknown;
  }

  /**
   * السيناريو: طلبٌ مكتمل، ثمّ تقييمٌ من العميل للسائق، ثمّ إعادةُ حسابٍ صريحة، ثمّ نبضة.
   *
   * كلُّ خطوةٍ تمرّ عبر `runner` والمنافذِ وحدها — لا SQL ولا مخزنَ ذاكرةٍ مباشر. وذاك
   * شرطُ أن تكون المقارنةُ مقارنةَ **مُهيئين** لا مقارنةَ نصّين.
   */
  async function runScenario(runner: ReputationRunner): Promise<ScenarioSnapshot> {
    await runner.write((deps) =>
      completeOrderWith(deps, { orderPublicId: order(1), orderIndex: 1 }),
    );

    await runner.write((deps) =>
      submitRating(deps, {
        draft: {
          orderPublicId: order(1),
          raterType: "customer",
          raterPublicId: CUSTOMER,
          subjectPublicId: DRIVER,
          stars: 5,
          reasonCode: "on_time",
          submittedAt: T0,
        },
        idempotencyKey: "parity-rating-key-1",
      }),
    );

    await runner.write((deps) =>
      recomputeScore(deps, { subjectType: "driver", subjectPublicId: DRIVER }),
    );

    const tick = await runner.write((deps) => runTick(deps, { limit: 10 }));

    return runner.read(async (deps) => ({
      score: await readScore(deps, { subjectType: "driver", subjectPublicId: DRIVER }),
      facts: await deps.facts.listBySubject("driver", DRIVER),
      ratings: await listRatings(deps, { subjectPublicId: DRIVER }),
      signals: await listFraudSignals(deps, { subjectPublicId: DRIVER }),
      tick,
    }));
  }

  /** أحداثُ الصندوق مفروزةً بمُعرّفها — الترتيبُ ليس عقداً، والمحتوى عقد. */
  function sortedEvents(events: readonly unknown[]): readonly unknown[] {
    return [...events].sort((left, right) => {
      const leftId = (left as { readonly event_id: string }).event_id;
      const rightId = (right as { readonly event_id: string }).event_id;
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
  }

  describe("سيناريو الطلب والتقييم والنبضة", () => {
    it("يُعطي نفسَ الصفوف حرفياً على المُهيئين", async () => {
      const memoryDeps = createInMemoryReputationDependencies({ startAt: T0 });
      const pgHarness = createPgHarness(pg, T0);

      const fromMemory = await runScenario(memoryRunner(memoryDeps));
      const fromPostgres = await runScenario(pgHarness.runner);

      expect(fromPostgres).toEqual(fromMemory);
    });

    it("ويُدخل الصندوقَ نفسَ الأحداث بنفس الحمولات", async () => {
      const memoryDeps = createInMemoryReputationDependencies({ startAt: T0 });
      const pgHarness = createPgHarness(pg, T0);

      await runScenario(memoryRunner(memoryDeps));
      await runScenario(pgHarness.runner);

      const memoryEvents = sortedEvents(memoryDeps.outbox.appended.map((entry) => entry.event));
      const pgEvents = sortedEvents((await readOutbox(pg.db)).map((row) => row.payload));

      expect(pgEvents).toEqual(memoryEvents);
    });

    it("والإعادةُ بنفس مفتاح المعالجة الواحدة لا تُضاعف شيئاً في المُهيئين", async () => {
      const memoryDeps = createInMemoryReputationDependencies({ startAt: T0 });
      const pgHarness = createPgHarness(pg, T0);

      const memoryRun = memoryRunner(memoryDeps);
      await runScenario(memoryRun);
      await runScenario(pgHarness.runner);

      const rating = {
        orderPublicId: order(1),
        raterType: "customer",
        raterPublicId: CUSTOMER,
        subjectPublicId: DRIVER,
        stars: 5,
        reasonCode: "on_time",
        submittedAt: T0,
      } as const;

      const replayedInMemory = await memoryRun.write((deps) =>
        submitRating(deps, { draft: rating, idempotencyKey: "parity-rating-key-1" }),
      );
      const replayedInPostgres = await pgHarness.runner.write((deps) =>
        submitRating(deps, { draft: rating, idempotencyKey: "parity-rating-key-1" }),
      );

      expect(replayedInPostgres).toEqual(replayedInMemory);
      expect(
        (await memoryRun.read((deps) => listRatings(deps, { subjectPublicId: DRIVER }))).length,
      ).toBe(1);
      expect(
        (await pgHarness.runner.read((deps) => listRatings(deps, { subjectPublicId: DRIVER })))
          .length,
      ).toBe(1);
    });
  });
});
