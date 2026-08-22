import type { CancelDispatchJobRequest, CreateDispatchJobRequest, RejectOfferRequest } from "@wasla/contracts-dispatch";

import { validationFailed } from "../domain/errors.js";

const IDEMPOTENCY_MIN = 8;
const IDEMPOTENCY_MAX = 128;
const REQUEST_ID_MAX = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestHeaders = Record<string, string | string[] | undefined>;

function invalid(field: string, traceId?: string): never {
  throw validationFailed(field, "صيغة العقد", traceId);
}

function singleHeader(headers: RequestHeaders, name: string, traceId?: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) invalid(name, traceId);
  if (value === undefined) return undefined;
  // الفاصلة ليست جزءاً مشروعاً من مفتاح التكرار أو معرّف التتبع المولَّدين هنا؛
  // لذا تكفي دليلاً على ترويسة مكررة دمجها Node بدلاً من إخفاء التكرار.
  if (value.includes(",")) invalid(name, traceId);
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function requireIdempotencyKey(headers: RequestHeaders, traceId?: string): string {
  const key = singleHeader(headers, "Idempotency-Key", traceId);
  if (key === undefined || key.length < IDEMPOTENCY_MIN || key.length > IDEMPOTENCY_MAX) {
    invalid("Idempotency-Key", traceId);
  }
  return key;
}

export function assertRequestIdLength(headers: RequestHeaders, traceId?: string): void {
  const requestId = singleHeader(headers, "x-request-id", traceId);
  if (requestId !== undefined && requestId.length > REQUEST_ID_MAX) invalid("x-request-id", traceId);
}

function object(raw: unknown, traceId?: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) invalid("body", traceId);
  return raw as Record<string, unknown>;
}

function onlyKeys(body: Record<string, unknown>, keys: readonly string[], traceId?: string): void {
  if (Object.keys(body).some((key) => !keys.includes(key))) invalid("body", traceId);
}

export function toCreateJobRequest(raw: unknown, traceId?: string): CreateDispatchJobRequest {
  const body = object(raw, traceId);
  onlyKeys(body, ["order_id", "order_public_id", "zone_id", "order_type", "vehicle_class"], traceId);
  return body as unknown as CreateDispatchJobRequest;
}

export function toPathId(raw: unknown, field: string, traceId?: string): string {
  if (typeof raw !== "string" || !UUID.test(raw)) invalid(field, traceId);
  return raw;
}

export function toRejectOfferRequest(raw: unknown, traceId?: string): RejectOfferRequest {
  const body = object(raw, traceId);
  onlyKeys(body, ["reason_code"], traceId);
  return body as unknown as RejectOfferRequest;
}

export function toCancelJobRequest(raw: unknown, traceId?: string): CancelDispatchJobRequest {
  const body = object(raw, traceId);
  onlyKeys(body, ["reason_code"], traceId);
  return body as unknown as CancelDispatchJobRequest;
}
