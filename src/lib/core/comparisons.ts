import { fixtureCatalog, samples } from "./fixtures";
import type { Entity, Medium, Evidence } from "./types";
export interface ComparisonCase {
  evaluationId?: string;
  id: string;
  title: string;
  seed: Entity;
  destination: Medium;
  frozenAt: string;
  catalogVersion: string;
  promptVersion: string;
  model: string;
  source: "synthetic" | "qloo";
  catalog: Entity[];
  eligibleIds?: string[];
  arms: {
    condition: "with" | "without";
    entities: Entity[];
    status: "illustrative" | "empty" | "ok" | "failed";
    note: string;
    evidence?: Evidence;
  }[];
  study?: { participants: number; observations: string[] };
  constraints: { loves: string[]; excluded: string[]; lessObvious: boolean };
}
const cases: [string, Entity, Medium][] = [
  ["mood-for-love", samples[0], "artist"],
  ["prince", samples[1], "book"],
  ["left-hand", samples[2], "movie"],
  [
    "nina-simone",
    fixtureCatalog.find((e) => e.name === "Nina Simone")!,
    "book",
  ],
  ["kindred", fixtureCatalog.find((e) => e.name === "Kindred")!, "movie"],
];
export const comparisons: ComparisonCase[] = cases.map(
  ([id, seed, destination], index) => {
    const catalog = fixtureCatalog.filter((e) => e.medium === destination);
    const without = [catalog[1], catalog[4], catalog[7]];
    const withAffinity =
      index === 3
        ? []
        : index === 4
          ? without
          : [catalog[2], catalog[6], catalog[9]];
    return {
      id,
      title: `${seed.name} → ${destination === "artist" ? "music" : destination === "movie" ? "films" : "books"}`,
      seed,
      destination,
      frozenAt: "2026-10-17T00:00:00.000Z",
      catalogVersion: "authored-synthetic-catalog-1",
      promptVersion: "comparison-protocol-1",
      model: "deterministic illustration; no model ran",
      source: "synthetic",
      catalog,
      constraints: { loves: [], excluded: [seed.id], lessObvious: false },
      arms: [
        {
          condition: "with",
          entities: withAffinity,
          status: withAffinity.length ? "illustrative" : "empty",
          note:
            index === 3
              ? "Illustrates poor/empty coverage; not an observed Qloo failure."
              : "Illustrative connections; live Qloo affinity arm has not run.",
        },
        {
          condition: "without",
          entities: without,
          status: "illustrative",
          note: "Illustrative metadata-only arm; no model ran.",
        },
      ],
    };
  },
);
export function comparisonDifference(item: ComparisonCase) {
  const a =
    item.arms
      .find((arm) => arm.condition === "with")
      ?.entities.map((e) => e.id) ?? [];
  const b =
    item.arms
      .find((arm) => arm.condition === "without")
      ?.entities.map((e) => e.id) ?? [];
  if (a.join(",") === b.join(",")) return "Both versions chose the same doors.";
  const overlap = a.filter((id) => b.includes(id)).length;
  if (a.length === b.length && overlap === a.length) {
    const changes = a.flatMap((id, index) =>
      b[index] === id
        ? []
        : [
            `${item.catalog.find((e) => e.id === id)?.name ?? id}: ${b.indexOf(id) + 1} → ${index + 1}`,
          ],
    );
    return `The same doors in a different order. Positions without → with affinity: ${changes.join("; ")}.`;
  }
  return `${overlap} shared ${overlap === 1 ? "door" : "doors"}; ${a.filter((id) => !b.includes(id)).length} only with affinity; ${b.filter((id) => !a.includes(id)).length} only without affinity. ${item.source === "synthetic" ? "These are illustrative sets." : ""}`;
}
