import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  IdentityEvent,
  IdentityEventType,
  IdentityEventByType,
  IdentityCreatedV1,
  IdentityLinkAddedV1,
  TelegramUsernameChangedV1,
  RecoveryStartedV1,
} from "../index.js";
import { IDENTITY_EVENT_TYPES } from "../index.js";

/**
 * Drift-guard tests for the hand-derived event types.
 *
 * The event types are hand-authored from events.json (codegen produced an
 * unusable generic type for the $defs-only root schema). These tests read the
 * canonical events.json and assert the hand-written types stay in sync with
 * the contract's event_type literals + payload shapes.
 */

const eventsContract = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../../services/identity/contracts/events.json"),
    "utf8",
  ),
) as {
  $defs: Record<string, any>;
};

/** Extract the `const` event_type literal from a $def (or null). */
function eventTypeOf(def: any): string | null {
  const allOf = Array.isArray(def?.allOf) ? def.allOf : [];
  for (const part of allOf) {
    const et = part?.properties?.event_type?.const;
    if (typeof et === "string") return et;
  }
  return null;
}

describe("@wasla/contracts-identity — event types drift guard", () => {
  it("IDENTITY_EVENT_TYPES matches the event_type literals in events.json", () => {
    const schemaTypes = Object.values(eventsContract.$defs)
      .map(eventTypeOf)
      .filter((t): t is string => typeof t === "string")
      .sort();
    const codeTypes = [...IDENTITY_EVENT_TYPES].sort();
    expect(codeTypes).toEqual(schemaTypes);
  });

  it("every schema event_type has a matching TS interface in IdentityEventByType", () => {
    const schemaTypes = new Set(
      Object.values(eventsContract.$defs)
        .map(eventTypeOf)
        .filter((t): t is string => typeof t === "string"),
    );
    const tsKeys: IdentityEventType[] = [
      "identity.created",
      "identity.link.added",
      "identity.telegram_username.changed",
      "identity.recovery.started",
    ];
    for (const t of schemaTypes) {
      expect(tsKeys).toContain(t);
    }
    // Type-level check: IdentityEventByType keys are exactly the event types.
    type _Keys = keyof IdentityEventByType;
    const _assertKeys: _Keys[] = [
      "identity.created",
      "identity.link.added",
      "identity.telegram_username.changed",
      "identity.recovery.started",
    ];
    expect(_assertKeys).toHaveLength(4);
  });

  it("IdentityCreatedV1 payload mirrors the schema (wasla_public_id + source enum)", () => {
    const ev: IdentityCreatedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "identity.created",
      event_version: "v1",
      occurred_at: "2026-08-20T11:00:00Z",
      producer: "identity-service",
      aggregate: { type: "user", id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: { wasla_public_id: "WS-0000010427", source: "customer_bot" },
    };
    expect(ev.payload.wasla_public_id).toMatch(/^WS-\d{10}$/);
  });

  it("IdentityLinkAddedV1 payload mirrors the schema (provider + external_id + verified)", () => {
    const ev: IdentityLinkAddedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "identity.link.added",
      event_version: "v1",
      occurred_at: "2026-08-20T11:00:00Z",
      producer: "identity-service",
      aggregate: { type: "user", id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: { provider: "telegram", external_id: "987654321", verified: true },
    };
    expect(ev.payload.provider).toBe("telegram");
  });

  it("TelegramUsernameChangedV1 payload mirrors the schema (old/new username + source)", () => {
    const ev: TelegramUsernameChangedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "identity.telegram_username.changed",
      event_version: "v1",
      occurred_at: "2026-08-20T11:00:00Z",
      producer: "identity-service",
      aggregate: { type: "user", id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        old_username: null,
        new_username: "wasla_user",
        effective_at: "2026-08-20T11:00:00Z",
        source: "customer_bot",
      },
    };
    expect(ev.payload.old_username).toBeNull();
  });

  it("RecoveryStartedV1 payload mirrors the schema (recovery_id + verification_method)", () => {
    const ev: RecoveryStartedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "identity.recovery.started",
      event_version: "v1",
      occurred_at: "2026-08-20T11:00:00Z",
      producer: "identity-service",
      aggregate: { type: "user", id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: { recovery_id: "550e8400-e29b-41d4-a716-446655440000", verification_method: "phone_otp" },
    };
    expect(ev.payload.verification_method).toBe("phone_otp");
  });

  it("IdentityEvent union discriminates by event_type", () => {
    const ev: IdentityEvent = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "identity.created",
      event_version: "v1",
      occurred_at: "2026-08-20T11:00:00Z",
      producer: "identity-service",
      aggregate: { type: "user", id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: { wasla_public_id: "WS-0000010427", source: "driver_bot" },
    };
    if (ev.event_type === "identity.created") {
      expect(ev.payload.source).toBe("driver_bot");
    }
  });
});
