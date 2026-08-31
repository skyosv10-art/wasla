import type { ServiceRequestSigner } from "@wasla/service-auth";

import { engineUnavailable, matchingResultInvalid } from "../domain/errors.js";
import type { CandidateRequest, CandidateResult, MatchingPort } from "../ports.js";

export const MATCHING_CANDIDATES_PATH = "/matching/candidates";
export const MATCHING_AVAILABILITY_PATH = (driverPublicId: string): string =>
  `/candidacy/${driverPublicId}/availability`;

/** الصلاحيات التي يحتاجها هذا العميل على حد المطابقة، لا أكثر. */
export const DISPATCH_MATCHING_SCOPES: readonly string[] = [
  "matching:candidates:evaluate",
  "matching:candidacy:write",
];

export interface HttpMatchingOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  /**
   * موقّع النداء الصادر. **إلزامي بلا قيمة افتراضية بقصد** (M1-03): القيمة
   * الافتراضية «بلا توقيع» كانت ستجعل نداءً يُنسى توقيعه ينجح في كل اختبار
   * ويُرَدّ 401 في الإنتاج وحده، وهو أسوأ موضع لاكتشاف نسيان.
   */
  readonly signRequest: ServiceRequestSigner;
}

interface MatchingCandidateBody {
  decision_id?: unknown;
  ruleset_version?: unknown;
  evaluated_at?: unknown;
  candidates?: unknown;
  empty_reason_code?: unknown;
}

export class HttpMatchingPort implements MatchingPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly signRequest: ServiceRequestSigner;

  constructor(options: HttpMatchingOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.signRequest = options.signRequest;
  }

  async candidates(request: CandidateRequest): Promise<CandidateResult> {
    const response = await this.fetch(MATCHING_CANDIDATES_PATH, {
      order_id: request.orderId,
      order_public_id: request.orderPublicId,
      order_type: request.serviceKind,
      vehicle_class: request.vehicleClass,
      pickup_zone_id: request.zoneId,
      excluded_driver_ids: request.excludedDriverPublicIds,
      limit: request.limit,
      ...(request.dispatchJobId === undefined ? {} : { dispatch_job_id: request.dispatchJobId }),
    });
    if (response.status === 503) throw engineUnavailable();
    if (response.status !== 200) throw matchingResultInvalid("successful matching response");
    return toCandidateResult(await readJson(response));
  }

  async markUnavailable(driverPublicId: string, reasonCode: "OFFER_ACCEPTED", changedAt: string): Promise<void> {
    const idempotencyKey = `dispatch:availability:${driverPublicId}:${reasonCode}:${changedAt}`;
    const response = await this.fetch(
      MATCHING_AVAILABILITY_PATH(driverPublicId),
      { availability_state: "busy", actor_type: "dispatch" },
      undefined,
      "POST",
      idempotencyKey,
    );
    if (response.status === 200 || response.status === 404) return;
    throw engineUnavailable();
  }

  private async fetch(
    path: string,
    body: Record<string, unknown>,
    traceId?: string,
    method = "POST",
    idempotencyKey?: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          // الرمز مربوط بهذه الطريقة وهذا المسار ويُحرق عند أول استعمال، فلا
          // يُبنى مرة ويُعاد استعماله.
          ...this.signRequest(method, path),
          ...(traceId === undefined ? {} : { "x-request-id": traceId }),
          ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw engineUnavailable(traceId);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readJson(response: Response): Promise<MatchingCandidateBody> {
  try {
    return await response.json() as MatchingCandidateBody;
  } catch {
    return {};
  }
}

function toCandidateResult(body: MatchingCandidateBody, traceId?: string): CandidateResult {
  if (
    typeof body.decision_id !== "string" ||
    typeof body.ruleset_version !== "number" ||
    !Number.isInteger(body.ruleset_version) ||
    typeof body.evaluated_at !== "string" ||
    !Array.isArray(body.candidates)
  ) {
    throw matchingResultInvalid("candidate result shape", traceId);
  }
  const candidates = body.candidates.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw matchingResultInvalid("ranked candidate shape", traceId);
    }
    const item = candidate as { driver_public_id?: unknown; rank?: unknown };
    if (typeof item.driver_public_id !== "string" || typeof item.rank !== "number" || !Number.isInteger(item.rank)) {
      throw matchingResultInvalid("ranked candidate fields", traceId);
    }
    return { driverPublicId: item.driver_public_id, rank: item.rank };
  });
  if (body.empty_reason_code !== undefined && body.empty_reason_code !== null && typeof body.empty_reason_code !== "string") {
    throw matchingResultInvalid("empty_reason_code", traceId);
  }
  return {
    decisionId: body.decision_id,
    rulesetVersion: body.ruleset_version,
    evaluatedAt: body.evaluated_at,
    candidates,
    emptyReasonCode: typeof body.empty_reason_code === "string" ? body.empty_reason_code : null,
  };
}
