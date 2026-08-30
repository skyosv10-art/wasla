/**
 * تحويلُ قيمةٍ مجهولةِ النوعِ (خرجت من فكِّ رمزٍ أو من ترويسةٍ داخليّة) إلى
 * `Principal` موثوقٍ بنيويّاً — أو رفضُها. لا يتحقَّق من التوقيعِ: ذلك عملُ
 * المُتحقِّقِ (M1-02/M1-03). هذا البابُ يمنع أن يدخلَ شكلٌ ناقصٌ إلى منطقِ الأعمال.
 */

import { AuthErrorCode, AuthenticationError } from "./errors.js";
import type {
  AnonymousPrincipal,
  Principal,
  PrincipalChannel,
  ServicePrincipal,
  UserActorType,
  UserPrincipal,
} from "./principal.js";

const USER_ACTORS: readonly UserActorType[] = [
  "customer",
  "driver",
  "partner",
  "admin",
  "support",
];

const CHANNELS: readonly PrincipalChannel[] = [
  "telegram",
  "web",
  "mobile",
  "admin_web",
];

/** صيغةُ الصلاحيّة: `<service>:<resource>:<action>` بأحرفٍ صغيرةٍ وشُرطاتٍ سفليّة. */
const SCOPE_PATTERN = /^[a-z][a-z0-9_]*(:[a-z][a-z0-9_*]*){2}$/;

/** اسمُ الخدمة: كما هو في `services/<name>` — أحرفٌ صغيرةٌ وشُرطاتٌ فقط. */
const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

function fail(message: string): never {
  throw new AuthenticationError(AuthErrorCode.INVALID_PRINCIPAL, message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`حقلٌ نصّيٌّ مطلوبٌ وغيرُ صالح: ${field}`);
  }
  return value;
}

function requireIsoInstant(value: unknown, field: string): string {
  const text = requireString(value, field);
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) fail(`ليس تاريخاً ISO-8601 صالحاً: ${field}`);
  return text;
}

function requireScopes(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) fail(`قائمةُ صلاحيّاتٍ مطلوبةٌ: ${field}`);
  const scopes = value.map((entry, index) =>
    requireString(entry, `${field}[${index}]`),
  );
  for (const scope of scopes) {
    if (!SCOPE_PATTERN.test(scope)) {
      fail(`صيغةُ صلاحيّةٍ غيرُ صالحة: ${scope}`);
    }
  }
  if (new Set(scopes).size !== scopes.length) {
    fail(`تكرارٌ في قائمةِ الصلاحيّات: ${field}`);
  }
  return Object.freeze(scopes);
}

function requireRoles(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) fail(`قائمةُ أدوارٍ مطلوبةٌ: ${field}`);
  return Object.freeze(
    value.map((entry, index) => requireString(entry, `${field}[${index}]`)),
  );
}

/**
 * يقرأ `Principal` من قيمةٍ مجهولةٍ ويرفض كلَّ ما لا يطابق العقد.
 * لا يُعيد `anonymous` عندَ الفشل — الفشلُ يُرفَع كي لا يُخفى نقصُ الإثباتِ
 * بصورةِ «مستخدمٍ مجهولٍ» فيمرَّ إلى منطقٍ يقبل المجهول.
 */
export function parsePrincipal(input: unknown): Principal {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("الـPrincipal يجب أن يكون كائناً");
  }
  const raw = input as Record<string, unknown>;

  switch (raw.kind) {
    case "anonymous": {
      const reason = raw.reason;
      if (reason !== "no_credentials" && reason !== "unverified_credentials") {
        fail("سببُ المجهوليّةِ غيرُ معروف");
      }
      const principal: AnonymousPrincipal = { kind: "anonymous", reason };
      return Object.freeze(principal);
    }

    case "user": {
      const actor = raw.actor;
      if (!USER_ACTORS.includes(actor as UserActorType)) {
        fail(`نوعُ فاعلٍ غيرُ معروف: ${String(actor)}`);
      }
      const channel = raw.channel;
      if (!CHANNELS.includes(channel as PrincipalChannel)) {
        fail(`قناةٌ غيرُ معروفة: ${String(channel)}`);
      }
      const principal: UserPrincipal = {
        kind: "user",
        waslaPublicId: requireString(raw.waslaPublicId, "waslaPublicId"),
        internalUuid: requireString(raw.internalUuid, "internalUuid"),
        actor: actor as UserActorType,
        channel: channel as PrincipalChannel,
        sessionId: requireString(raw.sessionId, "sessionId"),
        roles: requireRoles(raw.roles, "roles"),
        scopes: requireScopes(raw.scopes, "scopes"),
        issuedAt: requireIsoInstant(raw.issuedAt, "issuedAt"),
        expiresAt: requireIsoInstant(raw.expiresAt, "expiresAt"),
        ...(raw.tenantId === undefined
          ? {}
          : { tenantId: requireString(raw.tenantId, "tenantId") }),
      };
      return Object.freeze(principal);
    }

    case "service": {
      const serviceName = requireString(raw.serviceName, "serviceName");
      if (!SERVICE_NAME_PATTERN.test(serviceName)) {
        fail(`اسمُ خدمةٍ غيرُ صالح: ${serviceName}`);
      }
      const audience = requireString(raw.audience, "audience");
      if (!SERVICE_NAME_PATTERN.test(audience)) {
        fail(`جهةٌ مقصودةٌ غيرُ صالحة: ${audience}`);
      }
      const principal: ServicePrincipal = {
        kind: "service",
        serviceName,
        audience,
        scopes: requireScopes(raw.scopes, "scopes"),
        issuedAt: requireIsoInstant(raw.issuedAt, "issuedAt"),
        expiresAt: requireIsoInstant(raw.expiresAt, "expiresAt"),
        ...(raw.onBehalfOfPublicId === undefined
          ? {}
          : {
              onBehalfOfPublicId: requireString(
                raw.onBehalfOfPublicId,
                "onBehalfOfPublicId",
              ),
            }),
      };
      return Object.freeze(principal);
    }

    default:
      fail(`جنسُ Principal غيرُ معروف: ${String(raw.kind)}`);
  }
}
