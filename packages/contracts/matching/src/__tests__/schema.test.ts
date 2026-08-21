import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(__dirname, "../../../../../services/matching/contracts/schema.sql"), "utf8");
describe("ADR-011 matching schema invariants", () => {
  it("requires matching ruleset weights to sum to 100", () => expect(schemaSql).toContain("ck_ruleset_weights_sum_100"));
  it("checks opaque WS public-id format", () => expect(schemaSql).toContain("driver_public_id ~ '^WS-[0-9]{10}$'"));
  it("forbids accepted offers exceeding received offers", () => expect(schemaSql).toContain("ck_candidacy_accepted_lte_received"));
  it("requires a reason for an empty decision", () => expect(schemaSql).toContain("ck_decision_empty_has_reason"));
  it("makes a decision rank unique", () => expect(schemaSql).toContain("CONSTRAINT ux_decision_rank UNIQUE (decision_id, rank)"));
});
