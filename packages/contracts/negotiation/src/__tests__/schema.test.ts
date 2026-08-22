import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NEGOTIATION_CLOSE_REASON_CODES, NEGOTIATION_HANDOFF_STATES, NEGOTIATION_LAUNCH_POLICY_LABEL,
  NEGOTIATION_LAUNCH_POLICY_VERSION, NEGOTIATION_PARTIES, NEGOTIATION_ROUND_STATES,
  NEGOTIATION_SERVICE_KINDS, NEGOTIATION_THREAD_STATES,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(
  resolve(__dirname, "../../../../../services/negotiations/contracts/schema.sql"), "utf8",
);
/**
 * المخطّط بلا تعليقات. الحرّاس السالبة تُقرأ على هذا لا على الملفّ كلّه، لأنّ الملفّ يشرح
 * **لماذا لا يوجد** `payment_status` و`chat_id` — وحارسٌ يقرأ الشرح يجعل أقرب إصلاحٍ
 * حذفَ التوضيح لا حذفَ التسريب. الحدّ يُفرض على الكود، والتفسير حرّ.
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
  const m = new RegExp(`${column}[^\\n]*?IN \\(([^)]*)\\)`, "s").exec(sql)
    ?? new RegExp(`${column}\\s+TEXT[\\s\\S]*?IN \\(([\\s\\S]*?)\\)\\)`, "").exec(sql);
  expect(m, `${column} must constrain its values`).not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe("ADR-013 negotiation schema invariants", () => {
  it("declares the eight tables of the phase and no more", () => {
    expect([...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!).sort()).toEqual([
      "negotiation_agreements", "negotiation_idempotency", "negotiation_messages",
      "negotiation_outbox", "negotiation_policies", "negotiation_price_handoffs",
      "negotiation_rounds", "negotiation_threads",
    ]);
  });
  it("checks the opaque public-id formats of both parties and the order", () => {
    expect(schemaSql).toContain("customer_public_id ~ '^WS-[0-9]{10}$'");
    expect(schemaSql).toContain("driver_public_id ~ '^WS-[0-9]{10}$'");
    expect(schemaSql).toContain("order_public_id ~ '^ORD-[0-9]{10}$'");
  });
  it("keeps every enum column identical to the exported constant", () => {
    const threads = table("negotiation_threads");
    expect(inList(threads, "state")).toEqual([...NEGOTIATION_THREAD_STATES]);
    expect(inList(threads, "close_reason_code")).toEqual([...NEGOTIATION_CLOSE_REASON_CODES]);
    expect(inList(threads, "service_kind")).toEqual([...NEGOTIATION_SERVICE_KINDS]);
    expect(inList(threads, "opened_by")).toEqual([...NEGOTIATION_PARTIES]);
    expect(inList(table("negotiation_rounds"), "state")).toEqual([...NEGOTIATION_ROUND_STATES]);
    expect(inList(table("negotiation_agreements"), "handoff_state")).toEqual([...NEGOTIATION_HANDOFF_STATES]);
  });
  it("seeds exactly one frozen launch policy, and freezes it in the seed row", () => {
    expect(schemaSql).toContain(
      `VALUES (${NEGOTIATION_LAUNCH_POLICY_VERSION}, '${NEGOTIATION_LAUNCH_POLICY_LABEL}', 'SAR'`,
    );
    expect(schemaSql).toMatch(/VALUES \(1, 'saudi-launch-v1'[^\n]*true\)/);
  });
});

describe("ADR-013 decision 1: one bilateral thread, never an auction", () => {
  it("allows at most one thread per (order × driver)", () => {
    expect(schemaSql).toContain("ux_negotiation_threads_order_driver UNIQUE (order_public_id, driver_public_id)");
  });
  it("binds a thread to at most one dispatch offer", () => {
    expect(schemaSql).toContain("ux_negotiation_threads_dispatch_offer UNIQUE (dispatch_offer_id)");
  });
  /** خيطٌ جماعي يحتاج قائمة أطراف؛ غيابُها هو ما يمنع المزاد لا حسنُ النيّة. */
  it("stores no participant list and no bid table", () => {
    expect(schemaSql).not.toMatch(/participants?\s+(TEXT\[\]|JSONB)/);
    expect(schemaSql).not.toContain("negotiation_bids");
    expect(schemaSql).not.toContain("driver_public_ids");
  });
});

describe("ADR-013 decision 2: negotiation never owns the order's price", () => {
  /**
   * لا مفتاح أجنبي ولا انعكاس لحالة الطلب هنا: المبلغ يُسلَّم عبر `AgreedPricePort`
   * ومحرّك الطلب وحده يسجّله. عمودٌ لحالة الطلب في هذا المخطّط يتخلّف بصمت.
   */
  it("mirrors no order state and references no orders table", () => {
    expect(schemaSql).not.toMatch(/REFERENCES\s+orders/i);
    expect(schemaSql).not.toMatch(/^\s+order_state\s/m);
    expect(schemaSql).not.toMatch(/^\s+order_status\s/m);
    expect(schemaSql).not.toMatch(/^\s+price_mode\s/m);
  });
  it("records every hand-off attempt as its own row, so a retry is auditable", () => {
    expect(schemaSql).toContain("ux_negotiation_price_handoffs_attempt UNIQUE (thread_id, attempt_no)");
    expect(schemaSql).toContain("ck_negotiation_price_handoffs_failure_named");
  });
  /** الاتفاق يبقى قائماً وإن فشل التسليم: `abandoned` حالةُ تسليمٍ لا حالةُ اتفاق. */
  it("keeps the hand-off state on the agreement without a state that unmakes it", () => {
    expect(table("negotiation_agreements")).toContain("handoff_state");
    expect([...NEGOTIATION_HANDOFF_STATES]).not.toContain("invalidated" as never);
    expect([...NEGOTIATION_HANDOFF_STATES]).not.toContain("cancelled" as never);
    expect(schemaSql).toContain("ck_negotiation_agreements_terminal_no_retry");
  });
});

describe("ADR-013 decision 3: agreement is an explicit accept of a numbered round", () => {
  it("numbers rounds per thread and allows at most one pending round", () => {
    expect(schemaSql).toContain("ux_negotiation_rounds_thread_no UNIQUE (thread_id, round_no)");
    expect(schemaSql).toContain("ux_negotiation_rounds_one_pending");
  });
  it("allows at most one accepted round per thread", () => {
    expect(schemaSql).toContain("ux_negotiation_rounds_one_accepted");
  });
  /** حارسُ القبول الذاتي في القاعدة لا في TypeScript وحده. */
  it("forbids the proposer from resolving their own round in the database", () => {
    expect(schemaSql).toContain("ck_negotiation_rounds_no_self_resolution");
  });
  it("keeps a counter the optimistic guard can read without touching the child table", () => {
    expect(table("negotiation_threads")).toContain("current_round_no");
    expect(schemaSql).toContain("ck_negotiation_threads_round_counters");
  });
  it("ties an agreed thread to the round that made it agreed", () => {
    expect(schemaSql).toContain("ck_negotiation_threads_agreed_names_round");
    expect(schemaSql).toContain("ck_negotiation_threads_agreed_round_exists");
  });
  it("allows at most one agreement per (order × driver)", () => {
    expect(schemaSql).toContain("ux_negotiation_agreements_order_driver UNIQUE (order_public_id, driver_public_id)");
  });
});

describe("ADR-013 decision 4: money is integer minor units with an explicit currency", () => {
  it("uses no floating point and no NUMERIC for any amount", () => {
    expect(schemaSql).not.toMatch(/(amount|price)\w*\s+(NUMERIC|DECIMAL|REAL|DOUBLE|FLOAT)/i);
  });
  it("names every money column in minor units", () => {
    const money = [...schemaSql.matchAll(/^\s+(\w*amount\w*)\s+BIGINT/gm)].map((m) => m[1]!);
    expect(money.length).toBeGreaterThan(0);
    for (const column of money) expect(column, column).toMatch(/_minor$/);
  });
  it("carries a currency beside every stored amount", () => {
    for (const name of ["negotiation_threads", "negotiation_rounds", "negotiation_agreements"]) {
      expect(table(name), name).toContain("currency ~ '^[A-Z]{3}$'");
    }
  });
});

describe("ADR-013 decision 5: time is stored data read by a tick, never a timer", () => {
  it("stores the due instant on both the thread and the round", () => {
    expect(table("negotiation_threads")).toContain("expires_at");
    expect(table("negotiation_rounds")).toContain("expires_at");
  });
  it("keeps a tick index the sweep can seek instead of scanning", () => {
    expect(table("negotiation_threads")).toContain("next_tick_at");
    expect(schemaSql).toMatch(/CREATE INDEX[^\n]*ix_negotiation_threads_tick_due/);
  });
  /** `closed_at` أثرٌ، و`state` حقيقةٌ تكتبها النبضة: لا حالةَ محسوبة مخزّنة. */
  it("stores no is_expired flag anywhere", () => {
    expect(schemaSql).not.toMatch(/^\s+is_expired\s/m);
    expect(schemaSql).not.toMatch(/^\s+expired\s+BOOLEAN/m);
  });
});

describe("ADR-013 decision 6 & 7: the body lives here only, the translation nowhere", () => {
  it("stores the message body in negotiation_messages and in no other table", () => {
    expect(table("negotiation_messages")).toContain("body");
    for (const name of ["negotiation_threads", "negotiation_rounds", "negotiation_agreements", "negotiation_outbox"]) {
      expect(table(name), name).not.toMatch(/^\s+body\s/m);
      expect(table(name), name).not.toMatch(/^\s+note\s/m);
    }
  });
  it("stores only the source locale, never a translation", () => {
    expect(schemaCode).toContain("source_locale");
    expect(schemaCode).not.toContain("translated_body");
    expect(schemaCode).not.toContain("negotiation_message_translations");
  });
  it("lets a body be redacted without erasing that a message existed", () => {
    expect(schemaSql).toContain("ck_negotiation_messages_redaction");
    expect(schemaSql).toContain("redaction_reason_code");
  });
  /** القناة طبقة توصيل (ADR-007): لا `chat_id` في مخطّط مجال. */
  it("stores no channel identity and no personal contact detail", () => {
    for (const forbidden of ["chat_id", "telegram", "phone", "display_name", "latitude", "longitude"]) {
      expect(schemaCode.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

describe("ADR-013 decision 8: out-of-scope concerns own no column here", () => {
  it("stores no payment, settlement, reputation or pricing-engine column", () => {
    for (const forbidden of [
      "payment_status", "paid_at", "settlement", "payout", "commission",
      "reputation", "trust_score", "fraud_score", "suggested_amount_minor", "attachment",
    ]) expect(schemaCode.toLowerCase(), forbidden).not.toContain(forbidden);
  });
  /** والشرحُ نفسه مطلوب: الغياب المقصود يُقرأ في المخطّط لا في تاريخ Git. */
  it("still explains in prose why those columns are absent", () => {
    expect(schemaSql).toMatch(/Phase 19|Phase 09/);
    expect(schemaSql.length).toBeGreaterThan(schemaCode.length);
  });
});

describe("negotiation durability contract", () => {
  it("keys idempotency and stores the decided outcome, not only the request", () => {
    const idem = table("negotiation_idempotency");
    expect(idem).toContain("idempotency_key");
    expect(idem).toContain("payload_fingerprint");
    expect(idem).toContain("response_status");
    expect(idem).toContain("response_body");
  });
  it("writes the event beside the decision through an outbox", () => {
    expect(table("negotiation_outbox")).toContain("published_at");
    expect(schemaSql).toMatch(/CREATE INDEX[^\n]*ix_negotiation_outbox_unpublished/);
  });
});
