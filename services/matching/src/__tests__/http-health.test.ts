import { describe, expect, it } from "vitest";

import { createMatchingApp } from "../http/app.js";
import { createDirectRunner } from "../runner.js";

import { createHarness } from "./harness.js";
import { createHttpHarness } from "./http-support.js";

describe("GET /health", () => {
  it("يعلن الذاكرة degraded ولو كانت نسخة القواعد المجمدة موجودة", async () => {
    const { app } = createHttpHarness();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      service: "matching-service",
      persistence: "memory",
      active_ruleset_version: 1,
    });
    await app.close();
  });

  it("لا يعلن ok إلا مع Postgres ونسخة قواعد مجمدة", async () => {
    const app = createMatchingApp({
      runner: createDirectRunner(createHarness()),
      health: { persistence: "postgres" },
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      persistence: "postgres",
      active_ruleset_version: 1,
    });
    await app.close();
  });
});
