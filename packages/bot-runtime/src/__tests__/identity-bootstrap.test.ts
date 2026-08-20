/**
 * HTTP identity bootstrap tests.
 *
 * The important behaviours are the classification ones: a transport problem must
 * stay *retryable*, while an actor reference that can never be resolved must be
 * *permanent*. Getting that backwards either burns the retry budget on a hopeless
 * request or drops a user who would have been fine on the second attempt.
 */

import { describe, expect, it } from "vitest";

import { ChannelError, type IdentityBootstrapInput } from "@wasla/channel-core";

import { HttpIdentityBootstrap, type FetchLike } from "../identity-bootstrap.js";

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}

function fetchStub(
  status: number,
  payload: unknown,
  recorded?: Recorded[],
): FetchLike {
  return async (url, init) => {
    recorded?.push({ url, body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> });
    return { status, json: async () => payload };
  };
}

function inputFor(ref = "900123"): IdentityBootstrapInput {
  return {
    channel: "telegram",
    bot: "driver",
    actor: { channelUserRef: ref, displayName: "كابتن", languageCode: "ar" },
    traceId: "trace-1",
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<ChannelError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelError);
    expect((error as ChannelError).code).toBe(code);
    return error as ChannelError;
  }
  throw new Error(`expected the call to fail with ${code}`);
}

describe("HttpIdentityBootstrap", () => {
  it("resolves an existing identity (200)", async () => {
    const recorded: Recorded[] = [];
    const bootstrap = new HttpIdentityBootstrap({
      baseUrl: "http://identity:8080/",
      fetchImpl: fetchStub(200, { wasla_public_id: "WS-0000000001", created: false }, recorded),
    });

    const result = await bootstrap.ensureIdentity(inputFor());

    expect(result).toEqual({ waslaPublicId: "WS-0000000001", created: false });
    // Trailing slashes are trimmed so the path is never doubled.
    expect(recorded[0]?.url).toBe("http://identity:8080/identity/resolve");
    expect(recorded[0]?.body).toEqual({
      telegram_user_id: 900123,
      telegram_language_code: "ar",
      source: "driver_bot",
    });
  });

  it("treats 201 as a created identity", async () => {
    const bootstrap = new HttpIdentityBootstrap({
      baseUrl: "http://identity:8080",
      fetchImpl: fetchStub(201, { wasla_public_id: "WS-0000000002" }),
    });

    const result = await bootstrap.ensureIdentity(inputFor());

    expect(result).toEqual({ waslaPublicId: "WS-0000000002", created: true });
  });

  it("turns an unexpected status into a retryable bootstrap failure", async () => {
    const bootstrap = new HttpIdentityBootstrap({
      baseUrl: "http://identity:8080",
      fetchImpl: fetchStub(500, {}),
    });

    const error = await expectCode(
      bootstrap.ensureIdentity(inputFor()),
      "CHANNEL_IDENTITY_BOOTSTRAP_FAILED",
    );
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(503);
  });

  it("turns a missing public id into a bootstrap failure", async () => {
    const bootstrap = new HttpIdentityBootstrap({
      baseUrl: "http://identity:8080",
      fetchImpl: fetchStub(200, { created: true }),
    });

    await expectCode(bootstrap.ensureIdentity(inputFor()), "CHANNEL_IDENTITY_BOOTSTRAP_FAILED");
  });

  it("turns a network failure into a bootstrap failure", async () => {
    const bootstrap = new HttpIdentityBootstrap({
      baseUrl: "http://identity:8080",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    await expectCode(bootstrap.ensureIdentity(inputFor()), "CHANNEL_IDENTITY_BOOTSTRAP_FAILED");
  });

  it("rejects a non-numeric actor reference permanently", async () => {
    const bootstrap = new HttpIdentityBootstrap({
      baseUrl: "http://identity:8080",
      fetchImpl: fetchStub(200, { wasla_public_id: "WS-0000000003" }),
    });

    const error = await expectCode(
      bootstrap.ensureIdentity(inputFor("not-a-number")),
      "CHANNEL_INVALID_UPDATE",
    );
    expect(error.retryable).toBe(false);
  });

  it("omits the language when the actor has none", async () => {
    const recorded: Recorded[] = [];
    const bootstrap = new HttpIdentityBootstrap({
      baseUrl: "http://identity:8080",
      fetchImpl: fetchStub(200, { wasla_public_id: "WS-0000000004" }, recorded),
    });

    await bootstrap.ensureIdentity({
      channel: "telegram",
      bot: "customer",
      actor: { channelUserRef: "42" },
    });

    expect(recorded[0]?.body).toEqual({ telegram_user_id: 42, source: "customer_bot" });
  });
});
