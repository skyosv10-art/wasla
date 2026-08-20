/**
 * HTTP adapter for the IdentityLookupPort (MR 5).
 *
 * Geography stores `wasla_public_id` as an opaque reference (no FK to
 * identity_users, per ADR-006). Before assigning a location it must confirm the
 * identity exists — production does that over HTTP against the identity
 * service's contract endpoint `GET /identity/users/{waslaPublicId}`:
 *
 *   200 → identity exists
 *   404 → identity does not exist (→ GEO_IDENTITY_NOT_FOUND at the use case)
 *   anything else / network failure → throws, surfaced as GEO_INTERNAL_ERROR
 *     (503 degraded) rather than silently treating the identity as missing.
 *
 * Uses the global `fetch` (Node 20+), so no extra HTTP dependency is added.
 */

import { GeographyError } from "../domain/errors.js";
import type { IdentityLookupPort } from "../ports.js";

export interface HttpIdentityLookupOptions {
  /** Base URL of the identity service, e.g. http://identity:8080 */
  baseUrl: string;
  /** Request timeout in ms (default 2000). */
  timeoutMs?: number;
}

export class HttpIdentityLookupPort implements IdentityLookupPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: HttpIdentityLookupOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  async identityExists(waslaPublicId: string): Promise<boolean> {
    const url = `${this.baseUrl}/identity/users/${encodeURIComponent(waslaPublicId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      if (response.status === 200) {
        return true;
      }
      if (response.status === 404) {
        return false;
      }
      throw new GeographyError(
        "GEO_INTERNAL_ERROR",
        `identity lookup failed with status ${response.status}`,
      );
    } catch (error) {
      if (error instanceof GeographyError) {
        throw error;
      }
      throw new GeographyError(
        "GEO_INTERNAL_ERROR",
        `identity lookup unavailable: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
