/**
 * HTTP adapter for `GeographyPort` (MR 4/6).
 *
 * Every stop is anchored to a zone, and this service needs exactly two facts
 * about that zone: that it exists and that it is active. It reads them from the
 * geography service's published endpoint `GET /geo/zones/{zoneId}?locale=…`
 * (ZoneDetail):
 *
 *   200 → { zoneId, status, path }   (path = «مدينة / حي / منطقة فرعية»)
 *   404 → null (→ CUSTOMER_ZONE_NOT_FOUND, 404, at the use case)
 *   anything else / network failure / timeout → CUSTOMER_INTERNAL_ERROR (503)
 *
 * A failed lookup is never silently treated as «zone missing»: an outage would
 * otherwise turn into a permanent-looking rejection of a valid zone. The port
 * deliberately exposes no coordinates, distance or coverage — none of those
 * exist in the system (§28), and the path is display copy only, never stored.
 *
 * `locale` is a constructor option because `GeographyPort.findZone(zoneId)` has
 * no locale parameter: the path is a convenience string, not a decision input,
 * so per-customer localisation of it is a Phase 05+ concern and is recorded as
 * such in the architecture doc rather than smuggled into the port signature.
 */

import type { ServiceRequestSigner } from "@wasla/service-auth";

import { CustomerError } from "../domain/errors.js";
import type { ZoneReference } from "../domain/model.js";
import type { GeographyPort } from "../ports.js";

export interface HttpGeographyOptions {
  /** Base URL of the geography service, e.g. http://geography:8081 */
  baseUrl: string;
  /** Locale used for the display path (default `ar`, per ADR-006). */
  locale?: "ar" | "en" | "ur";
  /** Request timeout in ms (default 2000). */
  timeoutMs?: number;
  /**
   * موقّع النداء الصادر. **إلزامي بلا قيمة افتراضية بقصد** (`M1-04` الموجةُ
   * الخامسةُ): حدُّ الجغرافيا مفروضٌ الآن، والقيمةُ الافتراضيّةُ «بلا توقيعٍ»
   * كانت ستَجعلُ نداءً يُنسى توقيعُهُ ينجحُ في كلِّ اختبارٍ ويُرَدُّ 401 في
   * الإنتاجِ وحدَه.
   */
  readonly signRequest: ServiceRequestSigner;
}

/** الصلاحيّاتُ التي يحتاجُها هذا العميلُ على حدِّ الجغرافيا، لا أكثر. */
export const CUSTOMERS_GEOGRAPHY_SCOPES: readonly string[] = ["geography:zone:read"];

interface ZoneDetailResponse {
  id?: unknown;
  status?: unknown;
  name?: unknown;
  path?: {
    city?: { name?: unknown };
    district?: { name?: unknown };
  };
}

function readName(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** «مدينة / حي / منطقة فرعية» — omitting whichever level the response lacks. */
function buildPath(detail: ZoneDetailResponse): string | null {
  const parts = [
    readName(detail.path?.city?.name),
    readName(detail.path?.district?.name),
    readName(detail.name),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" / ");
}

/** المسارُ الموقَّعُ بلا سلسلةِ استفسارٍ: الربطُ يغطّي المسارَ (ADR-021 §4). */
const ZONE_DETAIL_PATH = (zoneId: string): string => `/geo/zones/${encodeURIComponent(zoneId)}`;

export class HttpGeographyPort implements GeographyPort {
  private readonly baseUrl: string;
  private readonly locale: "ar" | "en" | "ur";
  private readonly timeoutMs: number;
  private readonly signRequest: ServiceRequestSigner;

  constructor(options: HttpGeographyOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.locale = options.locale ?? "ar";
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.signRequest = options.signRequest;
  }

  async findZone(zoneId: string): Promise<ZoneReference | null> {
    // هدفُ الطلبِ يُبنى **مرّةً واحدةً** ويُستعمَل للإرسالِ وللتوقيعِ معاً
    // (`ADR-036` · `RISK-0026`): الربطُ صارَ يشملُ سلسلةَ الاستعلامِ، فبناءُ
    // العنوانِ مرّةً وتوقيعُ مسارٍ آخرَ مرّةً يُنتِج `request_binding_mismatch`.
    const target = `${ZONE_DETAIL_PATH(zoneId)}?locale=${encodeURIComponent(this.locale)}`;
    const url = `${this.baseUrl}${target}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        // الرمز مربوطٌ بهذه الطريقةِ وهذا الهدفِ **باستعلامِه** ويُحرَقُ عندَ
        // أوّلِ استعمالٍ (`ADR-036`).
        headers: this.signRequest("GET", target),
      });
      if (response.status === 404) return null;
      if (response.status !== 200) {
        throw new CustomerError(
          "CUSTOMER_INTERNAL_ERROR",
          `فشل استعلام المنطقة بحالة ${response.status}`,
        );
      }

      const detail = (await response.json()) as ZoneDetailResponse;
      // The status decides whether an order may use the zone, so an unreadable
      // status is an error rather than an assumption in either direction.
      if (detail.status !== "active" && detail.status !== "inactive") {
        throw new CustomerError(
          "CUSTOMER_INTERNAL_ERROR",
          "حالة المنطقة غير مفهومة في رد خدمة الجغرافيا",
        );
      }

      return {
        zoneId: typeof detail.id === "string" ? detail.id : zoneId,
        status: detail.status,
        path: buildPath(detail),
      };
    } catch (error) {
      if (error instanceof CustomerError) throw error;
      throw new CustomerError(
        "CUSTOMER_INTERNAL_ERROR",
        `خدمة الجغرافيا غير متاحة: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
