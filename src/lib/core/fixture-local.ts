import { fixturePool } from "./fixtures";
import {
  defaultMedium,
  visibleDoors,
  type Generation,
  type Medium,
  type OwnerTrail,
} from "./types";
// Browser-only example interaction. It accepts synthetic records only; it is
// never imported by a live data adapter or used as authoritative server evidence.
export function localGeneration(
  trail: OwnerTrail,
  destination: Medium | "auto",
  lessObvious: boolean,
): OwnerTrail {
  if (trail.counters.runs >= 8)
    throw new Error(
      "This trail has reached its limit. Keep it, or start a new one later.",
    );
  if (trail.mode !== "fixture")
    throw new Error("Live connections require a server.");
  const anchor = trail.steps.at(-1)?.entity ?? trail.root,
    medium =
      destination === "auto"
        ? defaultMedium(trail.root, trail.steps)
        : destination;
  const excluded = [
    trail.root.id,
    ...trail.steps.map((s) => s.entity.id),
    ...trail.excluded.map((x) => x.entity.id),
    ...trail.shown,
  ];
  const pool = fixturePool(anchor, medium, excluded, lessObvious);
  const gen: Generation = {
    id: `local-${crypto.randomUUID()}`,
    runId: "offline-example",
    anchor,
    requested: destination,
    firstMedium: medium,
    medium,
    locked: destination !== "auto",
    lessObvious,
    pool,
    warnings: [],
    checkedAt: "2026-10-17T00:00:00.000Z",
    discovery: {
      id: `local-${crypto.randomUUID()}`,
      runId: "offline-example",
      kind: "discovery",
      anchor,
      endpoint: "/v2/insights",
      medium,
      results: pool.map((e, i) => ({ id: e.id, position: i + 1 })),
      exclusionsCount: excluded.length,
      exclusionsHash: "",
      ...(lessObvious ? { popularityMax: 0.8 } : {}),
      loves: [],
      source: "synthetic",
      cache: "miss",
      checkedAt: "2026-10-17T00:00:00.000Z",
      elapsedMs: 0,
      warnings: [],
      decoder: "synthetic-example-1",
    },
  };
  if (
    trail.loves.length &&
    !(trail.loves.length === 1 && trail.loves[0].id === anchor.id)
  ) {
    gen.pool.reverse();
    gen.ranking = {
      ...gen.discovery,
      kind: "ranking",
      loves: trail.loves,
      results: gen.pool.map((e, i) => ({ id: e.id, position: i + 1 })),
    };
  }
  return {
    ...trail,
    version: trail.version + 1,
    current: gen,
    generations: [...trail.generations, gen],
    shown: [
      ...new Set([...trail.shown, ...gen.pool.slice(0, 3).map((e) => e.id)]),
    ],
    status: "active",
    counters: { ...trail.counters, runs: trail.counters.runs + 1 },
  };
}
export type LocalAction = {
  action: string;
  entityId?: string;
  generationId?: string;
  branchPoint?: number;
};
export function localAction(
  current: OwnerTrail,
  input: LocalAction,
): OwnerTrail {
  const trail = structuredClone(current);
  if (trail.mode !== "fixture")
    throw new Error("Live connections require a server.");
  const entity = [
    trail.root,
    ...trail.steps.map((s) => s.entity),
    ...trail.generations.flatMap((g) => g.pool),
    ...trail.saved,
    ...trail.excluded.map((x) => x.entity),
  ].find((e) => e.id === input.entityId);
  if (input.action === "follow") {
    if (
      !entity ||
      !trail.current ||
      !visibleDoors(trail).some((e) => e.id === entity.id) ||
      trail.steps.length >= 3
    )
      throw new Error("Please check this choice and try again.");
    trail.steps.push({
      entity,
      anchor: trail.current.anchor,
      generation: trail.current,
      selectedAt: new Date().toISOString(),
    });
    delete trail.current;
    trail.status = trail.steps.length === 3 ? "complete" : "active";
    trail.message = `Added ${entity.name} to your trail.`;
  } else if (input.action === "finish") {
    if (!trail.steps.length) throw new Error("Choose a discovery first.");
    trail.status = "complete";
    delete trail.current;
  } else if (input.action === "branch") {
    trail.steps = trail.steps.slice(0, input.branchPoint);
    delete trail.directionRequest;
    trail.generations = trail.steps.map((s) => s.generation);
    delete trail.current;
    trail.status = "draft";
  } else if (entity) {
    if (input.action === "save")
      trail.saved = [...trail.saved.filter((e) => e.id !== entity.id), entity];
    if (input.action === "unsave")
      trail.saved = trail.saved.filter((e) => e.id !== entity.id);
    if (input.action === "love")
      trail.loves = [
        ...trail.loves.filter((e) => e.id !== entity.id),
        entity,
      ].slice(0, 6);
    if (input.action === "unlove")
      trail.loves = trail.loves.filter((e) => e.id !== entity.id);
    if (input.action === "known" || input.action === "reject") {
      trail.excluded.push({ entity, reason: input.action });
      trail.message = `We'll leave ${entity.name} out.`;
    }
    if (input.action === "removeExclusion")
      trail.excluded = trail.excluded.filter((e) => e.entity.id !== entity.id);
  }
  trail.shown = [
    ...new Set([...trail.shown, ...visibleDoors(trail).map((e) => e.id)]),
  ];
  trail.canUndo = true;
  trail.version++;
  return trail;
}

export function newLocalExample(root: import("./types").Entity): OwnerTrail {
  const now = Date.now();
  return {
    id: `local-${crypto.randomUUID()}`,
    mode: "fixture",
    version: 1,
    root,
    status: "draft",
    revision: crypto.randomUUID(),
    steps: [],
    generations: [],
    loves: [root],
    saved: [],
    excluded: [],
    shown: [],
    counters: { runs: 0, insights: 0, attempts: 0, searches: 0 },
    createdAt: now,
    expiresAt: now + 30 * 86400_000,
    canUndo: false,
    sharedVersions: [],
  };
}
