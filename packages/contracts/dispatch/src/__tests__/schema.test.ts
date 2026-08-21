import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(__dirname, "../../../../../services/dispatch/contracts/schema.sql"), "utf8");
describe("ADR-011 dispatch schema invariants", () => {
  it("allows only one open wave per job", () => expect(schemaSql).toContain("ux_dispatch_waves_one_open_job"));
  it("allows only one accepted offer per job", () => expect(schemaSql).toContain("ux_dispatch_offers_one_accepted_job"));
  it("forbids a repeated offer to the same driver for a job", () => expect(schemaSql).toContain("CONSTRAINT ux_dispatch_offers_job_driver UNIQUE (job_id, driver_public_id)"));
  it("requires a reason for every terminal job, wave, and offer", () => {
    for (const name of ["ck_dispatch_jobs_terminal_needs_reason", "ck_dispatch_waves_terminal_needs_reason", "ck_dispatch_offers_terminal_needs_reason"]) expect(schemaSql).toContain(name);
  });
  it("orders automated and escalation deadlines", () => expect(schemaSql).toContain("ck_dispatch_jobs_deadline_order CHECK (escalation_expires_at >= expires_at)"));
});
