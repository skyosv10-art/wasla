/** HTTP is translated to flow codes here, so server prose never becomes bot copy. */
import { DriverFlowError } from "../flows.js";
import type { DriverNegotiationsPort, NegotiationRoundView, NegotiationThreadView } from "../negotiation-flows.js";

export interface HttpDriverNegotiationsOptions { readonly baseUrl: string; readonly timeoutMs?: number; }
type WireThread = { id: string; service_kind: NegotiationThreadView["serviceKind"]; state: NegotiationThreadView["state"]; current_round_no: number };
type WireRound = { round_no: number; proposed_by: NegotiationRoundView["proposedBy"]; amount_minor: number; currency: string; state: NegotiationRoundView["state"] };
export class HttpDriverNegotiations implements DriverNegotiationsPort {
  private readonly baseUrl: string; private readonly timeoutMs: number;
  constructor(options: HttpDriverNegotiationsOptions) { this.baseUrl = options.baseUrl.replace(/\/+$/, ""); this.timeoutMs = options.timeoutMs ?? 2000; }
  private async request(path: string, init: RequestInit, traceId: string): Promise<unknown> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal, headers: { "content-type": "application/json", "x-request-id": traceId, ...init.headers } });
      if (response.ok) return response.status === 204 ? undefined : await response.json();
      if (response.status === 404) throw new DriverFlowError("DRIVER_NEGOTIATION_NOT_FOUND");
      if (response.status === 409) throw new DriverFlowError("DRIVER_NEGOTIATION_ROUND_STALE");
      if (response.status === 422) throw new DriverFlowError("DRIVER_NEGOTIATION_NOT_ACTIONABLE");
      throw new DriverFlowError("DRIVER_DEPENDENCY_UNAVAILABLE");
    } catch (error) { if (error instanceof DriverFlowError) throw error; throw new DriverFlowError("DRIVER_DEPENDENCY_UNAVAILABLE"); } finally { clearTimeout(timer); }
  }
  async listThreads(input: { driverPublicId: string; traceId: string }): Promise<readonly NegotiationThreadView[]> { const body = await this.request(`/negotiations?driverPublicId=${encodeURIComponent(input.driverPublicId)}`, { method: "GET" }, input.traceId) as { threads: WireThread[] }; return body.threads.map((thread) => ({ id: thread.id, serviceKind: thread.service_kind, state: thread.state, currentRoundNo: thread.current_round_no })); }
  async listRounds(input: { threadId: string; traceId: string }): Promise<readonly NegotiationRoundView[]> { const body = await this.request(`/negotiations/${encodeURIComponent(input.threadId)}/rounds`, { method: "GET" }, input.traceId) as { rounds: WireRound[] }; return body.rounds.map((round) => ({ roundNo: round.round_no, proposedBy: round.proposed_by, amountMinor: round.amount_minor, currency: round.currency, state: round.state })); }
  async accept(input: { threadId: string; expectedRoundNo: number; actingParty: "driver"; idempotencyKey: string; traceId: string }): Promise<void> { await this.request(`/negotiations/${encodeURIComponent(input.threadId)}/rounds/${input.expectedRoundNo}/accept`, { method: "POST", headers: { "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify({ acting_party: input.actingParty }) }, input.traceId); }
  async reject(input: { threadId: string; expectedRoundNo: number; actingParty: "driver"; closeThread: boolean; idempotencyKey: string; traceId: string }): Promise<void> { await this.request(`/negotiations/${encodeURIComponent(input.threadId)}/rounds/${input.expectedRoundNo}/reject`, { method: "POST", headers: { "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify({ acting_party: input.actingParty, close_thread: input.closeThread }) }, input.traceId); }
}
/** A missing URL is an outage, not evidence that a driver has no negotiations. */
export class UnconfiguredDriverNegotiations implements DriverNegotiationsPort {
  private unavailable(): never { throw new DriverFlowError("DRIVER_DEPENDENCY_UNAVAILABLE"); }
  async listThreads(_input: Parameters<DriverNegotiationsPort["listThreads"]>[0]): Promise<readonly NegotiationThreadView[]> { return this.unavailable(); }
  async listRounds(_input: Parameters<DriverNegotiationsPort["listRounds"]>[0]): Promise<readonly NegotiationRoundView[]> { return this.unavailable(); }
  async accept(_input: Parameters<DriverNegotiationsPort["accept"]>[0]): Promise<void> { return this.unavailable(); }
  async reject(_input: Parameters<DriverNegotiationsPort["reject"]>[0]): Promise<void> { return this.unavailable(); }
}
