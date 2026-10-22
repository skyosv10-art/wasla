/**
 * `create-channel-edge.ts` — بناءُ إضافاتِ الحدِّ المُركَّبةِ في `createBotApp`.
 *
 * **لا يبدأُ ترتيبُ الاستيرادِ هذا مُصغيًّا ولا عمليةً.** الحدُّ إضافاتُ
 * مساراتٍ تُركَّبُ في تطبيقِ الروبوتِ القائمِ (ADR-069 §3)، ولا يُفعِّلُ
 * التركيبُ شيئًا في الإنتاجِ ما لم يُصرَّحْ له بـ`WASLA_EDGE_ENABLED=true`
 * في `env-registry` (M2-04). والقوائمُ الحاليةُ كلُّها `production_open=false`
 * عمدًا — فحتى التركيبُ لا يفتحُ مسارًا حيًّا.
 *
 * **الأصلُ السياديُّ:** كلُّ مسارٍ يُفتحُ يمرُّ بقائمةِ السماحِ المصرَّحِ بها
 * (`packages/channel-edge/allowlist/<surface>.json`) وحارسِ الفحصِ 28
 * (`scripts/checks/validate-edge-allowlist.sh`). ولا مسارَ يُفتحُ لغيرِ
 * فئةِ `O` (ملكيةٌ بـ`obo`) بلا بوابةِ مالكٍ مستقلةٍ (ADR-069 §2.8).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "node:fs";
import type { ServiceRequestSigner } from "@wasla/service-auth";
import {
  fingerprintInitData,
  InitDataError,
  verifyTelegramInitData,
  type TelegramInitDataUser,
  type VerifiedInitData,
} from "@wasla/telegram-adapter";
import type { EdgeActorType, EdgeSurface } from "./types.js";

/** بناءُ إضافاتِ الحدِّ على تطبيقِ Fastifyِ مُركَّبٍ في `createBotApp`. */
export interface ChannelEdgeOptions {
  readonly surface: EdgeSurface;
  /** إصدارُ الجلسةِ (POST /identity/sessions). */
  readonly issueSession: IssueSessionPort;
  /** استبدالُ الجلسةِ (POST /identity/sessions/exchange). */
  readonly exchangeSession: ExchangeSessionPort;
  /** سحبُ الجلسةِ (POST /identity/sessions/revoke). */
  readonly revokeSession: RevokeSessionPort;
  /**
   * عنوانُ وجهةِ كلِّ خدمةٍ تُوجَّهُ إليها قائمةُ السماحِ — من ترتيبِ التركيبِ
   * لا من الطلبِ. فشلٌ مغلقٌ: مسارٌ مفتوحٌ (`production_open`) بلا وجهةٍ
   * يمنعُ اكتمالَ التركيبِ قبلَ بدءِ الاستماعِ (D2).
   */
  readonly serviceUrlFor: (service: string) => string;
  /**
   * مصنعُ موقِّعِ نداءاتٍ لكلِّ خدمةٍ — التوقيعُ بجمهورِ الخدمةِ الوجهةِ لا
   * بجمهورِ `identity` أبدًا (D5 · ADR-069 §2.1). صلاحياتُ كلِّ موقِّعٍ يملكُها
   * التركيبُ ثوابتَ مسمّاةً موثقةً في دليلِ منحِ M1-05 — لا تُمرَّر من القائمةِ.
   */
  readonly requestSignerFor: (service: string) => ServiceRequestSigner;
  /** أصلُ المسارِ المسموحُ لقائمةِ السماحِ — يُقرأُ من ملفِ الحدِّ. */
  readonly allowlistUrl: string;
  /** مفتاحُ التفعيلِ — لا يُقرأُ من جسمِ الطلبِ ولا الترويساتِ. */
  readonly enabled: boolean;
  /** مفاتيحُ السماحِ المُطابِقةُ لما تُصرِّحُ بهِ قائمةُ الحدِّ لا أكثرَ. */
  readonly allowedOrigins: readonly string[];
  /** ساعةٌ الآنَ — تُستعملُ في الفحصِ لا في التوقيعِ (نفسُ مفاتيحِ الروبوتِ). */
  readonly now?: () => Date;
  /** عدَّادُ المعدلِ على `POST /edge/session` لكلِ `telegram_user_id`. */
  readonly rateLimiter?: EdgeRateLimiter;
}

/** منفذُ إصدارِ الجلسةِ — يُمرَّرُ من التركيبِ لا من هنا. */
export interface IssueSessionPort {
  (body: IssueSessionRequest): Promise<IssueSessionResponse>;
}

/** منفذُ استبدالِ الجلسةِ — يُمرَّرُ من التركيبِ لا من هنا. */
export interface ExchangeSessionPort {
  (body: ExchangeSessionRequest): Promise<ExchangeSessionResponse>;
}

/** منفذُ سحبِ الجلسةِ — يُمرَّرُ من التركيبِ لا من هنا. */
export interface RevokeSessionPort {
  (body: RevokeSessionRequest): Promise<RevokeSessionResponse>;
}

/** عقدُ `POST /identity/sessions` (نفسُ عقدِ identity · CLM-0519). */
export interface IssueSessionRequest {
  readonly telegram_user_id: number;
  readonly init_data_fingerprint: string;
  readonly telegram_username?: string;
  readonly telegram_first_name?: string;
  readonly telegram_language_code?: string;
}

/** ردُّ `POST /identity/sessions` (نفسُ عقدِ identity · CLM-0519). */
export interface IssueSessionResponse {
  readonly token: string;
  readonly wasla_public_id: string;
  readonly actor_type: EdgeActorType;
  readonly expires_at: string;
  readonly session_id: string;
}

/** عقدُ `POST /identity/sessions/exchange` (نفسُ عقدِ identity · CLM-0519). */
export interface ExchangeSessionRequest {
  readonly session_token: string;
  readonly audience: readonly string[];
}

/** ردُّ `POST /identity/sessions/exchange` (نفسُ عقدِ identity · CLM-0519). */
export interface ExchangeSessionResponse {
  readonly assertion: string;
  readonly wasla_public_id: string;
  readonly actor_type: EdgeActorType;
  readonly audience: readonly string[];
  readonly expires_at: string;
}

/** عقدُ `POST /identity/sessions/revoke` (نفسُ عقدِ identity · CLM-0519). */
export interface RevokeSessionRequest {
  readonly session_token: string;
  readonly reason?: string;
}

/** ردُّ `POST /identity/sessions/revoke` (نفسُ عقدِ identity · CLM-0519). */
export interface RevokeSessionResponse {
  readonly revoked: boolean;
}

/** عدَّادُ المعدلِ — يُمرَّرُ من التركيبِ لا من هنا. */
export interface EdgeRateLimiter {
  check(telegramUserId: number, ip: string): boolean;
}

const DEFAULT_INIT_DATA_MAX_AGE_SECONDS = 900;
const DEFAULT_INIT_DATA_CLOCK_SKEW_SECONDS = 60;

/** أسماءُ الترويساتِ التي يُحذفُها الحدُّ قبلَ التوجيهِ (ADR-069 §2.6-2). */
const STRIPPED_INBOUND_HEADERS = [
  "x-wasla-service-auth",
  "x-wasla-user-assertion",
  "x-customer-public-id",
  "authorization",
] as const;

/** بناءُ إضافاتِ الحدِّ (تُركَّبُ في `createBotApp` بعدَ حارسِ الفحصِ 24 و28). */
export function createChannelEdge(options: ChannelEdgeOptions): ChannelEdgeAdditionsImpl {
  if (!options.enabled) {
    // معطَّلٌ افتراضيًّا في الإنتاجِ: لا مسارَ يُسجَّلُ أصلاً — وهو أصحُّ تعطيلٍ
    // (fail-closed) لأنّ مسارًا غيرَ موجودٍ لا يمكنُ أن يُفتحَ لا بجسمٍ ولا
    // بترويسةٍ ولا بإعادةِ كتابةٍ.
    return { apply: () => undefined, enabled: false };
  }
  const now = options.now ?? (() => new Date());
  const surface = options.surface;
  return {
    enabled: true,
    apply: (app: FastifyInstance) => {
      applySessionRoutes(app, options, surface, now);
      applyProxyRoutes(app, options, surface);
    },
  };
}

/** ما يعيدُهُ `createChannelEdge` إلى التركيبِ (عقدٌ قابلٌ للقراءةِ لا منطقٌ). */
export interface ChannelEdgeAdditionsImpl {
  /** يُركَّبُ على تطبيقِ Fastifyِ القائمِ. */
  readonly apply: (app: FastifyInstance) => void;
  /** هل الحدُّ مُفعَّلٌ في هذا التركيبِ؟ (`false` في الإنتاجِ افتراضيًّا). */
  readonly enabled: boolean;
}

/** بناءُ مساراتِ إصدارِ الجلسةِ (`POST /edge/session` و`/logout`). */
function applySessionRoutes(
  app: FastifyInstance,
  options: ChannelEdgeOptions,
  surface: EdgeSurface,
  now: () => Date,
): void {
  // POST /edge/session — إصدارُ جلسةٍ من `initData` موقَّعٍ (ADR-069 §2.1).
  app.post("/edge/session", async (request, reply) => {
    assertAllowedOrigin(request, options.allowedOrigins);
    const body = request.body as { init_data?: unknown };
    const raw = typeof body?.init_data === "string" ? body.init_data : "";
    if (!raw) {
      return deny(reply, 400, "EDGE_INVALID_REQUEST", "init_data مطلوب");
    }
    // ADR-069 §2.6-3: التحققُّ من `initData` بسرِّ الروبوتِ الصاحبِ للسطحِ.
    let verified: VerifiedInitData;
    try {
      verified = verifyTelegramInitData(raw, surface.botToken, {
        now: now(),
        maxAgeSeconds: DEFAULT_INIT_DATA_MAX_AGE_SECONDS,
        clockSkewSeconds: DEFAULT_INIT_DATA_CLOCK_SKEW_SECONDS,
      });
    } catch (error) {
      if (error instanceof InitDataError) {
        return deny(reply, 401, "EDGE_INIT_DATA_INVALID", error.message);
      }
      throw error;
    }
    const user = verified.user as TelegramInitDataUser;
    if (!user || typeof user.id !== "number" || user.id <= 0) {
      return deny(reply, 401, "EDGE_INIT_DATA_INVALID", "init_data مفقود user.id");
    }
    if (options.rateLimiter && !options.rateLimiter.check(user.id, request.ip)) {
      return deny(reply, 429, "EDGE_RATE_LIMITED", "تجاوز حد المعدل");
    }
    const issued = await options.issueSession({
      telegram_user_id: user.id,
      init_data_fingerprint: fingerprintInitData(raw),
      ...(user.username !== undefined ? { telegram_username: user.username } : {}),
      ...(user.firstName !== undefined ? { telegram_first_name: user.firstName } : {}),
      ...(user.languageCode !== undefined
        ? { telegram_language_code: user.languageCode }
        : {}),
    });
    if (issued.actor_type !== surface.actorType) {
      // E-16: جلسةُ سائقٍ على حدِّ العميلِ (أو العكسِ) تُرفضُ فورًا.
      return deny(reply, 401, "EDGE_ACTOR_MISMATCH", "الفاعل لا يطابق السطح");
    }
    return reply.status(201).send({
      token: issued.token,
      wasla_public_id: issued.wasla_public_id,
      expires_at: issued.expires_at,
      session_id: issued.session_id,
    });
  });

  // POST /edge/session/logout — سحبُ الجلسةِ (ADR-069 §2.5).
  app.post("/edge/session/logout", async (request, reply) => {
    assertAllowedOrigin(request, options.allowedOrigins);
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      return deny(reply, 401, "EDGE_UNAUTHENTICATED", "رمز الجلسة مطلوب");
    }
    const token = authorization.slice("Bearer ".length);
    const revoked = await options.revokeSession({
      session_token: token,
      reason: "user_requested",
    });
    if (!revoked.revoked) {
      return deny(reply, 401, "EDGE_UNAUTHENTICATED", "الرمز مجهول أو منتهٍ");
    }
    return reply.status(200).send({ revoked: true });
  });
}

/** بناءُ مساراتِ التوجيهِ (الوكيلِ) — يُفتحُ ما تصرِّحُ بهِ قائمةُ السماحِ فقط. */
function applyProxyRoutes(
  app: FastifyInstance,
  options: ChannelEdgeOptions,
  surface: EdgeSurface,
): void {
  // التوجيهُ من قائمةِ السماحِ المُصرَّحِ بها — لا استنتاجَ آليًّا من الفحصِ 24
  // (ADR-069 §2.6-6 r2). وغيرُ المدرجِ يُردُّ بـ404 قبلَ أيِّ نداءٍ خلفيٍّ (E-09).
  const allowlist = loadAllowlist(options.allowlistUrl, surface);
  if (allowlist.length === 0) {
    // لا مسارَ مفتوحًا في هذا التركيبِ — وهو الحالةُ القائمةُ في الإنتاجِ.
    return;
  }
  for (const entry of allowlist) {
    if (!entry.production_open) continue; // مسارٌ مسجَّلٌ للقياسِ لا للفتحِ.
    // فشلٌ مغلقٌ عندَ الفتحِ: وجهةُ الخدمةِ وموقِّعُها يُحلَّانِ في زمنِ التركيبِ —
    // لا مسارَ نصفَ مُركَّبٍ ينتظرُ طلبًا ليكتشفَ غيابَهما (D2 · D5).
    const baseUrl = options.serviceUrlFor(entry.service);
    if (!baseUrl) {
      throw new Error(
        `EDGE_SERVICE_UNCONFIGURED: مسارٌ مفتوحٌ (${entry.method} ${entry.path}) بلا عنوانِ وجهةٍ للخدمةِ ${entry.service}`,
      );
    }
    const signer = options.requestSignerFor(entry.service);
    app.route({
      method: entry.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      url: entry.path,
      handler: async (request, reply) => {
        return proxyRequest(options, surface, entry, request, reply, baseUrl, signer);
      },
    });
  }
}

/** مدخلُ قائمةِ السماحِ كما يُقرأُ من ملفِّ الحدِّ (ADR-069 §2.8). */
interface AllowlistEntry {
  readonly method: string;
  readonly path: string;
  readonly service: string;
  readonly class: "O" | "P" | "W" | "N" | "ADM";
  readonly required_scopes: readonly string[];
  readonly production_open: boolean;
  /** عقدُ استعلامِ المسارِ — غيابُهُ يعني لا معاملَ يُمرَّرُ إطلاقًا (D3 · E-20). */
  readonly query?: {
    readonly allowed?: readonly string[];
    readonly pinned?: Readonly<Record<string, string>>;
  };
}

/** ملفُّ قائمةِ السماحِ المتوقَّعُ لكلِّ فاعلِ سطحٍ (ADR-069 §2.8). */
const ALLOWLIST_FILE_BY_ACTOR: Readonly<Record<EdgeActorType, string>> = {
  customer: "customer-mini-app",
  driver: "driver-mini-app",
};

/** قراءةُ قائمةِ السماحِ من ملفِّ الحدِّ — مصدرُ الحقيقةِ لا الشفرةُ. */
function loadAllowlist(allowlistUrl: string, surface: EdgeSurface): readonly AllowlistEntry[] {
  // قائمةُ السماحِ ملفٌّ يُقرأُ في زمنِ التركيبِ لا في زمنِ النداءِ، فلا
  // يمكنُ لطلبٍ أن يغيِّرَ ما يُفتحُ. والحارسُ 28 يُسقِطُ أيَّ انحرافٍ في CI.
  const raw = readFileSync(allowlistUrl, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // D1: حقلُ `surface` في جذرِ الملفِّ هو ما يربطُ الملفَ بالسطحِ — لا تصفيةُ
  // المداخلِ بمفتاحٍ لا يحملُهُ أيُّ مدخلٍ. عدمُ التطابقِ يمنعُ اكتمالَ التركيبِ.
  const expectedFile = ALLOWLIST_FILE_BY_ACTOR[surface.actorType];
  if (parsed.surface !== expectedFile) {
    throw new Error(
      `EDGE_ALLOWLIST_SURFACE_MISMATCH: ملفُّ القائمةِ surface=${JSON.stringify(parsed.surface)} لا يطابقُ السطحَ المتوقَّعَ ${expectedFile}`,
    );
  }
  return Array.isArray(parsed.entries) ? (parsed.entries as AllowlistEntry[]) : [];
}

/** خطأُ عقدِ الاستعلامِ — يُترجَمُ إلى 400 لا إلى 500 (D3 · E-20). */
class EdgeQueryError extends Error {}

/** المسارُ الفعليُّ بمعاملاتِهِ: تُستبدَلُ مقاطعُ `:param` بقيمِها (D4). */
function actualPathOf(template: string, params: unknown): string {
  const values = (params ?? {}) as Record<string, unknown>;
  return template
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const raw = values[segment.slice(1)];
      if (typeof raw !== "string" && typeof raw !== "number") {
        throw new EdgeQueryError(
          `معاملُ المسارِ ${segment.slice(1)} مفقودٌ أو غيرَ نصٍّ`,
        );
      }
      return encodeURIComponent(String(raw));
    })
    .join("/");
}

/**
 * استعلامُ التوجيهِ وفقَ عقدِ المدخلِ (D3 · E-20): لا يُمرَّرُ إلا ما أذِنَتْ بهِ
 * القائمةُ، وتُثبَّتُ قيمٌ يملكُها الحدُّ وحدَهُ، وكلُّ معاملٍ آخرَ — بما فيهِ
 * معاملاتُ E-20 المحظورةُ — يُرَدُّ بـ400 لا يُسقَطُ صامتًا ولا يُوسَّعُ العقدُ.
 */
function forwardedQueryOf(entry: AllowlistEntry, rawQuery: unknown): string {
  const allowed = new Set(entry.query?.allowed ?? []);
  const pinned = entry.query?.pinned ?? {};
  const raw = (rawQuery ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key in pinned) {
      // معاملٌ يملكُهُ الحدُّ: لا يملكُهُ العميلُ ولا بقيمةٍ منهُ أصلًا.
      throw new EdgeQueryError(`معاملُ الاستعلامِ ${key} يملكُهُ الحدُّ وحدَهُ`);
    }
    if (!allowed.has(key)) {
      throw new EdgeQueryError(`معاملُ استعلامٍ غيرُ مصرَّحٍ بهِ: ${key}`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new EdgeQueryError(`قيمةُ معاملِ الاستعلامِ ${key} غيرُ صالحةٍ`);
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  for (const [key, value] of Object.entries(pinned)) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join("&");
}

/** توجيهُ الطلبِ إلى الخدمةِ الخلفيةِ بعدَ حذفِ الترويساتِ وصنعِ رمزِ الخدمةِ. */
async function proxyRequest(
  options: ChannelEdgeOptions,
  surface: EdgeSurface,
  entry: AllowlistEntry,
  request: FastifyRequest,
  reply: FastifyReply,
  baseUrl: string,
  signer: ServiceRequestSigner,
): Promise<void> {
  assertAllowedOrigin(request, options.allowedOrigins);
  // ADR-069 §2.6-2: تُقرأُ ترويسةُ المصادقةِ قبلَ حذفِ الترويساتِ الداخليةِ —
  // الحذفُ يسبقُ التوجيهَ لا القراءةَ (D8): قراءتُها بعدَ الحذفِ كانت تُسقِطُ
  // كلَّ نداءٍ محميٍّ بـ401 قبلَ أيِّ نداءٍ خلفيٍّ.
  const authorization = request.headers.authorization;
  for (const name of STRIPPED_INBOUND_HEADERS) {
    delete request.headers[name];
  }
  if (!authorization?.startsWith("Bearer ")) {
    return deny(reply, 401, "EDGE_UNAUTHENTICATED", "رمز الجلسة مطلوب");
  }
  const sessionToken = authorization.slice("Bearer ".length);
  // ADR-069 §2.1 (2): استبدالُ الجلسةِ بتأكيدٍ قصيرِ العمرِ ≤60 ث.
  const exchanged = await options.exchangeSession({
    session_token: sessionToken,
    audience: [entry.service],
  });
  if (exchanged.actor_type !== surface.actorType) {
    return deny(reply, 401, "EDGE_ACTOR_MISMATCH", "الفاعل لا يطابق السطح");
  }
  // ADR-069 §2.6-1: مصدرُ `obo` الوحيدُ هو `wasla_public_id` العائدُ من `exchange`.
  // D3/D4: التوقيعُ والهدفُ على المسارِ الفعليِّ بمعاملاتِهِ واستعلامِهِ — لا على
  // قالبِ القائمةِ (ADR-036: ربطُ الطلبِ يشملُ الاستعلامَ المرتَّبَ).
  const path = actualPathOf(entry.path, request.params);
  let forwardedQuery: string;
  try {
    forwardedQuery = forwardedQueryOf(entry, request.query);
  } catch (error) {
    if (error instanceof EdgeQueryError) {
      return deny(reply, 400, "EDGE_INVALID_QUERY", error.message);
    }
    throw error;
  }
  const pathWithQuery = forwardedQuery ? `${path}?${forwardedQuery}` : path;
  const headers = signer(
    entry.method,
    pathWithQuery,
    exchanged.wasla_public_id,
  );
  headers["X-Wasla-User-Assertion"] = exchanged.assertion;
  headers["Content-Type"] = request.headers["content-type"] ?? "application/json";
  const target = `${baseUrl.replace(/\/$/, "")}/${pathWithQuery.replace(/^\//, "")}`;
  const response = await fetch(target, {
    method: entry.method,
    headers,
    ...(entry.method === "GET" || entry.method === "DELETE" ? {} : { body: JSON.stringify(request.body) }),
  });
  const text = await response.text();
  return reply.status(response.status).send(text ? safeJsonParse(text) : {});
}

/** ردُّ الرفضِ — لا سببَ داخليًّا ولا رمزَ ولا بصمةَ. */
function deny(reply: FastifyReply, status: number, code: string, message: string): void {
  reply.status(status).send({ code, message });
}

/** التحققُّ من أصلِ الطلبِ — لا يُقبلُ إلا منشأُ الموقعِ الثابتِ (§2.6-7). */
function assertAllowedOrigin(request: FastifyRequest, allowedOrigins: readonly string[]): void {
  if (allowedOrigins.length === 0) return;
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) {
    throw Object.assign(new Error("منشأ غير مسموح"), { statusCode: 403 });
  }
}

/** تحليلُ الجوابِ الخلفيِّ بلا رميٍّ على جوابٍ غيرِ JSON. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
