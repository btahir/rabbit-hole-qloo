import type { Entity, Generation } from "./types";

/** Reject a recognizable synopsis borrowed from another returned door.
 * This is a conservative mix-up guard, not a general fact checker. */
export function borrowsOtherDoorFacts(
  line: string,
  destination: Entity,
  candidates: Entity[],
  anchor: Entity,
): boolean {
  const ignored = new Set(
    "about after again also another before between both each from have into like more same than that their them then there these they this those through what when where which while with would your".split(
      " ",
    ),
  );
  const words = (text: string) =>
    new Set(
      (text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter(
        (word) => !ignored.has(word),
      ),
    );
  const anchorWords = words(
    `${anchor.name} ${anchor.narrativeFacts ?? anchor.description ?? ""}`,
  );
  const sentence = [...words(line)].filter((word) => !anchorWords.has(word));
  const overlap = (entity: Entity) => {
    const facts = words(
      `${entity.name} ${entity.narrativeFacts ?? entity.description ?? ""}`,
    );
    return sentence.filter((word) => facts.has(word)).length;
  };
  const own = overlap(destination);
  return (
    own < 2 &&
    candidates.some(
      (other) =>
        other.id !== destination.id && overlap(other) >= Math.max(3, own + 2),
    )
  );
}

/** Old trails and the explicitly local guide have no model narration. */
export function connectionLine(entity: Entity, generation: Generation): string {
  return (
    generation.connections?.[entity.id] ??
    (generation.discovery.source === "synthetic"
      ? `An illustrative turn from ${generation.anchor.name} to ${entity.name}.`
      : fallbackConnection(entity, generation.anchor))
  );
}

export function rankingChange(
  generation: Generation,
  entity?: Entity,
): string | undefined {
  if (!generation.ranking) return undefined;
  const before = generation.discovery.results;
  const after = generation.ranking.results;
  if (entity) {
    const a = before.find((r) => r.id === entity.id)?.position;
    const b = after.find((r) => r.id === entity.id)?.position;
    if (a && b)
      return a === b
        ? `Your favourites check kept this at number ${b}.`
        : `Your favourites moved this from number ${a} to number ${b}.`;
  }
  const first = before.slice(0, 3).map((r) => r.id);
  const next = after.slice(0, 3).map((r) => r.id);
  if (first.join() === next.join())
    return "Your favourites check kept the same three doors in the same order.";
  if (next.length === 3 && next.every((id) => first.includes(id)))
    return "Your favourites brought the same three doors into a new order.";
  const name = (id: string) => generation.pool.find((e) => e.id === id)?.name;
  const added = next
    .filter((id) => !first.includes(id))
    .map(name)
    .filter(Boolean);
  const removed = first
    .filter((id) => !next.includes(id))
    .map(name)
    .filter(Boolean);
  return added.length && removed.length
    ? `Favourites check: ${added.join(" and ")} replaced ${removed.join(" and ")}.`
    : "Your favourites changed the first three doors.";
}

/** An honest, source-only bridge when model copy is absent or rejected. */
export function fallbackConnection(entity: Entity, anchor: Entity): string {
  const fact = (entity.narrativeFacts ?? entity.description)?.match(
    /^(.{12,130}?[.!?])(?:\s|$)/,
  )?.[1];
  return fact
    ? `From ${anchor.name}: ${fact}`
    : `From ${anchor.name}, the next turn is ${entity.name}.`;
}

export function rankingHeadline(generation: Generation): string | undefined {
  if (!generation.ranking) return;
  const before = generation.discovery.results.slice(0, 3).map((r) => r.id);
  const added = generation.ranking.results
    .slice(0, 3)
    .filter((r) => !before.includes(r.id));
  if (added.length)
    return `Your favourites brought ${added.length === 1 ? "one new door" : `${added.length} new doors`} into these three.`;
  return generation.ranking.results
    .slice(0, 3)
    .map((r) => r.id)
    .join() === before.join()
    ? "These three also connect with your favourites."
    : "Your favourites changed which door comes first.";
}
