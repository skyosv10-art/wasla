/**
 * getUser use case — read a Wasla user by their Public ID.
 * GET /identity/users/{waslaPublicId}
 */

import type { IdentityUser } from "@wasla/contracts-identity";

import { IdentityError } from "../domain/errors.js";
import { isValidWaslaPublicId } from "../domain/public-id.js";
import type { IdentityLink } from "../domain/model.js";
import type { UseCaseDeps } from "./resolve-telegram-identity.js";

function toLinkDto(link: IdentityLink) {
  return {
    provider: link.provider,
    external_id: link.externalId,
    verified: link.verified,
    linked_at: link.linkedAt,
  };
}

export async function getUser(
  deps: Pick<UseCaseDeps, "repo">,
  waslaPublicId: string,
): Promise<IdentityUser> {
  if (!isValidWaslaPublicId(waslaPublicId)) {
    throw new IdentityError(
      "IDENTITY_INVALID_PUBLIC_ID",
      `invalid Wasla Public ID format: ${waslaPublicId}`,
    );
  }
  const user = await deps.repo.findUserByPublicId(waslaPublicId);
  if (!user) {
    throw new IdentityError(
      "IDENTITY_NOT_FOUND",
      `no user with Wasla Public ID ${waslaPublicId}`,
    );
  }
  const links = await deps.repo.listLinks(user.internalUuid);
  return {
    wasla_public_id: user.waslaPublicId,
    status: user.status,
    created_at: user.createdAt,
    links: links.map(toLinkDto),
  };
}
