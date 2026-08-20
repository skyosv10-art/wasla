/**
 * resolveTelegramIdentity use case.
 *
 * Idempotent by `telegram_user_id` (per OpenAPI POST /identity/resolve):
 *  - If the Telegram id is already linked to a user, resolve to that user.
 *  - A changed `telegram_username` does NOT create a new user — it is recorded
 *    in Identity History and a TelegramUsernameChanged event is emitted.
 *  - If no user exists, create one (new Wasla Public ID + internal_uuid),
 *    add the Telegram link, record the initial username, and emit
 *    IdentityCreated + IdentityLinkAdded events to the outbox.
 *
 * This is the core of the Phase 01 Exit Gate: "create a user from Telegram
 * and identity stays stable across Username change."
 */

import type {
  ResolveIdentityRequest,
  ResolveIdentityResponse,
  IdentityLink as IdentityLinkDto,
} from "@wasla/contracts-identity";

import { IdentityError } from "../domain/errors.js";
import { formatWaslaPublicId } from "../domain/public-id.js";
import {
  identityCreated,
  identityLinkAdded,
  telegramUsernameChanged,
  type CreationSource,
} from "../domain/events.js";
import type { IdentityLink } from "../domain/model.js";
import type {
  Clock,
  IdGenerator,
  IdentityRepository,
  Outbox,
  PublicIdSequence,
} from "../ports.js";

/** Shared dependencies injected into use cases (hexagonal wiring). */
export interface UseCaseDeps {
  repo: IdentityRepository;
  outbox: Outbox;
  publicIdSeq: PublicIdSequence;
  clock: Clock;
  idGen: IdGenerator;
  /** Optional correlation id propagated into event envelopes. */
  traceId?: string;
}

function toLinkDto(link: IdentityLink): IdentityLinkDto {
  return {
    provider: link.provider,
    external_id: link.externalId,
    verified: link.verified,
    linked_at: link.linkedAt,
  };
}

/** Resolve the source for creation/history from the request (default customer_bot). */
function resolveSource(
  source: ResolveIdentityRequest["source"],
): CreationSource {
  return source ?? "customer_bot";
}

export async function resolveTelegramIdentity(
  deps: UseCaseDeps,
  request: ResolveIdentityRequest,
): Promise<ResolveIdentityResponse> {
  const { repo, outbox, publicIdSeq, clock, idGen, traceId } = deps;

  // 1. Validate the idempotent key.
  if (
    request.telegram_user_id === undefined ||
    request.telegram_user_id === null ||
    !Number.isFinite(request.telegram_user_id)
  ) {
    throw new IdentityError(
      "IDENTITY_MISSING_TELEGRAM_ID",
      "telegram_user_id is required to resolve a Wasla identity",
    );
  }

  const telegramExternalId = String(request.telegram_user_id);

  // 2. Idempotent resolve: existing user for this Telegram id.
  const existing = await repo.findUserByTelegramId(telegramExternalId);
  if (existing) {
    const latestUsername = await repo.latestTelegramUsername(
      existing.internalUuid,
    );
    const incomingUsername = request.telegram_username ?? null;

    if (
      incomingUsername !== null &&
      incomingUsername !== latestUsername
    ) {
      const now = clock.now();
      const source = resolveSource(request.source);
      await repo.recordHistory({
        userInternalUuid: existing.internalUuid,
        field: "telegram_username",
        oldValue: latestUsername,
        newValue: incomingUsername,
        effectiveAt: now,
        source,
      });
      await outbox.append(
        telegramUsernameChanged({
          idGen,
          clock,
          aggregateId: existing.internalUuid,
          oldUsername: latestUsername,
          newUsername: incomingUsername,
          source,
          traceId,
        }),
      );
    }

    const links = await repo.listLinks(existing.internalUuid);
    return {
      wasla_public_id: existing.waslaPublicId,
      internal_uuid: existing.internalUuid,
      created: false,
      links: links.map(toLinkDto),
    };
  }

  // 3. Create a new Wasla identity.
  const publicIdNumber = await publicIdSeq.next();
  const waslaPublicId = formatWaslaPublicId(publicIdNumber);
  const internalUuid = idGen.uuid();
  const now = clock.now();
  const source = resolveSource(request.source);

  await repo.createUser({
    internalUuid,
    waslaPublicId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await repo.addLink({
    userInternalUuid: internalUuid,
    provider: "telegram",
    externalId: telegramExternalId,
    verified: true,
    linkedAt: now,
  });

  if (request.telegram_username) {
    await repo.recordHistory({
      userInternalUuid: internalUuid,
      field: "telegram_username",
      oldValue: null,
      newValue: request.telegram_username,
      effectiveAt: now,
      source,
    });
  }

  // 4. Emit domain events to the outbox.
  await outbox.append(
    identityCreated({
      idGen,
      clock,
      aggregateId: internalUuid,
      waslaPublicId,
      source,
      traceId,
    }),
  );
  await outbox.append(
    identityLinkAdded({
      idGen,
      clock,
      aggregateId: internalUuid,
      provider: "telegram",
      externalId: telegramExternalId,
      verified: true,
      traceId,
    }),
  );

  const links = await repo.listLinks(internalUuid);
  return {
    wasla_public_id: waslaPublicId,
    internal_uuid: internalUuid,
    created: true,
    links: links.map(toLinkDto),
  };
}
