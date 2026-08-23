import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRAUD_RULE_CODES, FRAUD_SEVERITIES, REPUTATION_FACT_KINDS,
  REPUTATION_LAUNCH_RULESET_LABEL, REPUTATION_LAUNCH_RULESET_VERSION,
  REPUTATION_RATING_MAX_STARS, REPUTATION_RATING_MIN_STARS, REPUTATION_RATING_REASON_CODES,
  REPUTATION_SUBJECT_TYPES, REPUTATION_TIERS,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(
  resolve(__dirname, "../../../../../services/reputation/contracts/schema.sql"), "utf8",
);
/**
 * المخطّط بلا تعليقات. الحرّاس السالبة تُقرأ على هذا لا على الملفّ كلّه، لأنّ الملفّ يشرح
 * **لماذا لا يوجد** `comment` و`is_fraudster` — وحارسٌ يقرأ الشرح يجعل أقرب إصلاحٍ حذفَ
 * التوضيح لا حذفَ التسريب. الحدّ يُفرض على الكود، والتفسير حرّ.
 */
const schemaCode = schemaSql
  .split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
/** يقتصّ نصّ تعريف جدول واحد كي لا يمرّ حارسٌ سالب بسبب عمودٍ في جدولٍ آخر. */
function table(name: string): string {
  const start = schemaSql.indexOf(`CREATE TABLE IF NOT EXISTS ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const end = schemaSql.indexOf("\nCREATE TABLE IF NOT EXISTS ", start + 1);
  return schemaSql.slice(start, end === -1 ? undefined : end);
}
/** يستخرج قائمة `IN (...)` لعمود بعينه ليقارنها بالثابت المُصدَّر حرفاً بحرف. */
function inList(sql: string, column: string): string[] {
  const m = new RegExp(`${column}[^\\n]*?IN \\(([^)]*)\\)`, "s").exec(sql);
  expect(m, `${column} must constrain its values`).not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe("ADR-014 reputation schema invariants", () => {
  it("declares the nine tables of the phase and no more", () => {
    expect([...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!).sort()).toEqual([
      "fraud_signals", "reputation_facts", "reputation_fraud_thresholds", "reputation_idempotency",
      "reputation_outbox", "reputation_ratings", "reputation_rule_weights", "reputation_rulesets",
      "reputation_scores",
    ]);
  });
  it("checks the opaque public-id formats of the subject, the rater and the order", () => {
    expect(schemaSql).toContain("subject_public_id ~ '^WS-[0-9]{10}$'");
    expect(schemaSql).toContain("rater_public_id ~ '^WS-[0-9]{10}$'");
    expect(schemaSql).toContain("order_public_id ~ '^ORD-[0-9]{10}$'");
  });
  it("keeps every enum column identical to the exported constant", () => {
    expect(inList(table("reputation_facts"), "fact_kind")).toEqual([...REPUTATION_FACT_KINDS]);
    expect(inList(table("reputation_facts"), "subject_type")).toEqual([...REPUTATION_SUBJECT_TYPES]);
    expect(inList(table("reputation_rule_weights"), "fact_kind")).toEqual([...REPUTATION_FACT_KINDS]);
    expect(inList(table("reputation_scores"), "tier")).toEqual([...REPUTATION_TIERS]);
    expect(inList(table("reputation_ratings"), "reason_code")).toEqual([...REPUTATION_RATING_REASON_CODES]);
    expect(inList(table("reputation_ratings"), "rater_type")).toEqual([...REPUTATION_SUBJECT_TYPES]);
    expect(inList(table("fraud_signals"), "rule_code")).toEqual([...FRAUD_RULE_CODES]);
    expect(inList(table("fraud_signals"), "severity")).toEqual([...FRAUD_SEVERITIES]);
    expect(inList(table("reputation_fraud_thresholds"), "rule_code")).toEqual([...FRAUD_RULE_CODES]);
  });
  it("seeds exactly one frozen launch ruleset, and freezes it in the seed row", () => {
    expect(schemaSql).toContain(`'${REPUTATION_LAUNCH_RULESET_LABEL}'`);
    expect(schemaSql).toContain(`VALUES (${REPUTATION_LAUNCH_RULESET_VERSION}, '${REPUTATION_LAUNCH_RULESET_LABEL}'`);
    expect(schemaSql).toContain("true)");
    expect([...schemaSql.matchAll(/INSERT INTO reputation_rulesets/g)]).toHaveLength(1);
  });
  /**
   * القرار 4: واقعةٌ بلا وزنٍ مُعلَن **تُرفض**. وزنٌ لكل نوعٍ يقع فعلاً على كل جانبٍ يقع
   * عليه، وإلّا صار الرفض عائقاً لا حماية.
   */
  it("seeds a weight for every fact kind that can happen on a side", () => {
    const weights = table("reputation_rule_weights");
    for (const [side, kind] of [
      ["customer", "order_completed"], ["customer", "order_cancelled_by_customer"],
      ["customer", "rating_received"], ["driver", "order_completed"],
      ["driver", "order_cancelled_by_driver"], ["driver", "assignment_accepted"],
      ["driver", "assignment_rejected"], ["driver", "assignment_timed_out"],
      ["driver", "rating_received"],
    ] as const) {
      expect(weights, `${side}/${kind}`).toMatch(new RegExp(`'${side}',\\s*'${kind}'`));
    }
  });
  it("seeds a threshold and a severity for every fraud rule", () => {
    const thresholds = table("reputation_fraud_thresholds");
    for (const rule of FRAUD_RULE_CODES) expect(thresholds, rule).toContain(`'${rule}'`);
  });
});

describe("ADR-014 decision 2: at-least-once is a database constraint, not a code habit", () => {
  /** الحارسُ الذي تعتمد عليه بوابة الخروج: إعادةُ الحدث نفسه لا تُنتج نقطةً ثانية. */
  it("makes a fact unique by its source, keyed by order and sequence", () => {
    const facts = table("reputation_facts");
    expect(facts).toContain("CONSTRAINT ux_reputation_facts_source");
    expect(facts).toMatch(/UNIQUE \(subject_type, subject_public_id, fact_kind, order_public_id, source_sequence\)/);
  });
  it("records where every fact came from", () => {
    const facts = table("reputation_facts");
    for (const column of ["source_event_type", "source_event_id", "source_sequence"]) {
      expect(facts, column).toContain(column);
    }
  });
  /** خلطُ زمن الوقوع بزمن التسجيل يجعل النافذة المتحرّكة تكذب عند أوّل إعادة تسليم. */
  it("separates when it happened from when we heard about it", () => {
    const facts = table("reputation_facts");
    expect(facts).toContain("occurred_at");
    expect(facts).toContain("recorded_at");
  });
  /** الدفتر append-only: قيدٌ يمنع تعديل صفٍّ لا يُكتب في DDL، لكن غيابَ الأعمدة يُعلنه. */
  it("keeps the ledger append-only in shape: no updated_at and no soft-delete column", () => {
    const facts = table("reputation_facts");
    for (const column of ["updated_at", "deleted_at", "is_deleted", "revoked_at"]) {
      expect(facts, column).not.toContain(column);
    }
  });
  it("gives the sliding window its index, so a fraud rule is a query not a scan", () => {
    expect(schemaSql).toContain("ix_reputation_facts_kind_window");
  });
});

describe("ADR-014 decision 3 · 4: a derived value must be reproducible", () => {
  it("stamps the ruleset version on every derived row", () => {
    for (const name of ["reputation_scores", "reputation_ratings", "fraud_signals"]) {
      expect(table(name), name).toContain("ruleset_version");
    }
  });
  it("records how far the score was computed, so freshness is an answer not a guess", () => {
    const scores = table("reputation_scores");
    expect(scores).toContain("fact_count");
    expect(scores).toContain("computed_through_fact_id");
    expect(scores).toContain("computed_at");
  });
  /** النبضةُ تحتاج فهرساً للاستحقاق، لا مؤقّتاً في الذاكرة (القرار 8). */
  it("indexes the recompute due time, because time moves by tick", () => {
    expect(table("reputation_scores")).toContain("next_recompute_at");
    expect(schemaSql).toContain("ix_reputation_scores_recompute_due");
  });
  /** النقاط تُجمَع وتُقارَن: عائمٌ يجعل جمعَ نفس الوقائع يُعطي رقمين مختلفين. */
  it("uses integers for every number that is added or compared", () => {
    expect(schemaCode).not.toMatch(/\bNUMERIC\b/i);
    expect(schemaCode).not.toMatch(/\bDECIMAL\b/i);
    expect(schemaCode).not.toMatch(/\bREAL\b/i);
    expect(schemaCode).not.toMatch(/\bDOUBLE PRECISION\b/i);
    expect(schemaCode).not.toMatch(/\bFLOAT\b/i);
  });
});

describe("ADR-014 decision 5 · 6: a rating is a score, a signal is an observation", () => {
  /** غيابُ النصّ مقصود ومُعلَن كي لا يُضاف لاحقاً بحسن نيّة: النصّ يحتاج تنقيحاً ومالكاً. */
  it("stores no free text on a rating", () => {
    const ratings = table("reputation_ratings").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    for (const column of ["comment", "note", "body", "review_text", "message", "text"]) {
      expect(ratings, column).not.toContain(column);
    }
  });
  it("bounds the stars in the DDL", () => {
    expect(table("reputation_ratings")).toContain(
      `stars                   SMALLINT    NOT NULL CHECK (stars BETWEEN ${REPUTATION_RATING_MIN_STARS} AND ${REPUTATION_RATING_MAX_STARS})`,
    );
  });
  it("refuses a self rating and a same-side rating in the DDL, not only in the domain", () => {
    const ratings = table("reputation_ratings");
    expect(ratings).toContain("CONSTRAINT ck_reputation_ratings_no_self");
    expect(ratings).toContain("CONSTRAINT ck_reputation_ratings_cross_side");
  });
  it("keeps one rating per order, rater and subject", () => {
    expect(table("reputation_ratings")).toContain("CONSTRAINT ux_reputation_ratings_order_pair");
  });
  /** إشارةٌ بعددٍ دون العتبة إشارةٌ لا سبب لها، والنبضةُ تُعاد فلا تتكرّر بها الإشارة. */
  it("makes a fraud signal explain itself and not repeat with the tick", () => {
    const signals = table("fraud_signals");
    for (const column of ["window_started_at", "window_ended_at", "observed_count", "threshold_count"]) {
      expect(signals, column).toContain(column);
    }
    expect(signals).toContain("CONSTRAINT ck_fraud_signals_over_threshold");
    expect(signals).toContain("CONSTRAINT ux_fraud_signals_rule_window");
  });
  /** لا بتَّ في الإشارة هنا: المراجعة البشرية Phase 15، والحكمُ ليس ملكَ خدمةِ قياس. */
  it("stores no verdict on a fraud signal", () => {
    const signals = table("fraud_signals").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    for (const column of [
      "state", "resolution", "resolved_at", "decision", "is_fraudster", "confirmed",
      "penalty", "suspended", "blocked",
    ]) expect(signals, column).not.toContain(column);
  });
});

describe("reputation persistence plumbing matches the earlier phases", () => {
  it("keeps an idempotency ledger with a fingerprint and the four write scopes", () => {
    const idem = table("reputation_idempotency");
    expect(idem).toContain("payload_fingerprint");
    expect(inList(idem, "scope")).toEqual(["record_fact", "submit_rating", "recompute_score", "tick"]);
  });
  it("keeps an outbox so a decision and its event share one transaction", () => {
    const outbox = table("reputation_outbox");
    expect(inList(outbox, "aggregate_type")).toEqual([
      "reputation_fact", "reputation_score", "reputation_rating", "fraud_signal",
    ]);
    expect(outbox).toContain("published_at");
    expect(schemaSql).toContain("ix_reputation_outbox_unpublished");
  });
  it("ships a reverse migration, so the phase is undoable", () => {
    expect(schemaSql).toContain("DROP TABLE IF EXISTS reputation_facts;");
    expect(schemaSql).toContain("DROP TABLE IF EXISTS fraud_signals;");
  });
});
