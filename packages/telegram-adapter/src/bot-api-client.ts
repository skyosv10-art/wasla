/**
 * Thin Bot API client (ADR-007 §3: no bot library, `fetch` from Node 20).
 *
 * It does four things and nothing else: build the method URL, POST JSON, time
 * the request out, and hand back either a parsed envelope or a transport
 * failure. No retries (the core owns retry policy), no queueing (the limiter
 * owns pacing), no domain knowledge.
 *
 * Secret handling: the token lives only in the URL built inside `call`, and the
 * client redacts it from anything it returns or throws. A token in a log line is
 * a full bot takeover, so `describe()` and every error path stay token-free
 * (SECURITY_RULES).
 */

import { readEnvelope, type BotApiEnvelope } from "./api-shapes.js";

/** Minimal `fetch` surface, injected so tests never touch the network. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export interface BotApiClientOptions {
  /** Bot token, from the environment — never a literal in source. */
  readonly botToken: string;
  /** Overridable for tests and for a local Bot API server. */
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export const BOT_API_DEFAULTS = {
  baseUrl: "https://api.telegram.org",
  timeoutMs: 10_000,
} as const;

/** Successful HTTP exchange with a Bot API method. */
export interface BotApiResponse {
  readonly status: number;
  readonly envelope: BotApiEnvelope;
  readonly transportFailed?: false;
}

/** The request never produced a usable response (timeout, socket, bad body). */
export interface BotApiTransportFailure {
  readonly transportFailed: true;
  readonly status?: undefined;
  readonly envelope?: undefined;
}

export type BotApiOutcome = BotApiResponse | BotApiTransportFailure;

export class BotApiClient {
  private readonly botToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: BotApiClientOptions) {
    if (!options.botToken || options.botToken.trim().length === 0) {
      throw new Error("botToken is required (load it from the environment)");
    }
    this.botToken = options.botToken.trim();
    this.baseUrl = (options.baseUrl ?? BOT_API_DEFAULTS.baseUrl).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? BOT_API_DEFAULTS.timeoutMs;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("no fetch implementation available");
    }
  }

  /** Token-free description, safe to log. */
  describe(): { baseUrl: string; timeoutMs: number } {
    return { baseUrl: this.baseUrl, timeoutMs: this.timeoutMs };
  }

  /**
   * Calls one Bot API method with a JSON body.
   *
   * Never throws for a channel-side problem: a rejected call, a timeout and an
   * unparsable body all come back as data, because the caller must translate
   * them into a `CHANNEL_*` code rather than let a transport exception escape
   * into the core.
   */
  async call(method: string, payload: object): Promise<BotApiOutcome> {
    const url = `${this.baseUrl}/bot${this.botToken}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        // 200 with an unparsable body is still a failed exchange for us.
        return { transportFailed: true };
      }
      return { status: response.status, envelope: readEnvelope(body) };
    } catch {
      // Deliberately swallowed: the cause can embed the request URL, and the URL
      // contains the bot token.
      return { transportFailed: true };
    } finally {
      clearTimeout(timer);
    }
  }
}
