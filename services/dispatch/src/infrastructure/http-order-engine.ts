import type { ServiceRequestSigner } from "@wasla/service-auth";

import type {
  OrderEnginePort,
  OrderEngineResult,
  RegisterOfferInput,
  ResolveAssignmentInput,
  TransitionOrderInput,
} from "../ports.js";

export const ORDER_ASSIGNMENTS_PATH = (orderId: string): string => `/orders/${orderId}/assignments`;
export const ORDER_ASSIGNMENT_PATH = (orderId: string, assignmentId: string): string =>
  `/orders/${orderId}/assignments/${assignmentId}`;
export const ORDER_TRANSITIONS_PATH = (orderId: string): string => `/orders/${orderId}/transitions`;

/** الصلاحيات التي يحتاجها هذا العميل على حد الطلبات، لا أكثر. */
export const DISPATCH_ORDERS_SCOPES: readonly string[] = [
  "orders:assignment:write",
  "orders:transition:write",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HttpOrderEngineOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  /**
   * موقّع النداء الصادر. **إلزامي بلا قيمة افتراضية بقصد** (M1-04): القيمة
   * الافتراضية «بلا توقيع» كانت ستجعل نداءً يُنسى توقيعه ينجح في كل اختبار
   * ويُرَدّ 401 في الإنتاج وحده، وهو أسوأ موضع لاكتشاف نسيان.
   */
  readonly signRequest: ServiceRequestSigner;
}

type Operation = "register" | "resolve" | "transition";

export class HttpOrderEnginePort implements OrderEnginePort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly signRequest: ServiceRequestSigner;

  constructor(options: HttpOrderEngineOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.signRequest = options.signRequest;
  }

  async registerOffer(input: RegisterOfferInput): Promise<OrderEngineResult> {
    return this.request(
      "register",
      ORDER_ASSIGNMENTS_PATH(input.orderId),
      { driver_public_id: input.driverPublicId },
      input.idempotencyKey,
      input.traceId,
    );
  }

  async resolveAssignment(input: ResolveAssignmentInput): Promise<OrderEngineResult> {
    return this.request(
      "resolve",
      ORDER_ASSIGNMENT_PATH(input.orderId, input.assignmentId),
      {
        assignment_state: input.state,
        ...(input.reasonCode === null ? {} : { reason_code: input.reasonCode }),
      },
      input.idempotencyKey,
      input.traceId,
      "PATCH",
    );
  }

  async transitionOrder(input: TransitionOrderInput): Promise<OrderEngineResult> {
    return this.request(
      "transition",
      ORDER_TRANSITIONS_PATH(input.orderId),
      {
        to_status: input.to,
        actor_type: "system",
        ...(input.reasonCode === null ? {} : { reason_code: input.reasonCode }),
      },
      input.idempotencyKey,
      input.traceId,
    );
  }

  private async request(
    operation: Operation,
    path: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
    traceId: string | undefined,
    method = "POST",
  ): Promise<OrderEngineResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          // الرمز مربوط بهذه الطريقة وهذا المسار ويُحرق عند أول استعمال.
          ...this.signRequest(method, path),
          ...(traceId === undefined ? {} : { "x-request-id": traceId }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return await toResult(operation, response);
    } catch (error) {
      if ((error as Error).name === "AbortError") return { outcome: "timeout" };
      return { outcome: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function toResult(operation: Operation, response: Response): Promise<OrderEngineResult> {
  if (response.status >= 200 && response.status < 300) {
    if (operation === "register") {
      const assignmentId = await assignmentIdFrom(response);
      if (assignmentId === null) return { outcome: "unavailable" };
      return response.status === 200
        ? { outcome: "already_applied", assignmentId }
        : { outcome: "applied", assignmentId };
    }
    if (await jsonObjectFrom(response) === null) return { outcome: "unavailable" };
    return response.status === 200 ? { outcome: "already_applied" } : { outcome: "applied" };
  }
  if (response.status === 409 || response.status === 422) {
    return { outcome: "rejected", rejectionCode: await errorCodeFrom(response) ?? undefined };
  }
  return { outcome: "unavailable" };
}

async function assignmentIdFrom(response: Response): Promise<string | null> {
  const body = await jsonObjectFrom(response);
  if (body === null) return null;
  return typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
}

async function jsonObjectFrom(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await response.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function errorCodeFrom(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}
