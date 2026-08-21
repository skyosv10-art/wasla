/**
 * HTTP adapter for `IdentityLookupPort` (MR 4/6).
 *
 * The customer profile stores `wasla_public_id` as an opaque reference with no
 * foreign key (ADR-001 · ADR-009 §2), so «does this identity exist» is a
 * question for the identity service, asked over its published contract endpoint
 * `GET /identity/users/{waslaPublicId}`:
 *
 *   200 → the identity exists
 *   404 → it does not (→ CUSTOMER_IDENTITY_NOT_FOUND, 404, at the use case)
 *   anything else, a network failure or a timeout → throws
 *     CUSTOMER_INTERNAL_ERROR (503 degraded)
 *
 * The last line is the important one: an unreachable identity service must not
 * be read as «the user does not exist», because that would let a transient
 * outage reject a legitimate customer with a permanent-looking 404. Fail loudly
 * and let the caller retry (same rule as the geography adapter).
 *
 * Uses the global `fetch` (Node 20+) — no HTTP dependency is added for it.
 */

import { CustomerError } from "../domain/errors.js";
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
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      if (response.status === 200) return true;
      if (response.status === 404) return false;
      throw new CustomerError(
        "CUSTOMER_INTERNAL_ERROR",
        `فشل التحقّق من الهوية بحالة ${response.status}`,
      );
    } catch (error) {
      if (error instanceof CustomerError) throw error;
      throw new CustomerError(
        "CUSTOMER_INTERNAL_ERROR",
        `خدمة الهوية غير متاحة: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
