import type { ConversationEvent } from "@wasla/bot-runtime";
import { describe, expect, it } from "vitest";

import { DriverFlowError, type DriverFlowsPort, type DriverStatusView } from "../flows.js";
import {
  DRIVER_ACCEPT_COMMAND,
  DRIVER_NEGOTIATIONS_COMMAND,
  DRIVER_NEGOTIATION_REPLY_LIMIT,
  DRIVER_REJECT_COMMAND,
  createDriverNegotiationConversationHandler,
  type DriverNegotiationsPort,
  type NegotiationRoundView,
  type NegotiationThreadView,
} from "../negotiation-flows.js";
import { UnconfiguredDriverNegotiations } from "../infrastructure/http-negotiations.js";

const THREAD_A: NegotiationThreadView = { id: "11111111-1111-4111-8111-111111111111", serviceKind: "ride", state: "open", currentRoundNo: 2 };
const THREAD_B: NegotiationThreadView = { id: "22222222-2222-4222-8222-222222222222", serviceKind: "delivery", state: "open", currentRoundNo: 4 };
const CUSTOMER_PENDING: NegotiationRoundView = { roundNo: 2, proposedBy: "customer", amountMinor: 12500, currency: "SAR", state: "pending" };
const STATUS: DriverStatusView = { eligibilityState: "eligible", reasonCodes: [], declaredAvailability: "offline", recheckAt: null };

class DriverFlowsFake implements DriverFlowsPort {
  async ensureRegistered() { return { created: false }; }
  async readStatus() { return STATUS; }
  async declareAvailability() { return STATUS; }
  async listDocuments() { return []; }
}
class NegotiationsFake implements DriverNegotiationsPort {
  threads: NegotiationThreadView[] = [];
  rounds = new Map<string, NegotiationRoundView[]>();
  acceptCalls: Parameters<DriverNegotiationsPort["accept"]>[0][] = [];
  rejectCalls: Parameters<DriverNegotiationsPort["reject"]>[0][] = [];
  failure: DriverFlowError | null = null;
  async listThreads() { if (this.failure) throw this.failure; return this.threads; }
  async listRounds(input: { threadId: string }) { if (this.failure) throw this.failure; return this.rounds.get(input.threadId) ?? []; }
  async accept(input: Parameters<DriverNegotiationsPort["accept"]>[0]) { if (this.failure) throw this.failure; this.acceptCalls.push(input); }
  async reject(input: Parameters<DriverNegotiationsPort["reject"]>[0]) { if (this.failure) throw this.failure; this.rejectCalls.push(input); }
}
function event(command: string, scope: "private" | "group" = "private"): ConversationEvent {
  return { bot: "driver", channel: "telegram", chatRef: "5", channelUpdateId: "update-88", kind: "command", command, scope, traceId: "trace-88", async resolveIdentity() { return { waslaPublicId: "WS-1000000001", created: false }; } };
}
function handler(flows = new DriverFlowsFake(), negotiations = new NegotiationsFake()) { return { negotiations, run: createDriverNegotiationConversationHandler(flows, negotiations) }; }

describe("driver bot — negotiation flows", () => {
  it("قائمة فارغة: لا يُفترَض أن السائق بلا تفاوض عند عطل التبعية", async () => { const { run } = handler(); expect((await run(event(DRIVER_NEGOTIATIONS_COMMAND)))?.text).toContain("لا توجد خيوط"); });
  it("يعرض خيطاً مفتوحاً ودوره المعلّق بالعربية", async () => { const { negotiations, run } = handler(); negotiations.threads = [THREAD_A]; negotiations.rounds.set(THREAD_A.id, [CUSTOMER_PENDING]); const text = (await run(event(DRIVER_NEGOTIATIONS_COMMAND)))?.text ?? ""; expect(text).toContain("مشوار"); expect(text).toContain("الدور 2: 12500 SAR"); expect(text).toContain("العميل"); });
  it("الخيط المتفق عليه يُظهر المبلغ المتفق عليه", async () => { const { negotiations, run } = handler(); negotiations.threads = [{ ...THREAD_A, state: "agreed" }]; negotiations.rounds.set(THREAD_A.id, [{ ...CUSTOMER_PENDING, state: "accepted" }]); expect((await run(event(DRIVER_NEGOTIATIONS_COMMAND)))?.text).toContain("اتُّفق على 12500 SAR"); });
  it("يحترم حد الثلاثة في رد المحادثة ولا يسرّب handoff_state أو uuid", async () => { const { negotiations, run } = handler(); negotiations.threads = Array.from({ length: 4 }, (_, index) => ({ ...THREAD_A, id: `${index + 1}1111111-1111-4111-8111-111111111111` })); for (const thread of negotiations.threads) negotiations.rounds.set(thread.id, [CUSTOMER_PENDING]); const text = (await run(event(DRIVER_NEGOTIATIONS_COMMAND)))?.text ?? ""; expect(text.match(/• /g)).toHaveLength(DRIVER_NEGOTIATION_REPLY_LIMIT); expect(text).not.toContain("handoff_state"); expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i); });
  it("يقبل العرض الوحيد برقم الدور ومفتاح channelUpdateId", async () => { const { negotiations, run } = handler(); negotiations.threads = [THREAD_A]; negotiations.rounds.set(THREAD_A.id, [CUSTOMER_PENDING]); await run(event(DRIVER_ACCEPT_COMMAND)); expect(negotiations.acceptCalls).toEqual([{ threadId: THREAD_A.id, expectedRoundNo: 2, actingParty: "driver", idempotencyKey: "bot-accept-update-88", traceId: "trace-88" }]); });
  it("قاعدة اللبس: عرضان معلّقان لا ينتجان نداء قرار", async () => { const { negotiations, run } = handler(); negotiations.threads = [THREAD_A, THREAD_B]; negotiations.rounds.set(THREAD_A.id, [CUSTOMER_PENDING]); negotiations.rounds.set(THREAD_B.id, [{ ...CUSTOMER_PENDING, roundNo: 4 }]); expect((await run(event(DRIVER_ACCEPT_COMMAND)))?.text).toContain("أكثر من عرض"); expect(negotiations.acceptCalls).toHaveLength(0); });
  it("لا يقبل الدور الذي اقترحه السائق نفسه", async () => { const { negotiations, run } = handler(); negotiations.threads = [THREAD_A]; negotiations.rounds.set(THREAD_A.id, [{ ...CUSTOMER_PENDING, proposedBy: "driver" }]); await run(event(DRIVER_ACCEPT_COMMAND)); expect(negotiations.acceptCalls).toHaveLength(0); });
  it.each([["DRIVER_NEGOTIATION_ROUND_STALE", "تغيّر العرض"], ["DRIVER_NEGOTIATION_NOT_ACTIONABLE", "لم يعد العرض قابلاً"], ["DRIVER_DEPENDENCY_UNAVAILABLE", "الخدمة غير متاحة"]])("يترجم %s من الكود لا من نص الخادم", async (code, text) => { const { negotiations, run } = handler(); negotiations.failure = new DriverFlowError(code, "server prose must not appear"); const reply = await run(event(DRIVER_NEGOTIATIONS_COMMAND)); expect(reply?.text).toContain(text); expect(reply?.text).not.toContain("server prose"); });
  it("غياب NEGOTIATIONS_SERVICE_URL يرمي كود التبعية ولا يعيد قائمة فارغة", async () => { await expect(new UnconfiguredDriverNegotiations().listThreads({ driverPublicId: "WS-1000000001", traceId: "t" })).rejects.toMatchObject({ code: "DRIVER_DEPENDENCY_UNAVAILABLE" }); });
  it("يرفض تدفق التفاوض في المجموعة", async () => { const { run } = handler(); expect(await run(event(DRIVER_REJECT_COMMAND, "group"))).toBeNull(); });
});
