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

import type { ServiceRequestSigner } from "@wasla/service-auth";

import { CustomerError } from "../domain/errors.js";
import type { IdentityLookupPort } from "../ports.js";

/** المسار المنشور الذي ينادى هنا، بلا سلسلة استفسار — والمُعرّف جزء من المسار. */
export const IDENTITY_USER_PATH_PREFIX = "/identity/users/";

/**
 * الصلاحية الوحيدة التي يحتاجها هذا العميل على حد الهويّة: **قراءة مستخدم**.
 * ولا يحمل `identity:link:write` ولا `identity:recovery:write` — سؤال «هل هذه
 * الهويّة موجودة» لا يجوز أن يُحمَل برمزٍ يقدر به على ربط هويّة أو بدء استعادة.
 */
export const CUSTOMERS_IDENTITY_SCOPES: readonly string[] = ["identity:user:read"];

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
