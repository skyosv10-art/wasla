import { describe, it, expect } from "vitest";
import type {
  ResolveIdentityRequest,
  ResolveIdentityResponse,
  IdentityUser,
  IdentityLink,
  paths,
} from "../index.js";

/**
 * Contract First smoke tests (ADR-004) — these are compile-time type checks
 * that confirm the generated types align with the published OpenAPI contract.
 * They run at runtime too (to exercise the vitest pipeline) but their primary
 * value is failing to compile if the contract drifts.
 */

describe("@wasla/contracts-identity (typed contracts)", () => {
  it("exposes a valid resolve request shape", () => {
    const req: ResolveIdentityRequest = {
      telegram_user_id: 987654321,
      telegram_username: "wasla_user",
      telegram_language_code: "ar",
      source: "customer_bot",
    };
    expect(req.telegram_user_id).toBe(987654321);
    expect(req.source).toBe("customer_bot");
  });

  it("enforces the source enum (positive values accepted)", () => {
    const customerBot: ResolveIdentityRequest["source"] = "customer_bot";
    const driverBot: ResolveIdentityRequest["source"] = "driver_bot";
    expect(customerBot).toBe("customer_bot");
    expect(driverBot).toBe("driver_bot");
  });

  it("exposes the resolve response with wasla_public_id + internal_uuid", () => {
    const res: ResolveIdentityResponse = {
      wasla_public_id: "WS-0000010427",
      internal_uuid: "550e8400-e29b-41d4-a716-446655440000",
      created: true,
    };
    expect(res.wasla_public_id).toMatch(/^WS-\d{10}$/);
    expect(res.created).toBe(true);
  });

  it("exposes the User entity with status enum", () => {
    const user: IdentityUser = {
      wasla_public_id: "WS-0000010427",
      status: "active",
      created_at: "2026-08-20T11:00:00Z",
    };
    expect(user.status).toBe("active");
  });

  it("exposes IdentityLink with provider enum", () => {
    const link: IdentityLink = {
      provider: "telegram",
      external_id: "987654321",
      verified: true,
    };
    expect(link.provider).toBe("telegram");
  });

  it("declares the resolve identity path as POST /identity/resolve", () => {
    type ResolvePath = paths["/identity/resolve"]["post"];
    // The path operation exists and is non-never.
    const _: ResolvePath = {} as ResolvePath;
    expect(_).toBeDefined();
  });
});
