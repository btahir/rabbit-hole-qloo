import { expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  createBoundedAgent,
  TurnTools,
  agentTools,
} from "../src/lib/core/agent";
import { publicGeneration } from "../src/lib/core/service";
import { rankingChange } from "../src/lib/core/connections";
import { qlooPort } from "../src/lib/core/qloo";
import { setup } from "./helpers";

it("binds narration to the returned pool and shares only the chosen connection", async () => {
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
  const ids = turn.discovery!.entities.map((e) => e.id);
  expect(() =>
    turn.publishDoors(ids, ["Only one sentence for a full pool."]),
  ).toThrow();
  const lines = ids.map((_, i) => `A public connection for door ${i}.`);
  turn.publishDoors(ids, lines);
  const selected = turn.published!.pool[1];
  const shared = publicGeneration(turn.published!, selected);
  expect(shared.connections).toEqual({ [selected.id]: lines[1] });
  expect(shared.pool).toEqual([selected]);
  expect(shared.ranking).toBeUndefined();
});

it("does not publish a private favourite in the shared story", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  trail.loves.push({
    ...trail.root,
    id: "private-love",
    name: "Private favourite",
  });
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
    ids.map(() => "Your Private favourite led to this."),
  );
  expect(turn.published!.connections).toEqual({});
});

it("gives the model no authority to choose membership or order at publication", async () => {
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
  const tools = agentTools(turn);
  // SDK schemas reject the obsolete model-supplied UUID list.
  expect(
    (
      tools.publishDoors.inputSchema as {
        safeParse: (v: unknown) => { success: boolean };
      }
    ).safeParse({ candidateIds: ["invented"] }).success,
  ).toBe(false);
  turn.publishDoors(turn.discovery!.entities.map((e) => e.id));
  const generation = turn.published!;
  generation.ranking = structuredClone(generation.discovery);
  expect(rankingChange(generation)).toContain("same order");
  generation.ranking.results = [...generation.discovery.results]
    .reverse()
    .map((r, i) => ({ ...r, position: i + 1 }));
  expect(rankingChange(generation, generation.pool[0])).toContain(
    `from number 1 to number ${generation.pool.length}`,
  );
});

it("fits long catalog metadata inside the fixed prompt budget without dropping doors", async () => {
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
        result.entities.forEach((e) => {
          e.description =
            "A long description with multilingual characters 漢字. ".repeat(10);
        });
        return result;
      },
    },
    async () => {},
  );
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const first = calls++ === 0;
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: `step-${calls}`,
            toolName: first ? "discoverDoors" : "publishDoors",
            input: JSON.stringify(
              first
                ? { medium: "artist" }
                : {
                    connections: turn.discovery!.entities.map((e, index) => ({
                      door: index + 1,
                      sentence: "A public connection from the anchor.",
                    })),
                  },
            ),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        warnings: [],
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
      };
    },
  });
  await createBoundedAgent(turn, model, async () => {}).generate({
    prompt: "Find doors.",
  });
  expect(calls).toBe(2);
  expect(turn.published!.pool).toHaveLength(12);
});
