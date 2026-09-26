/**
 * فرضُ هويّةِ الخدمةِ على حدِّ الدعم (Phase 16 · ADR-049).
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

/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ الدعم. */
export const SUPPORT_SERVICE_AUDIENCE = "support";

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ الدعم.
 */
export const SUPPORT_SCOPES = {
  ticketWrite: "support:ticket:write",
  ticketRead: "support:ticket:read",
  evidenceWrite: "support:evidence:write",
} as const;

export interface SupportServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
}

/** `/health` وحدَهُ: لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً. */
export const OPEN: ServiceIdentityRouteConfig = { serviceIdentity: "open" };

/** مسارُ عمليّاتٍ داخليٌّ لا مُنتَفِعَ إنسانٍ له: يفرضُ الصلاحيّةَ بلا مُنتَفِعٍ. */
export function internalScoped(...scopes: readonly string[]): ServiceIdentityRouteConfig {
  return { serviceIdentity: { scopes } };
}

/** جسمُ الرفضِ كما يُسلِّمُهُ حدُّ الدعم. */
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
