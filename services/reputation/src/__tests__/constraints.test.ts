/**
 * حارسٌ سلبيّ: كلُّ قيدٍ مُسمّى في الـDDL مفروضٌ في الذاكرة **بنفس الاسم**.
 *
 * هذا الملفُّ يقرأ `services/reputation/contracts/schema.sql` **بعد حذف التعليقات**
 * ويستخرج كلَّ `CONSTRAINT <name>` ثمّ يؤكّد أنّ الاسمَ مفروضٌ هنا (HANDOFF §16-ج:
 * الحارسُ يقرأ سطحاً آليّاً لا نثراً). ولو أُضيف قيدٌ إلى القاعدة بلا فرضٍ في الذاكرة
 * انكسر هذا الاختبار فوراً، فلا يمرّ صفٌّ مستحيلٌ في الاختبارات ويُكتشف أوّلَ مرّةٍ في
 * Postgres.
 *
 * وحذفُ التعليقات شرط: الشرحُ في أعلى الـDDL يذكر أسماءَ قيودٍ في نثره، ولو قُرئ لظنّ
 * الحارسُ أنّها تعريفاتٌ فأربك نفسه.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENFORCED_CONSTRAINTS } from "../infrastructure/constraints.js";
import { isReputationError } from "../domain/errors.js";
import {
  InMemoryFraudSignalRepository,
  InMemoryRatingRepository,
  InMemoryScoreRepository,
} from "../infrastructure/in-memory.js";
import { SEEDED_RULESETS, assertRulesetInvariants } from "../domain/ruleset.js";
import type { FraudSignalRow, ReputationRatingRow, ReputationScoreRow } from "../domain/model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, "..", "..", "contracts", "schema.sql");

/** حذفُ تعليقات `--` وتعليقات الكتلة قبل أي استخراج. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function declaredConstraints(): readonly string[] {
  const ddl = stripSqlComments(readFileSync(SCHEMA_PATH, "utf8"));
  const names = new Set<string>();
  for (const match of ddl.matchAll(/\bCONSTRAINT\s+([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/** استخراجُ اسم القيد من خطأٍ يجب أن يكون خطأَ قيد. */
function constraintOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (isReputationError(error)) {
      const details = error.details as { readonly constraint?: unknown } | undefined;
      return typeof details?.constraint === "string" ? details.constraint : "";
    }
    throw error;
  }
  throw new Error("كان يجب أن يفشل الاستدعاء");
}

async function asyncConstraintOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (isReputationError(error)) {
      const details = error.details as { readonly constraint?: unknown } | undefined;
      return typeof details?.constraint === "string" ? details.constraint : "";
    }
    throw error;
  }
  throw new Error("كان يجب أن يفشل الاستدعاء");
}

describe("مطابقةُ الـDDL", () => {
  it("الـDDL يُقرأ فعلاً ويحمل قيوداً — فلا يمرّ الحارسُ على ملفٍّ فارغ", () => {
    const declared = declaredConstraints();
    expect(declared.length).toBeGreaterThanOrEqual(15);
  });

  it("كلُّ قيدٍ مُسمّى في الـDDL مفروضٌ في الذاكرة", () => {
    const enforced = new Set<string>(ENFORCED_CONSTRAINTS);
    const missing = declaredConstraints().filter((name) => !enforced.has(name));
    expect(missing).toEqual([]);
  });

  it("ولا اسمَ مفروضٌ هنا بلا وجودٍ في الـDDL — فلا حارسَ يحرس شيئاً لا يوجد", () => {
    const declared = new Set(declaredConstraints());
    const orphans = ENFORCED_CONSTRAINTS.filter((name) => !declared.has(name));
    expect(orphans).toEqual([]);
  });

  it("حذفُ التعليقات يعمل — أسماءُ القيود المذكورةُ في الشرح لا تُحسب تعريفات", () => {
    const commented = stripSqlComments("-- CONSTRAINT ck_ذكرٌ_في_نثر CHECK (true)\nSELECT 1;");
    expect(commented).not.toContain("CONSTRAINT");
  });
});

describe("قيودُ نسخة القواعد", () => {
  const base = SEEDED_RULESETS[0];

  it("سقفٌ لا يعلو الأرضية ⇒ ck_reputation_rulesets_score_bounds", () => {
    expect(
      constraintOf(() => assertRulesetInvariants({ ...base, scoreCeiling: base.scoreFloor })),
    ).toBe("ck_reputation_rulesets_score_bounds");
  });

  it("بدايةٌ خارج الحدود ⇒ ck_reputation_rulesets_start_in_bounds", () => {
    expect(constraintOf(() => assertRulesetInvariants({ ...base, startingScore: 140 }))).toBe(
      "ck_reputation_rulesets_start_in_bounds",
    );
  });

  it("رتبةٌ موثوقةٌ أدنى من عادية ⇒ ck_reputation_rulesets_tier_order", () => {
    expect(constraintOf(() => assertRulesetInvariants({ ...base, tierTrustedAt: 10 }))).toBe(
      "ck_reputation_rulesets_tier_order",
    );
  });

  it("النسخةُ المزروعةُ تعبر كلَّ قيودها", () => {
    expect(() => assertRulesetInvariants(base)).not.toThrow();
  });
});

describe("قيودُ النتيجة", () => {
  function scoreRow(overrides: Partial<ReputationScoreRow> = {}): ReputationScoreRow {
    return {
      subjectType: "customer",
      subjectPublicId: "WS-1000000001",
      scorePoints: 60,
      tier: "new",
      factCount: 0,
      rulesetVersion: 1,
      computedThroughFactId: null,
      computedAt: "2026-03-01T12:00:00.000Z",
      nextRecomputeAt: "2026-03-02T12:00:00.000Z",
      ...overrides,
    };
  }

  it("نقاطٌ سالبة ⇒ ck_reputation_scores_non_negative", async () => {
    const repository = new InMemoryScoreRepository();
    expect(await asyncConstraintOf(() => repository.upsert(scoreRow({ scorePoints: -1 })))).toBe(
      "ck_reputation_scores_non_negative",
    );
  });

  it("رتبةُ new مع تاريخٍ ⇒ ck_reputation_scores_new_has_no_history", async () => {
    const repository = new InMemoryScoreRepository();
    expect(
      await asyncConstraintOf(() =>
        repository.upsert(scoreRow({ tier: "new", factCount: 3, computedThroughFactId: null })),
      ),
    ).toBe("ck_reputation_scores_new_has_no_history");
  });

  it("صفٌّ سليمٌ يُكتب، وإعادةُ كتابته تحديثٌ لا صفٌّ ثانٍ (pk_reputation_scores)", async () => {
    const repository = new InMemoryScoreRepository();
    await repository.upsert(scoreRow());
    await repository.upsert(scoreRow({ scorePoints: 70, tier: "standard", factCount: 5 }));
    const stored = await repository.find("customer", "WS-1000000001");
    expect(stored?.scorePoints).toBe(70);
  });
});

describe("قيودُ التقييم", () => {
  function ratingRow(overrides: Partial<ReputationRatingRow> = {}): ReputationRatingRow {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      orderPublicId: "ORD-0000000001",
      raterType: "customer",
      raterPublicId: "WS-1000000001",
      subjectType: "driver",
      subjectPublicId: "WS-2000000002",
      stars: 5,
      reasonCode: null,
      rulesetVersion: 1,
      submittedAt: "2026-03-01T12:00:00.000Z",
      traceId: null,
      ...overrides,
    };
  }

  it("تقييمُ النفس ⇒ ck_reputation_ratings_no_self", async () => {
    const repository = new InMemoryRatingRepository();
    expect(
      await asyncConstraintOf(() =>
        repository.insert(ratingRow({ subjectPublicId: "WS-1000000001" })),
      ),
    ).toBe("ck_reputation_ratings_no_self");
  });

  it("جانبان متماثلان ⇒ ck_reputation_ratings_cross_side", async () => {
    const repository = new InMemoryRatingRepository();
    expect(
      await asyncConstraintOf(() => repository.insert(ratingRow({ subjectType: "customer" }))),
    ).toBe("ck_reputation_ratings_cross_side");
  });

  it("زوجٌ مُكرّرٌ على نفس الطلب ⇒ ux_reputation_ratings_order_pair", async () => {
    const repository = new InMemoryRatingRepository();
    await repository.insert(ratingRow());
    expect(
      await asyncConstraintOf(() =>
        repository.insert(ratingRow({ id: "00000000-0000-4000-8000-000000000002" })),
      ),
    ).toBe("ux_reputation_ratings_order_pair");
  });
});

describe("قيودُ إشارة الاحتيال", () => {
  function signalRow(overrides: Partial<FraudSignalRow> = {}): FraudSignalRow {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      subjectType: "driver",
      subjectPublicId: "WS-2000000002",
      ruleCode: "repeated_driver_cancellation",
      severity: "medium",
      windowStartedAt: "2026-02-01T00:00:00.000Z",
      windowEndedAt: "2026-03-03T00:00:00.000Z",
      observedCount: 5,
      thresholdCount: 4,
      rulesetVersion: 1,
      raisedAt: "2026-03-02T12:00:00.000Z",
      traceId: null,
      ...overrides,
    };
  }

  it("نافذةٌ معكوسة ⇒ ck_fraud_signals_window_order", async () => {
    const repository = new InMemoryFraudSignalRepository();
    expect(
      await asyncConstraintOf(() =>
        repository.insert(signalRow({ windowEndedAt: "2026-01-01T00:00:00.000Z" })),
      ),
    ).toBe("ck_fraud_signals_window_order");
  });

  it("عددٌ دون العتبة ⇒ ck_fraud_signals_over_threshold", async () => {
    /**
     * إشارةٌ مخزّنةٌ دون عتبتها تعني أنّ أحداً سيُراجَع بلا سببٍ يمكن قراءته. والقيدُ
     * يمنع الصفَّ من الوجود أصلاً، لا يُصلحه لاحقاً.
     */
    const repository = new InMemoryFraudSignalRepository();
    expect(await asyncConstraintOf(() => repository.insert(signalRow({ observedCount: 3 })))).toBe(
      "ck_fraud_signals_over_threshold",
    );
  });

  it("نفسُ القاعدة ونفسُ النافذة مرّتين ⇒ ux_fraud_signals_rule_window", async () => {
    const repository = new InMemoryFraudSignalRepository();
    await repository.insert(signalRow());
    expect(
      await asyncConstraintOf(() =>
        repository.insert(signalRow({ id: "00000000-0000-4000-8000-000000000002" })),
      ),
    ).toBe("ux_fraud_signals_rule_window");
  });

  it("نافذةٌ أخرى لنفس القاعدة مقبولة — الحدُّ على النافذة لا على القاعدة", async () => {
    const repository = new InMemoryFraudSignalRepository();
    await repository.insert(signalRow());
    await repository.insert(
      signalRow({
        id: "00000000-0000-4000-8000-000000000002",
        windowStartedAt: "2026-02-02T00:00:00.000Z",
        windowEndedAt: "2026-03-04T00:00:00.000Z",
      }),
    );
    expect(await repository.list({ subjectPublicId: "WS-2000000002" })).toHaveLength(2);
  });
});
