/**
 * getIdentityHistory use case — read a user's identity change history.
 * GET /identity/users/{waslaPublicId}/history?field=...
 */

import type { IdentityHistoryEntry } from "@wasla/contracts-identity";

import { IdentityError } from "../domain/errors.js";
import { isValidWaslaPublicId } from "../domain/public-id.js";
import type { HistoryField } from "../domain/model.js";
import type { UseCaseDeps } from "./resolve-telegram-identity.js";

const VALID_FIELDS: readonly HistoryField[] = [
  "telegram_username",
  "phone",
  "link",
];

export interface GetIdentityHistoryInput {
  waslaPublicId: string;
  field?: string;
}

export async function getIdentityHistory(
  deps: Pick<UseCaseDeps, "repo">,
  input: GetIdentityHistoryInput,
): Promise<IdentityHistoryEntry[]> {
  if (!isValidWaslaPublicId(input.waslaPublicId)) {
    throw new IdentityError(
      "IDENTITY_INVALID_PUBLIC_ID",
      `invalid Wasla Public ID format: ${input.waslaPublicId}`,
    );
  }
  const user = await deps.repo.findUserByPublicId(input.waslaPublicId);
  if (!user) {
    throw new IdentityError(
      "IDENTITY_NOT_FOUND",
      `no user with Wasla Public ID ${input.waslaPublicId}`,
    );
  }
  const field =
    input.field === undefined
      ? undefined
      : VALID_FIELDS.includes(input.field as HistoryField)
        ? (input.field as HistoryField)
        : undefined;
  const entries = await deps.repo.listHistory(user.internalUuid, field);
  // The API history endpoint exposes only telegram_username/phone/link fields
  // (per OpenAPI IdentityHistoryEntry.field enum); 'status' changes are internal.
  return entries
    .filter((h) => h.field !== "status")
    .map((h) => ({
      field: h.field as Exclude<HistoryField, "status">,
      old_value: h.oldValue,
      new_value: h.newValue,
      effective_at: h.effectiveAt,
      source: h.source,
    }));
}
