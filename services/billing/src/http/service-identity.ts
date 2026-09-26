/**
 * فرضُ هويّةِ الخدمةِ على حدِّ الفوترة (Phase 17 · ADR-050).
 *
 * كلُّ مسارٍ يفرضُ هويّةَ خدمةٍ ما عدا `/health` (مفتوح).
 * لا مُنتَفِعَ إنسانٍ في أيّ مسار — لا مقارنةَ `obo` ولا `beneficiary`.
 */

import type {
  ServiceIdentityDenial,
  ServiceIdentityRouteConfig,
} from "@wasla/service-auth/fastify";
import type {
  ServiceAuthKeyRegistry,
  ServiceTokenReplayGuard,
} from "@wasla/service-auth";

export const BILLING_SERVICE_AUDIENCE = "billing";

export const BILLING_SCOPES = {
  invoiceWrite: "billing:invoice:write",
  invoiceRead: "billing:invoice:read",
  feeSettle: "billing:fee:settle",
  payoutRequest: "billing:payout:request",
} as const;

export interface BillingServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
}

export const OPEN: ServiceIdentityRouteConfig = { serviceIdentity: "open" };

export function internalScoped(...scopes: readonly string[]): ServiceIdentityRouteConfig {
  return { serviceIdentity: { scopes } };
}

export function denialBody(
  denial: ServiceIdentityDenial,
  _traceId: string,
): { error: { code: string; message: string } } {
  return {
    error: {
      code: denial.code,
      message: denial.message,
    },
  };
}
