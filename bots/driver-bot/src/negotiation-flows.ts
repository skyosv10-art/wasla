/**
 * Negotiation actions are intentionally small: the runtime event has a command,
 * not message text or button payload. A counter-offer needs an amount, so it stays
 * in the Mini App; inventing a number parser here would change the channel contract.
 */
import type { ConversationEvent, ConversationHandler, ConversationReply } from "@wasla/bot-runtime";
import type { UserDelegation } from "@wasla/service-auth";

import type { DriverFlowsPort } from "./flows.js";
import { DriverFlowError, DRIVER_FLOW_ERROR_TEXT, DRIVER_FLOW_FALLBACK_ERROR_TEXT } from "./flows.js";

export const DRIVER_NEGOTIATIONS_COMMAND = "negotiations";
export const DRIVER_ACCEPT_COMMAND = "accept";
export const DRIVER_REJECT_COMMAND = "reject";
export const DRIVER_NEGOTIATION_REPLY_LIMIT = 3;

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
export interface DriverNegotiationsPort {
  listThreads(input: { readonly driverPublicId: string; readonly traceId: string; readonly delegation?: UserDelegation }): Promise<readonly NegotiationThreadView[]>;
  listRounds(input: { readonly threadId: string; readonly traceId: string; readonly delegation?: UserDelegation }): Promise<readonly NegotiationRoundView[]>;
  accept(input: { readonly threadId: string; readonly expectedRoundNo: number; readonly actingParty: "driver"; readonly idempotencyKey: string; readonly traceId: string; readonly delegation?: UserDelegation }): Promise<void>;
  reject(input: { readonly threadId: string; readonly expectedRoundNo: number; readonly actingParty: "driver"; readonly closeThread: boolean; readonly idempotencyKey: string; readonly traceId: string; readonly delegation?: UserDelegation }): Promise<void>;
}

export const DRIVER_NEGOTIATION_TEXT = {
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
  const matches = threads.filter(({ round }) => round?.state === "pending" && round.proposedBy === "customer");
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

/**
 * ADR-060 · CLM-0440: تأكيدُ المستخدمِ من `identity` لِجمهورِ المفاوضاتِ — **يُمرَّرُ ولا يُصنَعُ**.
 * أفضلُ جهدٍ في P1 (المُستقبِلُ `off`): غيابُهُ ⇒ نداءٌ كما كانَ. وتفويضٌ لا يطابقُ هويّةَ المُرسِلِ
 * المحلولةَ يُسقَطُ ولا يُرسَلُ — البوتُ لا يُرسِلُ `obo` لشخصٍ غيرِ مُرسِلِ التحديثِ.
 */
export const NEGOTIATIONS_ASSERTION_AUDIENCE: readonly string[] = ["negotiations"];
async function delegationOf(event: ConversationEvent): Promise<{ readonly delegation?: UserDelegation }> {
  const delegation = (await event.userAssertion?.(NEGOTIATIONS_ASSERTION_AUDIENCE)) ?? null;
  if (delegation === null) return {};
  return delegation.publicId === (await event.resolveIdentity()).waslaPublicId ? { delegation } : {};
}

async function recentThreads(_flows: DriverFlowsPort, negotiations: DriverNegotiationsPort, event: ConversationEvent, delegated: { readonly delegation?: UserDelegation }): Promise<ThreadWithRound[]> {
  const identity = await event.resolveIdentity();
  const threads = await negotiations.listThreads({ driverPublicId: identity.waslaPublicId, traceId: event.traceId, ...delegated });
  return Promise.all(threads.map(async (thread) => ({
    thread,
    round: currentRound(thread, await negotiations.listRounds({ threadId: thread.id, traceId: event.traceId, ...delegated })),
  })));
}

export function createDriverNegotiationConversationHandler(flows: DriverFlowsPort, negotiations: DriverNegotiationsPort): ConversationHandler {
  return async (event): Promise<ConversationReply | null> => {
    if (event.scope !== "private" || event.kind !== "command" || event.command === undefined) return null;
    if (![DRIVER_NEGOTIATIONS_COMMAND, DRIVER_ACCEPT_COMMAND, DRIVER_REJECT_COMMAND].includes(event.command)) return null;
    try {
      const delegated = await delegationOf(event);
      const threads = await recentThreads(flows, negotiations, event, delegated);
      if (event.command === DRIVER_NEGOTIATIONS_COMMAND) {
        if (threads.length === 0) return { text: DRIVER_NEGOTIATION_TEXT.noThreads, withMiniApp: true, step: "negotiations" };
        return { text: [DRIVER_NEGOTIATION_TEXT.header, ...threads.slice(0, DRIVER_NEGOTIATION_REPLY_LIMIT).map(renderThread), DRIVER_NEGOTIATION_TEXT.appHint].join("\n"), withMiniApp: true, step: "negotiations" };
      }
      const selected = selectOnlyPendingOtherPartyRound(threads);
      if (selected === "none") return { text: DRIVER_NEGOTIATION_TEXT.noOffer, withMiniApp: true, step: `negotiation:${event.command}:none` };
      if (selected === "ambiguous") return { text: DRIVER_NEGOTIATION_TEXT.ambiguous, withMiniApp: true, step: `negotiation:${event.command}:ambiguous` };
      const { thread, round } = selected;
      if (!round) throw new Error("pending negotiation selection without a round");
      const idempotencyKey = `bot-${event.command}-${event.channelUpdateId}`;
      if (event.command === DRIVER_ACCEPT_COMMAND) await negotiations.accept({ threadId: thread.id, expectedRoundNo: round.roundNo, actingParty: "driver", idempotencyKey, traceId: event.traceId, ...delegated });
      else await negotiations.reject({ threadId: thread.id, expectedRoundNo: round.roundNo, actingParty: "driver", closeThread: true, idempotencyKey, traceId: event.traceId, ...delegated });
      return { text: event.command === DRIVER_ACCEPT_COMMAND ? DRIVER_NEGOTIATION_TEXT.accepted : DRIVER_NEGOTIATION_TEXT.rejected, withMiniApp: true, step: `negotiation:${event.command}` };
    } catch (error) {
      if (error instanceof DriverFlowError) return { text: DRIVER_FLOW_ERROR_TEXT[error.code] ?? DRIVER_FLOW_FALLBACK_ERROR_TEXT, step: `error:${event.command}` };
      throw error;
    }
  };
}
