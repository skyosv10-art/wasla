/**
 * إصدارُ تأكيدِ المستخدمِ النهائيِّ `wua1` (ADR-060 §2.1/§2.5 · CLM-0440 · RISK-0042).
 *
 * `identity` **المُصدِرُ الوحيدُ**: مفتاحُ Ed25519 الخاصُّ لا يُحمَّلُ إلّا هنا. والإصدارُ:
 *   1. **قراءةٌ فقط** — `findUserByTelegramId`؛ لا ينشئُ مستخدماً كما يفعلُ `resolve`.
 *      مستخدمٌ غيرُ مربوطٍ ⇒ 404: التأكيدُ يشهدُ على هويّةٍ قائمةٍ ولا يصنعُها.
 *   2. **الفاعلُ من المنادي لا من الطلبِ وحدَه**: `customer-bot` لا يُصدِرُ إلّا `customer`،
 *      و`driver-bot` لا يُصدِرُ إلّا `driver`، و`partner-bot` لا يُصدِرُ إلّا `store_staff`.
 *      فبوتٌ مخترَقٌ لا يرفعُ نفسَه إلى نوعِ فاعلٍ آخرَ.
 *   3. **الجمهورُ من قائمةٍ مغلقةٍ لكلِّ فاعلٍ** — لا تأكيدَ صالحٌ لخدمةٍ لم يُعلَنْ أنَّ هذا
 *      الفاعلَ يُنادَى عليها.
 *   4. **غيابُ مفتاحِ التوقيعِ ⇒ 503** `IDENTITY_ASSERTION_UNAVAILABLE` — لا تأكيدَ «غيرُ موقَّعٍ».
 *
 * الحدُّ (البوتُ) يُمرِّرُ ما صدرَ ولا يصنعُهُ؛ وهو ليسَ مصدراً للهويّةِ (ADR-060 §2.4).
 */
import {
  mintUserAssertion,
  type UserAssertionActor,
  type UserAssertionPayload,
  type UserAssertionSigningKey,
} from "@wasla/service-auth/user-assertion";

import { IdentityError } from "../domain/errors.js";
import type { IdentityRepository } from "../ports.js";

/** المُنادي المسموحُ ← نوعُ الفاعلِ الوحيدُ الذي يُصدَرُ لهُ. */
export const ASSERTION_ACTOR_BY_CALLER: Readonly<Record<string, UserAssertionActor>> = {
  "customer-bot": "customer",
  "driver-bot": "driver",
  "partner-bot": "store_staff",
};

/**
 * الجماهيرُ المسموحةُ لكلِّ فاعلٍ (ADR-060 §3 — الخدماتُ الثلاثُ في P2 ومُمرِّرُها).
 * تُوسَّعُ بالإضافةِ مع قرارٍ، لا بطلبٍ من البوتِ.
 *
 * **توسيعٌ بالإضافةِ (ADR-069 §2.2 · CLM-0519):** جلسةُ المستخدمِ وحدَها تُقايِضُ
 * بتأكيدٍ قصيرِ العمرِ (`≤60s`) لجمهورٍ أوسعَ — لأنّ التأكيدَ الآنَ يثبتُ جلسةً
 * صادقةً من قناةِ ثقةٍ (init-data موقَّعةٌ)، لا مجرّدَ هويّةٍ قائمةٍ. فاستُكملت
 * قائمةُ العميلِ بـ`customers · orders · dispatch · reputation · search`،
 * وقائمةُ السائقِ بـ`customers · orders · dispatch`. **ولا تغييرَ في عتباتِ المنحِ**:
 * التوسيعُ هنا يعرّفُ ما يجوزُ أن يُطلَبَ في استبدالٍ صالحٍ، والإنفاذُ على كلِّ
 * حدٍّ مِن خاصيّتِهِ (المرحلةُ الثانيةُ واللاحقةُ).
 */
export const ASSERTION_AUDIENCES_BY_ACTOR: Readonly<Record<UserAssertionActor, readonly string[]>> = {
  customer: [
    "identity",
    "negotiations",
    "marketplace",
    "delivery",
    "geography",
    "subscriptions",
    // ADR-069 §2.2 · CLM-0519
    "customers",
    "orders",
    "dispatch",
    "reputation",
    "search",
  ],
  driver: [
    "identity",
    "negotiations",
    "drivers",
    "matching",
    "geography",
    // ADR-069 §2.2 · CLM-0519
    "customers",
    "orders",
    "dispatch",
  ],
  store_staff: ["identity", "marketplace"],
};

export interface IssueUserAssertionRequest {
  readonly telegram_user_id?: unknown;
  readonly actor_type?: unknown;
  readonly audience?: unknown;
}

export interface IssueUserAssertionResponse {
  readonly assertion: string;
  readonly wasla_public_id: string;
  readonly actor_type: UserAssertionActor;
  readonly audience: readonly string[];
  readonly expires_at: string;
}

export interface IssueUserAssertionDeps {
  readonly repo: IdentityRepository;
  readonly signingKey: UserAssertionSigningKey | null;
  readonly now: () => Date;
  readonly ttlSeconds?: number;
}

export async function issueUserAssertion(
  deps: IssueUserAssertionDeps,
  callerService: string,
  request: IssueUserAssertionRequest,
): Promise<{ response: IssueUserAssertionResponse; payload: UserAssertionPayload }> {
  const telegramUserId = request.telegram_user_id;
  if (typeof telegramUserId !== "number" || !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    throw new IdentityError("IDENTITY_ASSERTION_INVALID_REQUEST", "telegram_user_id must be a positive integer");
  }
  const actor = request.actor_type;
  if (typeof actor !== "string" || !(actor in ASSERTION_AUDIENCES_BY_ACTOR)) {
    throw new IdentityError("IDENTITY_ASSERTION_INVALID_REQUEST", "actor_type must be customer | driver | store_staff");
  }
  const audience = request.audience;
  if (!Array.isArray(audience) || audience.length === 0 || audience.length > 4 || !audience.every((a) => typeof a === "string")) {
    throw new IdentityError("IDENTITY_ASSERTION_INVALID_REQUEST", "audience must be a non-empty list of service names");
  }
  const allowedActor = ASSERTION_ACTOR_BY_CALLER[callerService];
  if (allowedActor === undefined || allowedActor !== actor) {
    throw new IdentityError("IDENTITY_ASSERTION_FORBIDDEN", "this caller may not obtain an assertion for this actor type");
  }
  const allowedAudiences = ASSERTION_AUDIENCES_BY_ACTOR[actor as UserAssertionActor];
  if (!audience.every((a) => allowedAudiences.includes(a as string))) {
    throw new IdentityError("IDENTITY_ASSERTION_FORBIDDEN", "requested audience is not allowed for this actor type");
  }
  if (deps.signingKey === null) {
    throw new IdentityError("IDENTITY_ASSERTION_UNAVAILABLE", "user assertions are not available");
  }

  const user = await deps.repo.findUserByTelegramId(telegramUserId);
  if (user === null || user.status === "deleted") {
    throw new IdentityError("IDENTITY_NOT_FOUND", "no linked identity for this channel user");
  }
  if (user.status !== "active") {
    throw new IdentityError("IDENTITY_USER_SUSPENDED", "identity is not active");
  }

  const { assertion, payload } = mintUserAssertion({
    key: deps.signingKey,
    sub: user.waslaPublicId,
    act: actor as UserAssertionActor,
    chn: "telegram",
    via: callerService,
    aud: audience as string[],
    now: deps.now(),
    ...(deps.ttlSeconds === undefined ? {} : { ttlSeconds: deps.ttlSeconds }),
  });
  return {
    payload,
    response: {
      assertion,
      wasla_public_id: payload.sub,
      actor_type: payload.act,
      audience: payload.aud,
      expires_at: new Date(payload.exp * 1000).toISOString(),
    },
  };
}
