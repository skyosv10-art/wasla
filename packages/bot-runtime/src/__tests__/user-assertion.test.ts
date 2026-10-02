/**
 * ADR-060 · CLM-0440 — البوتُ يطلبُ التأكيدَ ويُمرِّرُهُ، ولا يصنعُهُ.
 *
 * المقيسُ: `HttpUserAssertionIssuer` يُوقِّعُ بصلاحيّةِ الإصدارِ وحدَها ويطلبُ فاعلَ بوتِهِ؛
 * و`event.userAssertion` أفضلُ جهدٍ — `null` بلا مُصدِرٍ أو عندَ إخفاقِهِ، والمحادثةُ تمضي.
 */
import { describe, expect, it } from "vitest";

import { ServiceAuthKeyRegistry, createServiceRequestSigner, verifyServiceToken } from "@wasla/service-auth";
import type { UserDelegation } from "@wasla/service-auth";

import type { ConversationEvent } from "../conversation.js";
import {
  CHANNEL_USER_ASSERTION_SCOPES,
  HttpUserAssertionIssuer,
  USER_ASSERTION_ISSUE_PATH,
  UserAssertionUnavailableError,
  type UserAssertionIssuerPort,
  type UserAssertionRequest,
} from "../user-assertion.js";

import { authHeaders, harnessFor } from "./harness.js";

const KID = "k-test-0001";
const SECRET = "bot-runtime-test-secret-0123456789";
const keys = new ServiceAuthKeyRegistry({ keys: [{ kid: KID, secret: SECRET, status: "active" }], activeKid: KID });

function commandUpdate(updateId: number, command: string): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_770_000_000,
      chat: { id: 4001, type: "private" },
      from: { id: 900123, first_name: "مستخدم", language_code: "ar" },
      text: `/${command}`,
    },
  };
}

describe("HttpUserAssertionIssuer", () => {
  function issuer(status: number, body: unknown, seen: Array<{ url: string; init: Record<string, unknown> }> = []) {
    return new HttpUserAssertionIssuer({
      baseUrl: "http://identity.test/",
      signRequest: createServiceRequestSigner({ serviceName: "driver-bot", audience: "identity", keys, scopes: CHANNEL_USER_ASSERTION_SCOPES }),
      fetchImpl: async (url, init) => {
        seen.push({ url, init: init as Record<string, unknown> });
        return { status, json: async () => body };
      },
    });
  }

  it("يطلبُ فاعلَ بوتِهِ وجمهوراً مُسمّىً، بمُوقِّعٍ صلاحيّتُهُ الإصدارُ وحدَهُ", async () => {
    const seen: Array<{ url: string; init: Record<string, unknown> }> = [];
    const result = await issuer(200, { assertion: "wua1.a.b", wasla_public_id: "WS-0000000007" }, seen).issue({
      channel: "telegram",
      bot: "driver",
      actor: { channelUserRef: "900123" } as UserAssertionRequest["actor"],
      audience: ["negotiations"],
      traceId: "t-1",
    });
    expect(result).toEqual({ publicId: "WS-0000000007", assertion: "wua1.a.b" });
    expect(seen[0]!.url).toBe(`http://identity.test${USER_ASSERTION_ISSUE_PATH}`);
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ telegram_user_id: 900123, actor_type: "driver", audience: ["negotiations"] });
    const headers = seen[0]!.init.headers as Record<string, string>;
    const principal = verifyServiceToken(headers["x-wasla-service-auth"]!, {
      keys,
      audience: "identity",
      now: new Date(),
      method: "POST",
      path: USER_ASSERTION_ISSUE_PATH,
    });
    expect(principal.serviceName).toBe("driver-bot");
    expect(principal.scopes).toEqual(["identity:assertion:issue"]);
  });

  it("جوابٌ غيرُ 200 أو مشوَّهٌ ⇒ UserAssertionUnavailableError بسببٍ مُسمّىً", async () => {
    const input = { channel: "telegram", bot: "customer", actor: { channelUserRef: "900123" }, audience: ["negotiations"] } as unknown as UserAssertionRequest;
    await expect(issuer(503, {}).issue(input)).rejects.toMatchObject({ reason: "identity_status_503" });
    await expect(issuer(200, { assertion: 1 }).issue(input)).rejects.toMatchObject({ reason: "identity_response_malformed" });
    const bad = { ...input, actor: { channelUserRef: "abc" } } as unknown as UserAssertionRequest;
    await expect(issuer(200, {}).issue(bad)).rejects.toBeInstanceOf(UserAssertionUnavailableError);
  });
});

describe("event.userAssertion — أفضلُ جهدٍ في P1", () => {
  async function run(userAssertions: UserAssertionIssuerPort | undefined) {
    const got: Array<UserDelegation | null> = [];
    const requests: UserAssertionRequest[] = [];
    const wrapped: UserAssertionIssuerPort | undefined =
      userAssertions === undefined
        ? undefined
        : { issue: async (input) => (requests.push(input), userAssertions.issue(input)) };
    const { app, channel } = harnessFor("customer", {
      supportedCommands: ["start", "places"],
      ...(wrapped === undefined ? {} : { userAssertions: wrapped }),
      onConversation: async (event: ConversationEvent) => {
        got.push((await event.userAssertion?.(["negotiations"])) ?? null);
        return { text: "تم", step: "places" };
      },
    });
    const response = await app.inject({ method: "POST", url: "/channel/customer/webhook", headers: authHeaders(), payload: commandUpdate(71, "places") });
    expect(response.statusCode).toBe(202);
    await app.close();
    return { got, requests, sent: channel.sent.length };
  }

  it("بلا مُصدِرٍ ⇒ null والمحادثةُ تُجيبُ", async () => {
    expect(await run(undefined)).toMatchObject({ got: [null], sent: 1 });
  });

  it("مُصدِرٌ يفشلُ ⇒ null والمحادثةُ تُجيبُ — لا fail-closed قبلَ enforce", async () => {
    const failing: UserAssertionIssuerPort = { issue: async () => { throw new UserAssertionUnavailableError("identity_status_503"); } };
    expect(await run(failing)).toMatchObject({ got: [null], sent: 1 });
  });

  it("مُصدِرٌ يُجيبُ ⇒ التفويضُ كما صدرَ، والطلبُ يحملُ مُرسِلَ التحديثِ وجمهورَهُ", async () => {
    const delegation = { publicId: "WS-0000000001", assertion: "wua1.p.s" };
    const result = await run({ issue: async () => delegation });
    expect(result.got).toEqual([delegation]);
    expect(result.requests[0]).toMatchObject({ bot: "customer", channel: "telegram", audience: ["negotiations"], actor: { channelUserRef: "900123" } });
  });
});
