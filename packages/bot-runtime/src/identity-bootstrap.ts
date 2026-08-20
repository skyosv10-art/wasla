/**
 * HTTP adapter for `IdentityBootstrapPort` — the channel layer's only touchpoint
 * with the Identity service (ADR-001, ADR-007 rule 4).
 *
 * Mirrors the pattern already proven in geography
 * (`services/geography/src/infrastructure/http-identity-lookup.ts`): global
 * `fetch` (Node 20+, no extra HTTP dependency), an `AbortController` timeout, and
 * an explicit status mapping instead of a permissive `response.ok`.
 *
 * Contract: `POST /identity/resolve` (services/identity/contracts/api.openapi.yml)
 *   200 → an existing identity was resolved   → `created: false`
 *   201 → a new identity was created          → `created: true`
 *   anything else / network failure / timeout  → `CHANNEL_IDENTITY_BOOTSTRAP_FAILED`
 *     (retryable, 503) — a bootstrap failure must be re-attempted, never turned
 *     into "the user has no identity".
 *
 * **Known contract gap (documented, not worked around):** `/identity/resolve`
 * still speaks Telegram (`telegram_user_id`), because it was written in Phase 01
 * before the neutral channel vocabulary existed. This adapter is therefore the
 * translation point neutral-actor → identity request, and it is the *only* place
 * in the bots layer that maps a `channelUserRef` onto a Telegram-shaped field.
 * When a second channel arrives, the identity contract must gain a neutral
 * `channel` + `channel_user_ref` pair; this class shrinks to a pass-through.
 * Tracked in docs/16-progress/HANDOFF_NEXT_STEPS.md.
 *
 * A `channelUserRef` that is not a positive integer is *not* retried: it can
 * never become resolvable, so it surfaces as `CHANNEL_INVALID_UPDATE` (400)
 * rather than as a retryable bootstrap failure that would burn the whole backoff
 * schedule on a permanent condition.
 */

import {
  channelError,
  isChannelError,
  type IdentityBootstrapInput,
  type IdentityBootstrapPort,
  type IdentityBootstrapResult,
} from "@wasla/channel-core";
import type { BotKind } from "@wasla/contracts-channel";

/** `fetch`, narrowed to what this adapter uses (injectable in tests). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface HttpIdentityBootstrapOptions {
  /** Base URL of the identity service, e.g. http://identity:8080 */
  readonly baseUrl: string;
  /** Request timeout in ms (default 2000 — same budget geography uses). */
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

/** `source` values the identity contract accepts, derived from the bot kind. */
function sourceFor(bot: BotKind): string {
  return `${bot}_bot`;
}

/** Identity keys its idempotency on a numeric Telegram user id. */
function numericRef(ref: string): number {
  const value = Number(ref);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw channelError("CHANNEL_INVALID_UPDATE", "مرجع مستخدم القناة غير صالح لحلّ الهوية", {
      details: { reason: "actor_ref_not_numeric" },
    });
  }
  return value;
}

interface ResolveIdentityResponse {
  readonly wasla_public_id?: unknown;
  readonly created?: unknown;
}

export class HttpIdentityBootstrap implements IdentityBootstrapPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpIdentityBootstrapOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async ensureIdentity(input: IdentityBootstrapInput): Promise<IdentityBootstrapResult> {
    const body = {
      telegram_user_id: numericRef(input.actor.channelUserRef),
      ...(input.actor.languageCode ? { telegram_language_code: input.actor.languageCode } : {}),
      source: sourceFor(input.bot),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/identity/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.traceId ? { "x-trace-id": input.traceId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status !== 200 && response.status !== 201) {
        throw this.failure(`identity resolve returned ${response.status}`, {
          status: response.status,
        });
      }

      const payload = (await response.json()) as ResolveIdentityResponse;
      const waslaPublicId = payload.wasla_public_id;
      if (typeof waslaPublicId !== "string" || waslaPublicId.length === 0) {
        throw this.failure("identity resolve returned no wasla_public_id");
      }

      return {
        waslaPublicId,
        created: payload.created === true || response.status === 201,
      };
    } catch (cause) {
      // A ChannelError is already the stable vocabulary — never re-wrap it, or the
      // permanent/retryable classification of the inner code would be lost.
      if (isChannelError(cause)) throw cause;
      if (cause instanceof Error && cause.name === "AbortError") {
        throw this.failure("identity resolve timed out", { timeoutMs: this.timeoutMs });
      }
      throw this.failure(
        `identity resolve unavailable: ${cause instanceof Error ? cause.message : "unknown error"}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private failure(
    message: string,
    details?: Readonly<Record<string, string | number | boolean>>,
  ): Error {
    return channelError("CHANNEL_IDENTITY_BOOTSTRAP_FAILED", "تعذّر الوصول إلى خدمة الهوية", {
      cause: new Error(message),
      ...(details ? { details } : {}),
    });
  }
}
