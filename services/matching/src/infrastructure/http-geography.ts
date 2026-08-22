/**
 * محول HTTP لهرم المناطق.
 *
 * 404 تعني أن المنطقة غائبة فلا تدخل الخريطة؛ أما فشل النقل أو رد لا يمكن
 * الوثوق ببنيته فليس «منطقة مجهولة»، لأن تحويل تعطل الجغرافيا إلى رفض دائم
 * يحجب منطقة صحيحة. لا توجد إعادة محاولة حتى لا تضاعف زمن قرار المطابقة.
 */

import { matchingUnavailable } from "../domain/errors.js";
import type { ZoneLineage } from "../domain/model.js";
import type { ZoneHierarchyPort } from "../ports.js";

export interface HttpZoneHierarchyOptions {
  /** عنوان خدمة الجغرافيا؛ المنفذ الافتراضي في بنية WASLA هو 8081. */
  baseUrl?: string;
  /** حد زمني صارم يمنع اعتماداً متعثراً من تعطيل تقييم المطابقة. */
  timeoutMs?: number;
}

type PathLevel = { id?: unknown };
interface ZoneDetailResponse {
  id?: unknown;
  path?: {
    country?: PathLevel;
    region?: PathLevel;
    city?: PathLevel;
    district?: PathLevel;
  };
}

function stringId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toLineage(zoneId: string, response: ZoneDetailResponse): ZoneLineage {
  const resolvedZoneId = stringId(response.id);
  const countryId = stringId(response.path?.country?.id);
  const regionId = stringId(response.path?.region?.id);
  const cityId = stringId(response.path?.city?.id);
  const districtId = stringId(response.path?.district?.id);
  if (
    resolvedZoneId === null ||
    countryId === null ||
    regionId === null ||
    cityId === null ||
    districtId === null
  ) {
    throw matchingUnavailable("رد خدمة الجغرافيا لا يحمل هرم منطقة كاملاً");
  }
  return { zoneId: resolvedZoneId === zoneId ? resolvedZoneId : zoneId, countryId, regionId, cityId, districtId };
}

/** تطبيق منفذ المناطق باستدعاء مستقل لكل معرف مطلوب. */
export class HttpZoneHierarchy implements ZoneHierarchyPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: HttpZoneHierarchyOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:8081").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  async resolve(zoneIds: readonly string[]): Promise<Map<string, ZoneLineage>> {
    // المناطق مستقلة؛ تنفيذها معاً يحافظ على مهلة كل طلب بدلاً من مضاعفتها بعدد
    // مناطق السائق، مع بقاء الفشل الواحد صريحاً ولا توجد أي إعادة محاولة.
    const resolved = await Promise.all(
      [...new Set(zoneIds)].map(async (zoneId) => ({ zoneId, lineage: await this.resolveOne(zoneId) })),
    );
    const result = new Map<string, ZoneLineage>();
    for (const { zoneId, lineage } of resolved) {
      if (lineage !== null) result.set(zoneId, lineage);
    }
    return result;
  }

  private async resolveOne(zoneId: string): Promise<ZoneLineage | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/geo/zones/${encodeURIComponent(zoneId)}`, {
        method: "GET",
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (response.status !== 200) {
        throw matchingUnavailable("خدمة الجغرافيا أعادت حالة غير متاحة للمطابقة");
      }
      return toLineage(zoneId, (await response.json()) as ZoneDetailResponse);
    } catch (error) {
      if (error instanceof Error && error.name === "MatchingError") throw error;
      throw matchingUnavailable("خدمة الجغرافيا غير متاحة");
    } finally {
      clearTimeout(timer);
    }
  }
}
