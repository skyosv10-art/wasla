import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPUTATION_API_PATHS, REPUTATION_SERVICE_PORT, REPUTATION_SOURCE_EVENT_TYPES } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/reputation/contracts");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
const readme = readFileSync(resolve(base, "README.md"), "utf8");

/** **سطح المسارات والعمليات وحده** — بلا أسماء مكوّنات ولا نثر تفسيري. */
const routeSurface = api.split("\n")
  .filter((line) => /^  \/|^      operationId:/.test(line))
  .join("\n").toLowerCase();
/** سطح المكوّنات المُسمّاة، لحدودٍ يجب أن تغيب حتى كنوع بيانات (دفع · تسعير · اشتراك). */
const surface = api.split("\n")
  .filter((line) => /^  \/|^    [A-Z][A-Za-z0-9]+:|^      operationId:/.test(line))
  .join("\n").toLowerCase();
/**
 * **أسماء المفاتيح وقيم التعدادات وحدها** — بلا `description` ولا `summary`.
 *
 * العقد يشرح **لماذا لا يوجد** إيقافٌ ولماذا العقوبة ليست ملكَ خدمةِ قياس (ADR-014
 * القرار 7)؛ وحارسٌ يقرأ النّص التفسيري يجعل أقرب إصلاحٍ حذفَ التوضيح لا حذفَ التسريب.
 * الحدّ يُفرض على ما يراه المستهلك في الحمولة، والتفسير حرّ.
 */
const machineSurface = [
  ...api.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):/gm),
  ...api.matchAll(/^\s*-\s+([A-Za-z0-9_./{}-]+)\s*$/gm),
].map((m) => m[1]!).join("\n").toLowerCase();
/** المخطّط بلا تعليقات، لنفس السبب. */
const schemaCode = schema.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n").toLowerCase();

describe("ADR-014 reputation boundary", () => {
  it("exposes no order, dispatch, matching, driver or identity route", () => {
    for (const token of [
      "/orders", "/dispatch", "/offers", "/wave", "/assignment", "/candidate",
      "/drivers", "/customers", "/users", "/zones", "/negotiations",
    ]) expect(routeSurface, token).not.toContain(token);
  });
  it("keeps every route under /reputation, plus /health", () => {
    for (const path of REPUTATION_API_PATHS) {
      expect(path === "/health" || path.startsWith("/reputation"), path).toBe(true);
    }
  });
  it("has no foreign key outside its own tables", () => {
    expect(schemaCode).not.toMatch(
      /REFERENCES\s+(?!reputation_rulesets\b|reputation_facts\b|reputation_scores\b|reputation_ratings\b|fraud_signals\b)[a-z_]+/i,
    );
  });
  /** `*_public_id` مراجع opaque: لا مفتاح أجنبي عبر حدود خدمة، ولا ملفّ مستخدمٍ هنا. */
  it("keys cross-service references as opaque values, never as foreign keys", () => {
    expect(schemaCode).toContain("subject_public_id");
    expect(schemaCode).toContain("order_public_id");
    for (const table of ["orders", "driver_profiles", "customer_profiles", "users", "dispatch_offers"]) {
      expect(schemaCode, table).not.toMatch(new RegExp(`references\\s+${table}\\b`, "i"));
    }
  });
  /** طبقة التوصيل (ADR-007): القناة لا تعبر عقد مجال، لا في مسار ولا في مخطّط. */
  it("names no delivery channel anywhere in the contract surface", () => {
    for (const token of ["telegram", "chat_id", "whatsapp", "webhook", "bot_token", "sms"]) {
      expect(machineSurface, token).not.toContain(token);
      expect(schemaCode, token).not.toContain(token);
    }
  });
  /** القرار 9: لا بيانات شخصية ولا إحداثيات. السمعة تُقاس بمُعرّفٍ عامّ لا بشخصٍ موصوف. */
  it("stores no personal data and no coordinate", () => {
    for (const token of ["display_name", "full_name", "phone", "email", "national_id", "latitude", "longitude"]) {
      expect(machineSurface, token).not.toContain(token);
      expect(schemaCode, token).not.toContain(token);
    }
  });
});

describe("ADR-014 decision 7: the boundary that keeps this service from punishing", () => {
  /**
   * الحارسُ الأهمّ في الطور. خدمةُ قياسٍ تملك زرَّ إيقافٍ تصبح محكمةً بلا قاضٍ: الإيقاف
   * ملكُ `services/drivers` (ADR-012 القرار 3) والقرارُ الإداريّ ملكُ Phase 15.
   */
  it("exposes no route that suspends, blocks or penalizes", () => {
    for (const token of [
      "suspend", "block", "unblock", "banned", "penal", "punish",
      "deactivate", "disable", "restrict", "blacklist",
    ]) expect(routeSurface, token).not.toContain(token);
  });
  it("declares no punitive field on any request or response body", () => {
    for (const token of [
      "is_suspended", "is_blocked", "is_banned", "is_fraudster", "penalty",
      "suspended_at", "blocked_at", "restriction", "punishment", "eligible",
    ]) expect(machineSurface, token).not.toContain(token);
    for (const column of [
      "is_suspended", "is_blocked", "is_banned", "is_fraudster", "penalty", "blacklist",
    ]) expect(schemaCode, column).not.toContain(column);
  });
  /** الرتبة تسميةٌ تُقرأ ولا تُنفَّذ: من يبني عليها قراراً يبنيه في خدمته ويملك أثره. */
  it("names the owner of eligibility and of the administrative decision", () => {
    expect(readme).toContain("services/drivers");
    expect(readme).toContain("لا تعاقب");
  });
});

describe("ADR-014 decisions 1 · 6: measurement, not a model and not a verdict", () => {
  /** إشارةٌ تقول «0.87» لا يمكن مراجعتها ولا الردّ عليها: لا احتمال ولا نموذج هنا. */
  it("declares no probability, model or confidence surface", () => {
    for (const token of [
      "probability", "confidence", "model_version", "prediction", "predicted",
      "anomaly_score", "risk_score", "ml_",
    ]) {
      expect(machineSurface, token).not.toContain(token);
      expect(schemaCode, token).not.toContain(token);
    }
  });
  /** القرار 1: `services/fraud` تبقى فارغة، والانحراف مُعلَنٌ في العقد لا مكتومٌ في الكود. */
  it("declares the single-service deviation in the README", () => {
    expect(readme).toContain("services/fraud");
    expect(readme).toContain("ADR-014");
  });
});

describe("ADR-014 decision 8 · out-of-scope concerns own no surface here", () => {
  it("exposes no payment, settlement, subscription, reward or pricing surface", () => {
    for (const token of [
      "payment", "settle", "payout", "invoice", "commission", "wallet",
      "subscription", "reward", "bonus", "referral",
      "price", "tariff", "surge", "discount",
      "attachment", "upload", "media", "image", "voice",
      "translate", "translation", "moderat",
    ]) expect(surface, token).not.toContain(token);
  });
  /** ولا حتّى كعمود: عمودٌ لا مالك له يُملأ بتخمين. */
  it("stores no out-of-scope column", () => {
    for (const column of [
      "amount_minor", "currency", "payment_status", "paid_at", "commission",
      "subscription_tier", "reward_points", "comment", "appeal",
    ]) expect(schemaCode, column).not.toContain(column);
  });
  /** لا مؤقّت: الزمن بابٌ واحد مُعلَن (القرار 8). */
  it("moves time only through the tick route", () => {
    expect([...REPUTATION_API_PATHS]).toContain("/reputation/tick");
    for (const token of ["cron", "scheduler", "timer", "interval_ms", "setinterval"]) {
      expect(machineSurface, token).not.toContain(token);
    }
  });
});

describe("reputation source events ↔ the published upstream catalog", () => {
  /**
   * مصدرُ الحقيقة حدثٌ منشور (القرار 2). القائمة تقيم في حزمة العقد كي يكون الاشتراك
   * مُعلَناً لمن يقرأ العقد بلا قراءة تنفيذ المستهلك في المراجعة 5/6.
   */
  it("subscribes only to the two published order events", () => {
    expect([...REPUTATION_SOURCE_EVENT_TYPES]).toEqual(["order.status_changed", "order.assignment_resolved"]);
  });
  it("names the order engine as the sole source of a fact, in the README", () => {
    expect(readme).toContain("order.status_changed");
    expect(readme).toContain("order.assignment_resolved");
  });
  /** قراءةٌ متزامنة من محرّك الطلب تُنتج اقتراناً واستطلاعاً: العقد لا يفتح لها باباً. */
  it("declares no synchronous read of the order engine", () => {
    for (const token of ["order_status", "orderstatus", "fetchorder", "getorder", "poll"]) {
      expect(machineSurface, token).not.toContain(token);
    }
  });
});

describe("reputation port allocation", () => {
  /** المنفذ يقيم في حزمة العقد لا في الخدمة: نسخته في مستهلك تُنتج حقيقتين. */
  it("claims 8092, the next port after negotiations 8091", () => {
    expect(REPUTATION_SERVICE_PORT).toBe(8092);
    expect(api).toContain(`localhost:${REPUTATION_SERVICE_PORT}`);
    expect(readme).toContain("8092");
  });
  it("claims no port already allocated to an earlier phase", () => {
    for (const taken of [8081, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090, 8091]) {
      expect(REPUTATION_SERVICE_PORT, String(taken)).not.toBe(taken);
      expect(api, String(taken)).not.toContain(`localhost:${taken}`);
    }
  });
});
