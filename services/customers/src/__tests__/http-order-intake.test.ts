/**
 * `HttpOrderIntakePort` — the production handover adapter (Phase 06 · MR 5/6).
 *
 * These tests run against a **real loopback listener**, not a mocked `fetch`. The
 * whole risk in this adapter is on the wire: a camelCase key, a missing header, a
 * status mapped to the wrong operational meaning. A mocked fetch would assert the
 * mock's idea of the call and prove none of that.
 *
 * The listener is scripted per test (status + body + captured request) and stays
 * dumb on purpose — it is not a second implementation of the engine. The
 * engine's *real* behaviour is asserted over HTTP by the Phase 06 exit gate
 * (MR 6/6), which drives this same adapter against `createOrderApp`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { isOrderIntakeFailure, OrderIntakeFailure } from "../domain/errors.js";
import { HttpOrderIntakePort, ORDER_INTAKE_PATH } from "../infrastructure/http-order-intake.js";
import type { OrderIntakeRequestInput } from "../ports.js";

// ---------------------------------------------------------------------------
// A scripted engine on a real port
// ---------------------------------------------------------------------------

interface Captured {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Record<string, unknown>;
}

interface Script {
  /** Status to answer with (ignored when `hang` is true). */
  readonly status?: number;
  /** Body to answer with; a string is sent verbatim (used for «not JSON»). */
  readonly body?: unknown;
  /** Never answer — the caller's timeout must be what ends the request. */
  readonly hang?: boolean;
}

interface Engine {
  readonly baseUrl: string;
  readonly received: Captured[];
  close(): Promise<void>;
}

const servers: Engine[] = [];

async function startEngine(script: Script): Promise<Engine> {
  const received: Captured[] = [];
  const held = new Set<ServerResponse>();

  const server: Server = createServer((request: IncomingMessage, response) => {
    void (async () => {
      let raw = "";
      request.setEncoding("utf-8");
      for await (const chunk of request) raw += chunk as string;
      received.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: raw.length === 0 ? {} : (JSON.parse(raw) as Record<string, unknown>),
      });

      if (script.hang) {
        held.add(response);
        return;
      }
      response.writeHead(script.status ?? 201, { "content-type": "application/json" });
      response.end(typeof script.body === "string" ? script.body : JSON.stringify(script.body ?? {}));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const engine: Engine = {
    baseUrl: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const response of held) response.destroy();
        server.close(() => resolve());
      }),
  };
  servers.push(engine);
  return engine;
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

const ACCEPTED = { order_public_id: "ORD-0000000042", accepted_at: "2026-08-21T18:00:00.000Z" };

function intakeInput(overrides: Partial<OrderIntakeRequestInput> = {}): OrderIntakeRequestInput {
  return {
    orderRequestId: "11111111-2222-4333-8444-555555555555",
    customerPublicId: "WS-0000000001",
    orderType: "delivery",
    vehicleClass: "sedan",
    priceMode: "customer_offer",
    offeredPrice: { amountMinor: 2500, currency: "SAR" },
    stops: [
      {
        sequence: 1,
        kind: "pickup",
        zoneId: "zone-a",
        source: "manual_zone",
        label: null,
        coordinates: null,
        savedPlaceId: null,
      },
      {
        sequence: 2,
        kind: "dropoff",
        zoneId: "zone-b",
        source: "manual_zone",
        label: null,
        coordinates: null,
        savedPlaceId: null,
      },
    ],
    shipment: null,
    notes: null,
    requestedAt: "2026-08-21T17:59:00.000Z",
    idempotencyKey: "idem-key-0001",
    ...overrides,
  };
}

/** Reason code of the failure a call produced — or `null` if it succeeded. */
async function reasonOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (isOrderIntakeFailure(error)) return error.reasonCode;
    throw error;
  }
}

// ---------------------------------------------------------------------------

describe("HttpOrderIntakePort — the handover on the wire", () => {
  it("posts the published payload to /orders/intake and returns the engine's reference", async () => {
    const engine = await startEngine({ status: 201, body: ACCEPTED });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    const result = await port.submitOrderRequest(intakeInput());

    expect(result).toEqual({
      orderPublicId: "ORD-0000000042",
      acceptedAt: "2026-08-21T18:00:00.000Z",
    });
    const call = engine.received[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(ORDER_INTAKE_PATH);
    // The published shape, snake_case throughout: a camelCase key here is the
    // exact defect this assertion exists to catch.
    expect(Object.keys(call.body).some((key) => /[A-Z]/.test(key))).toBe(false);
    expect(call.body.customer_public_id).toBe("WS-0000000001");
    expect(call.body.offered_price).toEqual({ amount_minor: 2500, currency: "SAR" });
    expect(Array.isArray(call.body.stops)).toBe(true);
  });

  it("forwards the customer's idempotency key, never a new one", async () => {
    const engine = await startEngine({ status: 201, body: ACCEPTED });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await port.submitOrderRequest(intakeInput({ idempotencyKey: "customer-key-9" }));

    const call = engine.received[0]!;
    expect(call.headers["idempotency-key"]).toBe("customer-key-9");
    // The body carries the same key: the engine rejects a disagreement (400), so
    // the two must come from one source.
    expect(call.body.idempotency_key).toBe("customer-key-9");
  });

  it("forwards the trace id when there is one, and sends no header when there is not", async () => {
    const engine = await startEngine({ status: 201, body: ACCEPTED });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await port.submitOrderRequest(intakeInput(), { traceId: "trace-abc" });
    await port.submitOrderRequest(intakeInput());

    expect(engine.received[0]!.headers["x-request-id"]).toBe("trace-abc");
    expect(engine.received[1]!.headers["x-request-id"]).toBeUndefined();
  });

  it("treats 200 as success: it is the engine replaying the same key, not a conflict", async () => {
    const engine = await startEngine({ status: 200, body: ACCEPTED });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(port.submitOrderRequest(intakeInput())).resolves.toEqual({
      orderPublicId: "ORD-0000000042",
      acceptedAt: "2026-08-21T18:00:00.000Z",
    });
  });

  it("maps 422 to a business rejection", async () => {
    const engine = await startEngine({
      status: 422,
      body: { code: "ORDER_ZONE_NOT_SERVED", message: "…", trace_id: "t" },
    });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(reasonOf(port.submitOrderRequest(intakeInput()))).resolves.toBe(
      "CUSTOMER_ORDER_INTAKE_REJECTED",
    );
  });

  it("maps 409 to a final rejection, because retrying the same key cannot change it", async () => {
    const engine = await startEngine({
      status: 409,
      body: { code: "ORDER_IDEMPOTENCY_KEY_REUSED", message: "…", trace_id: "t" },
    });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    const reason = await reasonOf(port.submitOrderRequest(intakeInput()));
    expect(reason).toBe("CUSTOMER_ORDER_INTAKE_REJECTED");
  });

  it("names the engine's error code in the failure message, for the log line", async () => {
    const engine = await startEngine({
      status: 422,
      body: { code: "ORDER_PRICE_MODE_CONFLICT", message: "…", trace_id: "t" },
    });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(port.submitOrderRequest(intakeInput())).rejects.toThrow(
      /ORDER_PRICE_MODE_CONFLICT/,
    );
  });

  it("maps 400 to unavailable, not rejected: an unread payload is our defect", async () => {
    const engine = await startEngine({
      status: 400,
      body: { code: "ORDER_VALIDATION_FAILED", message: "…", trace_id: "t" },
    });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(reasonOf(port.submitOrderRequest(intakeInput()))).resolves.toBe(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
  });

  it("maps 404 to unavailable: a path the engine does not publish is our mistake", async () => {
    const engine = await startEngine({ status: 404, body: {} });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(reasonOf(port.submitOrderRequest(intakeInput()))).resolves.toBe(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
  });

  it("maps 503 to unavailable, which is the retryable case", async () => {
    const engine = await startEngine({
      status: 503,
      body: { code: "ORDER_ENGINE_UNAVAILABLE", message: "…", trace_id: "t" },
    });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(reasonOf(port.submitOrderRequest(intakeInput()))).resolves.toBe(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
  });

  it("maps 500 to unavailable", async () => {
    const engine = await startEngine({ status: 500, body: "boom" });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(reasonOf(port.submitOrderRequest(intakeInput()))).resolves.toBe(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
  });

  it("times out into TIMEOUT — distinct from unavailable, because the order may exist", async () => {
    const engine = await startEngine({ hang: true });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl, timeoutMs: 60 });

    const reason = await reasonOf(port.submitOrderRequest(intakeInput()));
    expect(reason).toBe("CUSTOMER_ORDER_INTAKE_TIMEOUT");
    // The engine did receive it: this is exactly the «unknown» case.
    expect(engine.received).toHaveLength(1);
  });

  it("reports an unreachable engine as unavailable rather than throwing a raw error", async () => {
    const engine = await startEngine({ status: 201, body: ACCEPTED });
    const baseUrl = engine.baseUrl;
    await engine.close();
    servers.length = 0;
    const port = new HttpOrderIntakePort({ baseUrl, timeoutMs: 200 });

    const error = await port
      .submitOrderRequest(intakeInput())
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OrderIntakeFailure);
    expect((error as OrderIntakeFailure).reasonCode).toBe("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");
  });

  it("refuses an acceptance with no usable reference", async () => {
    const engine = await startEngine({ status: 201, body: { accepted_at: "2026-08-21T18:00:00Z" } });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(reasonOf(port.submitOrderRequest(intakeInput()))).resolves.toBe(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
  });

  it("refuses an acceptance whose order id is not the engine's public id shape", async () => {
    const engine = await startEngine({
      status: 201,
      body: { order_public_id: "42", accepted_at: "2026-08-21T18:00:00Z" },
    });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(reasonOf(port.submitOrderRequest(intakeInput()))).resolves.toBe(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
  });

  it("refuses an acceptance whose body is not JSON", async () => {
    const engine = await startEngine({ status: 201, body: "<html>proxy error</html>" });
    const port = new HttpOrderIntakePort({ baseUrl: engine.baseUrl });

    await expect(reasonOf(port.submitOrderRequest(intakeInput()))).resolves.toBe(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
  });

  it("tolerates a trailing slash in the configured base url", async () => {
    const engine = await startEngine({ status: 201, body: ACCEPTED });
    const port = new HttpOrderIntakePort({ baseUrl: `${engine.baseUrl}/` });

    await port.submitOrderRequest(intakeInput());

    expect(engine.received[0]!.url).toBe(ORDER_INTAKE_PATH);
  });
});
