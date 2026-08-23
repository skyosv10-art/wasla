import type { ConversationEvent } from "@wasla/bot-runtime";
import { describe, expect, it } from "vitest";

import { CustomerFlowError, type CustomerFlowsPort, type OrderRequestView } from "../flows.js";
import {
  CUSTOMER_ACCEPT_COMMAND,
  CUSTOMER_NEGOTIATIONS_COMMAND,
  CUSTOMER_NEGOTIATION_REPLY_LIMIT,
  CUSTOMER_REJECT_COMMAND,
  createCustomerNegotiationConversationHandler,
  type CustomerNegotiationsPort,
  type NegotiationRoundView,
  type NegotiationThreadView,
} from "../negotiation-flows.js";
import { UnconfiguredCustomerNegotiations } from "../infrastructure/http-negotiations.js";

const THREAD_A: NegotiationThreadView = { id: "11111111-1111-4111-8111-111111111111", serviceKind: "ride", state: "open", currentRoundNo: 2 };
const THREAD_B: NegotiationThreadView = { id: "22222222-2222-4222-8222-222222222222", serviceKind: "delivery", state: "open", currentRoundNo: 4 };
const DRIVER_PENDING: NegotiationRoundView = { roundNo: 2, proposedBy: "driver", amountMinor: 12500, currency: "SAR", state: "pending" };

class CustomerFlowsFake implements CustomerFlowsPort {
  orders: OrderRequestView[] = [{ status: "submitted", orderType: "ride", orderPublicId: "ORD-1000000001", failureReasonCode: null, createdAt: "2026-08-23T00:00:00.000Z" }];
  async ensureProfile(): Promise<{ created: boolean }> { return { created: false }; }
  async listSavedPlaces() { return []; }
  async listRecentOrderRequests() { return this.orders; }
}
class NegotiationsFake implements CustomerNegotiationsPort {
  threads: NegotiationThreadView[] = [];
  rounds = new Map<string, NegotiationRoundView[]>();
  acceptCalls: Parameters<CustomerNegotiationsPort["accept"]>[0][] = [];
  rejectCalls: Parameters<CustomerNegotiationsPort["reject"]>[0][] = [];
  failure: CustomerFlowError | null = null;
  async listThreads() { if (this.failure) throw this.failure; return this.threads; }
  async listRounds(input: { threadId: string }) { if (this.failure) throw this.failure; return this.rounds.get(input.threadId) ?? []; }
  async accept(input: Parameters<CustomerNegotiationsPort["accept"]>[0]) { if (this.failure) throw this.failure; this.acceptCalls.push(input); }
  async reject(input: Parameters<CustomerNegotiationsPort["reject"]>[0]) { if (this.failure) throw this.failure; this.rejectCalls.push(input); }
}
function event(command: string, scope: "private" | "group" = "private"): ConversationEvent {
  return { bot: "customer", channel: "telegram", chatRef: "5", channelUpdateId: "update-77", kind: "command", command, scope, traceId: "trace-77", async resolveIdentity() { return { waslaPublicId: "WS-1000000001", created: false }; } };
}
function handler(flows = new CustomerFlowsFake(), negotiations = new NegotiationsFake()) { return { flows, negotiations, run: createCustomerNegotiationConversationHandler(flows, negotiations) }; }

describe("customer bot — negotiation flows", () => {
  it("قائمة فارغة: لا تُحوِّل غياب التفاوض إلى بيانات داخلية", async () => {
    const { run } = handler();
    expect((await run(event(CUSTOMER_NEGOTIATIONS_COMMAND)))?.text).toContain("لا توجد خيوط");
  });
  it("يعرض خيطاً مفتوحاً ودوره المعلّق بالعربية", async () => {
    const { negotiations, run } = handler(); negotiations.threads = [THREAD_A]; negotiations.rounds.set(THREAD_A.id, [DRIVER_PENDING]);
    const text = (await run(event(CUSTOMER_NEGOTIATIONS_COMMAND)))?.text ?? "";
    expect(text).toContain("مشوار"); expect(text).toContain("الدور 2: 12500 SAR"); expect(text).toContain("السائق");
  });
  it("الخيط المتفق عليه يُظهر المبلغ المتفق عليه", async () => {
    const { negotiations, run } = handler(); negotiations.threads = [{ ...THREAD_A, state: "agreed" }]; negotiations.rounds.set(THREAD_A.id, [{ ...DRIVER_PENDING, state: "accepted" }]);
    expect((await run(event(CUSTOMER_NEGOTIATIONS_COMMAND)))?.text).toContain("اتُّفق على 12500 SAR");
  });
  it("يحترم حد الثلاثة في رد المحادثة ولا يسرّب handoff_state أو uuid", async () => {
    const { negotiations, run } = handler(); negotiations.threads = Array.from({ length: 4 }, (_, index) => ({ ...THREAD_A, id: `${index + 1}1111111-1111-4111-8111-111111111111` }));
    for (const thread of negotiations.threads) negotiations.rounds.set(thread.id, [DRIVER_PENDING]);
    const text = (await run(event(CUSTOMER_NEGOTIATIONS_COMMAND)))?.text ?? "";
    expect(text.match(/• /g)).toHaveLength(CUSTOMER_NEGOTIATION_REPLY_LIMIT); expect(text).not.toContain("handoff_state"); expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });
  it("يقبل العرض الوحيد برقم الدور ومفتاح channelUpdateId", async () => {
    const { negotiations, run } = handler(); negotiations.threads = [THREAD_A]; negotiations.rounds.set(THREAD_A.id, [DRIVER_PENDING]); await run(event(CUSTOMER_ACCEPT_COMMAND));
    expect(negotiations.acceptCalls).toEqual([{ threadId: THREAD_A.id, expectedRoundNo: 2, actingParty: "customer", idempotencyKey: "bot-accept-update-77", traceId: "trace-77" }]);
  });
  it("قاعدة اللبس: عرضان معلّقان لا ينتجان نداء قرار", async () => {
    const { negotiations, run } = handler(); negotiations.threads = [THREAD_A, THREAD_B]; negotiations.rounds.set(THREAD_A.id, [DRIVER_PENDING]); negotiations.rounds.set(THREAD_B.id, [{ ...DRIVER_PENDING, roundNo: 4 }]);
    expect((await run(event(CUSTOMER_ACCEPT_COMMAND)))?.text).toContain("أكثر من عرض"); expect(negotiations.acceptCalls).toHaveLength(0);
  });
  it("لا يقبل الدور الذي اقترحه العميل نفسه", async () => {
    const { negotiations, run } = handler(); negotiations.threads = [THREAD_A]; negotiations.rounds.set(THREAD_A.id, [{ ...DRIVER_PENDING, proposedBy: "customer" }]); await run(event(CUSTOMER_ACCEPT_COMMAND));
    expect(negotiations.acceptCalls).toHaveLength(0);
  });
  it.each([
    ["CUSTOMER_NEGOTIATION_ROUND_STALE", "تغيّر العرض"],
    ["CUSTOMER_NEGOTIATION_NOT_ACTIONABLE", "لم يعد العرض قابلاً"],
    ["CUSTOMER_DEPENDENCY_UNAVAILABLE", "الخدمة غير متاحة"],
  ])("يترجم %s من الكود لا من نص الخادم", async (code, text) => {
    const { negotiations, run } = handler(); negotiations.failure = new CustomerFlowError(code, "server prose must not appear");
    const reply = await run(event(CUSTOMER_NEGOTIATIONS_COMMAND)); expect(reply?.text).toContain(text); expect(reply?.text).not.toContain("server prose");
  });
  it("غياب NEGOTIATIONS_SERVICE_URL يرمي كود التبعية ولا يعيد قائمة فارغة", async () => {
    await expect(new UnconfiguredCustomerNegotiations().listThreads({ orderPublicId: "ORD-1000000001", traceId: "t" })).rejects.toMatchObject({ code: "CUSTOMER_DEPENDENCY_UNAVAILABLE" });
  });
  it("يرفض تدفق التفاوض في المجموعة", async () => { const { run } = handler(); expect(await run(event(CUSTOMER_REJECT_COMMAND, "group"))).toBeNull(); });
});
