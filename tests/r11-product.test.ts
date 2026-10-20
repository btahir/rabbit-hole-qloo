import { expect, it } from "vitest";
import { normalizeEntity } from "../src/lib/core/entities";
import { entitySchema } from "../src/lib/qloo/schemas";
import { narrativeFact, TurnTools } from "../src/lib/core/agent";
import { qlooPort } from "../src/lib/core/qloo";
import { connectionLine, rankingHeadline } from "../src/lib/core/connections";
import { eligibleSuggestion } from "../src/lib/core/suggestion-policy";
import { setup } from "./helpers";
it("preserves a complete fact through normalization and the actual model projection", async () => {
  const text =
    "A composer builds elaborate orchestral arrangements for a small ensemble, recording every instrument together in an old theatre and returning to the same musicians for each performance.";
  const entity = normalizeEntity(
    entitySchema.parse({
      entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "A composer",
      types: ["urn:entity:artist"],
      properties: {
        description: `<i>${text}</i> A final unfinished fragment…`,
      },
    }),
    "artist",
    new Date().toISOString(),
  );
  expect(entity.description!.length).toBeLessThanOrEqual(160);
  expect(entity.narrativeFacts).toBe(text);
  expect(narrativeFact(entity.description)).toBeUndefined();
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  const turn = new TurnTools(
    trail,
    "auto",
    false,
    qlooPort({ storage: c.storage, owner: c.owner, mode: "fixture" }),
    async () => {},
  );
  await turn.discoverDoors("artist");
  turn.discovery!.entities[0] = entity;
  expect(turn.compact(turn.discovery!).candidates[0].description).toBe(text);
});
it("keeps rejected narration useful without leaking the private favourite", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  trail.loves.push({ ...trail.root, id: "private", name: "Secret favourite" });
  const turn = new TurnTools(
    trail,
    "auto",
    false,
    qlooPort({ storage: c.storage, owner: c.owner, mode: "fixture" }),
    async () => {},
  );
  await turn.discoverDoors("artist");
  const ids = turn.discovery!.entities.map((e) => e.id);
  turn.publishDoors(
    ids,
    ids.map(() => "Secret favourite is your hidden connection."),
  );
  turn.published!.discovery.source = "qloo";
  const lines = turn
    .published!.pool.slice(0, 3)
    .map((e) => connectionLine(e, turn.published!));
  expect(new Set(lines).size).toBe(3);
  expect(lines.join()).not.toContain("Secret favourite");
  expect(lines.every((line) => line.includes(trail.root.name))).toBe(true);
});
it("does not offer the known seed-invalid Prince book as an onward door", () => {
  expect(
    eligibleSuggestion(
      entitySchema.parse({
        entity_id: "BF077E87-9221-451E-A4A3-61A5475C1671",
        name: "One Flew Over the Cuckoo's Nest",
        types: ["urn:entity:book"],
      }),
    ),
  ).toBe(false);
});
it("surfaces actual changed membership without asserting a reason Qloo did not return", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  const turn = new TurnTools(
    trail,
    "auto",
    false,
    qlooPort({ storage: c.storage, owner: c.owner, mode: "fixture" }),
    async () => {},
  );
  await turn.discoverDoors("artist");
  turn.publishDoors(turn.discovery!.entities.map((e) => e.id));
  const generation = turn.published!;
  generation.ranking = {
    ...generation.discovery,
    results: [...generation.discovery.results.slice(2, 5)],
  };
  expect(rankingHeadline(generation)).toBe(
    "Your favourites brought 2 new doors into these three.",
  );
});
