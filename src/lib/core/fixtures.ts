import type { Entity, Medium, Mode } from "./types";
import { fixtureMetadata } from "./fixture-metadata";
const checkedAt = "2026-10-17T00:00:00.000Z";
// Authored illustrative catalog, never recorded Qloo output. No affinity values.
const titles: Record<Medium, (string | [string, number | string])[]> = {
  movie: [
    ["In the Mood for Love", 2000],
    ["After Life", 1998],
    ["Arrival", 2016],
    ["Stalker", 1979],
    ["Spirited Away", 2001],
    ["Amélie", 2001],
    ["Daughters of the Dust", 1991],
    ["Paris, Texas", 1984],
    ["Moonlight", 2016],
    ["Wings of Desire", 1987],
    ["The Red Shoes", 1948],
    ["The Spirit of the Beehive", 1973],
  ],
  artist: [
    "Prince",
    "Cocteau Twins",
    "Nina Simone",
    "Sade",
    "David Bowie",
    "Alice Coltrane",
    "Björk",
    "Talk Talk",
    "Ryuichi Sakamoto",
    "Joni Mitchell",
    "Kate Bush",
    "Nusrat Fateh Ali Khan",
  ],
  book: [
    ["The Left Hand of Darkness", "Ursula K. Le Guin"],
    ["Kitchen", "Banana Yoshimoto"],
    ["Jazz", "Toni Morrison"],
    ["Kindred", "Octavia E. Butler"],
    ["Piranesi", "Susanna Clarke"],
    ["The Dispossessed", "Ursula K. Le Guin"],
    ["Beloved", "Toni Morrison"],
    ["Invisible Cities", "Italo Calvino"],
    ["The Waves", "Virginia Woolf"],
    ["The Summer Book", "Tove Jansson"],
    ["Giovanni’s Room", "James Baldwin"],
    ["The Woman in the Dunes", "Kōbō Abe"],
  ],
};
export const fixtureCatalog: Entity[] = Object.entries(titles).flatMap(
  ([medium, rows], group) =>
    rows.map((row, i) => ({
      id: `fixture:00000000-0000-4000-${String(group).padStart(4, "0")}-${String(i + 1).padStart(12, "0")}`,
      medium: medium as Medium,
      name: typeof row === "string" ? row : row[0],
      ...(Array.isArray(row) && typeof row[1] === "number"
        ? { year: row[1] }
        : {}),
      ...(Array.isArray(row) && typeof row[1] === "string"
        ? { author: row[1] }
        : {}),
      ...fixtureMetadata[typeof row === "string" ? row : row[0]],
      source: "Synthetic example" as const,
      checkedAt,
      schemaVersion: 1 as const,
    })),
);
export const samples = [
  fixtureCatalog[0],
  fixtureCatalog[12],
  fixtureCatalog[24],
];
export function configuredMode(): Mode {
  return process.env.QLOO_MODE === "fixture" || !process.env.QLOO_API_KEY
    ? "fixture"
    : "live";
}
export function fixtureSearch(query: string, medium: Medium) {
  return fixtureCatalog
    .filter(
      (e) =>
        e.medium === medium &&
        e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .slice(0, 5);
}
export function fixturePool(
  anchor: Entity,
  medium: Medium,
  excluded: string[],
  lessObvious: boolean,
) {
  const rows = fixtureCatalog.filter(
    (e) => e.medium === medium && !excluded.includes(e.id),
  );
  // Deterministic, illustrative alternatives. This is not a popularity simulation.
  const offset =
    (anchor.name.length + (lessObvious ? 3 : 0)) % Math.max(rows.length, 1);
  return [...rows.slice(offset), ...rows.slice(0, offset)].slice(0, 12);
}
