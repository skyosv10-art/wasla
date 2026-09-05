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

import type { ServiceRequestSigner } from "@wasla/service-auth";

import { GeographyError } from "../domain/errors.js";
import type { IdentityLookupPort } from "../ports.js";

/** المسار المنشور الذي ينادى هنا، بلا سلسلة استفسار — والمُعرّف جزء من المسار. */
export const IDENTITY_USER_PATH_PREFIX = "/identity/users/";

/**
 * الصلاحية الوحيدة التي يحتاجها هذا العميل على حد الهويّة: **قراءة مستخدم**.
 * ولا يحمل `identity:link:write` ولا `identity:recovery:write` — سؤال «هل هذه
 * الهويّة موجودة» لا يجوز أن يُحمَل برمزٍ يقدر به على ربط هويّة أو بدء استعادة.
 */
export const GEOGRAPHY_IDENTITY_SCOPES: readonly string[] = ["identity:user:read"];

export interface HttpIdentityLookupOptions {
  /** Base URL of the identity service, e.g. http://identity:8080 */
  baseUrl: string;
  /** Request timeout in ms (default 2000). */
  timeoutMs?: number;
  /**
   * موقّع النداء الصادر. **إلزامي بلا قيمة افتراضية بقصد** (M1-04): القيمة
   * الافتراضية «بلا توقيع» كانت ستجعل نداءً يُنسى توقيعه ينجح في كل اختبار
   * ويُرَدّ 401 في الإنتاج وحده، وهو أسوأ موضع لاكتشاف نسيان.
   *
   * والربط هنا **كامل**: مُعرّف المستخدم جزء من المسار لا من سلسلة الاستفسار،
   * فرمزٌ وُقِّع لقراءة مستخدم لا يصلح لقراءة غيره — بخلاف `/orders/lookup`
   * (`RISK-0026`).
   */
  readonly signRequest: ServiceRequestSigner;
}

export class HttpIdentityLookupPort implements IdentityLookupPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly signRequest: ServiceRequestSigner;

  constructor(options: HttpIdentityLookupOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.signRequest = options.signRequest;
  }

  async identityExists(waslaPublicId: string): Promise<boolean> {
    const path = `${IDENTITY_USER_PATH_PREFIX}${encodeURIComponent(waslaPublicId)}`;
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { ...this.signRequest("GET", path) },
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
