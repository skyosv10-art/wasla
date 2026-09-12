/**
 * محوّلُ سبرٍ لحدِّ السوقِ — `GET /health` (المراجعةُ 15/N · ADR-026 §4.17).
 *
 * ## لماذا `/health` ولا مسارَ كتالوجٍ حقيقيّاً
 *
 * سبرٌ بـ`GET /stores/{slug}` كانَ يلزمُهُ **بيانٌ** — slug متجرٍ موجودٍ في كلِّ
 * بيئةٍ — فيصيرُ إعدادُ مسبارٍ بياناً يجبُ أن يُزرَعَ، ويُقرأُ اختفاءُ المتجرِ
 * عطلاً في السوقِ. و`/health` عندَ السوقِ **ليسَ نبضةً فارغةً**: يقرأُ
 * `catalog.health()` وهيَ تسألُ قاعدتَهُ فعلاً (`listCategories`)، فالجوابُ
 * يُثبِتُ أنَّ الحدَّ قائمٌ **وأنَّ مخزنَهُ يُجيبُ** — وذاكَ كلُّ ما يُدّعى.
 *
 * ## العلّةُ التي كانت ستُمرِّرُ سوقاً معطوباً «سليماً»
 *
 * حدُّ السوقِ يُجيبُ `/health` بـ**200 دائماً**، والحالةُ في الجسمِ:
 * `{"status":"ok"|"degraded"|"unavailable","mode":"…"}` — لأنَّ مِجَسَّ حياةٍ
 * يُعيدُ 503 يُعيدُ تشغيلَ عمليّةٍ سليمةٍ لأنَّ قاعدةً رمشَت. فمسبارٌ يقرأُ
 * رمزَ HTTP وحدَهُ كانَ سيُبلِّغُ «السوقُ سليمٌ» عن سوقٍ فقدَ قاعدتَهُ.
 * **الحالةُ تُقرأُ من الجسمِ، والرمزُ شرطٌ لا خلاصةٌ.**
 *
 * ## توقيعٌ بلا صلاحيّةٍ
 *
 * النداءُ مُوقَّعٌ كسائرِ الصادرِ (ADR-020: التوقيعُ صفةُ المنادي لا رخصةٌ من
 * المُنادى)، وبقائمةِ صلاحيّاتٍ **فارغةٍ**: مسبارُ صحّةٍ لا يقرأُ متجراً ولا
 * منتجاً، وحملُ `marketplace:store:read` فيهِ يُوسِّعُ أثرَ سرقةِ رمزٍ بلا سببٍ.
 *
 * ## لا يرمي أبداً
 *
 * عقدُ `DependencyProbePort` أن يكونَ العطلُ **جواباً**. واستثناءٌ يَصعدُ من
 * هنا كانَ سيَبلغُ مُعالجَ أخطاءِ HTTP فيُجيبُ `ErrorResponse` على مسارٍ عقدُهُ
 * `ReadinessResponse` في 200 و503 معاً (contracts/errors.md قاعدةُ 6).
 */

import type { ServiceRequestSigner } from "@wasla/service-auth";

import type { DependencyProbePort, DependencyProbeResult } from "../domain/dependency-probe.js";

/** مِعجمٌ **مغلقٌ** لأسبابِ السبرِ: لا نصَّ استثناءٍ ولا عنوانَ ولا اسمَ مضيفٍ. */
export const MARKETPLACE_PROBE_REASONS = [
  "marketplace_unreachable",
  "marketplace_timeout",
  "marketplace_denied_identity",
  "marketplace_error_status",
  "marketplace_unreadable_body",
  "marketplace_contract_drift",
  "marketplace_degraded",
  "marketplace_unavailable",
] as const;
export type MarketplaceProbeReason = (typeof MARKETPLACE_PROBE_REASONS)[number];

/** صلاحيّاتُ المسبارِ: لا شيءَ. تُعلَنُ ثابتاً ليُقرأَ القصدُ لا الإغفالُ. */
export const DELIVERY_MARKETPLACE_PROBE_SCOPES: readonly string[] = [];

export const DEFAULT_MARKETPLACE_PROBE_TIMEOUT_MS = 1_000;

export interface HttpMarketplaceHealthProbeOptions {
  /** أصلُ خدمةِ السوقِ، مثلُ http://marketplace:8090 */
  readonly baseUrl: string;
  readonly signRequest: ServiceRequestSigner;
  /** مَهَلُ النداءِ بالمللي ثانية (الافتراضُ 1000). */
  readonly timeoutMs?: number;
  /** يُحقَنُ للاختبارِ فقط؛ الافتراضُ `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
}

const HEALTH_PATH = "/health";

export class HttpMarketplaceHealthProbe implements DependencyProbePort {
  private readonly baseUrl: string;
  private readonly signRequest: ServiceRequestSigner;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpMarketplaceHealthProbeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.signRequest = options.signRequest;
    this.timeoutMs =
      options.timeoutMs && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_MARKETPLACE_PROBE_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async probe(): Promise<DependencyProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${HEALTH_PATH}`, {
        method: "GET",
        signal: controller.signal,
        headers: this.signRequest("GET", HEALTH_PATH),
      });
    } catch (error) {
      const aborted = (error as Error | undefined)?.name === "AbortError";
      return failed(aborted ? "marketplace_timeout" : "marketplace_unreachable");
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      // نقصُ إعدادٍ عندَنا لا عطلٌ هناك — والفرقُ يهمُّ من يقرأُ الجاهزيّةَ.
      return failed("marketplace_denied_identity");
    }
    if (response.status !== 200) return failed("marketplace_error_status");

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return failed("marketplace_unreadable_body");
    }
    if (parsed === null || typeof parsed !== "object") {
      return failed("marketplace_unreadable_body");
    }

    const status = (parsed as { status?: unknown }).status;
    if (status === "ok") return { ok: true };
    if (status === "degraded") return failed("marketplace_degraded");
    if (status === "unavailable") return failed("marketplace_unavailable");
    // حالةٌ لم يعرفْها هذا المحوّلُ: انحرافُ عقدٍ يُبلَّغُ باسمِهِ، ولا يُقرأُ
    // «سليمٌ» لأنَّ الرمزَ كانَ 200.
    return failed("marketplace_contract_drift");
  }
}

function failed(reason: MarketplaceProbeReason): DependencyProbeResult {
  return { ok: false, detail: reason };
}
