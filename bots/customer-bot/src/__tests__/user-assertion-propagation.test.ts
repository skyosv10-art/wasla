/**
 * ADR-060 · CLM-0440 — بوتُ العميلِ **يُمرِّرُ** تأكيدَ المستخدمِ ولا يصنعُهُ ولا يثقُ بنفسِهِ مصدراً.
 *
 * المقيسُ: (1) المُهايِئُ يُرسِلُ `obo = sub` وترويسةَ `x-wasla-user-assertion` كما صدرَتْ؛
 * (2) بلا تفويضٍ لا `obo` ولا ترويسةَ (السلوكُ القائمُ)؛ (3) الانسيابُ يطلبُ جمهورَ
 * `negotiations` ويُمرِّرُ التفويضَ إلى كلِّ نداءٍ؛ (4) تفويضٌ لا يطابقُ هويّةَ المُرسِلِ يُسقَطُ؛
 * (5) غيابُ التأكيدِ لا يُفشِلُ الأمرَ (P1 — المُستقبِلُ `off`).
 */
import type { ConversationEvent } from "@wasla/bot-runtime";
import { createServiceRequestSigner, ServiceAuthKeyRegistry, USER_ASSERTION_HEADER } from "@wasla/service-auth";
import type { UserDelegation } from "@wasla/service-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CUSTOMER_BOT_NEGOTIATIONS_SCOPES, HttpCustomerNegotiations } from "../infrastructure/http-negotiations.js";
import type { CustomerFlowsPort, OrderRequestView } from "../flows.js";
import {
  CUSTOMER_ACCEPT_COMMAND,
  NEGOTIATIONS_ASSERTION_AUDIENCE,
  createCustomerNegotiationConversationHandler,
  type CustomerNegotiationsPort,
  type NegotiationRoundView,
  type NegotiationThreadView,
} from "../negotiation-flows.js";

const ME = "WS-1000000001";
const DELEGATION: UserDelegation = { publicId: ME, assertion: "wua1.cGF5bG9hZA.c2ln" };
const THREAD: NegotiationThreadView = { id: "11111111-1111-4111-8111-111111111111", serviceKind: "ride", state: "open", currentRoundNo: 2 };
const PENDING: NegotiationRoundView = { roundNo: 2, proposedBy: "driver", amountMinor: 12500, currency: "SAR", state: "pending" };

function signer(method: string, path: string, obo?: string): Record<string, string> {
  return createServiceRequestSigner({
    serviceName: "customer-bot",
    audience: "negotiations",
    keys: new ServiceAuthKeyRegistry({ keys: [{ kid: "test-active", secret: "customer-bot-test-secret-01234567", status: "active" }], activeKid: "test-active" }),
    scopes: CUSTOMER_BOT_NEGOTIATIONS_SCOPES,
  })(method, path, obo);
}

function sent(mock: ReturnType<typeof vi.fn>): { headers: Record<string, string>; claims: { obo?: string } } {
  const init = mock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
  const token = init.headers["x-wasla-service-auth"]!;
  return { headers: init.headers, claims: JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) };
}

afterEach(() => vi.unstubAllGlobals());

describe("HttpCustomerNegotiations — تمريرُ التأكيد", () => {
  it("مع تفويضٍ: obo = sub وترويسةُ التأكيدِ كما صدرَتْ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await new HttpCustomerNegotiations({ baseUrl: "http://n", signRequest: signer }).accept({
      threadId: THREAD.id, expectedRoundNo: 2, actingParty: "customer", idempotencyKey: "idem-1", traceId: "t", delegation: DELEGATION,
    });
    const { headers, claims } = sent(fetchMock);
    expect(claims.obo).toBe(ME);
    expect(headers[USER_ASSERTION_HEADER]).toBe(DELEGATION.assertion);
  });

  it("بلا تفويضٍ: لا obo ولا ترويسةَ — السلوكُ القائمُ بلا تغيير", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ threads: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new HttpCustomerNegotiations({ baseUrl: "http://n", signRequest: signer }).listThreads({ orderPublicId: "ORD-1000000001", traceId: "t" });
    const { headers, claims } = sent(fetchMock);
    expect(claims.obo).toBeUndefined();
    expect(headers[USER_ASSERTION_HEADER]).toBeUndefined();
  });
});

class Flows implements CustomerFlowsPort {
  orders: OrderRequestView[] = [{ status: "submitted", orderType: "ride", orderPublicId: "ORD-1000000001", failureReasonCode: null, createdAt: "2026-08-23T00:00:00.000Z" }];
  async ensureProfile() { return { created: false }; }
  async listSavedPlaces() { return []; }
  async listRecentOrderRequests() { return this.orders; }
}
class Recording implements CustomerNegotiationsPort {
  readonly delegations: Array<UserDelegation | undefined> = [];
  async listThreads(input: Parameters<CustomerNegotiationsPort["listThreads"]>[0]) { this.delegations.push(input.delegation); return [THREAD]; }
  async listRounds(input: Parameters<CustomerNegotiationsPort["listRounds"]>[0]) { this.delegations.push(input.delegation); return [PENDING]; }
  async accept(input: Parameters<CustomerNegotiationsPort["accept"]>[0]) { this.delegations.push(input.delegation); }
  async reject(input: Parameters<CustomerNegotiationsPort["reject"]>[0]) { this.delegations.push(input.delegation); }
}
function event(assertion: ((aud: readonly string[]) => Promise<UserDelegation | null>) | undefined, audiences: Array<readonly string[]> = []): ConversationEvent {
  return {
    bot: "customer", channel: "telegram", chatRef: "5", channelUpdateId: "update-91", kind: "command", command: CUSTOMER_ACCEPT_COMMAND, scope: "private", traceId: "trace-91",
    async resolveIdentity() { return { waslaPublicId: ME, created: false }; },
    ...(assertion === undefined ? {} : { userAssertion: async (aud: readonly string[]) => (audiences.push(aud), assertion(aud)) }),
  };
}

describe("انسيابُ المفاوضةِ — التفويضُ يصلُ إلى كلِّ نداء", () => {
  it("يطلبُ جمهورَ negotiations ويُمرِّرُ التفويضَ إلى السردِ والقبولِ", async () => {
    const port = new Recording(); const audiences: Array<readonly string[]> = [];
    const reply = await createCustomerNegotiationConversationHandler(new Flows(), port)(event(async () => DELEGATION, audiences));
    expect(reply?.step).toBe("negotiation:accept");
    expect(audiences).toEqual([NEGOTIATIONS_ASSERTION_AUDIENCE]);
    expect(port.delegations).toEqual([DELEGATION, DELEGATION, DELEGATION]);
  });

  it("تفويضٌ لِشخصٍ غيرِ المُرسِلِ يُسقَطُ ولا يُرسَلُ obo عنهُ", async () => {
    const port = new Recording();
    await createCustomerNegotiationConversationHandler(new Flows(), port)(event(async () => ({ publicId: "WS-9999999999", assertion: "wua1.x.y" })));
    expect(port.delegations).toEqual([undefined, undefined, undefined]);
  });

  it("بلا تأكيدٍ (null أو لا دالّةَ) يمضي الأمرُ كما كانَ — لا fail-closed في P1", async () => {
    for (const assertion of [undefined, async () => null]) {
      const port = new Recording();
      const reply = await createCustomerNegotiationConversationHandler(new Flows(), port)(event(assertion));
      expect(reply?.step).toBe("negotiation:accept");
      expect(port.delegations).toEqual([undefined, undefined, undefined]);
    }
  });
});
