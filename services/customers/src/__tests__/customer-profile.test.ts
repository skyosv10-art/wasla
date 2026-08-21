/**
 * Profile use-case tests.
 *
 * Assertions target the documented error codes and event payloads, never Arabic
 * copy, so wording can change without breaking the suite.
 */

import { describe, expect, it } from "vitest";

import {
  getCustomerProfile,
  upsertCustomerProfile,
} from "../use-cases/customer-profile.js";
import {
  CUSTOMER,
  ZONE_A,
  ZONE_INACTIVE,
  ZONE_UNKNOWN,
  expectCustomerError,
  makeContext,
} from "./helpers.js";

describe("customer profile", () => {
  it("creates a profile with the documented defaults", async () => {
    const ctx = makeContext();
    const result = await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: {},
    });

    expect(result.created).toBe(true);
    expect(result.profile.preferredLocale).toBe("ar");
    expect(result.profile.status).toBe("active");
    expect(result.profile.displayName).toBeNull();
    expect(result.profile.defaultZoneId).toBeNull();

    const [event] = ctx.outbox.all();
    expect(event?.event_type).toBe("customer.profile.created");
    expect(event?.producer).toBe("customers-service");
  });

  it("rejects an id that does not match the WASLA pattern", async () => {
    const ctx = makeContext();
    await expectCustomerError(
      () => getCustomerProfile(ctx, { waslaPublicId: "WS-123" }),
      "CUSTOMER_INVALID_PUBLIC_ID",
    );
  });

  it("returns 404 for a customer with no profile", async () => {
    const ctx = makeContext();
    const failure = await expectCustomerError(
      () => getCustomerProfile(ctx, { waslaPublicId: CUSTOMER }),
      "CUSTOMER_PROFILE_NOT_FOUND",
    );
    expect(failure.httpStatus).toBe(404);
  });

  it("refuses to create a profile for an unknown identity", async () => {
    const ctx = makeContext();
    ctx.identityLookup.remove(CUSTOMER);
    await expectCustomerError(
      () => upsertCustomerProfile(ctx, { waslaPublicId: CUSTOMER, patch: {} }),
      "CUSTOMER_IDENTITY_NOT_FOUND",
    );
  });

  it("validates the default zone before storing it", async () => {
    const ctx = makeContext();
    await expectCustomerError(
      () =>
        upsertCustomerProfile(ctx, {
          waslaPublicId: CUSTOMER,
          patch: { defaultZoneId: ZONE_UNKNOWN },
        }),
      "CUSTOMER_ZONE_NOT_FOUND",
    );
    await expectCustomerError(
      () =>
        upsertCustomerProfile(ctx, {
          waslaPublicId: CUSTOMER,
          patch: { defaultZoneId: ZONE_INACTIVE },
        }),
      "CUSTOMER_ZONE_INACTIVE",
    );
  });

  it("updates only the fields present in the patch", async () => {
    const ctx = makeContext();
    await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: "أبو محمد", defaultZoneId: ZONE_A },
    });
    ctx.outbox.clear();
    ctx.clock.advance(60_000);

    const result = await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { preferredLocale: "ur" },
    });

    expect(result.created).toBe(false);
    expect(result.changedFields).toEqual(["preferred_locale"]);
    // Untouched keys survive the update.
    expect(result.profile.displayName).toBe("أبو محمد");
    expect(result.profile.defaultZoneId).toBe(ZONE_A);
    expect(result.profile.updatedAt).not.toBe(result.profile.createdAt);

    const [event] = ctx.outbox.all();
    expect(event?.event_type).toBe("customer.profile.updated");
  });

  it("clears a field when the patch sends null explicitly", async () => {
    const ctx = makeContext();
    await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: "أبو محمد" },
    });
    const result = await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: null },
    });

    expect(result.profile.displayName).toBeNull();
    expect(result.changedFields).toEqual(["display_name"]);
  });

  it("emits no event and reports no change for a no-op update", async () => {
    const ctx = makeContext();
    await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: "أبو محمد" },
    });
    ctx.outbox.clear();

    const result = await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: "أبو محمد" },
    });

    expect(result.changedFields).toEqual([]);
    expect(ctx.outbox.all()).toHaveLength(0);
  });
});
