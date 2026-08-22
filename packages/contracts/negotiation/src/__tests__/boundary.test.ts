import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NEGOTIATION_API_PATHS, NEGOTIATION_SERVICE_PORT } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/negotiations/contracts");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
const readme = readFileSync(resolve(base, "README.md"), "utf8");

/** **سطح المسارات والعمليات وحده** — بلا أسماء مكوّنات ولا نثر تفسيري. */
const routeSurface = api.split("\n")
  .filter((line) => /^  \/|^      operationId:/.test(line))
  .join("\n").toLowerCase();
/** سطح المكوّنات المُسمّاة، لحدودٍ يجب أن تغيب حتى كنوع بيانات (دفع · سمعة · تسعير). */
const surface = api.split("\n")
  .filter((line) => /^  \/|^    [A-Z][A-Za-z0-9]+:|^      operationId:/.test(line))
  .join("\n").toLowerCase();
/**
 * **أسماء المفاتيح وقيم التعدادات وحدها** — بلا `description` ولا `summary`.
 *
 * العقد يشرح **لماذا لا يوجد** `chat_id` ولماذا القناة طبقة توصيل (ADR-007)؛ وحارسٌ
 * يقرأ النّص التفسيري يجعل أقرب إصلاحٍ حذفَ التوضيح لا حذفَ التسريب. الحدّ يُفرض على
 * ما يراه المستهلك في الحمولة، والتفسير حرّ.
 */
const machineSurface = [
  ...api.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):/gm),
  ...api.matchAll(/^\s*-\s+([A-Za-z0-9_./{}-]+)\s*$/gm),
].map((m) => m[1]!).join("\n").toLowerCase();
/** المخطّط بلا تعليقات، لنفس السبب. */
const schemaCode = schema.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n").toLowerCase();

describe("ADR-013 negotiation boundary", () => {
  it("exposes no order, dispatch, matching or identity route", () => {
    for (const token of [
      "/orders", "/dispatch", "/offers", "/wave", "/assignment", "/candidate",
      "/drivers", "/customers", "/users", "/zones",
    ]) expect(routeSurface, token).not.toContain(token);
  });
  it("keeps every route under /negotiations, plus /health", () => {
    for (const path of NEGOTIATION_API_PATHS) {
      expect(path === "/health" || path.startsWith("/negotiations"), path).toBe(true);
    }
  });
  it("has no foreign key outside its own tables", () => {
    expect(schemaCode).not.toMatch(
      /REFERENCES\s+(?!negotiation_policies\b|negotiation_threads\b|negotiation_rounds\b|negotiation_messages\b|negotiation_agreements\b)[a-z_]+/i,
    );
  });
  /** `dispatch_offer_id` و`*_public_id` مراجع opaque: لا مفتاح أجنبي عبر حدود خدمة. */
  it("keys cross-service references as opaque values, never as foreign keys", () => {
    expect(schemaCode).toContain("dispatch_offer_id");
    for (const table of ["dispatch_offers", "orders", "driver_profiles", "customer_profiles", "users"]) {
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
});

describe("ADR-013 decision 2: the boundary that keeps the order engine sovereign", () => {
  /**
   * لا مسار هنا يكتب في الطلب، ولا مسار يقرأ حالته. التسليم منفذٌ صادر واحد
   * (`AgreedPricePort`) يُنفَّذ في MR 5/6، ومحرّك الطلب وحده يسجّل السعر.
   */
  it("exposes no route that writes an order", () => {
    for (const token of ["order-price", "orderprice", "setprice", "updateorder", "confirmorder"]) {
      expect(routeSurface, token).not.toContain(token);
    }
  });
  it("declares the hand-off as a state to read, not an error to raise", () => {
    expect(machineSurface).toContain("handoff_state");
    expect(api).not.toContain("'502'");
    expect(api).not.toMatch(/^\s+502:/m);
  });
  /** الدَّين المُعلَن: محرّك الطلب لا يملك عمود سعرٍ متَّفق عليه بعد. */
  it("names the order engine as the owner of the recorded price", () => {
    expect(readme).toContain("AgreedPricePort");
    expect(readme).toContain("لا كتابة في `orders`");
  });
});

describe("ADR-013 decision 8: out-of-scope concerns own no surface here", () => {
  it("exposes no payment, settlement, reputation, pricing or attachment surface", () => {
    for (const token of [
      "payment", "settle", "payout", "invoice", "commission", "wallet",
      "reputation", "trust", "fraud", "rating", "review",
      "suggest", "estimate", "tariff", "surge",
      "attachment", "upload", "media", "image", "voice",
      "translate", "translation",
    ]) expect(surface, token).not.toContain(token);
  });
  /** ولا حتّى كحقل في حمولة: عمودٌ لا مالك له يُملأ بتخمين. */
  it("declares no out-of-scope field on any request or response body", () => {
    for (const token of [
      "payment_status", "paid_at", "payout", "commission", "trust_score", "fraud_score",
      "suggested_amount_minor", "attachment_url", "translated_body",
    ]) expect(machineSurface, token).not.toContain(token);
  });
  /** لا مزاد: لا مسار يقرأ عروض عدّة سائقين على طلبٍ واحد. */
  it("exposes no auction, bid or broadcast route", () => {
    for (const token of ["auction", "bid", "broadcast", "compete", "bulk"]) {
      expect(routeSurface, token).not.toContain(token);
    }
  });
});

describe("negotiation port allocation", () => {
  /** المنفذ يقيم في حزمة العقد لا في الخدمة: نسخته في مستهلك تُنتج حقيقتين. */
  it("claims 8091, the next port after drivers 8090", () => {
    expect(NEGOTIATION_SERVICE_PORT).toBe(8091);
    expect(api).toContain(`localhost:${NEGOTIATION_SERVICE_PORT}`);
    expect(readme).toContain("8091");
  });
  it("claims no port already allocated to an earlier phase", () => {
    for (const taken of [8081, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090]) {
      expect(NEGOTIATION_SERVICE_PORT, String(taken)).not.toBe(taken);
      expect(api, String(taken)).not.toContain(`localhost:${taken}`);
    }
  });
});
