/**
 * The stub order engine — a real HTTP service that is not a real engine.
 *
 * Phase 04 hands over an order intent and stops there: matching, the order state
 * machine and `order_public_id` belong to Phase 06 (ADR-009 §3, and the
 * `OrderIntakeRequest` schema in the service contract says so in as many words).
 * The exit gate still has to answer «does a valid order **reach** the engine»,
 * and answering it against an in-process function would prove almost nothing:
 * the payload would never be serialised, so a camelCase leak or a float price
 * would pass unnoticed.
 *
 * So this stub is a real listener that behaves like a strict engine:
 *
 *   - it validates the body against the published `OrderIntakeRequest` shape and
 *     answers 400 when a required field is missing or of the wrong type — the
 *     gate wants a *reader* of the contract, not a recorder that accepts
 *     anything;
 *   - it mints `order_public_id` itself, because the engine owns that id;
 *   - it records every request it received, so the gate can assert the handover
 *     payload rather than the fact that a call happened;
 *   - it can be told to reject, to hang, or to fail — the fail-closed paths are
 *     part of the gate, not an afterthought.
 *
 * It lives in the gate package on purpose. Putting it under `services/` would
 * create a deployable that looks like an engine, and someone would eventually
 * wire it into an environment. `node:http` rather than Fastify: a stub with its
 * own framework dependency is a stub that can break for reasons of its own.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** How the stub answers the next handover. */
export type StubEngineMode =
  /** 201 + a minted order id. */
  | "accept"
  /** 422: the engine understood the request and refused it. */
  | "reject"
  /** No answer at all, so the caller's timeout is what ends the request. */
  | "hang"
  /** 500: the engine is broken, which is not the same as absent. */
  | "fail";

/** The path the gate's adapter posts to. Not a published contract. */
export const STUB_ENGINE_INTAKE_PATH = "/orders/intake";

/** Required top-level fields of `OrderIntakeRequest`, per the service contract. */
const REQUIRED_FIELDS = [
  "order_request_id",
  "customer_public_id",
  "order_type",
  "vehicle_class",
  "price_mode",
  "stops",
  "requested_at",
] as const;

export interface StubEngineRequest {
  readonly body: Record<string, unknown>;
  readonly idempotencyKey: string | undefined;
  readonly traceId: string | undefined;
}

export interface StubOrderEngine {
  readonly baseUrl: string;
  /** Every accepted *and* refused handover, in arrival order. */
  readonly received: StubEngineRequest[];
  /** Bodies the stub rejected as not matching `OrderIntakeRequest`. */
  readonly malformed: Record<string, unknown>[];
  mode(next: StubEngineMode): void;
  /** Ids minted so far, so the gate can compare with what was stored. */
  readonly minted: string[];
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf-8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

/**
 * Reject anything that is not the published handover shape.
 *
 * Deliberately shallow — this is a stub, and a full validator here would be a
 * second implementation of the contract that could disagree with the real one.
 * What it does check is exactly what a serialisation mistake would break: the
 * field names, two stops, and a price that is an integer in minor units.
 */
function contractViolation(body: Record<string, unknown>): string | null {
  for (const field of REQUIRED_FIELDS) {
    if (body[field] === undefined || body[field] === null) return `missing ${field}`;
  }
  const stops = body.stops;
  if (!Array.isArray(stops) || stops.length !== 2) return "stops must be exactly two";
  for (const stop of stops as Record<string, unknown>[]) {
    if (typeof stop.zone_id !== "string") return "stop.zone_id must be a string";
    if (typeof stop.source !== "string") return "stop.source must be a string";
  }
  const price = body.offered_price as Record<string, unknown> | null | undefined;
  if (price !== null && price !== undefined) {
    if (!Number.isInteger(price.amount_minor)) return "offered_price.amount_minor must be integer";
    if (typeof price.currency !== "string") return "offered_price.currency must be a string";
  }
  // A camelCase key is the exact mistake this stub exists to catch.
  const camel = Object.keys(body).find((key) => /[A-Z]/.test(key));
  return camel === undefined ? null : `camelCase key in handover: ${camel}`;
}

/** Start the stub on an ephemeral loopback port. */
export async function startStubOrderEngine(
  initialMode: StubEngineMode = "accept",
): Promise<StubOrderEngine> {
  const received: StubEngineRequest[] = [];
  const malformed: Record<string, unknown>[] = [];
  const minted: string[] = [];
  let mode: StubEngineMode = initialMode;
  let sequence = 0;
  const pending = new Set<ServerResponse>();

  const server: Server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== STUB_ENGINE_INTAKE_PATH) {
        response.writeHead(404).end();
        return;
      }

      const raw = await readBody(request);
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "body is not JSON" }));
        return;
      }

      const violation = contractViolation(body);
      if (violation) {
        malformed.push(body);
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: violation }));
        return;
      }

      received.push({
        body,
        idempotencyKey: request.headers["idempotency-key"] as string | undefined,
        traceId: request.headers["x-request-id"] as string | undefined,
      });

      if (mode === "hang") {
        // Held open until close(): the caller's timeout must be what ends this.
        pending.add(response);
        return;
      }
      if (mode === "fail") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "engine exploded" }));
        return;
      }
      if (mode === "reject") {
        response.writeHead(422, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "vehicle class not served in this zone" }));
        return;
      }

      sequence += 1;
      const orderPublicId = `ORD-${String(sequence).padStart(6, "0")}`;
      minted.push(orderPublicId);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          order_public_id: orderPublicId,
          accepted_at: new Date().toISOString(),
        }),
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    received,
    malformed,
    minted,
    mode: (next) => {
      mode = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const response of pending) response.destroy();
        pending.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
