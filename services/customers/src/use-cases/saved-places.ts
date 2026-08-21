/**
 * Saved-place use cases: list, save, remove.
 *
 * A saved place is a shortcut, not a record of truth: its anchor is a zone, and
 * removing it never invalidates a past order request, because stops keep their
 * own copy of the zone and `saved_place_id` carries no foreign key (ADR-009).
 */

import { SAVED_PLACES_LIMIT } from "@wasla/contracts-customer";

import { CustomerError } from "../domain/errors.js";
import { customerPlaceRemoved, customerPlaceSaved } from "../domain/events.js";
import type { SavedPlace, SavedPlaceDraft } from "../domain/model.js";
import {
  assertIdempotencyKey,
  assertWaslaPublicId,
  normalizePlaceDraft,
  placeFingerprint,
} from "../domain/validation.js";
import { eventContext, type UseCaseDeps } from "./deps.js";
import { requireActiveZone } from "./zones.js";

/** List a customer's places, most recently used first. */
export async function listSavedPlaces(
  deps: UseCaseDeps,
  input: { waslaPublicId: string },
): Promise<SavedPlace[]> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  return deps.repo.listPlaces(waslaPublicId);
}

export interface SavePlaceInput {
  readonly waslaPublicId: string;
  readonly idempotencyKey: string;
  readonly draft: SavedPlaceDraft;
}

export interface SavePlaceResult {
  readonly place: SavedPlace;
  /** True when the key had already been used with the same payload. */
  readonly replayed: boolean;
}

/**
 * Save a place.
 *
 * The idempotency key is compared against the stored place rather than a stored
 * hash: the row already is the payload, so no fingerprint column exists in
 * schema.sql and nothing can drift out of sync with it.
 */
export async function savePlace(
  deps: UseCaseDeps,
  input: SavePlaceInput,
): Promise<SavePlaceResult> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const draft = normalizePlaceDraft(input.draft);

  const previous = await deps.repo.findPlaceByIdempotencyKey(
    waslaPublicId,
    idempotencyKey,
  );
  if (previous) {
    const samePayload =
      placeFingerprint(previous) === placeFingerprint(draft);
    if (!samePayload) {
      throw new CustomerError(
        "CUSTOMER_IDEMPOTENCY_KEY_REUSED",
        "المفتاح نفسه استُعمل بحمولة مختلفة",
      );
    }
    return { place: previous, replayed: true };
  }

  await requireActiveZone(deps.geography, draft.zoneId);

  // The limit is a use-case policy, not a schema constraint, so it can become
  // per-customer later without a migration.
  if ((await deps.repo.countPlaces(waslaPublicId)) >= SAVED_PLACES_LIMIT) {
    throw new CustomerError(
      "CUSTOMER_PLACE_LIMIT_REACHED",
      "بلغت الحدّ الأقصى للأماكن المحفوظة",
    );
  }

  // Case-insensitive: two places called "البيت" and "بيت" differ, but "Home"
  // and "home" are the same shortcut to a human.
  if (await deps.repo.findPlaceByLabel(waslaPublicId, draft.label)) {
    throw new CustomerError(
      "CUSTOMER_PLACE_LABEL_TAKEN",
      "التسمية مستعملة لهذا العميل",
    );
  }

  const place = await deps.repo.insertPlace({
    id: deps.idGen.uuid(),
    waslaPublicId,
    label: draft.label,
    zoneId: draft.zoneId,
    addressText: draft.addressText,
    coordinates: draft.coordinates,
    idempotencyKey,
    createdAt: deps.clock.now(),
  });

  await deps.outbox.append(customerPlaceSaved(place, eventContext(deps)));
  return { place, replayed: false };
}

/** Remove a place. Only the owner can remove one, and absence is a 404. */
export async function removeSavedPlace(
  deps: UseCaseDeps,
  input: { waslaPublicId: string; placeId: string },
): Promise<void> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  const place = await deps.repo.findPlace(waslaPublicId, input.placeId);
  if (!place) {
    throw new CustomerError(
      "CUSTOMER_PLACE_NOT_FOUND",
      "المكان المحفوظ غير موجود",
    );
  }
  await deps.repo.deletePlace(waslaPublicId, place.id);
  await deps.outbox.append(customerPlaceRemoved(place, eventContext(deps)));
}
