/**
 * Launch surface route tests: which Mini App a bot exposes, and the links it
 * generates.
 *
 * The 1:1 bot→Mini App mapping asserted here is the Phase 03 Exit Gate criterion.
 * It is verified over HTTP as well as in the core because the mapping is only
 * useful if the *deployed surface* honours it.
 */

import { describe, expect, it } from "vitest";

import { BOT_KINDS } from "@wasla/contracts-channel";

import { authHeaders, harnessFor } from "./harness.js";

describe("GET /channel/:bot/mini-app", () => {
  it.each(BOT_KINDS)("bot %s reports its own Mini App", async (bot) => {
    const { app, presence } = harnessFor(bot);

    const response = await app.inject({ method: "GET", url: `/channel/${bot}/mini-app` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      bot,
      mini_app: bot,
      url: presence.miniAppUrl,
      label: presence.miniAppLabel,
    });
  });

  it("returns 404 for another bot's Mini App", async () => {
    const { app } = harnessFor("driver");

    const response = await app.inject({ method: "GET", url: "/channel/partner/mini-app" });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CHANNEL_UNKNOWN_BOT");
  });
});

describe("POST /channel/:bot/deep-links", () => {
  it("builds a link from the configured template", async () => {
    const { app } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/deep-links",
      headers: authHeaders(),
      payload: { action: "track_order", params: { order: "ORD-1" } },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.bot).toBe("customer");
    expect(body.action).toBe("track_order");
    expect(body.payload.length).toBeGreaterThan(0);
    // The URL comes from configuration; no address is authored in code.
    expect(body.url.startsWith("https://t.me/wasla_customer_bot?start=")).toBe(true);
    expect(body.url).toContain(encodeURIComponent(body.payload));
  });

  it("rejects a request without an action", async () => {
    const { app } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/deep-links",
      headers: authHeaders(),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CHANNEL_INVALID_DEEP_LINK");
  });

  it("rejects non-string params", async () => {
    const { app } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/deep-links",
      headers: authHeaders(),
      payload: { action: "open_app", params: { attempts: 3 } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CHANNEL_INVALID_DEEP_LINK");
  });

  it("returns 404 when the path names another bot", async () => {
    const { app } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/driver/deep-links",
      headers: authHeaders(),
      payload: { action: "open_app" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CHANNEL_UNKNOWN_BOT");
  });
});
