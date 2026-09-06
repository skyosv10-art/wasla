/**
 * The one adapter that connects the customer bot to the Customer Core — and the
 * only file in this package that imports the domain.
 *
 * **Why in-process and not over HTTP.** The Customer Core's HTTP layer validates
 * *shape* only; every meaningful rule lives in its use cases and its
 * `domain/validation.ts`, precisely so an in-process caller cannot get a weaker
 * check than an HTTP one (docs/04-api/CUSTOMER_HTTP.md §2). Calling the use cases
 * directly therefore obeys exactly the same rules while costing no round-trip and
 * no second failure mode. It stays behind `CustomerFlowsPort`, so the day the bot
 * and the service must be separate processes, this file is replaced by an HTTP
 * implementation and `flows.ts` does not change.
 *
 * Dependency direction: `bots/customer-bot → services/customers`. It exists here
 * and nowhere else, and it is one-way — the service never imports a bot, and the
 * channel packages never import either (ADR-007 rule 2). A composition root is
 * the layer allowed to know both sides; that is what makes it a composition root.
 */

import {
  CryptoIdGenerator,
  FakeGeography,
  InMemoryCustomerRepository,
  InMemoryOutbox,
  SystemClock,
  UnavailableOrderIntake,
  getCustomerProfile,
  isCustomerError,
  listOrderRequests,
  listSavedPlaces,
  upsertCustomerProfile,
  HttpGeographyPort,
  HttpIdentityLookupPort,
  PostgresCustomerOutbox,
  PostgresCustomerRepository,
  createCustomerDb,
  type GeographyPort,
  type IdentityLookupPort,
  type Locale,
  type UseCaseDeps,
  CUSTOMERS_IDENTITY_SCOPES,
} from "@wasla/customers-service";
import { createServiceRequestSigner, keyRegistryFromEnv } from "@wasla/service-auth";
import type { Pool } from "pg";

import {
  HttpCustomerNegotiations,
  UnconfiguredCustomerNegotiations,
} from "./infrastructure/http-negotiations.js";
import type { CustomerNegotiationsPort } from "./negotiation-flows.js";

import {
  CustomerFlowError,
  type CustomerFlowsPort,
  type OrderRequestView,
  type SavedPlaceView,
} from "./flows.js";

/** Locales the Customer Core stores (`Locale` in its domain model). */
const SUPPORTED_LOCALES: readonly Locale[] = ["ar", "en", "ur"] as const;

/**
 * `ar-SA` → `ar`, `en_US` → `en`, anything unknown → undefined.
 *
 * Undefined is not «Arabic»: the use case applies its own default (`ar`) when
 * creating a profile, and guessing here would mean two defaults that can drift.
 */
export function toLocale(languageCode: string | undefined): Locale | undefined {
  if (!languageCode) return undefined;
  const base = languageCode.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.find((locale) => locale === base);
}

/** Domain failure → a code the flows can translate; anything else propagates. */
function toFlowError(cause: unknown): unknown {
  return isCustomerError(cause) ? new CustomerFlowError(cause.code, cause.message) : cause;
}

/**
 * `CustomerFlowsPort` over the use cases.
 *
 * `traceId` is per call, not per instance: it is the id of the update being
 * answered, and it must reach the outbox envelope of any event this flow causes
 * (docs/04-api/CUSTOMER_HTTP.md §7). The deps bundle is therefore rebuilt around
 * the base one for each call — a cheap object spread, not a new connection.
 */
export class UseCaseCustomerFlows implements CustomerFlowsPort {
  constructor(private readonly deps: UseCaseDeps) {}

  private with(traceId?: string): UseCaseDeps {
    return traceId === undefined ? this.deps : { ...this.deps, traceId };
  }

  /**
   * Create the profile only when there is none.
   *
   * Read-then-create rather than a plain upsert: `/start` can be sent any number
   * of times, and the channel's display name is *not* authoritative — a customer
   * who set their name in the Mini App must not have it silently replaced by
   * their Telegram name on the next `/start`. A concurrent second `/start` is
   * harmless: the upsert it runs changes nothing, so it emits no event.
   */
  async ensureProfile(input: {
    readonly waslaPublicId: string;
    readonly displayName?: string;
    readonly languageCode?: string;
  }): Promise<{ readonly created: boolean }> {
    const deps = this.with();
    try {
      await getCustomerProfile(deps, { waslaPublicId: input.waslaPublicId });
      return { created: false };
    } catch (cause) {
      if (!isCustomerError(cause) || cause.code !== "CUSTOMER_PROFILE_NOT_FOUND") {
        throw toFlowError(cause);
      }
    }

    const locale = toLocale(input.languageCode);
    try {
      const result = await upsertCustomerProfile(deps, {
        waslaPublicId: input.waslaPublicId,
        patch: {
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(locale === undefined ? {} : { preferredLocale: locale }),
        },
      });
      return { created: result.created };
    } catch (cause) {
      throw toFlowError(cause);
    }
  }

  /**
   * Saved places, as labels.
   *
   * The zone is *not* resolved into its human path: that is one geography call
   * per place, and a chat list is not worth N network calls (nor the risk of one
   * failing and taking the whole list with it). The Mini App, which shows a map,
   * resolves them.
   */
  async listSavedPlaces(input: {
    readonly waslaPublicId: string;
  }): Promise<readonly SavedPlaceView[]> {
    try {
      const places = await listSavedPlaces(this.with(), {
        waslaPublicId: input.waslaPublicId,
      });
      return places.map((place) => ({
        label: place.label,
        addressText: place.addressText,
      }));
    } catch (cause) {
      throw toFlowError(cause);
    }
  }

  async listRecentOrderRequests(input: {
    readonly waslaPublicId: string;
    readonly limit: number;
  }): Promise<readonly OrderRequestView[]> {
    try {
      const requests = await listOrderRequests(this.with(), {
        waslaPublicId: input.waslaPublicId,
        limit: input.limit,
      });
      return requests.map((request) => ({
        status: request.status,
        orderType: request.orderType,
        orderPublicId: request.orderPublicId,
        failureReasonCode: request.failureReasonCode,
        createdAt: request.createdAt,
      }));
    } catch (cause) {
      throw toFlowError(cause);
    }
  }
}

/** What `buildCustomerFlows` returns: the port plus what must be released. */
export interface CustomerFlowsWiring {
  readonly flows: CustomerFlowsPort;
  /** The Customer Core pool, when this process opened one. */
  readonly pool: Pool | null;
  /** Which persistence the flows run on — visible so an operator can verify it. */
  readonly persistence: "postgres" | "memory";
}

/**
 * Environment variables this wiring reads. Injectable so tests never touch
 * `process.env` (the same discipline as `loadBotConfig`).
 */
export interface CustomerFlowsEnv {
  readonly CUSTOMER_DATABASE_URL?: string | undefined;
  readonly IDENTITY_SERVICE_URL?: string | undefined;
  /**
   * مادّةُ مفاتيحِ هويّةِ الخدمةِ (`M1-04`). تُقرأُ من هذه الحُقيبةِ لا من
   * `process.env`، على نفسِ نهجِ باقي المتغيّراتِ هنا: متغيّرٌ ناقصٌ يُخفِقُ
   * **في موضعِه** لا يُورَثُ صامتاً من الصَّدَفةِ.
   *
   * **ولا قيمةَ افتراضيّةَ «بلا توقيعٍ»:** حدُّ الهويّةِ يفرضُ التوقيعَ، وبوتٌ
   * بلا مفاتيحَ يُرَدُّ 401 فيُخبِرُ العميلَ أنّ هويّتَه غيرُ موجودةٍ وهي
   * موجودةٌ — وذلك أسوأُ من إخفاقٍ ظاهرٍ عندَ الإقلاعِ.
   */
  readonly WASLA_SERVICE_AUTH_KEYS?: string | undefined;
  readonly WASLA_SERVICE_AUTH_ACTIVE_KID?: string | undefined;
  readonly GEOGRAPHY_SERVICE_URL?: string | undefined;
  readonly NEGOTIATIONS_SERVICE_URL?: string | undefined;
}

/**
 * Wire the flows from the environment, or refuse.
 *
 * `null` when `CUSTOMER_DATABASE_URL` is unset — and that refusal is the point:
 * an in-memory fallback here would give a *deployed* bot a private, empty
 * customer database that answers «no saved places» to a customer who has twenty,
 * and loses the profile it created on every restart. A bot without flows behaves
 * exactly as it did in Phase 03: `/places` and `/orders` are not registered, so
 * the core answers `CHANNEL_UNSUPPORTED_COMMAND` (422) — a visible refusal instead of a
 * plausible lie.
 *
 * The fallbacks that *do* exist are the service's own, for the same reasons
 * (services/customers/src/http/server.ts): identity permissive, geography empty,
 * order intake unavailable.
 */
export function buildCustomerFlows(env: CustomerFlowsEnv): CustomerFlowsWiring | null {
  const databaseUrl = env.CUSTOMER_DATABASE_URL?.trim();
  if (!databaseUrl) return null;

  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();
  const identityLookup: IdentityLookupPort = env.IDENTITY_SERVICE_URL
    ? new HttpIdentityLookupPort({
        baseUrl: env.IDENTITY_SERVICE_URL,
        // M1-04 (الموجة 3): حدُّ الهويّةِ يفرضُ هويّةَ الخدمةِ، والصلاحيّةُ
        // المطلوبةُ قراءةُ مستخدمٍ وحدَها — لا ربطَ هويّةٍ ولا بدءَ استعادةٍ.
        signRequest: createServiceRequestSigner({
          serviceName: "customer-bot",
          audience: "identity",
          keys: keyRegistryFromEnv({
            WASLA_SERVICE_AUTH_KEYS: env.WASLA_SERVICE_AUTH_KEYS,
            WASLA_SERVICE_AUTH_ACTIVE_KID: env.WASLA_SERVICE_AUTH_ACTIVE_KID,
          }),
          scopes: CUSTOMERS_IDENTITY_SCOPES,
        }),
      })
    : new PermissiveIdentityLookup();
  const geography: GeographyPort = env.GEOGRAPHY_SERVICE_URL
    ? new HttpGeographyPort({ baseUrl: env.GEOGRAPHY_SERVICE_URL })
    : new FakeGeography([]);

  const { pool, db } = createCustomerDb({ connectionString: databaseUrl });
  const deps: UseCaseDeps = {
    repo: new PostgresCustomerRepository(db),
    outbox: new PostgresCustomerOutbox(db),
    clock,
    idGen,
    identityLookup,
    geography,
    // The bot never submits an order (flows.ts §scope), so the fail-closed
    // default is not a limitation here — it is the assertion that it cannot.
    orderIntake: new UnavailableOrderIntake(),
  };

  return { flows: new UseCaseCustomerFlows(deps), pool, persistence: "postgres" };
}

/**
 * Dev-only identity lookup: every format-valid public id is treated as existing.
 *
 * Mirrors the service's own dev fallback deliberately — two different answers to
 * «does this identity exist» between the bot and the service would be worse than
 * one permissive answer in both.
 */
class PermissiveIdentityLookup implements IdentityLookupPort {
  async identityExists(): Promise<boolean> {
    return true;
  }
}

/** An in-memory wiring for local runs and tests — never for a deployment. */
export function buildInMemoryCustomerFlows(): CustomerFlowsPort {
  return new UseCaseCustomerFlows({
    repo: new InMemoryCustomerRepository(),
    outbox: new InMemoryOutbox(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
    identityLookup: new PermissiveIdentityLookup(),
    geography: new FakeGeography([]),
    orderIntake: new UnavailableOrderIntake(),
  });
}


/** The missing negotiation URL remains an explicit dependency failure, never an empty list. */
export function buildCustomerNegotiations(env: CustomerFlowsEnv): CustomerNegotiationsPort {
  const baseUrl = env.NEGOTIATIONS_SERVICE_URL?.trim();
  return baseUrl ? new HttpCustomerNegotiations({ baseUrl }) : new UnconfiguredCustomerNegotiations();
}
