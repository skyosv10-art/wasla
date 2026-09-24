/**
 * http-tick.ts — العميلُ الصادرُ الوحيدُ لمُجدوِلِ النبضاتِ (G8 · M2-09A · CLM-0330).
 *
 * يُحصى عميلًا في سجلِّ التغطيةِ (`docs/07-security/SERVICE_AUTH_ENFORCEMENT.md`)
 * ويقرؤُهُ `validate-service-auth-coverage.sh`: كلُّ نداءٍ موقَّعٌ بـ`signTickRequest`
 * المبنيِّ من `createServiceRequestSigner` (والمصفوفةُ تُنفَذُ عندَ البناءِ).
 *
 * بلا جسمٍ ولا `content-type`: المساراتُ الخمسةُ ترفضُ أيَّ جسمٍ (`assertNoBody`)،
 * وFastify يرفضُ جسمًا فارغًا بترويسةِ JSON (400) — كلاهما كانَ سيُسقِطُ السلفَ.
 */
import type { ServiceRequestSigner } from "@wasla/service-auth";
import type { TickOutcome, TickRoute } from "../scheduler.js";

export async function postTick(
  fetchImpl: typeof fetch,
  tick: TickRoute,
  baseUrl: string,
  timeoutMs: number,
  signTickRequest: ServiceRequestSigner,
): Promise<TickOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${tick.path}`, {
      method: tick.method,
      headers: signTickRequest(tick.method, tick.path),
      signal: controller.signal,
    });
    if (response.ok) return { service: tick.service, outcome: "ok", status: response.status };
    if (response.status === 503) return { service: tick.service, outcome: "unavailable", status: 503 };
    const body = await response.text().catch(() => "<unreadable>");
    return { service: tick.service, outcome: "failed", status: response.status, reason: body.slice(0, 200) };
  } catch (error) {
    if ((error as Error).name === "AbortError") return { service: tick.service, outcome: "timeout", timeoutMs };
    return { service: tick.service, outcome: "failed", reason: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
