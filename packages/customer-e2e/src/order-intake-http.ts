/**
 * A gate-owned HTTP adapter for `OrderIntakePort`.
 *
 * **This is not the production adapter, and it must not become one.** Since
 * Phase 06 · MR 5/6 the production one exists — `HttpOrderIntakePort` in
 * `services/customers/src/infrastructure/http-order-intake.ts` — and it is what
 * the Phase 06 exit gate drives against the real engine. This adapter stays here
 * unchanged because the Phase 04 gate is a *frozen* proof about Phase 04: if it
 * started importing the production adapter, a later change to the engine's status
 * map would silently rewrite what Phase 04 was signed off on.
 *
 * The `OrderIntakeRequest` schema in `services/customers/contracts/api.openapi.yml`
 * assigns that work to Phase 06, which owns the engine and therefore owns its
 * URL, its auth and its retry policy. What Phase 04 owes is narrower: proof that
 * a validated intent leaves this service **as the published payload** and that
 * every refusal path is fail-closed. That needs an adapter, so the gate brings
 * its own — minimal, and living in a package that has no deployable.
 *
 * It uses the service's own `toOrderIntakeRequestDto`, which is the point: if the
 * gate wrote its own mapping, it would be asserting the gate's idea of the
 * handover rather than the service's.
 *
 * The three failure reasons are distinguished because the row and the failure
 * event carry them for whoever operates the system (ADR-009 §3):
 *
 *   422           → CUSTOMER_ORDER_INTAKE_REJECTED  (understood and refused)
 *   abort/timeout → CUSTOMER_ORDER_INTAKE_TIMEOUT   (no answer in time)
 *   anything else → CUSTOMER_ORDER_INTAKE_UNAVAILABLE (unreachable or broken)
 *
 * A 400 from the engine is *not* mapped to «rejected»: it means this adapter sent
 * something the engine could not read, which is a bug on our side, so it is
 * reported as unavailable rather than dressed up as a business refusal.
 */

import {
  OrderIntakeFailure,
  toOrderIntakeRequestDto,
  type OrderIntakePort,
  type OrderIntakeRequestInput,
  type OrderIntakeResultOutput,
} from "@wasla/customers-service";

import { STUB_ENGINE_INTAKE_PATH } from "./stub-order-engine.js";

export interface HttpOrderIntakeOptions {
  /** Base URL of the engine, e.g. http://127.0.0.1:34567 */
  readonly baseUrl: string;
  /** Request timeout in ms (default 2000, as for the other adapters). */
  readonly timeoutMs?: number;
}

interface IntakeResponseBody {
  order_public_id?: unknown;
  accepted_at?: unknown;
}

export class HttpStubOrderIntake implements OrderIntakePort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: HttpOrderIntakeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  async submitOrderRequest(
    request: OrderIntakeRequestInput,
  ): Promise<OrderIntakeResultOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${STUB_ENGINE_INTAKE_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The engine needs it to de-duplicate a retried handover; it is the
          // customer's key, not a second one invented here.
          "idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify(toOrderIntakeRequestDto(request)),
        signal: controller.signal,
      });

      if (response.status === 422) {
        throw new OrderIntakeFailure(
          "CUSTOMER_ORDER_INTAKE_REJECTED",
          "the order engine refused the request",
        );
      }
      if (response.status !== 201 && response.status !== 200) {
        throw new OrderIntakeFailure(
          "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
          `order engine answered ${response.status}`,
        );
      }

      const body = (await response.json()) as IntakeResponseBody;
      if (typeof body.order_public_id !== "string" || typeof body.accepted_at !== "string") {
        // An answer we cannot read is not an acceptance: storing a row without
        // the engine's reference would leave an order nobody can look up.
        throw new OrderIntakeFailure(
          "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
          "order engine answered without a usable reference",
        );
      }

      return { orderPublicId: body.order_public_id, acceptedAt: body.accepted_at };
    } catch (error) {
      if (error instanceof OrderIntakeFailure) throw error;
      const aborted = (error as Error).name === "AbortError";
      throw new OrderIntakeFailure(
        aborted ? "CUSTOMER_ORDER_INTAKE_TIMEOUT" : "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
        `order engine handover failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
