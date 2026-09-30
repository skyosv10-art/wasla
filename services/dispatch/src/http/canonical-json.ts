/**
 * RISK-0013 (CLM-0417): the wire serializer for every JSON reply of this service.
 *
 * An idempotent replay is read back from a JSONB column, and JSONB does not keep key
 * order; the first answer is serialized from the object the route built. Serializing
 * both through one canonical form (keys sorted at every depth) makes the replay
 * byte-identical to the first answer by construction. Semantics are exactly those of
 * `JSON.stringify` (`toJSON`, `undefined` dropped, non-finite → null) except key order.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value) ?? "null";
}

function serialize(value: unknown): string | undefined {
  if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    value = (value as { toJSON: () => unknown }).toJSON();
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => serialize(item) ?? "null").join(",")}]`;
  const entries: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = serialize((value as Record<string, unknown>)[key]);
    if (item !== undefined) entries.push(`${JSON.stringify(key)}:${item}`);
  }
  return `{${entries.join(",")}}`;
}
