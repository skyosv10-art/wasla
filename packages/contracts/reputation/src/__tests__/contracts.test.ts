import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRAUD_RULE_CODES, REPUTATION_API_PATHS, REPUTATION_ERROR_CLASS_STATUS,
  REPUTATION_ERROR_CODE_CLASS, REPUTATION_ERROR_CODES, REPUTATION_HTTP_STATUS_CODES,
  REPUTATION_RATING_MAX_STARS, REPUTATION_RATING_MIN_STARS, REPUTATION_SERVICE_PORT,
  httpStatusForReputationError,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/reputation/contracts");
const errorsMd = readFileSync(resolve(CONTRACTS_DIR, "errors.md"), "utf8");
const openApiYml = readFileSync(resolve(CONTRACTS_DIR, "api.openapi.yml"), "utf8");

function section(title: string): string {
  const start = errorsMd.indexOf(title); expect(start, `${title} must exist`).toBeGreaterThan(-1);
  const next = errorsMd.indexOf("\n## ", start + title.length);
  return errorsMd.slice(start, next === -1 ? undefined : next);
}
/** جدول الأكواد وحده يحمل عموداً برمز HTTP، فيُقرأ من قسمه لا من الملفّ كلّه. */
const errorRows = [...section("## أكواد الأخطاء").matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|/gm)]
  .map((m) => [m[1]!, Number(m[2]!)] as const);
function apiPaths(yml: string): string[] { return [...yml.matchAll(/^  (\/[^:]+):/gm)].map((m) => m[1]!); }
function apiStatuses(yml: string): number[] {
  return [...yml.matchAll(/^\s{8,}'?(\d{3})'?:/gm)].map((m) => Number(m[1]!));
}

describe("reputation error catalog ↔ errors.md", () => {
  it("exports every documented error code and no undocumented code", () => {
    expect(errorRows.map(([code]) => code).sort()).toEqual([...REPUTATION_ERROR_CODES].sort());
  });
  it("maps every code to its documented HTTP status", () => {
    for (const [code, status] of errorRows) expect(httpStatusForReputationError(code as never), code).toBe(status);
  });
  it("classes every exported code using a documented class", () => {
    for (const code of REPUTATION_ERROR_CODES) {
      expect(Object.keys(REPUTATION_ERROR_CLASS_STATUS)).toContain(REPUTATION_ERROR_CODE_CLASS[code]);
    }
  });
  it("keeps codes unique", () => expect(new Set(REPUTATION_ERROR_CODES).size).toBe(REPUTATION_ERROR_CODES.length));
  /** لا تابعَ متزامناً يُنتظر جوابه: الخدمة مستهلكٌ للأحداث لا وسيطٌ أمام خدمةٍ أخرى. */
  it("declares no 502: this service calls no upstream on the request path", () => {
    expect(Object.values(REPUTATION_ERROR_CLASS_STATUS)).not.toContain(502 as never);
    expect(Object.keys(REPUTATION_ERROR_CLASS_STATUS)).not.toContain("bad_gateway");
    expect([...REPUTATION_HTTP_STATUS_CODES]).not.toContain(502 as never);
    for (const code of REPUTATION_ERROR_CODES) expect(httpStatusForReputationError(code), code).not.toBe(502);
    for (const status of apiStatuses(openApiYml)) expect(status).not.toBe(502);
    expect(errorsMd).toContain("ما لا يُنتجه أي رمز");
  });
  /**
   * حارس الحدّ الأهمّ في ADR-014 (القرار 7). رمزٌ يقول «موقوف» يجعل مستهلكاً يفترض أنّ
   * السمعة تحجب، فيبني عليه سلوكاً لا مالك له. من يريد أحدها يكسر هذا الاختبار فيقرأ
   * السبب قبل أن يمنح خدمةَ قياسٍ سلطةَ عقاب.
   */
  it("declares no punitive code: this service measures, it does not punish", () => {
    for (const forbidden of [
      "REPUTATION_SUBJECT_SUSPENDED", "REPUTATION_SUBJECT_BANNED", "REPUTATION_SUBJECT_BLOCKED",
      "REPUTATION_FRAUD_DETECTED", "REPUTATION_FRAUD_CONFIRMED", "REPUTATION_PENALTY_APPLIED",
      "REPUTATION_SCORE_TOO_LOW", "REPUTATION_TIER_FORBIDDEN",
    ]) expect([...REPUTATION_ERROR_CODES]).not.toContain(forbidden as never);
  });
  /** رصدُ إشارةٍ ونشرُ حدثٍ ونبضةٌ متعثّرة نتائجُ عملٍ لا أخطاء: رمزٌ لها يُفسد كل عدّاد أخطاء. */
  it("declares no error code for a raised signal, a tick or a publish failure", () => {
    for (const forbidden of [
      "REPUTATION_SIGNAL_RAISED", "REPUTATION_TICK_FAILED", "REPUTATION_PUBLISH_FAILED",
      "REPUTATION_OUTBOX_FAILED", "REPUTATION_DECAY_FAILED",
    ]) expect([...REPUTATION_ERROR_CODES]).not.toContain(forbidden as never);
  });
  /** إعادةُ تسليم الحدث نفسه ليست خطأً: at-least-once يعني أنّ التكرار هو الطبيعي. */
  it("documents that an identical replay answers 200, not 409", () => {
    expect(errorsMd).toContain("REPUTATION_FACT_ALREADY_RECORDED");
    expect(openApiYml).toContain("duplicate");
  });
});

describe("reputation OpenAPI representation", () => {
  it("represents every documented path and no extra path", () => {
    expect(apiPaths(openApiYml).sort()).toEqual([...REPUTATION_API_PATHS].sort());
  });
  it("uses only the documented HTTP status codes", () => {
    for (const status of apiStatuses(openApiYml)) expect([...REPUTATION_HTTP_STATUS_CODES]).toContain(status as never);
  });
  it("declares the service port once, in the contract package", () => {
    expect(REPUTATION_SERVICE_PORT).toBe(8092);
    expect(openApiYml).toContain("localhost:8092");
  });
  it("refuses an unknown key on every request body (onlyKeys is a contract, not a habit)", () => {
    expect(openApiYml).toContain("additionalProperties: false");
  });
  /** `GET /reputation/facts` بلا مُرشِّح تعني قراءة دفتر كل الناس. */
  it("keeps a filter mandatory on the collection reads", () => {
    expect(errorRows.map(([code]) => code)).toContain("REPUTATION_FILTER_REQUIRED");
  });
  /** بابٌ واحد للزمن: `POST /reputation/tick` (القرار 8). لا مؤقّت في الذاكرة. */
  it("moves time by an explicit tick", () => {
    expect([...REPUTATION_API_PATHS]).toContain("/reputation/tick");
    expect(openApiYml).toContain("TickResult");
  });
  /** النتيجة مُشتقّة: مسارٌ يضبط نقاطاً يدوياً يهدم القرار 3 من جذره. */
  it("exposes recompute and exposes no way to set a score by hand", () => {
    expect([...REPUTATION_API_PATHS]).toContain("/reputation/scores/{subjectType}/{subjectPublicId}/recompute");
    for (const forbidden of ["setScore", "adjustScore", "overrideScore", "setTier", "suspendSubject"]) {
      expect(openApiYml, forbidden).not.toContain(forbidden);
    }
  });
});

describe("reputation rating and fraud surface", () => {
  it("bounds the stars in the contract, not in the interface", () => {
    expect(REPUTATION_RATING_MIN_STARS).toBe(1);
    expect(REPUTATION_RATING_MAX_STARS).toBe(5);
    expect(openApiYml).toContain("minimum: 1");
    expect(openApiYml).toContain("maximum: 5");
  });
  it("keeps fraud rule codes unique", () => {
    expect(new Set(FRAUD_RULE_CODES).size).toBe(FRAUD_RULE_CODES.length);
  });
  /** الإشارة تُقرأ ولا تُنشأ من الخارج ولا يُبتّ فيها هنا (القرار 6). */
  it("reads fraud signals and never writes or resolves one over HTTP", () => {
    const signals = openApiYml.slice(openApiYml.indexOf("  /reputation/fraud-signals:"));
    const block = signals.slice(0, signals.indexOf("\n  /", 1) === -1 ? undefined : signals.indexOf("\n  /", 1));
    expect(block).toContain("get:");
    expect(block).not.toContain("post:");
    expect(block).not.toContain("patch:");
    expect(block).not.toContain("delete:");
  });
});
