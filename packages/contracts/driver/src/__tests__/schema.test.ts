import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(__dirname, "../../../../../services/drivers/contracts/schema.sql"), "utf8");

describe("ADR-012 driver schema invariants", () => {
  it("checks opaque WS public-id format on the role profile key", () => {
    expect(schemaSql).toContain("wasla_public_id ~ '^WS-[0-9]{10}$'");
  });
  it("requires a reason code for every suspension", () => expect(schemaSql).toContain("ck_driver_profiles_suspension_reason"));
  it("allows at most one primary vehicle per driver", () => expect(schemaSql).toContain("ux_driver_vehicles_one_primary"));
  it("forbids a retired vehicle from staying primary", () => expect(schemaSql).toContain("ck_driver_vehicles_retired_not_primary"));
  it("keeps a document review coherent with its decision", () => expect(schemaSql).toContain("ck_driver_documents_review_coherence"));
  it("allows one live document per type", () => expect(schemaSql).toContain("ux_driver_documents_one_live_per_type"));
  it("forbids an unknown required document type in a policy", () => expect(schemaSql).toContain("ck_policy_required_documents_known"));
  it("forbids an ineligible verdict without a reason", () => expect(schemaSql).toContain("ck_eligibility_log_reasons"));
  it("records the outcome of every candidacy publication attempt", () => expect(schemaSql).toContain("ck_candidacy_publication_outcome"));
});

describe("ADR-012 decision 2: eligibility is a function, not a column", () => {
  /** عمود أهليّة مخزّن يتخلّف عن مصادره بصمت — وهذا هو الحارس الذي يمنع عودته. */
  it("stores no eligibility_state column on the profile", () => {
    const profile = schemaSql.slice(
      schemaSql.indexOf("CREATE TABLE IF NOT EXISTS driver_profiles"),
      schemaSql.indexOf("CREATE TABLE IF NOT EXISTS driver_service_zones"),
    );
    expect(profile).not.toMatch(/^\s+eligibility_state\s/m);
    expect(profile).not.toMatch(/^\s+is_eligible\s/m);
  });
  it("keeps the tick index on the profile", () => expect(schemaSql).toContain("eligibility_recheck_at"));
  it("versions the eligibility policy and can freeze it", () => {
    expect(schemaSql).toContain("driver_eligibility_policies");
    expect(schemaSql).toContain("is_frozen");
  });
  it("seeds exactly one frozen launch policy", () => {
    expect(schemaSql).toContain("VALUES (1, 'saudi-launch-v1', true)");
  });
});

describe("ADR-012 decision 5: expiry is stored data, never a stored state", () => {
  it("declares no expired document status", () => {
    const documents = schemaSql.slice(
      schemaSql.indexOf("CREATE TABLE IF NOT EXISTS driver_documents"),
      schemaSql.indexOf("CREATE TABLE IF NOT EXISTS driver_eligibility_policies"),
    );
    expect(documents).not.toContain("'expired'");
    expect(documents).toContain("expires_at");
  });
});

describe("ADR-012 decision 7: out-of-scope concerns own no column here", () => {
  /** عمودٌ يُضاف قبل مالكه يُملأ بقيَم يخترعها من لا يملك القرار. */
  for (const forbidden of [
    "subscription_status", "subscription", "rating", "reputation",
    "acceptance_rate", "completion_rate", "iban", "bank_account",
    "telegram_id", "chat_id", "phone", "national_id_number",
    "latitude", "longitude",
  ]) {
    it(`declares no ${forbidden} column`, () => {
      expect(schemaSql).not.toMatch(new RegExp(`^\\s+${forbidden}\\s`, "m"));
    });
  }
});

/**
 * لوحة المركبة **تُخزّن ولا تُنشر**: المراجعة الإدارية تحتاج مطابقة اللوحة برخصة السير،
 * ولا مستهلك حدث يحتاجها. فالحدّ هنا ليس «لا تُخزّن» بل «لا تعبر حدّ الخدمة» — وحارسه في events.test.ts.
 */
describe("plate number is stored but never published", () => {
  it("keeps the plate on the vehicle row, nullable", () => {
    expect(schemaSql).toMatch(/^\s+plate_number\s+TEXT\s/m);
    expect(schemaSql).toContain("plate_number IS NULL OR");
  });
});
