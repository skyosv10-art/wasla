import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPENAPI = readFileSync(join(SERVICE_ROOT, "contracts", "api.openapi.yml"), "utf8");

describe("boundary — port 8096 uniqueness (ADR-050 §6)", () => {
  it("api.openapi.yml uses port 8096", () => {
    expect(OPENAPI).toContain("8096");
  });
});

describe("boundary — OpenAPI security (ADR-050 §6)", () => {
  it("uses ServiceAuth with x-wasla-service-auth header", () => {
    expect(OPENAPI).toContain("ServiceAuth");
    expect(OPENAPI).toContain("x-wasla-service-auth");
  });

  it("health endpoint is open", () => {
    expect(OPENAPI).toMatch(/\/billing\/health[\s\S]*?security:\s*\[\]/);
  });

  it("invoice endpoints require scopes", () => {
    expect(OPENAPI).toContain("billing:invoice:write");
    expect(OPENAPI).toContain("billing:invoice:read");
  });
});

describe("boundary — no PII in OpenAPI", () => {
  it("does not contain chat_id or phone fields", () => {
    expect(OPENAPI).not.toContain("chat_id");
    expect(OPENAPI).not.toContain("phone");
    expect(OPENAPI).not.toContain("telegram");
  });
});
