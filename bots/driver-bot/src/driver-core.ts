/**
 * The one adapter that connects the driver bot to the Driver Core — and the only
 * file in this package that imports the domain.
 *
 * **Why in-process and not over HTTP.** The Driver Core's HTTP layer validates
 * *shape* only; every meaningful rule lives in its use cases and its
 * `domain/validation.ts`, precisely so an in-process caller cannot get a weaker
 * check than an HTTP one (docs/04-api/DRIVER_HTTP.md §2, and the same argument the
 * customer bot records in `customer-core.ts`). Calling the use cases directly
 * therefore obeys exactly the same rules while costing no round-trip and no second
 * failure mode. It stays behind `DriverFlowsPort`, so the day the bot and the
 * service must be separate processes, this file is replaced by an HTTP
 * implementation and `flows.ts` does not change.
 *
 * Dependency direction: `bots/driver-bot → services/drivers`. It exists here and
 * nowhere else, and it is one-way — the service never imports a bot, and the
 * channel packages never import either (ADR-007 rule 2).
 *
 * **What this file must NOT contain: a second answer to a wiring question.** The
 * candidacy port and the zone catalogue are chosen by
 * `services/drivers/src/infrastructure/outbound-wiring.ts`, which the service's own
 * HTTP process calls too. Two private copies would let the bot accept a zone the
 * service rejects, and a driver's verdict would then depend on which surface he
 * used.
 */

import {
  CryptoIdGenerator,
  PostgresDriverRunner,
  SystemClock,
  configuredCandidacy,
  configuredZoneCatalog,
  createDriverDb,
  declareAvailability,
  isDriverError,
  listDriverDocuments,
  readDriverProfile,
  readEligibility,
  registerDriver,
  type DriverOutboundEnv,
  type DriverRunner,
  type DriverSharedDeps,
} from "@wasla/drivers-service";
import type { Pool } from "pg";

import {
  DriverFlowError,
  type DeclaredAvailabilityView,
  type DriverDocumentView,
  type DriverFlowsPort,
  type DriverStatusView,
} from "./flows.js";

/** Locales the Driver Core stores (`Locale` in its domain model). */
const SUPPORTED_LOCALES = ["ar", "en", "ur"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * `ar-SA` → `ar`, `en_US` → `en`, anything unknown → undefined.
 *
 * Undefined is not «Arabic»: `registerDriver` applies its own default (`ar`), and
 * guessing here would mean two defaults that can drift.
 */
export function toDriverLocale(languageCode: string | undefined): SupportedLocale | undefined {
  if (!languageCode) return undefined;
  const base = languageCode.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.find((locale) => locale === base);
}

/** Domain failure → a code the flows can translate; anything else propagates. */
function toFlowError(cause: unknown): unknown {
  return isDriverError(cause) ? new DriverFlowError(cause.code, cause.message) : cause;
}

/**
 * `DriverFlowsPort` over the use cases, through a `DriverRunner`.
 *
 * The runner is what keeps this adapter honest about transactions: `write` is one
 * Postgres transaction on the Postgres path, and no route — nor this bot — is ever
 * in a position to open one itself (`services/drivers/src/runner.ts`).
 *
 * Which calls are `write` is not a style choice:
 *
 *  - `ensureRegistered` writes, obviously.
 *  - `declareAvailability` writes, and republishes.
 *  - **`readStatus` writes too**, and that is the surprising one: `readEligibility`
 *    RECOMPUTES by design, because the alternative is a read that discovers the
 *    verdict has moved and says nothing. So a driver sending `/status` may cause an
 *    eligibility log row and a publication — the same behaviour as
 *    `GET /drivers/{id}/eligibility`, deliberately, since two surfaces answering the
 *    same question differently is the drift this whole service exists to prevent.
 *  - `listDocuments` only reads, so it takes `read` and can never be the reason a
 *    log row appeared.
 */
export class UseCaseDriverFlows implements DriverFlowsPort {
  constructor(private readonly runner: DriverRunner) {}

  /**
   * Register only when there is no profile.
   *
   * Read-then-create rather than a plain register: `/start` can be sent any number
   * of times, and `registerDriver` answers `DRIVER_ALREADY_EXISTS` (409) on the
   * second one — a conflict it raises deliberately, so that re-registering cannot
   * overwrite a file that already has documents. Turning that 409 into a reply the
   * driver has to read would be punishing him for tapping a button twice.
   *
   * The channel's display name is also NOT authoritative: a driver who set his name
   * in the Mini App must not have it silently replaced by his Telegram name on the
   * next `/start`, which is exactly what would happen if this were an upsert.
   */
  async ensureRegistered(input: {
    readonly waslaPublicId: string;
    readonly displayName?: string;
    readonly languageCode?: string;
  }): Promise<{ readonly created: boolean }> {
    try {
      await this.runner.read((deps) => readDriverProfile(deps, input.waslaPublicId));
      return { created: false };
    } catch (cause) {
      if (!isDriverError(cause) || cause.code !== "DRIVER_NOT_FOUND") {
        throw toFlowError(cause);
      }
    }

    const preferredLocale = toDriverLocale(input.languageCode);
    try {
      await this.runner.write((deps) =>
        registerDriver(deps, {
          waslaPublicId: input.waslaPublicId,
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(preferredLocale === undefined ? {} : { preferredLocale }),
          // `serviceKinds` is left empty on purpose: which services a driver offers
          // is his choice, and defaulting it to `ride` here would put a claim in his
          // file that he never made. The empty list is why a fresh `/start` is
          // followed by `NO_SERVICE_KIND` in `/status` — an accurate instruction,
          // not a bug.
        }),
      );
      return { created: true };
    } catch (cause) {
      // A concurrent second `/start` lands here with 409. It is not a failure worth
      // showing: the profile the caller asked for exists.
      if (isDriverError(cause) && cause.code === "DRIVER_ALREADY_EXISTS") {
        return { created: false };
      }
      throw toFlowError(cause);
    }
  }

  async readStatus(input: { readonly waslaPublicId: string }): Promise<DriverStatusView> {
    try {
      return await this.runner.write(async (deps) => {
        // The existence check first, and through the use case that owns it: without
        // it `readEligibility` answers `unknown` for an unregistered driver, and
        // «غير محدَّد بعد» would be a dead end where «أرسل /start» is the answer.
        const profile = await readDriverProfile(deps, input.waslaPublicId);
        const { decision } = await readEligibility(deps, input.waslaPublicId);
        return toStatusView(profile.declaredAvailability, decision);
      });
    } catch (cause) {
      throw toFlowError(cause);
    }
  }

  /**
   * Declare, then answer with the verdict.
   *
   * Two use-case calls and not one, for a reason worth stating: `declareAvailability`
   * returns the PROFILE, and a profile carries no reason codes — eligibility is a
   * derived function, not a column (ADR-012 decision 2). So the reasons have to come
   * from a decision, and `readEligibility` is the only thing that produces one.
   *
   * The second call is not a second decision: `declareAvailability` already ended in a
   * recomputation (every write does — the invariant in the service's own header), so
   * the recomputation here finds the verdict unchanged and writes nothing. Both calls
   * are inside ONE `runner.write`, which on Postgres makes them one transaction — so
   * the verdict the driver reads is the verdict that was published, and not a later
   * one produced by something that ran in between.
   */
  async declareAvailability(input: {
    readonly waslaPublicId: string;
    readonly declared: DeclaredAvailabilityView;
  }): Promise<DriverStatusView> {
    try {
      return await this.runner.write(async (deps) => {
        const profile = await declareAvailability(deps, input.waslaPublicId, input.declared);
        const { decision } = await readEligibility(deps, input.waslaPublicId);
        return toStatusView(profile.declaredAvailability, decision);
      });
    } catch (cause) {
      throw toFlowError(cause);
    }
  }

  /**
   * The documents, including superseded ones — the service returns them
   * deliberately, and hiding them here would make the driver's view disagree with
   * the one support reads while helping him.
   *
   * `storageRef` is NOT mapped through: it is a pointer into the file store, and a
   * chat message is the last place a storage path belongs (privacy.test.ts).
   */
  async listDocuments(input: {
    readonly waslaPublicId: string;
  }): Promise<readonly DriverDocumentView[]> {
    try {
      const documents = await this.runner.read((deps) =>
        listDriverDocuments(deps, input.waslaPublicId),
      );
      return documents.map((document) => ({
        documentType: document.documentType,
        status: document.status,
        expiresAt: document.expiresAt,
      }));
    } catch (cause) {
      throw toFlowError(cause);
    }
  }
}

/** The one place a domain decision becomes the view the chat renders. */
function toStatusView(
  declaredAvailability: DeclaredAvailabilityView,
  decision: {
    readonly state: DriverStatusView["eligibilityState"];
    readonly reasonCodes: readonly string[];
    readonly recheckAt: string | null;
  },
): DriverStatusView {
  return {
    eligibilityState: decision.state,
    reasonCodes: [...decision.reasonCodes],
    declaredAvailability,
    recheckAt: decision.recheckAt,
  };
}

/** What `buildDriverFlows` returns: the port plus what must be released. */
export interface DriverFlowsWiring {
  readonly flows: DriverFlowsPort;
  /** The Driver Core pool, when this process opened one. */
  readonly pool: Pool | null;
  /** Which persistence the flows run on — visible so an operator can verify it. */
  readonly persistence: "postgres";
}

/**
 * Environment variables this wiring reads. Injectable so tests never touch
 * `process.env` (the same discipline as `loadBotConfig`).
 *
 * `DRIVER_DATABASE_URL` and not `DATABASE_URL`: this process is not the driver
 * service, and one shared variable name would make a bot deployed beside a
 * different service silently open the wrong database.
 */
export interface DriverFlowsEnv extends DriverOutboundEnv {
  readonly DRIVER_DATABASE_URL?: string | undefined;
}

/**
 * Wire the flows from the environment, or refuse.
 *
 * `null` when `DRIVER_DATABASE_URL` is unset — and that refusal is the point. An
 * in-memory fallback here would give a *deployed* bot a private, empty driver
 * database: it would answer «لا توجد وثائق» to a driver holding a verified licence,
 * accept `/available` into nothing, and lose every profile it created on restart.
 * Worse, it would publish candidacies for drivers matching has never heard of.
 *
 * A bot without flows behaves exactly as it did in Phase 03: `/available`,
 * `/offline`, `/status` and `/docs` are not registered, so the channel core answers
 * `CHANNEL_UNSUPPORTED_COMMAND` (422) — a visible refusal instead of a plausible
 * lie, and the driver still gets his Mini App from `/start`.
 *
 * The fallbacks that *do* exist are the service's own, chosen by the shared
 * outbound wiring and for the reasons recorded there: matching refuses when no URL
 * is configured, and the zone catalogue degrades to `DRIVER_DEV_ZONE_IDS` with a
 * warning.
 */
export function buildDriverFlows(
  env: DriverFlowsEnv,
  log: (message: string) => void = (message) => console.warn(message),
): DriverFlowsWiring | null {
  const databaseUrl = env.DRIVER_DATABASE_URL?.trim();
  if (!databaseUrl) return null;

  const { pool, db } = createDriverDb({ connectionString: databaseUrl });
  const shared: DriverSharedDeps = {
    candidacy: configuredCandidacy(env),
    zoneCatalog: configuredZoneCatalog(env, log),
    clock: new SystemClock(),
    ids: new CryptoIdGenerator(),
  };

  return {
    flows: new UseCaseDriverFlows(new PostgresDriverRunner(db, shared)),
    pool,
    persistence: "postgres",
  };
}

/**
 * An in-memory wiring for local runs and tests — never for a deployment.
 *
 * It takes a runner rather than building one, because the in-memory environment is
 * assembled by the service (`createInMemoryEnvironment`) and a bot that assembled
 * its own would be a second definition of what a wired Driver Core is.
 */
export function buildDriverFlowsOver(runner: DriverRunner): DriverFlowsPort {
  return new UseCaseDriverFlows(runner);
}
