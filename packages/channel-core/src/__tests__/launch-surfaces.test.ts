import { describe, expect, it } from "vitest";

import { BOT_KINDS, BOT_MINI_APP } from "@wasla/contracts-channel";

import { StaticMiniAppRegistry, testRegistry } from "../infrastructure/in-memory.js";
import { decodeDeepLinkPayload } from "../domain/deep-link.js";
import { createDeepLink, getMiniAppLaunch } from "../use-cases/launch-surfaces.js";

describe("getMiniAppLaunch", () => {
  it("gives every bot its own mini app (Phase 03 exit gate assertion)", () => {
    const deps = { registry: testRegistry() };

    for (const bot of BOT_KINDS) {
      const descriptor = getMiniAppLaunch(deps, bot);
      expect(descriptor.miniApp).toBe(BOT_MINI_APP[bot]);
      expect(descriptor.url).toContain(bot);
    }
  });

  it("rejects an unregistered bot", () => {
    const deps = { registry: new StaticMiniAppRegistry({}) };

    expect(() => getMiniAppLaunch(deps, "customer")).toThrowError(
      expect.objectContaining({ code: "CHANNEL_UNKNOWN_BOT" }) as Error,
    );
  });

  it("distinguishes a registered bot with no mini app configured", () => {
    const deps = {
      registry: new StaticMiniAppRegistry({
        driver: { bot: "driver", miniApp: "driver", miniAppUrl: "", miniAppLabel: "driver app" },
      }),
    };

    expect(() => getMiniAppLaunch(deps, "driver")).toThrowError(
      /CHANNEL_MINI_APP_NOT_CONFIGURED|مُهيّأة/,
    );
  });
});

describe("createDeepLink", () => {
  it("substitutes an encoded payload into the configured template", () => {
    const deps = { registry: testRegistry() };

    const link = createDeepLink(deps, {
      bot: "customer",
      action: "track_order",
      params: { order: "ORD-7" },
    });

    expect(link.url).toBe(`https://example.test/bots/customer?payload=${link.payload}`);
    expect(decodeDeepLinkPayload(link.payload)).toEqual({
      action: "track_order",
      params: { order: "ORD-7" },
    });
  });

  it("refuses a bot without a template instead of guessing a url shape", () => {
    const deps = {
      registry: new StaticMiniAppRegistry({
        partner: {
          bot: "partner",
          miniApp: "partner",
          miniAppUrl: "https://example.test/partner",
          miniAppLabel: "partner app",
        },
      }),
    };

    expect(() => createDeepLink(deps, { bot: "partner", action: "open_app" })).toThrowError(
      /CHANNEL_UNKNOWN_BOT|قالب/,
    );
  });
});
