import { describe, it, expect } from "vitest";
import { generateApiKey, hashKey, verifyKey, keyMatchesPrefix } from "../domain/credentials";

describe("API credential generation", () => {
  it("generates a key with wsk_ prefix", () => {
    const { plaintext } = generateApiKey();
    expect(plaintext).toMatch(/^wsk_[0-9a-f]{64}$/);
  });

  it("generates a key prefix of 8 chars", () => {
    const { keyPrefix } = generateApiKey();
    expect(keyPrefix).toHaveLength(8);
  });

  it("produces a SHA-256 hash (64 hex chars)", () => {
    const { keyHash } = generateApiKey();
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different keys on each call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it("verifyKey returns true for matching key", () => {
    const { plaintext, keyHash } = generateApiKey();
    expect(verifyKey(plaintext, keyHash)).toBe(true);
  });

  it("verifyKey returns false for wrong key", () => {
    const { keyHash } = generateApiKey();
    expect(verifyKey("wsk_wrongkey", keyHash)).toBe(false);
  });

  it("keyMatchesPrefix returns true for matching prefix", () => {
    const { plaintext, keyPrefix } = generateApiKey();
    expect(keyMatchesPrefix(plaintext, keyPrefix)).toBe(true);
  });

  it("keyMatchesPrefix returns false for non-matching prefix", () => {
    expect(keyMatchesPrefix("wsk_abc123", "wsk_xyz")).toBe(false);
  });

  it("hashKey is deterministic", () => {
    const plaintext = "wsk_test123";
    expect(hashKey(plaintext)).toBe(hashKey(plaintext));
  });
});
