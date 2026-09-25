/**
 * API credential domain — issuance and revocation.
 *
 * (ADR-048 §4): API credentials are scoped to a single store, hashed at rest
 * (SHA-256), and revocable independently of the user account.
 */

import { createHash, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const PREFIX_LENGTH = 8;

export function generateApiKey(): { plaintext: string; keyPrefix: string; keyHash: string } {
  const raw = randomBytes(KEY_BYTES);
  const plaintext = `wsk_${raw.toString("hex")}`;
  const keyPrefix = plaintext.slice(0, PREFIX_LENGTH);
  const keyHash = hashKey(plaintext);
  return { plaintext, keyPrefix, keyHash };
}

export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function verifyKey(plaintext: string, storedHash: string): boolean {
  return hashKey(plaintext) === storedHash;
}

export function keyMatchesPrefix(plaintext: string, prefix: string): boolean {
  return plaintext.startsWith(prefix);
}
