import { expect, it } from "vitest";
import { TurnTools, agentTools } from "../src/lib/core/agent";
import { qlooPort } from "../src/lib/core/qloo";
import { setup } from "./helpers";

it("preserves complete narrative facts instead of biography fragments", async () => {
  const { narrativeFact } = await import("../src/lib/core/agent");
  expect(
    narrativeFact("First complete fact. Another longer sentence.", 25),
  ).toBe("First complete fact.");
  expect(
    narrativeFact("One impossibly long sentence with no shorter fact.", 10),
  ).toBeUndefined();
});

it("keeps repeat navigation out of the new-session allowance", async () => {
  const c = await setup();
  const { TrailService } = await import("../src/lib/core/service");
  const service = new TrailService(c.storage);
  for (let i = 0; i < 15; i++) await service.session(c.owner, "shared-ip");
  const fresh = await service.session("another-visitor", "shared-ip");
  expect(fresh.mode).toBeDefined();
});

it("rejects publication before trying the other unlocked empty direction", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  const port = qlooPort({
    storage: c.storage,
    owner: c.owner,
    mode: "fixture",
  });
  const turn = new TurnTools(
    trail,
    "auto",
    false,
    {
      ...port,
      insights: async (input) => {
        const result = await port.insights(input);
        return {
          ...result,
          entities: [],
          evidence: { ...result.evidence, results: [] },
        };
      },
    },
    async () => {},
  );
  await turn.discoverDoors("artist");
  expect(() => turn.publishDoors([], [])).toThrow();
  await turn.discoverDoors("book");
  expect(turn.publishDoors([], []).status).toBe("published");
});

it("binds reordered model sentences to numbered doors without changing Qloo order", async () => {
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
  const entities = turn.discovery!.entities;
  const connections = entities
    .map((e, index) => ({ door: index + 1, sentence: `Try ${e.name} next.` }))
    .reverse();
  const tools = agentTools(turn);
  await tools.publishDoors.execute!(
    { connections },
    { toolCallId: "test", messages: [], context: {} },
  );
  expect(turn.published!.pool.map((e) => e.id)).toEqual(
    entities.map((e) => e.id),
  );
  for (const entity of entities)
    expect(turn.published!.connections![entity.id]).toBe(
      `Try ${entity.name} next.`,
    );
});

it("ignores harmless model annotations without granting them control over a door", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  const turn = new TurnTools(
    trail,
    "auto",
    false,
    qlooPort({ storage: c.storage, owner: c.owner, mode: "fixture" }),
    async () => {},
  );
  const schema = agentTools(turn).publishDoors.inputSchema as {
    parse: (input: unknown) => unknown;
  };
  expect(
    schema.parse({
      connections: [
        {
          door: 1,
          sentence: "A specific public invitation.",
          name: "unused annotation",
          door_placeholder: null,
        },
      ],
    }),
  ).toEqual({
    connections: [{ door: 1, sentence: "A specific public invitation." }],
  });
});
