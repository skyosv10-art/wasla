/**
 * G-S10 (CLM-0613): permission and contract boundaries of the two drivers routes
 * the driver mini app's Home now calls — `PUT /drivers/:id/availability` and
 * `GET /drivers/:id/eligibility`. Uses the real Fastify app behind the real
 * service-identity middleware (`rawInject` + an explicit `signFor`), so what is
 * proven is the route's enforcement, not the test harness's auto-signing.
 *
 * Every refusal also re-reads the profile to prove the refused write changed
 * nothing.
 */
import { describe, expect, it } from "vitest";

import { DRIVER_SCOPES } from "../http/service-identity.js";

import { DRIVER, environment } from "./helpers.js";
import { buildSignedDriverApp, signFor } from "./service-identity-support.js";

const OTHER = "WS-9999999999";
const AVAILABILITY = `/drivers/${DRIVER}/availability`;
const ELIGIBILITY = `/drivers/${DRIVER}/eligibility`;
const PROFILE = `/drivers/${DRIVER}`;

async function seeded() {
  const env = environment();
  const { registerDriver } = await import("../use-cases/register-driver.js");
  const runner = (await import("../runner.js")).createDirectRunner(env);
  await runner.write(async (deps) => {
    await registerDriver(deps, {
      waslaPublicId: DRIVER,
      displayName: "سائق تجربة",
      preferredLocale: "ar",
      workCityZoneId: null,
      serviceKinds: ["ride"],
      traceId: "seed",
    });
  });
  return buildSignedDriverApp({ runner });
}

type Harness = Awaited<ReturnType<typeof seeded>>;

async function declared(h: Harness): Promise<string> {
  const res = await h.rawInject({
    method: "GET",
    url: PROFILE,
    headers: signFor("GET", PROFILE, { keys: h.keys, scopes: [DRIVER_SCOPES.profileRead] }),
  });
  expect(res.statusCode).toBe(200);
  return res.json().declared_availability as string;
}

describe("PUT /drivers/:id/availability — boundaries", () => {
  it("the owner with drivers:availability:write switches available → offline → available", async () => {
    const h = await seeded();
    for (const value of ["available", "offline", "available"] as const) {
      const res = await h.rawInject({
        method: "PUT",
        url: AVAILABILITY,
        headers: signFor("PUT", AVAILABILITY, { keys: h.keys, scopes: [DRIVER_SCOPES.availabilityWrite] }),
        payload: { declared_availability: value },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().declared_availability).toBe(value);
      expect(await declared(h)).toBe(value);
    }
    await h.app.close();
  });

  it("without drivers:availability:write → 403 and the declaration is unchanged", async () => {
    const h = await seeded();
    const before = await declared(h);
    const target = before === "available" ? "offline" : "available";
    const res = await h.rawInject({
      method: "PUT",
      url: AVAILABILITY,
      headers: signFor("PUT", AVAILABILITY, { keys: h.keys, scopes: [DRIVER_SCOPES.profileWrite] }),
      payload: { declared_availability: target },
    });
    expect(res.statusCode).toBe(403);
    expect(await declared(h)).toBe(before);
    await h.app.close();
  });

  it("a token for another driver → 404 (not 403) and the declaration is unchanged", async () => {
    const h = await seeded();
    const before = await declared(h);
    const target = before === "available" ? "offline" : "available";
    const res = await h.rawInject({
      method: "PUT",
      url: AVAILABILITY,
      headers: signFor("PUT", AVAILABILITY, {
        keys: h.keys,
        scopes: [DRIVER_SCOPES.availabilityWrite],
        onBehalfOfPublicId: OTHER,
      }),
      payload: { declared_availability: target },
    });
    expect(res.statusCode).toBe(404);
    expect(await declared(h)).toBe(before);
    await h.app.close();
  });

  it("busy is not declarable by the driver → 400 on declared_availability, unchanged", async () => {
    const h = await seeded();
    const before = await declared(h);
    const res = await h.rawInject({
      method: "PUT",
      url: AVAILABILITY,
      headers: signFor("PUT", AVAILABILITY, { keys: h.keys, scopes: [DRIVER_SCOPES.availabilityWrite] }),
      payload: { declared_availability: "busy" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toMatchObject({ field: "declared_availability" });
    expect(await declared(h)).toBe(before);
    await h.app.close();
  });
});

describe("GET /drivers/:id/eligibility — boundaries", () => {
  it("the owner with drivers:eligibility:read gets the verdict with every reason", async () => {
    const h = await seeded();
    const res = await h.rawInject({
      method: "GET",
      url: ELIGIBILITY,
      headers: signFor("GET", ELIGIBILITY, { keys: h.keys, scopes: [DRIVER_SCOPES.eligibilityRead] }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.wasla_public_id).toBe(DRIVER);
    // A freshly registered driver: no vehicle, no zone, no documents — all three
    // reasons, not just the first (the screen lists every reason).
    expect(body.eligibility_state).toBe("ineligible");
    expect(body.reason_codes).toEqual(["NO_PRIMARY_VEHICLE", "NO_SERVICE_ZONE", "DOCUMENT_MISSING"]);
    await h.app.close();
  });

  it("without drivers:eligibility:read → 403", async () => {
    const h = await seeded();
    const res = await h.rawInject({
      method: "GET",
      url: ELIGIBILITY,
      headers: signFor("GET", ELIGIBILITY, { keys: h.keys, scopes: [DRIVER_SCOPES.profileRead] }),
    });
    expect(res.statusCode).toBe(403);
    await h.app.close();
  });

  it("a token for another driver → 404 (not 403)", async () => {
    const h = await seeded();
    const res = await h.rawInject({
      method: "GET",
      url: ELIGIBILITY,
      headers: signFor("GET", ELIGIBILITY, {
        keys: h.keys,
        scopes: [DRIVER_SCOPES.eligibilityRead],
        onBehalfOfPublicId: OTHER,
      }),
    });
    expect(res.statusCode).toBe(404);
    await h.app.close();
  });
});
