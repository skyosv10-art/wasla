/**
 * Negotiation actions are intentionally small: the runtime event has a command,
 * not message text or button payload. A counter-offer needs an amount, so it stays
 * in the Mini App; inventing a number parser here would change the channel contract.
 */
import type { ConversationEvent, ConversationHandler, ConversationReply } from "@wasla/bot-runtime";

import type { CustomerFlowsPort } from "./flows.js";
import { CustomerFlowError, FLOW_ERROR_TEXT, FLOW_FALLBACK_ERROR_TEXT } from "./flows.js";

export const CUSTOMER_NEGOTIATIONS_COMMAND = "negotiations";
export const CUSTOMER_ACCEPT_COMMAND = "accept";
export const CUSTOMER_REJECT_COMMAND = "reject";
export const CUSTOMER_NEGOTIATION_ORDER_LIMIT = 3;
export const CUSTOMER_NEGOTIATION_REPLY_LIMIT = 3;

export type NegotiationParty = "customer" | "driver";
export type NegotiationThreadState = "open" | "agreed" | "declined" | "expired" | "cancelled";
export type NegotiationRoundState = "pending" | "accepted" | "rejected" | "superseded" | "expired";

export interface NegotiationThreadView {
  readonly id: string;
  readonly serviceKind: "ride" | "delivery";
  readonly state: NegotiationThreadState;
  readonly currentRoundNo: number;
}
export interface NegotiationRoundView {
  readonly roundNo: number;
  readonly proposedBy: NegotiationParty;
  readonly amountMinor: number;
  readonly currency: string;
  readonly state: NegotiationRoundState;
}
export interface CustomerNegotiationsPort {
  listThreads(input: { readonly orderPublicId: string; readonly traceId: string }): Promise<readonly NegotiationThreadView[]>;
  listRounds(input: { readonly threadId: string; readonly traceId: string }): Promise<readonly NegotiationRoundView[]>;
  accept(input: { readonly threadId: string; readonly expectedRoundNo: number; readonly actingParty: "customer"; readonly idempotencyKey: string; readonly traceId: string }): Promise<void>;
  reject(input: { readonly threadId: string; readonly expectedRoundNo: number; readonly actingParty: "customer"; readonly closeThread: boolean; readonly idempotencyKey: string; readonly traceId: string }): Promise<void>;
}

export const CUSTOMER_NEGOTIATION_TEXT = {
  noThreads: "لا توجد خيوط تفاوض حيّة حالياً. افتح التطبيق لمراجعة طلباتك.",
  header: "التفاوضات الحالية:",
  noOffer: "لا يوجد عرض ينتظر ردّك.",
  ambiguous: "يوجد أكثر من عرض ينتظر ردّك. افتح التطبيق واختر العرض الصحيح؛ لا ننفّذ إجراءً مالياً بلا خيط محدّد.",
  accepted: "تم قبول العرض وتسجيل الاتفاق.",
  rejected: "تم رفض العرض وإنهاء هذا التفاوض.",
  appHint: "لإرسال عرض مضاد أو مراجعة التفاصيل، افتح التطبيق.",
} as const;
const THREAD_STATE_TEXT: Readonly<Record<NegotiationThreadState, string>> = { open: "مفتوح", agreed: "تم الاتفاق", declined: "مرفوض", expired: "منتهي الصلاحية", cancelled: "ملغى" };
const ROUND_STATE_TEXT: Readonly<Record<NegotiationRoundState, string>> = { pending: "بانتظار الرد", accepted: "مقبول", rejected: "مرفوض", superseded: "استُبدل", expired: "منتهي الصلاحية" };
const PARTY_TEXT: Readonly<Record<NegotiationParty, string>> = { customer: "العميل", driver: "السائق" };
const SERVICE_TEXT: Readonly<Record<NegotiationThreadView["serviceKind"], string>> = { ride: "مشوار", delivery: "توصيل" };

interface ThreadWithRound { readonly thread: NegotiationThreadView; readonly round: NegotiationRoundView | undefined; }
function currentRound(thread: NegotiationThreadView, rounds: readonly NegotiationRoundView[]): NegotiationRoundView | undefined {
  return rounds.find((round) => round.roundNo === thread.currentRoundNo);
}

/** A chat cannot safely choose between two monetary actions without a thread id. */
export function selectOnlyPendingOtherPartyRound(threads: readonly ThreadWithRound[]): ThreadWithRound | "none" | "ambiguous" {
  const matches = threads.filter(({ round }) => round?.state === "pending" && round.proposedBy === "driver");
  return matches.length === 0 ? "none" : matches.length === 1 ? matches[0]! : "ambiguous";
}

function renderThread({ thread, round }: ThreadWithRound): string {
  const lines = [`• ${SERVICE_TEXT[thread.serviceKind]} — ${THREAD_STATE_TEXT[thread.state]}`];
  if (round) {
    lines.push(`الدور ${round.roundNo}: ${round.amountMinor} ${round.currency} — ${ROUND_STATE_TEXT[round.state]} — اقترحه ${PARTY_TEXT[round.proposedBy]}`);
    if (thread.state === "agreed") lines.push(`اتُّفق على ${round.amountMinor} ${round.currency}`);
  } else lines.push("لا يوجد دور حالي.");
  return lines.join("\n");
}

async function recentThreads(flows: CustomerFlowsPort, negotiations: CustomerNegotiationsPort, event: ConversationEvent): Promise<ThreadWithRound[]> {
  // Three order reads bound the fan-out: without it a chat command becomes a request storm.
  const orders = await flows.listRecentOrderRequests({ waslaPublicId: (await event.resolveIdentity()).waslaPublicId, limit: CUSTOMER_NEGOTIATION_ORDER_LIMIT });
  const orderIds = orders.flatMap((order) => order.orderPublicId === null ? [] : [order.orderPublicId]).slice(0, CUSTOMER_NEGOTIATION_ORDER_LIMIT);
  const threads = (await Promise.all(orderIds.map((orderPublicId) => negotiations.listThreads({ orderPublicId, traceId: event.traceId })))).flat();
  return Promise.all(threads.map(async (thread) => ({ thread, round: currentRound(thread, await negotiations.listRounds({ threadId: thread.id, traceId: event.traceId })) })));
}

export function createCustomerNegotiationConversationHandler(flows: CustomerFlowsPort, negotiations: CustomerNegotiationsPort): ConversationHandler {
  return async (event): Promise<ConversationReply | null> => {
    if (event.scope !== "private" || event.kind !== "command" || event.command === undefined) return null;
    if (![CUSTOMER_NEGOTIATIONS_COMMAND, CUSTOMER_ACCEPT_COMMAND, CUSTOMER_REJECT_COMMAND].includes(event.command)) return null;
    try {
      const threads = await recentThreads(flows, negotiations, event);
      if (event.command === CUSTOMER_NEGOTIATIONS_COMMAND) {
        if (threads.length === 0) return { text: CUSTOMER_NEGOTIATION_TEXT.noThreads, withMiniApp: true, step: "negotiations" };
        return { text: [CUSTOMER_NEGOTIATION_TEXT.header, ...threads.slice(0, CUSTOMER_NEGOTIATION_REPLY_LIMIT).map(renderThread), CUSTOMER_NEGOTIATION_TEXT.appHint].join("\n"), withMiniApp: true, step: "negotiations" };
      }
      const selected = selectOnlyPendingOtherPartyRound(threads);
      if (selected === "none") return { text: CUSTOMER_NEGOTIATION_TEXT.noOffer, withMiniApp: true, step: `negotiation:${event.command}:none` };
      if (selected === "ambiguous") return { text: CUSTOMER_NEGOTIATION_TEXT.ambiguous, withMiniApp: true, step: `negotiation:${event.command}:ambiguous` };
      const { thread, round } = selected;
      if (!round) throw new Error("pending negotiation selection without a round");
      const idempotencyKey = `bot-${event.command}-${event.channelUpdateId}`;
      if (event.command === CUSTOMER_ACCEPT_COMMAND) await negotiations.accept({ threadId: thread.id, expectedRoundNo: round.roundNo, actingParty: "customer", idempotencyKey, traceId: event.traceId });
      else await negotiations.reject({ threadId: thread.id, expectedRoundNo: round.roundNo, actingParty: "customer", closeThread: true, idempotencyKey, traceId: event.traceId });
      return { text: event.command === CUSTOMER_ACCEPT_COMMAND ? CUSTOMER_NEGOTIATION_TEXT.accepted : CUSTOMER_NEGOTIATION_TEXT.rejected, withMiniApp: true, step: `negotiation:${event.command}` };
    } catch (error) {
      if (error instanceof CustomerFlowError) return { text: FLOW_ERROR_TEXT[error.code] ?? FLOW_FALLBACK_ERROR_TEXT, step: `error:${event.command}` };
      throw error;
    }
  };
}
