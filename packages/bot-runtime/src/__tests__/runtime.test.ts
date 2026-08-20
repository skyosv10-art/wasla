/**
 * Composition tests — the ADR-007 axiom, executed.
 *
 * `buildBotRuntime` is the only place that names a concrete adapter, so these
 * tests do two things: they prove the production wiring boots from environment
 * variables alone, and they prove the same wiring runs with the channel and the
 * identity service swapped for test doubles, with nothing above changed.
 */

import { describe, expect, it } from "vitest";

import {
  FakeIdentityBootstrap,
  MockChannelAdapter,
  type ChannelDispatch,
} from "@wasla/channel-core";

import { envNames, loadBotConfig, type EnvBag } from "../config.js";
import { createBotApp } from "../http/app.js";
import { buildBotRuntime } from "../runtime.js";

import { authHeaders, startUpdate } from "./harness.js";

const SECRET = "a-sufficiently-long-secret";

function envFor(bot: "customer" | "driver" | "partner", overrides: EnvBag = {}): EnvBag {
  const names = envNames(bot);
  return {
    [names.token]: "token-value",
    [names.webhookSecret]: SECRET,
    [names.miniAppUrl]: `https://apps.wasla.test/${bot}`,
    [names.deepLinkTemplate]: `https://t.me/wasla_${bot}_bot?start={payload}`,
    ...overrides,
  };
}

function appFor(
  bot: "customer" | "driver" | "partner",
  env: EnvBag,
  doubles: { channel?: MockChannelAdapter; identity?: FakeIdentityBootstrap } = {},
) {
  const config = loadBotConfig(bot, env);
  const runtime = buildBotRuntime(config, {
    ...(doubles.channel ? { channel: doubles.channel } : {}),
    ...(doubles.identity ? { identity: doubles.identity } : {}),
  });

  const app = createBotApp({
    deps: {
      bot: runtime.bot,
      inbound: runtime.inbound,
      outbound: runtime.outbound,
      launch: runtime.launch,
    },
    webhookSecret: config.webhookSecret,
    health: () => (runtime.identityDegraded ? "degraded" : "ok"),
  });

  return { app, runtime };
}

describe("buildBotRuntime", () => {
  it("runs an end-to-end /start with the channel and identity swapped out", async () => {
    const channel = new MockChannelAdapter();
    const identity = new FakeIdentityBootstrap();
    const { app } = appFor("driver", envFor("driver", { IDENTITY_SERVICE_URL: "http://identity:8080" }), {
      channel,
      identity,
    });

    const response = await app.inject({
      method: "POST",
      url: "/channel/driver/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(1),
    });

    expect(response.statusCode).toBe(202);
    expect(identity.calls).toHaveLength(1);
    const dispatch = channel.last() as ChannelDispatch;
    expect(dispatch.buttons?.[0]).toMatchObject({ type: "mini_app", miniApp: "driver" });
    // The Mini App URL came from the environment, not from the source.
    expect((await app.inject({ method: "GET", url: "/channel/driver/mini-app" })).json().url).toBe(
      "https://apps.wasla.test/driver",
    );
  });

  it("reports `degraded` and refuses /start when no identity service is configured", async () => {
    const channel = new MockChannelAdapter();
    const { app } = appFor("customer", envFor("customer"), { channel });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ status: "degraded", channel: "telegram" });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(2),
    });

    // Retryable and honest: no identity is invented, so the update can be replayed
    // once the service is wired.
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("CHANNEL_IDENTITY_BOOTSTRAP_FAILED");
    expect(channel.sent).toHaveLength(0);
  });

  it("builds the real Telegram adapter when no double is injected", async () => {
    const { runtime } = appFor("partner", envFor("partner", { IDENTITY_SERVICE_URL: "http://identity:8080" }));

    expect(runtime.outbound.channel.channel).toBe("telegram");
    expect(runtime.identityDegraded).toBe(false);
  });
});
