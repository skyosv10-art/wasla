/**
 * Drift guards for the HTTP layer (Phase 05 · MR 4/6).
 *
 * The suites in `http-*.test.ts` prove that the routes we wrote behave correctly. They
 * cannot notice a route the CONTRACT declares and nobody implemented — the test for it
 * was never written either, so the gap is silent in both files at once. That is the
 * failure this file exists to make impossible: it reads the OpenAPI document from disk
 * and compares it, in both directions, against what Fastify actually registered and
 * against the request-key whitelists in `http/requests.ts`.
 *
 * Everything asserted here is a structural token — a path, a method, a property name.
 * Nothing matches Arabic prose, for the reason `contract-drift.test.ts` gives: a guard
 * that fails when an explanation is improved is a guard people learn to ignore.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createDriverApp } from "../http/app.js";
import {
  AVAILABILITY_UPDATE_KEYS,
  DOCUMENT_REVIEW_KEYS,
  DOCUMENT_SUBMISSION_KEYS,
  DRIVER_PROFILE_PATCH_KEYS,
  DRIVER_REGISTRATION_KEYS,
  SUSPENSION_REQUEST_KEYS,
  VEHICLE_PATCH_KEYS,
  VEHICLE_REGISTRATION_KEYS,
  ZONE_ITEM_KEYS,
} from "../http/requests.js";
import { createDirectRunner } from "../runner.js";
import { environment } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const contract = readFileSync(resolve(here, "../../contracts/api.openapi.yml"), "utf8");

/** Top-level `paths:` keys — indent 2 in the generated document. */
function contractPaths(): string[] {
  const paths: string[] = [];
  let inPaths = false;
  for (const line of contract.split("\n")) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(line)) break;
    const match = /^ {2}(\/\S*):\s*$/.exec(line);
    if (inPaths && match?.[1]) paths.push(match[1]);
  }
  return paths;
}

/** `{waslaPublicId}` → `:waslaPublicId`, the only difference between the two dialects. */
function toFastifyPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

/** The operations declared under one contract path, as `METHOD /path`. */
function contractOperations(): Set<string> {
  const operations = new Set<string>();
  let current: string | null = null;
  let inPaths = false;
  for (const line of contract.split("\n")) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    if (/^\S/.test(line)) break;
    const path = /^ {2}(\/\S*):\s*$/.exec(line);
    if (path?.[1]) {
      current = path[1];
      continue;
    }
    const method = /^ {4}(get|post|patch|put|delete):\s*$/.exec(line);
    if (method?.[1] && current) {
      operations.add(`${method[1].toUpperCase()} ${toFastifyPath(current)}`);
    }
  }
  return operations;
}

/**
 * What Fastify really serves, read back from its own router.
 *
 * Reading the router rather than a hand-kept list is the whole point: a list would be a
 * third place to forget, and the guard would then prove that two lists agree while the
 * server does something else. `HEAD` is dropped because Fastify derives it from `GET`
 * automatically and no contract declares it.
 */
async function registeredOperations(): Promise<Set<string>> {
  const app = createDriverApp({ runner: createDirectRunner(environment()) });
  await app.ready();
  const tree = app.printRoutes({ commonPrefix: false });
  await app.close();

  const operations = new Set<string>();
  const segments: string[] = [];
  for (const line of tree.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^([^/]*)(\S+?)(?: \(([^)]*)\))?$/u.exec(line);
    if (!match) continue;
    const [, glyphs = "", segment = "", methods] = match;
    const depth = Math.floor(glyphs.length / 4);
    segments.length = depth;
    segments[depth] = segment;
    if (!methods) continue;
    const path = segments.join("");
    for (const method of methods.split(", ")) {
      if (method !== "HEAD") operations.add(`${method} ${path}`);
    }
  }
  return operations;
}

/** The `properties:` names of one schema — schemas at indent 4, properties at 8. */
function propertyKeys(schemaName: string): string[] {
  const start = contract.indexOf(`\n    ${schemaName}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = contract.slice(start + 1);
  const end = rest.search(/\n {4}\w/);
  const block = end === -1 ? rest : rest.slice(0, end);
  const propertiesAt = block.indexOf("\n      properties:\n");
  if (propertiesAt === -1) return [];
  const properties = block.slice(propertiesAt + 1);
  const keys: string[] = [];
  for (const line of properties.split("\n").slice(1)) {
    if (/^ {1,6}\S/.test(line)) break;
    const match = /^ {8}(\w+):/.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

describe("حارس التباعد: المسارات المسجَّلة والعقد", () => {
  it("كلّ عملية في العقد لها مسار مسجَّل فعلاً", async () => {
    const registered = await registeredOperations();
    const missing = [...contractOperations()].filter((operation) => !registered.has(operation));
    expect(missing).toEqual([]);
  });

  it("كلّ مسار مسجَّل مُعلَن في العقد — لا نقطة نهاية غير موثَّقة", async () => {
    const declared = contractOperations();
    const extra = [...(await registeredOperations())].filter(
      (operation) => !declared.has(operation),
    );
    expect(extra).toEqual([]);
  });

  it("العقد يُعلن ثلاثة عشر مساراً، وهو العدد الذي تعهّدت به MR 4/6", () => {
    expect(contractPaths()).toHaveLength(13);
  });
});

/**
 * The zone item's fields, which live INLINE in the `replaceDriverZones` request body
 * rather than in `components/schemas`.
 *
 * Extracted from where they are instead of being copied here, for the same reason as
 * everything else in this file: a copy is a second source of truth, and the guard would
 * then pass while the contract said something else.
 */
function inlineZoneItemKeys(): string[] {
  const start = contract.indexOf("operationId: replaceDriverZones");
  expect(start).toBeGreaterThan(-1);
  const block = contract.slice(start, contract.indexOf("\n  /", start));
  const itemsAt = block.indexOf("\n                  items:\n");
  expect(itemsAt).toBeGreaterThan(-1);
  const keys: string[] = [];
  for (const line of block.slice(itemsAt + 1).split("\n").slice(1)) {
    if (/^ {1,18}\S/.test(line)) break;
    const match = /^ {22}(\w+):/.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

describe("حارس التباعد: قوائم مفاتيح الطلب", () => {
  // Both directions, per schema: a key the contract declares and the parser rejects
  // makes a documented request impossible; a key the parser accepts and the contract
  // does not declare is an undocumented field a caller will come to depend on.
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ["DriverRegistration", DRIVER_REGISTRATION_KEYS],
    ["DriverProfilePatch", DRIVER_PROFILE_PATCH_KEYS],
    ["VehicleRegistration", VEHICLE_REGISTRATION_KEYS],
    ["VehiclePatch", VEHICLE_PATCH_KEYS],
    ["DocumentSubmission", DOCUMENT_SUBMISSION_KEYS],
    ["DocumentReview", DOCUMENT_REVIEW_KEYS],
    ["AvailabilityUpdate", AVAILABILITY_UPDATE_KEYS],
    ["SuspensionRequest", SUSPENSION_REQUEST_KEYS],
  ];

  for (const [schema, accepted] of cases) {
    it(`${schema}: المفاتيح المقبولة هي حقول العقد نفسها`, () => {
      expect([...accepted].sort()).toEqual(propertyKeys(schema).sort());
    });
  }

  it("عنصر المنطقة: المفاتيح المقبولة هي حقول العقد الضمنية نفسها", () => {
    expect([...ZONE_ITEM_KEYS].sort()).toEqual(inlineZoneItemKeys().sort());
  });
});
