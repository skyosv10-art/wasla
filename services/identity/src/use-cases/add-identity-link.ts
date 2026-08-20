/**
 * addIdentityLink use case — add an external identity link to an existing user.
 * POST /identity/users/{waslaPublicId}/links
 */

import type { IdentityLink as IdentityLinkDto } from "@wasla/contracts-identity";

import { IdentityError } from "../domain/errors.js";
import { isValidWaslaPublicId } from "../domain/public-id.js";
import {
  identityLinkAdded,
} from "../domain/events.js";
import type { LinkProvider } from "../domain/model.js";
import type { UseCaseDeps } from "./resolve-telegram-identity.js";

const VALID_PROVIDERS: readonly LinkProvider[] = [
  "telegram",
  "phone",
  "email",
  "web",
  "mobile",
];

export interface AddIdentityLinkInput {
  waslaPublicId: string;
  provider: string;
  external_id: string;
  verified?: boolean;
}

export async function addIdentityLink(
  deps: UseCaseDeps,
  input: AddIdentityLinkInput,
): Promise<IdentityLinkDto> {
  if (!isValidWaslaPublicId(input.waslaPublicId)) {
    throw new IdentityError(
      "IDENTITY_INVALID_PUBLIC_ID",
      `invalid Wasla Public ID format: ${input.waslaPublicId}`,
    );
  }
  if (!VALID_PROVIDERS.includes(input.provider as LinkProvider)) {
    throw new IdentityError(
      "IDENTITY_LINK_INVALID_PROVIDER",
      `unsupported identity link provider: ${input.provider}`,
    );
  }
  const user = await deps.repo.findUserByPublicId(input.waslaPublicId);
  if (!user) {
    throw new IdentityError(
      "IDENTITY_NOT_FOUND",
      `no user with Wasla Public ID ${input.waslaPublicId}`,
    );
  }
  if (user.status === "suspended") {
    throw new IdentityError(
      "IDENTITY_USER_SUSPENDED",
      "cannot add an identity link to a suspended user",
    );
  }

  const provider = input.provider as LinkProvider;
  const verified = input.verified ?? false;
  const now = deps.clock.now();

  const link = await deps.repo.addLink({
    userInternalUuid: user.internalUuid,
    provider,
    externalId: input.external_id,
    verified,
    linkedAt: now,
  });

  await deps.outbox.append(
    identityLinkAdded({
      idGen: deps.idGen,
      clock: deps.clock,
      aggregateId: user.internalUuid,
      provider,
      externalId: input.external_id,
      verified,
      traceId: deps.traceId,
    }),
  );

  return {
    provider: link.provider,
    external_id: link.externalId,
    verified: link.verified,
    linked_at: link.linkedAt,
  };
}
