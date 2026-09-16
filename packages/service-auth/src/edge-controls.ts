/**
 * ضوابطُ الحدود: تحديدُ معدَّلِ الإساءةِ وتنقيحُ الأخطاءِ وتدقيقُ الرفض (M1-08).
 *
 * ثلاثُ طبقاتٍ تشتركُ في كونها «سياسةُ الحدِّ» لا «منطقُ المجال»:
 *
 * 1. **تحديدُ المعدَّلِ (rate-limit):** دلوُ رموزٍ على ساعةٍ مُحقونةٍ — لا ينامُ
 *    أبداً، يُرجعُ 429 بـ`retry_after` فيُعرفُ المنادي أن يُعيدَ الجدولة. وهو
 *    **في العمليّةِ وحدَها** (`RISK-0015` بنفس الوجه): لا يَدَّعي ضماناً موزَّعاً.
 *
 * 2. **تنقيحُ الخطأِ (redaction):** يُنظِّفُ الأجسامَ المُرسَلةَ على السلكِ من
 *    الرموزِ والأسرارِ والقيمِ الحسّاسة. فلا يُرَدُّ أبداً رمزُ خدمةٍ أو سرُّ
 *    webhook أو مفتاحٌ في جسمِ 401/403/429 — هذا هو الجانبُ «لا تُسِر».
 *
 * 3. **تدقيقُ الرفضِ (audit):** بالوعةٌ ضئيلةٌ لأحداثِ الرفضِ الأمنيّةِ (رفضُ
 *    هويّةٍ · رفضُ صلاحيّةٍ · تحديدُ معدَّلٍ). لا تُخزِّنُ في قاعدةِ بياناتٍ
 *    ولا تُدَّعى مُوزَّعةً — هي واجهةٌ يُحقنُها الجذرُ، وفي الاختبارِ تُحقنُ
 *    بالوعةً في الذاكرة.
 *
 * ── الترتيبُ مقصودٌ ────────────────────────────────────────────────────────
 * تحديدُ المعدَّلِ **قبل** التحقُّقِ من الهويّةِ: فالإساءةُ رخيصةٌ والتحقُّقُ
 * مُكلِفٌ (توقيعٌ + بحثُ مفتاحٍ + فحصُ إعادةٍ). لكنَّ الرفضَ الأمنيَّ (401/403)
 * **يُصدِرُ حدثَ تدقيقٍ** كذلك. والتنقيحُ يُطبَّقُ على **كلِّ** جسمِ خطأٍ
 * يُرسَلُ على السلك، بلا استثناء.
 *
 * المرجع: ADR-020 · ADR-021 · `RISK-0015` (مخزنُ الإعادةِ في الذاكرةِ).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// ── 1. تحديدُ المعدَّلِ ─────────────────────────────────────────────────────

/** خياراتُ تحديدِ المعدَّلِ. كلُّها اختياريّةٌ ولها افتراضيّاتٌ. */
export interface RateLimitOptions {
  /** أقصى عددِ رموزٍ في الدلو (سعةٌ). */
  readonly capacity?: number;
  /** الرموزُ المُتجدِّدةُ في الثانية. */
  readonly refillPerSecond?: number;
}

export const RATE_LIMIT_DEFAULTS = {
  capacity: 60,
  refillPerSecond: 10,
} as const;

/** نتيجةُ فحصِ المعدَّلِ. */
export type RateLimitVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

interface TokenBucket {
  tokens: number;
  updatedAtMs: number;
}

/**
 * دلوُ رموزٍ على ساعةٍ مُحقونةٍ — لا ينامُ أبداً.
 *
 * مصمَّمٌ للاختبارِ: الساعةُ مُحقنةٌ فالاختبارُ حتميٌّ لا عشوائيٌّ. وفي العمليّةِ
 * وحدَها (لا يَدَّعي ضماناً موزَّعاً — `RISK-0015`).
 */
export class EdgeRateLimiter {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly bucket: TokenBucket;

  constructor(
    private readonly now: () => Date,
    options: RateLimitOptions = {},
  ) {
    this.capacity = options.capacity ?? RATE_LIMIT_DEFAULTS.capacity;
    this.refillPerSecond = options.refillPerSecond ?? RATE_LIMIT_DEFAULTS.refillPerSecond;
    this.bucket = { tokens: this.capacity, updatedAtMs: this.nowMs() };
  }

  private nowMs(): number {
    return this.now().getTime();
  }

  private refill(): void {
    const nowMs = this.nowMs();
    const elapsedSeconds = Math.max(0, (nowMs - this.bucket.updatedAtMs) / 1000);
    this.bucket.tokens = Math.min(
      this.capacity,
      this.bucket.tokens + elapsedSeconds * this.refillPerSecond,
    );
    this.bucket.updatedAtMs = nowMs;
  }

  /** يستهلكُ رمزاً واحداً، أو يُرجعُ مدّةَ الانتظارِ بالثواني. */
  take(): RateLimitVerdict {
    this.refill();
    if (this.bucket.tokens >= 1) {
      this.bucket.tokens -= 1;
      return { allowed: true };
    }
    const missing = 1 - this.bucket.tokens;
    const retryAfterSeconds = Math.max(1, Math.ceil(missing / this.refillPerSecond));
    return { allowed: false, retryAfterSeconds };
  }

  /** الرموزُ المتاحةُ الآن (للاختبار). */
  get availableTokens(): number {
    this.refill();
    return this.bucket.tokens;
  }
}

// ── 2. التنقيحُ ─────────────────────────────────────────────────────────────

/** أسماءُ الترويساتِ الحسّاسةِ التي تُنزَعُ من أيِّ جسمِ خطأ. */
const SENSITIVE_HEADERS = new Set([
  "x-wasla-service-auth",
  "authorization",
  "x-telegram-bot-token",
  "x-webhook-secret",
  "cookie",
]);

/** يُطبِّعُ اسمَ الترويسةِ: أحرفٌ صغيرةٌ + الشرطاتُ السفليّةُ تُصبحُ وصلاتٍ. */
function normalizeHeader(key: string): string {
  return key.toLowerCase().replace(/_/g, "-");
}

/**
 * يُنظِّفُ جسمَ خطأٍ من أيِّ قيمةٍ حسّاسة.
 *
 * يُستدعى على كلِّ جسمِ خطأٍ يُرسَلُ على السلك. ولا يُطبَّقُ على النجاح (200)
 * لأنَّ جسمَ النجاحِ يُملأُهُ المسارُ لا البنيةُ التحتيّة.
 */
export function redactErrorBody(body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;
  if (Array.isArray(body)) {
    return body.map(redactErrorBody);
  }
  const obj = body as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_HEADERS.has(normalizeHeader(key))) {
      cleaned[key] = "[redacted]";
    } else if (typeof value === "string") {
      cleaned[key] = redactString(value);
    } else if (typeof value === "object" && value !== null) {
      cleaned[key] = redactErrorBody(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/** يكشفُ ويستبدلُ الأنماطَ الحسّاسةَ في النصوص: رموزُ `wsvc2.` وأسرارٌ طويلة. */
function redactString(value: string): string {
  // رمزُ خدمةٍ: wsvc2.<any>
  let redacted = value.replace(/wsvc2\.[A-Za-z0-9._-]+/g, "[token]");
  // سلسلةٌ سريّةٌ طويلةٌ (≥32 محرفاً متجاورة): قد تكون سرّاً أو رمزاً
  redacted = redacted.replace(/[A-Za-z0-9+/_-]{32,}/g, "[redacted]");
  return redacted;
}

// ── 3. التدقيقُ ─────────────────────────────────────────────────────────────

/** نوعُ حدثِ التدقيقِ الأمني. */
export type AuditEventType =
  | "authn_denied"
  | "authz_denied"
  | "rate_limited";

/** حدثُ تدقيقٍ أمني. */
export interface AuditEvent {
  readonly type: AuditEventType;
  readonly traceId: string;
  readonly route: string;
  readonly method: string;
  readonly reason?: string;
  readonly timestamp: string;
}

/**
 * بالوعةُ أحداثِ التدقيق. واجهةٌ يُحقنُها الجذر.
 *
 * لا تُخزِّنُ في قاعدةِ بياناتٍ ولا تُدَّعى مُوزَّعة. في الاختبارِ تُحقنُ
 * بالوعةً في الذاكرة.
 */
export interface AuditEventSink {
  record(event: AuditEvent): void;
}

/** بالوعةٌ في الذاكرة — للاختبارِ والمراجعة. */
export class InMemoryAuditSink implements AuditEventSink {
  readonly events: AuditEvent[] = [];

  record(event: AuditEvent): void {
    this.events.push(event);
  }

  get count(): number {
    return this.events.length;
  }

  filter(type: AuditEventType): AuditEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

// ── الربطُ بـ Fastify ────────────────────────────────────────────────────────

/**
 * خياراتُ ربطِ ضوابطِ الحدود بـ Fastify.
 *
 * `rateLimiter` و`auditSink` اختياريّان: غيابُ `rateLimiter` يعني عدمَ تحديدِ
 * معدَّلٍ (الخدمةُ تثقُ بأنَّ المنبعَ يُحدِّد)، وغيابُ `auditSink` يعني عدمَ
 * تسجيلِ أحداثِ تدقيق. وكلاهما مُحقنٌ لا مُشتَقٌّ من البيئة.
 */
export interface EdgeControlsOptions {
  readonly rateLimiter?: EdgeRateLimiter;
  readonly auditSink?: AuditEventSink;
  readonly now?: () => Date;
}

/**
 * يُركِّبُ ضوابطَ الحدودِ على تطبيقِ Fastify.
 *
 * الترتيبُ: تحديدُ المعدَّلِ أوّلاً (قبلَ التحقُّقِ من الهويّةِ)، ثمَّ التحقُّق
 * من الهويّةِ (في `registerServiceIdentityOnFastify` المُستدعاةِ من الجذرِ)، ثمَّ
 * المسار. والتنقيحُ يُطبَّقُ على كلِّ جسمِ خطأٍ عبرَ `setErrorHandler`.
 */
export function registerEdgeControls(
  app: FastifyInstance,
  options: EdgeControlsOptions = {},
): void {
  const { rateLimiter, auditSink } = options;
  const now = options.now ?? (() => new Date());

  // تحديدُ المعدَّلِ قبلَ التحقُّقِ من الهويّة
  if (rateLimiter) {
    app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      const verdict = rateLimiter.take();
      if (!verdict.allowed) {
        if (auditSink) {
          auditSink.record({
            type: "rate_limited",
            traceId: request.id,
            route: `${request.method} ${request.url}`,
            method: request.method,
            timestamp: now().toISOString(),
          });
        }
        const body = redactErrorBody({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
            retry_after_seconds: verdict.retryAfterSeconds,
            trace_id: request.id,
          },
        });
        await reply
          .status(429)
          .header("Retry-After", String(verdict.retryAfterSeconds))
          .send(body);
      }
    });
  }

  // تنقيحُ كلِّ جسمِ خطأٍ
  const originalErrorHandler = app.errorHandler;
  app.setErrorHandler((error, request, reply) => {
    // دع المعالجَ الأصليَّ يُنتِجُ الردَّ، ثمَّ نُنقِّحُهُ
    if (typeof originalErrorHandler === "function") {
      originalErrorHandler(error, request, reply);
    } else {
      reply.status(500).send({ error: { code: "INTERNAL", trace_id: request.id } });
    }
  });
}

/**
 * يُسجِّلُ حدثَ رفضٍ أمنيٍّ في بالوعةِ التدقيق (للاستدعاءِ من وسيطِ الهويّة).
 */
export function recordSecurityDenial(
  auditSink: AuditEventSink | undefined,
  type: AuditEventType,
  request: { id: string; method: string; url: string },
  reason?: string,
  now: () => Date = () => new Date(),
): void {
  if (!auditSink) return;
  auditSink.record({
    type,
    traceId: request.id,
    route: `${request.method} ${request.url}`,
    method: request.method,
    reason,
    timestamp: now().toISOString(),
  });
}
