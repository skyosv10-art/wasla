/**
 * Drift guard: the code, the schema seed, and the document must agree.
 *
 * This test reads `contracts/schema.sql` and `docs/03-domain/MATCHING_DISPATCH.md`
 * FROM DISK at runtime and compares them with the constants the ranking actually
 * uses. It is the only mechanism that makes "the weights are data, not code"
 * enforceable: without it, someone changes 40% to 50% in one of the three places
 * and every reader afterwards believes a different system exists — with no failing
 * test anywhere, because each file is self-consistent.
 *
 * Same discipline as the 46 contract guards in @wasla/contracts-matching (MR 1/6);
 * this one guards the numbers rather than the shapes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RULESET_V1, RULESET_V1_WEIGHTS, WEIGHTS_SUM, weightsSum } from "../domain/ruleset.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serviceRoot, "..", "..");

const schemaSql = readFileSync(path.join(serviceRoot, "contracts", "schema.sql"), "utf8");
const domainDoc = readFileSync(
  path.join(repoRoot, "docs", "03-domain", "MATCHING_DISPATCH.md"),
  "utf8",
);

/** The seeded `INSERT INTO matching_rulesets (...) VALUES (...)` weight row. */
function seededWeightsFromSchema(): number[] {
  const insert = /INSERT INTO matching_rulesets[\s\S]*?VALUES\s*\(([\s\S]*?)\)\s*ON CONFLICT/i.exec(
    schemaSql,
  );
  expect(insert, "schema.sql must seed matching_rulesets").not.toBeNull();
  const values = insert![1]!
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  // version, label, then the seven weights in the declared column order.
  const weights = values.slice(2, 9).map((value) => Number.parseInt(value, 10));
  expect(weights.every((value) => Number.isInteger(value))).toBe(true);
  return weights;
}

/** A `DEFAULT <n>` value of one column of `matching_rulesets`. */
function schemaDefault(column: string): number {
  const pattern = new RegExp(`${column}\\s+INTEGER\\s+NOT NULL\\s+DEFAULT\\s+(\\d+)`, "i");
  const match = pattern.exec(schemaSql);
  expect(match, `schema.sql must declare a default for ${column}`).not.toBeNull();
  return Number.parseInt(match![1]!, 10);
}

/** A `| label | … | **N%** | …` row of the weights table in §5 of the document. */
function documentedWeight(label: string): number {
  const pattern = new RegExp(`\\|\\s*${label}\\s*\\|[^|]*\\|\\s*\\*\\*(\\d+)%\\*\\*\\s*\\|`);
  const match = pattern.exec(domainDoc);
  expect(match, `MATCHING_DISPATCH.md §5 must document the weight of ${label}`).not.toBeNull();
  return Number.parseInt(match![1]!, 10);
}

describe("ruleset version 1 matches the seeded schema", () => {
  it("uses the same seven weights, in the same column order", () => {
    expect(seededWeightsFromSchema()).toEqual([
      RULESET_V1_WEIGHTS.eta,
      RULESET_V1_WEIGHTS.distance,
      RULESET_V1_WEIGHTS.zoneProximity,
      RULESET_V1_WEIGHTS.completion,
      RULESET_V1_WEIGHTS.rating,
      RULESET_V1_WEIGHTS.acceptance,
      RULESET_V1_WEIGHTS.fairness,
    ]);
  });

  it("uses the same label as the seeded row", () => {
    expect(schemaSql).toContain(`'${RULESET_V1.label}'`);
  });

  it("is seeded frozen, and is frozen in code", () => {
    expect(/1, '.*?',[\s\S]*?TRUE, now\(\)/.test(schemaSql)).toBe(true);
    expect(RULESET_V1.isFrozen).toBe(true);
  });

  it("uses the schema defaults for the filter parameters", () => {
    expect(RULESET_V1.candidacyFreshnessSeconds).toBe(schemaDefault("candidacy_freshness_seconds"));
    expect(RULESET_V1.maxCandidates).toBe(schemaDefault("max_candidates"));
    expect(RULESET_V1.fairnessHorizonSeconds).toBe(schemaDefault("fairness_horizon_seconds"));
  });

  it("stays inside the ranges the schema constrains", () => {
    expect(RULESET_V1.candidacyFreshnessSeconds).toBeGreaterThanOrEqual(15);
    expect(RULESET_V1.candidacyFreshnessSeconds).toBeLessThanOrEqual(3_600);
    expect(RULESET_V1.maxCandidates).toBeGreaterThanOrEqual(1);
    expect(RULESET_V1.maxCandidates).toBeLessThanOrEqual(200);
    expect(RULESET_V1.fairnessHorizonSeconds).toBeGreaterThanOrEqual(60);
    expect(RULESET_V1.fairnessHorizonSeconds).toBeLessThanOrEqual(86_400);
  });
});

describe("ruleset version 1 matches the domain document", () => {
  it("uses the weights documented in §5", () => {
    expect(documentedWeight("ETA")).toBe(RULESET_V1_WEIGHTS.eta);
    expect(documentedWeight("المسافة")).toBe(RULESET_V1_WEIGHTS.distance);
    expect(documentedWeight("قرب المنطقة")).toBe(RULESET_V1_WEIGHTS.zoneProximity);
    expect(documentedWeight("الإتمام")).toBe(RULESET_V1_WEIGHTS.completion);
    expect(documentedWeight("التقييم")).toBe(RULESET_V1_WEIGHTS.rating);
    expect(documentedWeight("القبول")).toBe(RULESET_V1_WEIGHTS.acceptance);
    expect(documentedWeight("العدالة")).toBe(RULESET_V1_WEIGHTS.fairness);
  });

  it("keeps the declared zeros declared rather than deleting them", () => {
    // A deleted row would turn "measured, weighted zero today" into "nobody
    // thought about it", which is exactly the distinction §5 exists to preserve.
    expect(RULESET_V1_WEIGHTS.eta).toBe(0);
    expect(RULESET_V1_WEIGHTS.distance).toBe(0);
    expect(RULESET_V1_WEIGHTS.rating).toBe(0);
  });

  it("sums to one hundred, as the document and the database CHECK both require", () => {
    expect(weightsSum(RULESET_V1_WEIGHTS)).toBe(WEIGHTS_SUM);
    expect(schemaSql).toMatch(/w_eta \+ w_distance \+ w_zone_proximity/);
  });
});
