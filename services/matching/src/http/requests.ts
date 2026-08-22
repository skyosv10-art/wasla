/**
 * تحويل مدخلات HTTP إلى مدخلات حالات الاستخدام.
 *
 * تتحقق هذه الحافة من شكل JSON والترويسات فقط؛ فالقيم نفسها تصل خاماً إلى دوال
 * assert في المجال حتى لا تختلف نتيجة الاستدعاء داخل العملية عن نتيجة HTTP.
 * فحص المصفوفات هنا يمنع TypeError تقنياً من حجب رمز التحقق المجالي المقصود.
 */

import { MatchingError, validationFailed } from "../domain/errors.js";
import type { EvaluateCandidatesInput } from "../use-cases/evaluate-candidates.js";
import type {
  ChangeAvailabilityRequest,
  UpsertCandidacyRequest,
} from "../use-cases/manage-candidacy.js";

const IDEMPOTENCY_KEY_MIN = 8;
const IDEMPOTENCY_KEY_MAX = 128;
const REQUEST_ID_MAX = 128;

/** ترويسات Fastify قد تكون مفردة أو مكررة. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

type JsonObject = Record<string, unknown>;

function invalid(field: string, expected: string, traceId?: string): MatchingError {
  return validationFailed(field, expected, traceId);
}

/**
 * ترفض الترويسة المكررة بدلاً من اختيار قيمة اعتباطية، لأن ذلك قد يغيّر هوية
 * الكتابة أو سلسلة التتبع من دون علم المُنادي.
 *
 * الفحصان ليسا تكراراً: Node لا يسلّم الترويسة المكررة مصفوفةً إلا لحالات خاصة
 * (`set-cookie` ونحوها)، وإنما **يدمج** التكرار في نص واحد مفصول بفاصلة. فلو اكتفينا
 * بفحص المصفوفة لعبر `Idempotency-Key: a` مرتين إلى الخدمة باسم `a, b` — أي بمفتاح
 * لم يرسله أحد، وهو أسوأ من الرفض. الفاصلة ليست جزءاً مشروعاً من مفتاح تكرار ولا من
 * مُعرّف تتبع في هذا النظام (كلاهما رمز مُولَّد)، فوجودها دليلٌ كافٍ على التكرار.
 * ولا تُذكر القيمة المرفوضة في الخطأ: الرسائل تصف المتوقع لا ما وصل.
 */
function singleHeader(headers: RequestHeaders, name: string, traceId?: string): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) throw invalid(name, "ترويسة واحدة", traceId);
  if (raw.includes(",")) throw invalid(name, "ترويسة واحدة", traceId);
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

/** يفحص معرف التتبع قبل أن يصل إلى سجل التدقيق ذي السعة المحدودة. */
export function assertRequestIdLength(headers: RequestHeaders, traceId?: string): void {
  const requestId = singleHeader(headers, "x-request-id", traceId);
  if (requestId !== undefined && requestId.length > REQUEST_ID_MAX) {
    throw invalid("x-request-id", `حتى ${REQUEST_ID_MAX} محرفاً`, traceId);
  }
}

/** يطلب مفتاح منع التكرار للكتابات وحدها؛ التقييم قراءة قرار ولا يأخذه العقد. */
export function requireIdempotencyKey(headers: RequestHeaders, traceId?: string): string {
  const key = singleHeader(headers, "Idempotency-Key", traceId);
  if (key === undefined) {
    throw new MatchingError(
      "MATCHING_IDEMPOTENCY_KEY_REQUIRED",
      "كل كتابة تحتاج مفتاح منع تكرار",
      { traceId, details: { field: "Idempotency-Key" } },
    );
  }
  if (key.length < IDEMPOTENCY_KEY_MIN || key.length > IDEMPOTENCY_KEY_MAX) {
    throw invalid("Idempotency-Key", `${IDEMPOTENCY_KEY_MIN}..${IDEMPOTENCY_KEY_MAX} محرفاً`, traceId);
  }
  return key;
}

function asObject(raw: unknown, traceId?: string): JsonObject {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalid("جسم الطلب", "كائن JSON", traceId);
  }
  return raw as JsonObject;
}

/**
 * ترفض المفتاح غير المُعلَن في العقد، لأن كل حمولة في `api.openapi.yml` تُصرّح
 * `additionalProperties: false`. الانتقاء الصامت للحقول المعروفة يجعل الخدمة تقبل
 * حمولةً وتتجاهل نصفها: مُنادٍ كتب `pickup_zone` بدل `pickup_zone_id` كان يحصل على
 * خطأ تحقّق غامض عن حقل مفقود بدل أن يُقال له إن المفتاح الذي أرسله لا وجود له،
 * ومُنادٍ أرسل حقلاً أُزيل من العقد كان يظنّ أنه ما زال يعمل. القبول الصامت يحوّل
 * خطأ المُنادي إلى سلوك صحيح ظاهرياً، وهو أسوأ من الرفض الصريح.
 */
function onlyKeys(body: JsonObject, allowed: readonly string[], traceId?: string): JsonObject {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(key, "مفتاح مُعلَن في العقد", traceId);
  }
  return body;
}

function optionalArray(body: JsonObject, field: string, traceId?: string): unknown[] | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalid(field, "مصفوفة", traceId);
  return value;
}

function requiredArray(body: JsonObject, field: string, traceId?: string): unknown[] {
  const value = optionalArray(body, field, traceId);
  if (value === undefined) throw invalid(field, "مصفوفة", traceId);
  return value;
}

/** يحافظ على القيم الخام لتبقى قواعد المجال هي الحكم النهائي. */
export function toCandidateQuery(raw: unknown, traceId?: string): EvaluateCandidatesInput {
  const body = onlyKeys(asObject(raw, traceId), [
    "order_id",
    "order_public_id",
    "order_type",
    "vehicle_class",
    "pickup_zone_id",
    "excluded_driver_ids",
    "limit",
    "ruleset_version",
    "dispatch_job_id",
    "evaluated_at",
  ], traceId);
  const excludedDriverIds = optionalArray(body, "excluded_driver_ids", traceId);
  return {
    orderId: body.order_id as string,
    orderPublicId: body.order_public_id as string,
    orderType: body.order_type as string,
    vehicleClass: body.vehicle_class as string,
    pickupZoneId: body.pickup_zone_id as string,
    ...(excludedDriverIds === undefined ? {} : { excludedDriverIds: excludedDriverIds as string[] }),
    ...(body.limit === undefined ? {} : { limit: body.limit as number }),
    ...(body.ruleset_version === undefined ? {} : { rulesetVersion: body.ruleset_version as number }),
    ...(body.dispatch_job_id === undefined ? {} : { dispatchJobId: body.dispatch_job_id as string | null }),
    ...(body.evaluated_at === undefined ? {} : { evaluatedAt: body.evaluated_at as string }),
    traceId,
  };
}

/** يبقي الاستبدال كاملاً عند الحافة ويترك دلالة كل حقل للمجال. */
export function toUpsertCandidacyRequest(
  driverPublicId: unknown,
  raw: unknown,
  idempotencyKey: string,
  traceId?: string,
): UpsertCandidacyRequest {
  const body = onlyKeys(asObject(raw, traceId), [
    "availability_state",
    "eligibility_state",
    "eligibility_source",
    "service_kinds",
    "vehicle_class",
    "zone_ids",
    "actor_type",
  ], traceId);
  return {
    driverPublicId: driverPublicId as string,
    availabilityState: body.availability_state as string,
    eligibilityState: body.eligibility_state as string,
    ...(body.eligibility_source === undefined
      ? {}
      : { eligibilitySource: body.eligibility_source as string }),
    serviceKinds: requiredArray(body, "service_kinds", traceId) as string[],
    ...(body.vehicle_class === undefined ? {} : { vehicleClass: body.vehicle_class as string | null }),
    zoneIds: requiredArray(body, "zone_ids", traceId) as string[],
    ...(body.actor_type === undefined ? {} : { actorType: body.actor_type as string }),
    idempotencyKey,
    traceId,
  };
}

/** مسار التوافر الضيق لا يقبل إلا ما يحتاجه تغيير التوافر. */
export function toChangeAvailabilityRequest(
  driverPublicId: unknown,
  raw: unknown,
  idempotencyKey: string,
  traceId?: string,
): ChangeAvailabilityRequest {
  const body = onlyKeys(asObject(raw, traceId), ["availability_state", "actor_type"], traceId);
  return {
    driverPublicId: driverPublicId as string,
    availabilityState: body.availability_state as string,
    ...(body.actor_type === undefined ? {} : { actorType: body.actor_type as string }),
    idempotencyKey,
    traceId,
  };
}
