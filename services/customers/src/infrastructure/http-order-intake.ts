/**
 * The production HTTP adapter for `OrderIntakePort` (Phase 06 · MR 5/6).
 *
 * This is the line Phase 04 promised would be «one adapter swap»: it replaces
 * `UnavailableOrderIntake` in the composition root and nothing in the domain or
 * the use cases changes. It posts the published `OrderIntakeRequest` payload to
 * the order engine's `POST /orders/intake` (port 8087) and returns the engine's
 * own reference — this service still never mints `order_public_id`.
 *
 * It replaces the gate-owned `HttpStubOrderIntake` in `@wasla/customer-e2e`,
 * which was explicitly marked «must not become the production adapter». The
 * difference is not the fetch call, it is the status map: the gate's adapter
 * spoke to a stub with three moods, while the real engine publishes five answers
 * and each one means something different for the customer's row.
 *
 * ## Status map (the whole point of this file)
 *
 * The engine's contract documents the meaning of each answer, so this adapter
 * does not get to invent one:
 *
 *   201 → accepted, a new order exists.
 *   200 → same `Idempotency-Key`, same payload: the order already exists and the
 *         engine is replaying its reference. **This is a success, not a
 *         conflict** — treating it as a failure would flip a stored `submitted`
 *         row back to `submission_failed` on a harmless retry.
 *   409 → same key, *different* payload. Retrying cannot ever succeed, so it is
 *         recorded as a final refusal (`REJECTED`) rather than as a retryable
 *         outage: leaving it retryable would busy-loop a request that the engine
 *         will refuse identically forever. That it is *our* mistake is stated in
 *         the message and the log, not smuggled into the customer's code.
 *   422 → understood and refused on business grounds (`REJECTED`).
 *   400 / 415 / 404 / any other 4xx → the engine could not read what we sent, or
 *         we called a path it does not publish. That is a defect on this side,
 *         **not** a business refusal: it is reported as `UNAVAILABLE` so the row
 *         is fail-closed and the alert lands on us. Dressing it up as
 *         «rejected» would tell the customer their order was refused when in
 *         fact it was never understood.
 *   503 / 5xx / connection refused → `UNAVAILABLE`, retryable **with the same
 *         key** (the engine de-duplicates, so a retry cannot create a twin).
 *   no answer within the timeout → `TIMEOUT`, which is the one case where the
 *         order may or may not exist; it stays distinct from `UNAVAILABLE`
 *         precisely because whoever operates the system must be able to tell
 *         «never landed» from «unknown».
 *
 * Every one of those becomes `OrderIntakeFailure` with a reason code, never a
 * partial result: `attemptHandover` in the use case turns it into a
 * `submission_failed` row plus a failure event, and the customer sees a single
 * 503 (`CUSTOMER_ORDER_INTAKE_UNAVAILABLE`). The finer reason is for operating
 * the system, not for the customer (ADR-009 §3).
 *
 * ## Correlation
 *
 * The customer's `Idempotency-Key` is forwarded as-is — it is the customer's
 * key, not a second one invented here, which is what makes a retry of the same
 * button press land on the same order. Both services bound the key to 8–128
 * characters, so a key this service accepted cannot be rejected by the engine
 * for length. `x-request-id` is forwarded too, so one trace id spans the
 * customer's request, the engine's audit row and both event envelopes.
 *
 * ## What this adapter deliberately does not do
 *
 * - **No retry loop.** The engine is idempotent, so a retry is safe, but *when*
 *   to retry is a decision about the customer's experience (and about queueing),
 *   and `POST /me/order-requests` already retries a `submission_failed` row on
 *   the next attempt with the same key. A hidden retry here would multiply the
 *   customer's timeout by the retry count.
 * - **No reading of orders.** `OrderIntakePort` has one method on purpose: this
 *   service does not own the order lifecycle (ADR-009 §3).
 * - **No auth header.** Phase 06 has no service-to-service authentication; when
 *   it arrives it belongs here as an option, and its absence is recorded in
 *   ORDER_HTTP.md rather than faked with a placeholder token.
 */

import { OrderIntakeFailure } from "../domain/errors.js";
import type { IntakeFailureReason } from "../domain/model.js";
import type {
  OrderIntakePort,
  OrderIntakeRequestInput,
  OrderIntakeResultOutput,
  OrderIntakeCallContext,
} from "../ports.js";
import { toOrderIntakeRequestDto } from "../use-cases/mappers.js";

/** The engine's published intake path (orders service contract). */
export const ORDER_INTAKE_PATH = "/orders/intake";

export interface HttpOrderIntakeOptions {
  /** Base URL of the order engine, e.g. http://orders:8087 */
  readonly baseUrl: string;
  /**
   * Request timeout in ms (default 2000, as for the other HTTP adapters).
   *
   * A handover is inside the customer's request, so this is a promise to the
   * customer as much as a network setting: a longer timeout turns a stuck engine
   * into a stuck bot conversation.
   */
  readonly timeoutMs?: number;
}

interface IntakeResponseBody {
  order_public_id?: unknown;
  accepted_at?: unknown;
  code?: unknown;
}

/** `ORD-##########`, minted by the engine — never by this service. */
const ORDER_PUBLIC_ID_PATTERN = /^ORD-[0-9]{10}$/;

export class HttpOrderIntakePort implements OrderIntakePort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: HttpOrderIntakeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  async submitOrderRequest(
    request: OrderIntakeRequestInput,
    context: OrderIntakeCallContext = {},
  ): Promise<OrderIntakeResultOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${ORDER_INTAKE_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
          ...(context.traceId === undefined
            ? {}
            : { "x-request-id": context.traceId }),
        },
        body: JSON.stringify(toOrderIntakeRequestDto(request)),
        signal: controller.signal,
      });

      if (response.status === 201 || response.status === 200) {
        return await readAcceptance(response);
      }

      throw await failureFor(response);
    } catch (error) {
      if (error instanceof OrderIntakeFailure) throw error;
      // AbortError is the timeout firing: the order may or may not exist, which
      // is a different operational fact from «the engine refused the
      // connection», and the row records which one happened.
      const aborted = (error as Error).name === "AbortError";
      throw new OrderIntakeFailure(
        aborted ? "CUSTOMER_ORDER_INTAKE_TIMEOUT" : "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
        aborted
          ? `لم يُجب محرّك الطلبات خلال ${this.timeoutMs}ms`
          : `تعذّر تسليم الطلب إلى المحرّك: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Read the engine's reference, or refuse the acceptance.
 *
 * An answer we cannot read is not an acceptance: storing a `submitted` row with
 * no usable `order_public_id` would leave an order nobody can look up, and the
 * shape is checked (not just the type) because the id is what a customer, a
 * driver and a support agent will all quote later.
 */
async function readAcceptance(response: Response): Promise<OrderIntakeResultOutput> {
  let body: IntakeResponseBody;
  try {
    body = (await response.json()) as IntakeResponseBody;
  } catch {
    throw new OrderIntakeFailure(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
      "رد المحرّك ليس JSON صالحاً",
    );
  }

  const orderPublicId = body.order_public_id;
  const acceptedAt = body.accepted_at;
  if (
    typeof orderPublicId !== "string" ||
    !ORDER_PUBLIC_ID_PATTERN.test(orderPublicId) ||
    typeof acceptedAt !== "string" ||
    acceptedAt.length === 0
  ) {
    throw new OrderIntakeFailure(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
      "قبل المحرّك الطلب بلا مرجع صالح (order_public_id/accepted_at)",
    );
  }

  return { orderPublicId, acceptedAt };
}

/** Map a non-success status onto the operational reason it actually means. */
async function failureFor(response: Response): Promise<OrderIntakeFailure> {
  const code = await readErrorCode(response);
  const suffix = code === null ? "" : ` (${code})`;

  if (response.status === 422) {
    return new OrderIntakeFailure(
      "CUSTOMER_ORDER_INTAKE_REJECTED",
      `رفض المحرّك الطلب منطقياً${suffix}`,
    );
  }
  if (response.status === 409) {
    // Same key, different payload: no retry can change the answer, so the row is
    // final. It is our defect, and it says so — but it is not retryable.
    return new OrderIntakeFailure(
      "CUSTOMER_ORDER_INTAKE_REJECTED",
      `تعارض مفتاح تكرار مع حمولة مختلفة — خطأ في المُسلِّم لا رفض تجاري${suffix}`,
    );
  }
  if (response.status >= 400 && response.status < 500) {
    // 400/415/404/…: the engine could not read us, or we called a path it does
    // not publish. Ours to fix, and never presented as a business refusal.
    return new OrderIntakeFailure(
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
      `لم يفهم المحرّك حمولتنا بحالة ${response.status}${suffix}`,
    );
  }
  return new OrderIntakeFailure(
    "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    `محرّك الطلبات أجاب ${response.status}${suffix}`,
  );
}

/**
 * Pull the engine's error `code` for the log line, if the body carries one.
 *
 * Best-effort by design: a failure must never depend on the readability of the
 * failure body, so an unreadable body degrades the message and nothing else.
 */
async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as IntakeResponseBody;
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/** Reasons this adapter can produce — asserted by the tests, kept in one place. */
export const HTTP_ORDER_INTAKE_REASONS: readonly IntakeFailureReason[] = [
  "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
  "CUSTOMER_ORDER_INTAKE_REJECTED",
  "CUSTOMER_ORDER_INTAKE_TIMEOUT",
];
