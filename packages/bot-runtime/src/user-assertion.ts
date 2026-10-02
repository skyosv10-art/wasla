/**
 * طلبُ تأكيدِ المستخدمِ النهائيِّ `wua1` من `identity` (ADR-060 · CLM-0440 · RISK-0042).
 *
 * **البوتُ حدٌّ يُمرِّرُ لا مصدرٌ للهويّةِ** (ADR-060 §2.4): لا يملكُ مفتاحاً خاصّاً، ولا يصنعُ
 * التأكيدَ ولا يُعدِّلُهُ. يطلبُهُ لمستخدمِ تحديثِ Telegram الذي تحقَّقَ من سرِّ الـwebhook،
 * ثمَّ يضعُهُ في ترويسةِ `x-wasla-user-assertion` مع `obo` مساوٍ لـ`sub`.
 *
 * **P1 — أفضلُ جهدٍ:** المُستقبِلونَ في وضعِ `off`، فغيابُ التأكيدِ لا يُغيِّرُ جواباً. لذلكَ
 * `ConversationEvent.userAssertion` يُعيدُ `null` عندَ أيِّ إخفاقٍ ويُسجِّلُ السببَ، ولا يُفشِلُ
 * المحادثةَ. والإغلاقُ عندَ الإخفاقِ (fail-closed) لا يبدأُ إلّا حينَ يصيرُ الهدفُ `enforce` (P3).
 */
import type { InboundActor } from "@wasla/channel-core";
import type { BotKind, ChannelName } from "@wasla/contracts-channel";
import type { ServiceRequestSigner, UserDelegation } from "@wasla/service-auth";

import type { FetchLike } from "./identity-bootstrap.js";

export const USER_ASSERTION_ISSUE_PATH = "/identity/assertions";

/** صلاحيّةُ الإصدارِ وحدَها — مُوقِّعٌ مستقلٌّ عن مُوقِّعِ `resolve` (أقلُّ امتيازٍ لكلِّ نداءٍ). */
export const CHANNEL_USER_ASSERTION_SCOPES: readonly string[] = ["identity:assertion:issue"];

/** نوعُ الفاعلِ يتبعُ البوتَ — و`identity` تتحقّقُ منهُ ثانيةً من اسمِ المنادي. */
export const USER_ASSERTION_ACTOR_BY_BOT: Readonly<Record<BotKind, "customer" | "driver" | "store_staff">> = {
  customer: "customer",
  driver: "driver",
  partner: "store_staff",
};

export interface UserAssertionRequest {
  readonly channel: ChannelName;
  readonly bot: BotKind;
  readonly actor: InboundActor;
  readonly audience: readonly string[];
  readonly traceId?: string;
}

export interface UserAssertionIssuerPort {
  issue(input: UserAssertionRequest): Promise<UserDelegation>;
}

export class UserAssertionUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`user assertion unavailable: ${reason}`);
    this.name = "UserAssertionUnavailableError";
    this.reason = reason;
  }
}

export interface HttpUserAssertionIssuerOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
  readonly signRequest: ServiceRequestSigner;
}

interface IssueResponse {
  readonly assertion?: unknown;
  readonly wasla_public_id?: unknown;
}

export class HttpUserAssertionIssuer implements UserAssertionIssuerPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly signRequest: ServiceRequestSigner;

  constructor(options: HttpUserAssertionIssuerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.signRequest = options.signRequest;
  }

  async issue(input: UserAssertionRequest): Promise<UserDelegation> {
    const telegramUserId = Number(input.actor.channelUserRef);
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      throw new UserAssertionUnavailableError("actor_ref_not_numeric");
    }
    const headers = {
      "content-type": "application/json",
      ...this.signRequest("POST", USER_ASSERTION_ISSUE_PATH),
      ...(input.traceId ? { "x-trace-id": input.traceId } : {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${USER_ASSERTION_ISSUE_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          telegram_user_id: telegramUserId,
          actor_type: USER_ASSERTION_ACTOR_BY_BOT[input.bot],
          audience: input.audience,
        }),
        signal: controller.signal,
      });
      if (response.status !== 200) throw new UserAssertionUnavailableError(`identity_status_${response.status}`);
      const body = (await response.json()) as IssueResponse;
      if (typeof body.assertion !== "string" || typeof body.wasla_public_id !== "string") {
        throw new UserAssertionUnavailableError("identity_response_malformed");
      }
      return { publicId: body.wasla_public_id, assertion: body.assertion };
    } catch (cause) {
      if (cause instanceof UserAssertionUnavailableError) throw cause;
      if (cause instanceof Error && cause.name === "AbortError") throw new UserAssertionUnavailableError("identity_timeout");
      throw new UserAssertionUnavailableError("identity_unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
}
