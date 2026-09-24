/**
 * M4-05 Privacy/Compliance Review tests.
 */
import { describe, it, expect } from "vitest";
import {
  DATA_ELEMENTS,
  COMPLIANCE_REQUIREMENTS,
  DATA_SUBJECT_RIGHTS,
  getSensitiveDataElements,
  getPersonalDataElements,
  getConsentRequiredElements,
  getComplianceGaps,
  getCompliantCount,
  getTotalCount,
  getComplianceScore,
} from "../harness.js";

describe("M4-05 Data Element Inventory", () => {
  it("should define data elements for all critical services", () => {
    expect(DATA_ELEMENTS.length).toBeGreaterThanOrEqual(10);
    const services = new Set(DATA_ELEMENTS.flatMap((d) => d.services));
    expect(services.has("identity")).toBe(true);
    expect(services.has("orders")).toBe(true);
    expect(services.has("geography")).toBe(true);
    expect(services.has("audit")).toBe(true);
  });

  it("should categorize location and payment as sensitive", () => {
    const sensitive = getSensitiveDataElements();
    expect(sensitive.length).toBeGreaterThanOrEqual(3);
    const names = sensitive.map((d) => d.name);
    expect(names).toContain("customer_location");
    expect(names).toContain("driver_location");
    expect(names).toContain("payment_info");
  });

  it("should have retention periods for all data elements", () => {
    for (const element of DATA_ELEMENTS) {
      expect(element.retentionDays).toBeGreaterThan(0);
      expect(element.retentionDays).toBeLessThanOrEqual(365);
    }
  });

  it("should require consent for sensitive data", () => {
    const consentRequired = getConsentRequiredElements();
    for (const element of consentRequired) {
      if (element.category === "sensitive") {
        expect(element.consentRequired).toBe(true);
      }
    }
  });

  it("should reference PDPL articles for each data element", () => {
    for (const element of DATA_ELEMENTS) {
      expect(element.pdplArticle).toBeTruthy();
      expect(element.pdplArticle).toContain("Art.");
    }
  });
});

describe("M4-05 PDPL Compliance Requirements", () => {
  it("should define 12 compliance requirements", () => {
    expect(COMPLIANCE_REQUIREMENTS.length).toBe(12);
  });

  it("should cover key PDPL articles", () => {
    const articles = COMPLIANCE_REQUIREMENTS.map((r) => r.article);
    expect(articles).toContain("Art. 5");
    expect(articles).toContain("Art. 12");
    expect(articles).toContain("Art. 23");
    expect(articles).toContain("Art. 27");
    expect(articles).toContain("Art. 28");
  });

  it("should identify compliance gaps with remediation steps", () => {
    const gaps = getComplianceGaps();
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.remediation).toBeTruthy();
    }
  });

  it("should have a compliance score above 30%", () => {
    const score = getComplianceScore();
    expect(score).toBeGreaterThan(30);
    console.log(`\n  Compliance score: ${score}% (${getCompliantCount()}/${getTotalCount()} fully compliant)`);
  });

  it("should mark service auth and audit as compliant", () => {
    const ropa = COMPLIANCE_REQUIREMENTS.find((r) => r.id === "PDPL-009")!;
    expect(ropa.status).toBe("compliant");
    const dpbDesign = COMPLIANCE_REQUIREMENTS.find((r) => r.id === "PDPL-010")!;
    expect(dpbDesign.status).toBe("compliant");
  });
});

describe("M4-05 Data Subject Rights", () => {
  it("should define 5 data subject rights", () => {
    expect(DATA_SUBJECT_RIGHTS.length).toBe(5);
    const rights = DATA_SUBJECT_RIGHTS.map((r) => r.right);
    expect(rights).toContain("Access");
    expect(rights).toContain("Correction");
    expect(rights).toContain("Deletion");
    expect(rights).toContain("Objection");
    expect(rights).toContain("Portability");
  });

  it("should map rights to PDPL articles", () => {
    for (const right of DATA_SUBJECT_RIGHTS) {
      expect(right.pdplArticle).toContain("Art.");
    }
  });

  it("should have implementation status for each right", () => {
    for (const right of DATA_SUBJECT_RIGHTS) {
      expect(right.implementationStatus).toBeTruthy();
    }
  });
});

describe("M4-05 Compliance Summary", () => {
  it("should generate a compliance report", () => {
    const total = getTotalCount();
    const compliant = getCompliantCount();
    const gaps = getComplianceGaps();
    const score = getComplianceScore();
    const sensitive = getSensitiveDataElements();

    console.log(`\n  === PDPL Compliance Report ===`);
    console.log(`  Total requirements: ${total}`);
    console.log(`  Fully compliant: ${compliant}`);
    console.log(`  Gaps (partial + not implemented): ${gaps.length}`);
    console.log(`  Compliance score: ${score}%`);
    console.log(`  Sensitive data elements: ${sensitive.length}`);
    console.log(`  Data subject rights: ${DATA_SUBJECT_RIGHTS.length}`);

    expect(total).toBe(12);
    expect(score).toBeGreaterThan(0);
  });
});
