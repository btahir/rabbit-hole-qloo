import "server-only";
import { createHash } from "node:crypto";
import type { ComparisonCase } from "./comparisons";
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
/** Identifies what was actually displayed, including failures and common inputs. */
export function evaluationId(item: ComparisonCase) {
  const { evaluationId: _id, study: _study, ...pair } = item;
  void _id;
  void _study;
  return createHash("sha256")
    .update(JSON.stringify(canonical(pair)))
    .digest("hex");
}
