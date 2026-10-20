import { createHash } from "node:crypto";
/** Immutable entity, generation and evidence objects occur in steps, history and
 * undo. Store their content once per record; distinct same-ID versions stay distinct.
 * The wire projection remains unchanged. No private payload is moved to an index. */
export function encodeRecord(value: unknown): string {
  const records: Record<string, unknown> = {};
  function visit(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object") return input;
    const object = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(object)) {
      if (key === "snapshot" && object.kind && typeof child === "string")
        result[key] = { $undo: visit(JSON.parse(child)) };
      else result[key] = visit(child);
    }
    if (
      typeof object.id === "string" &&
      (object.schemaVersion === 1 ||
        object.discovery ||
        object.endpoint === "/v2/insights")
    ) {
      const key = createHash("sha256")
        .update(JSON.stringify(result))
        .digest("hex")
        .slice(0, 24);
      records[key] ??= result;
      return { $ref: key };
    }
    return result;
  }
  const root = visit(value);
  return JSON.stringify({ format: "rabbit-record-1", root, records });
}
export function decodeRecord(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("format" in value) ||
    value.format !== "rabbit-record-1"
  )
    return value;
  const { root, records } = value as unknown as {
    root: unknown;
    records: Record<string, unknown>;
  };
  function restore(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(restore);
    if (!input || typeof input !== "object") return input;
    const object = input as Record<string, unknown>;
    if (typeof object.$ref === "string") return restore(records[object.$ref]);
    if ("$undo" in object) return JSON.stringify(restore(object.$undo));
    return Object.fromEntries(
      Object.entries(object).map(([key, child]) => [key, restore(child)]),
    );
  }
  return restore(root);
}
