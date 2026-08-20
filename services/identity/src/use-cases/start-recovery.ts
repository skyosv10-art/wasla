/**
 * startRecovery use case — begin account recovery via Wasla Public ID.
 * POST /identity/users/{waslaPublicId}/recovery
 *
 * Recovery does not bypass identity: it starts verification steps and flips
 * the user into `recovery_in_progress`. The verification method must not rely
 * on Telegram as the sole source.
 */

import type { RecoveryStarted } from "@wasla/contracts-identity";

import { IdentityError } from "../domain/errors.js";
import { isValidWaslaPublicId } from "../domain/public-id.js";
import { recoveryStarted } from "../domain/events.js";
import type { VerificationMethod } from "../domain/model.js";
import type { UseCaseDeps } from "./resolve-telegram-identity.js";

const VALID_METHODS: readonly VerificationMethod[] = [
  "phone_otp",
  "email_otp",
  "admin_assisted",
];

export interface StartRecoveryInput {
  waslaPublicId: string;
  verification_method: string;
}

export async function startRecovery(
  deps: UseCaseDeps,
  input: StartRecoveryInput,
): Promise<RecoveryStarted> {
  if (!isValidWaslaPublicId(input.waslaPublicId)) {
    throw new IdentityError(
      "IDENTITY_INVALID_PUBLIC_ID",
      `invalid Wasla Public ID format: ${input.waslaPublicId}`,
    );
  }
  if (!VALID_METHODS.includes(input.verification_method as VerificationMethod)) {
    throw new IdentityError(
      "IDENTITY_RECOVERY_METHOD_INVALID",
      `unsupported recovery verification method: ${input.verification_method}`,
    );
  }
  const user = await deps.repo.findUserByPublicId(input.waslaPublicId);
  if (!user || user.status === "deleted") {
    throw new IdentityError(
      "IDENTITY_NOT_FOUND",
      `no recoverable user with Wasla Public ID ${input.waslaPublicId}`,
    );
  }

  const verificationMethod = input.verification_method as VerificationMethod;
  const recoveryId = deps.idGen.uuid();
  const now = deps.clock.now();

  await deps.repo.createRecoveryRequest({
    id: recoveryId,
    userInternalUuid: user.internalUuid,
    verificationMethod,
    createdAt: now,
  });
  await deps.repo.updateUserStatus(user.internalUuid, "recovery_in_progress");

  await deps.outbox.append(
    recoveryStarted({
      idGen: deps.idGen,
      clock: deps.clock,
      aggregateId: user.internalUuid,
      recoveryId,
      verificationMethod,
      traceId: deps.traceId,
    }),
  );

  return {
    recovery_id: recoveryId,
    status: "verification_pending",
  };
}
