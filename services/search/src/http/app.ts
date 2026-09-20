/**
 * Search HTTP boundary — Fastify app (ADR-025 §5 / api.openapi.yml).
 *
 * Three routes: `GET /search/health` (liveness), `GET /search/ready`
 * (readiness) and `GET /search/products`. The app
 * depends on an injected `SearchProductsReadPort` — it never opens a DB
 * connection itself. Unit tests build the app with a fake port; production
 * wiring lives in `server.ts`.
 *
 * ## One error handler, no try/catch in handlers
 *
 * Handlers throw typed search errors (`SearchValidationError` / `SearchUnavailableError`)
 * or let the read port throw; a single `setErrorHandler` translates via
 * `sendSearchError`. No handler wraps its body in try/catch — that would mean a
 * second translation of the same error in a place nobody reads.
 *
 * ## Liveness and readiness are two different questions (review 5/N · RISK-0030)
 *
 * `GET /search/health` answers "is this process alive?" — it takes no
 * dependency and therefore CANNOT be a deployment gate. That was the whole bug:
 * with a degraded index the service answered `health: ok` while every
 * `/search/products` call returned `503`, so an orchestrator kept routing
 * traffic to a service that could not serve a single search.
 *
 * `GET /search/ready` answers "can this process serve a search?" by actually
 * touching the read model through `SearchIndexHealthPort`. It returns `200
 * { status: "ready" }` only when the index answered, and `503
 * SEARCH_INDEX_DEGRADED` otherwise. Orchestrators route on `/search/ready`;
 * `/search/health` stays for restart decisions.
 *
 * The probe is a REACHABILITY check, not a freshness check: it does not measure
 * relay lag, so a reachable-but-stale index still reads as ready. That limit is
 * declared in RISK-0032 rather than implied by a green probe.
 */

import Fastify, { type FastifyInstance } from "fastify";

import type {
  SearchDeadLetterReadPort,
  SearchIndexHealthPort,
  SearchProductsReadPort,
} from "../ports.js";
import {
  SEARCH_DEAD_LETTER_THRESHOLDS,
  classifySearchDeadLetterSeverity,
} from "../domain/relay-dead-letters.js";
import { SearchUnavailableError, SearchValidationError, sendSearchError } from "./errors.js";
import { parseSearchRequest } from "./requests.js";
import { toSearchPage } from "./mappers.js";
import {
  registerServiceIdentity,
  type SearchServiceIdentityOptions,
  type SearchRouteConfig,
  SEARCH_SCOPES,
} from "./service-identity.js";

export interface SearchHttpDeps {
  readonly searchReadPort: SearchProductsReadPort;
  /**
   * Readiness probe for `GET /search/ready`. Optional so existing callers keep
   * compiling; when absent the route reports `503` — a service that cannot
   * prove it reaches its index must not be declared ready by default.
   */
  readonly indexHealthPort?: SearchIndexHealthPort;
  /**
   * مقياسُ المسمومِ لـ`GET /search/relay/dead-letters` (فجوةُ `G5` · `CLM-0247`).
   *
   * اختياريٌّ كي يبقى كلُّ مُنادٍ قائمٍ يُترجَمُ، **وغيابُهُ يُجيبُ خطأً لا
   * صفراً**: مسارٌ يُجيبُ «لا مسمومَ» وهوَ لا يملكُ منفذاً يقيسُ كانَ سيُقرأُ
   * نظافةً — وهوَ أخطرُ من عطبٍ ظاهرٍ.
   */
  readonly deadLetterReadPort?: SearchDeadLetterReadPort;
  /**
   * ساعةُ حكمِ التنبيهِ — تُحقَنُ في الاختبارِ كي يُقاسَ حكمُ العمرِ بلا انتظارِ
   * يومٍ حقيقيٍّ. والافتراضُ ساعةُ النظامِ.
   */
  readonly now?: () => Date;
  /**
   * فرضُ هويّةِ الخدمةِ على هذا الحدّ. **إلزاميٌّ بلا قيمةٍ افتراضيّةٍ بقصدٍ**
   * (سابقةُ حدِّ السمعة): قيمةٌ افتراضيّةٌ تجعلُ نسيانَ التركيبِ في جذرٍ ما حدَّ
   * بحثٍ **مفتوحاً يمرُّ كلَّ اختباراتِه** — وهيَ بعينُها الثغرةُ التي قاسَتْها
   * الموجةُ الثامنةُ (`RISK-0051`) وتسدُّها هذهِ. فمن أرادَ حدّاً بلا فرضٍ فليكتبْ
   * ذلكَ صراحةً في جذرِ تركيبِه، ولا موضعَ في المستودعِ يكتبُه.
   */
  readonly serviceIdentity: SearchServiceIdentityOptions;
}

export interface SearchHttpApp {
  readonly fastify: FastifyInstance;
  readonly close: () => Promise<void>;
}

const OPEN: SearchRouteConfig = { serviceIdentity: "open" };

function internalScoped(...scopes: readonly string[]): SearchRouteConfig {
  return { serviceIdentity: { scopes } };
}

/* ════════════════════════════════════════════════════════════════════════
 * حدُّ تفصيلِ نوعِ الحدثِ — مُحلِّلٌ واحدٌ، ورفضٌ مُسبَّبٌ لا قصٌّ صامتٌ
 *
 * وسقفٌ أعلى موجودٌ بقصدٍ: `event_type_limit=100000` كانَ سيُعيدُ جواباً لا
 * يُقرأُ ويُحمِّلُ القاعدةَ في حادثةٍ — والوقتُ الذي يُقرأُ فيهِ هذا المسارُ هوَ
 * أسوأُ وقتٍ لذلكَ.
 * ════════════════════════════════════════════════════════════════════════ */

const DEAD_LETTER_EVENT_TYPE_DEFAULT_LIMIT = 10;
const DEAD_LETTER_EVENT_TYPE_MAX_LIMIT = 100;

function parseDeadLetterEventTypeLimit(query: unknown): number {
  const raw = (query ?? {}) as Record<string, unknown>;
  const rawLimit = raw["event_type_limit"];
  if (rawLimit === undefined || rawLimit === null || rawLimit === "") {
    return DEAD_LETTER_EVENT_TYPE_DEFAULT_LIMIT;
  }

  const text = String(rawLimit);
  const decimalOnly = /^[0-9]+$/u.test(text);
  const parsed = Number(text);
  if (
    !decimalOnly ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > DEAD_LETTER_EVENT_TYPE_MAX_LIMIT
  ) {
    throw new SearchValidationError(
      "SEARCH_DEAD_LETTER_LIMIT_INVALID",
      `\`event_type_limit\` عددٌ عشريٌّ صحيحٌ بينَ 1 و${DEAD_LETTER_EVENT_TYPE_MAX_LIMIT}`,
    );
  }
  return parsed;
}

export function buildSearchHttpApp(deps: SearchHttpDeps): SearchHttpApp {
  const app = Fastify({
    // request.id is used as trace_id in error bodies.
    genReqId: () => crypto.randomUUID(),
  });

  app.setErrorHandler((error, request, reply) => {
    const traceId = String(request.id);
    return sendSearchError(reply, error, traceId);
  });

  // قبلَ تسجيلِ أيِّ مسارٍ بقصدٍ: حاجزُ التصنيفِ يرى ما يُسجَّلُ بعدَهُ وحدَهُ،
  // فمسارٌ يُسجَّلُ قبلَ هذا السطرِ يمرُّ بلا فرضٍ ولا يُكشَفُ.
  registerServiceIdentity(app, deps.serviceIdentity);

  // Liveness: no dependency, no DB. Never fails while the process runs.
  app.get("/search/health", { config: OPEN }, async () => {
    return { status: "ok" as const };
  });

  // Readiness: queries the read model. No try/catch — a throwing probe is a
  // degraded probe, and the single error handler already maps that to 503.
  app.get("/search/ready", { config: internalScoped(SEARCH_SCOPES.readyRead) }, async (_request, reply) => {
    if (deps.indexHealthPort === undefined) {
      throw new SearchUnavailableError(
        "SEARCH_INDEX_DEGRADED",
        "لا مسبارَ جاهزيةٍ مُركَّبٌ — تعذّرَ إثباتُ الوصولِ إلى الفهرسِ",
      );
    }
    const health = await deps.indexHealthPort.probe();
    if (!health.index_reachable) {
      throw new SearchUnavailableError(
        "SEARCH_INDEX_DEGRADED",
        "الفهرسُ غيرُ قابلٍ للوصولِ",
      );
    }
    return reply.status(200).send({
      status: "ready" as const,
      index_reachable: true,
      indexed_documents: health.indexed_documents,
    });
  });

  app.get("/search/products", { config: internalScoped(SEARCH_SCOPES.productsRead) }, async (request, reply) => {
    const parsed = parseSearchRequest(
      request.query as Record<string, unknown>,
    );
    // No try/catch: the read port throws SearchUnavailableError on degraded
    // state; the single error handler translates it to 503.
    const page = await deps.searchReadPort.search({
      q: parsed.q,
      locale: parsed.locale,
      categorySlug: parsed.categorySlug,
      page: parsed.page,
      pageSize: parsed.pageSize,
      sort: parsed.sort,
    });
    return reply.status(200).send(toSearchPage(page));
  });

  /*
   * ── مقياسُ المسمومِ في دفترِ استهلاكِ المُرحِّلِ (فجوةُ `G5` · `CLM-0247`) ──
   *
   * `GET /search/relay/dead-letters`
   *
   * مسارُ تشغيلٍ لا مسارُ عميلٍ: موثَّقٌ في `docs/04-api/` لا في
   * `contracts/api.openapi.yml` — قياسُ دفترٍ داخليٍّ ليسَ وعداً لعميلٍ خارجيٍّ
   * (سابقةُ حدِّ التوصيلِ §4.23 حرفاً).
   *
   * **ولا يمسُّ الجاهزيّةَ**: `gates_readiness: false` منشورٌ في الجسمِ لا
   * مُستنتَجٌ، كي لا يُركِّبَ مراقبٌ عليهِ بوّابةَ نشرٍ فيصيرُ حدثٌ فاسدٌ واحدٌ
   * انقطاعَ بحثٍ.
   */
  app.get(
    "/search/relay/dead-letters",
    { config: internalScoped(SEARCH_SCOPES.relayDeadLettersRead) },
    async (request, reply) => {
      if (deps.deadLetterReadPort === undefined) {
        // 503 لا جسمٌ فارغٌ: «لا أدري» جوابُهُ خطأٌ لا صفرٌ.
        throw new SearchUnavailableError(
          "SEARCH_INTERNAL_ERROR",
          "لا منفذَ قياسِ مسمومٍ مُركَّبٌ — لا يُدَّعى خلوٌّ لم يُقَسْ (G5)",
        );
      }

      const eventTypeLimit = parseDeadLetterEventTypeLimit(request.query);
      const metric = await deps.deadLetterReadPort.readSearchDeadLetters({ eventTypeLimit });
      const verdict = classifySearchDeadLetterSeverity(metric, (deps.now ?? (() => new Date()))());

      return reply.status(200).send({
        applied_filter: { event_type_limit: eventTypeLimit },
        measured_at: metric.measuredAt,
        total_poisoned: metric.totalPoisoned,
        ledgers: metric.ledgers.map((ledger) => ({
          ledger: ledger.ledger,
          poisoned: ledger.poisoned,
          oldest_poisoned_at: ledger.oldestPoisonedAt,
          newest_poisoned_at: ledger.newestPoisonedAt,
          by_event_type: ledger.byEventType.map((entry) => ({
            event_type: entry.eventType,
            poisoned: entry.poisoned,
          })),
        })),
        alert: {
          severity: verdict.severity,
          because: verdict.because,
          oldest_poisoned_age_seconds: verdict.oldestPoisonedAgeSeconds,
          /*
           * الحدُّ منشورٌ في الجسمِ لا في وثيقةٍ وحدَها: العمرُ مقيسٌ من
           * `consumed_at` — أوّلِ محاولةٍ لا لحظةِ الفقدِ (دفترُ البحثِ لا يملكُ
           * `updated_at`). ومَن هوَ في حادثةٍ يقرأُ الجوابَ لا الـADR.
           */
          age_measured_from: "consumed_at",
          thresholds: {
            warning_poisoned: SEARCH_DEAD_LETTER_THRESHOLDS.warningPoisoned,
            critical_poisoned: SEARCH_DEAD_LETTER_THRESHOLDS.criticalPoisoned,
            critical_age_seconds: SEARCH_DEAD_LETTER_THRESHOLDS.criticalAgeSeconds,
          },
          gates_readiness: false,
        },
      });
    },
  );

  return {
    fastify: app,
    close: async () => {
      await app.close();
    },
  };
}
