import { afterEach, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { setup } from "./helpers";
import { TurnTools, createBoundedAgent } from "../src/lib/core/agent";
import { qlooPort, QLOO_DECODER } from "../src/lib/core/qloo";
import { AppError } from "../src/lib/core/errors";
import { agentInput } from "../src/lib/core/runs";

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};
afterEach(() => vi.restoreAllMocks());

it.each(["invalid_seed", "configuration", "limit"] as const)(
  "preserves terminal Qloo %s through the SDK without another model request",
  async (code) => {
    const c = await setup();
    const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
    const port = qlooPort({
      storage: c.storage,
      owner: c.owner,
      mode: "fixture",
    });
    const failure = new AppError(code, code === "limit" ? 429 : 503, 123456);
    const insights = vi.fn(async () => {
      throw failure;
    });
    const turn = new TurnTools(
      trail,
      "auto",
      false,
      { ...port, insights },
      async () => {},
    );
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: "discovery",
            toolName: "discoverDoors",
            input: JSON.stringify({ medium: "artist" }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        warnings: [],
        usage,
      }),
    });
    const steps = vi.fn(async () => {});
    await expect(
      createBoundedAgent(turn, model, steps).generate({ prompt: "Find doors" }),
    ).rejects.toBe(failure);
    expect(steps).toHaveBeenCalledTimes(1);
    expect(insights).toHaveBeenCalledTimes(1);
    expect(turn.published).toBeUndefined();
  },
);

it("never offers an already exhausted open direction to the model", async () => {
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
        return { entities: [], evidence: { ...result.evidence, results: [] } };
      },
    },
    async () => {},
  );
  const available: string[][] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      available.push((options.tools ?? []).map((t) => t.name));
      const n = available.length;
      if (n === 3) expect(() => turn.askDirection()).toThrow();
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: `step-${n}`,
            toolName: n < 3 ? "discoverDoors" : "publishDoors",
            input: JSON.stringify(
              n < 3
                ? { medium: n === 1 ? "artist" : "book" }
                : { connections: [] },
            ),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        warnings: [],
        usage,
      };
    },
  });
  await createBoundedAgent(turn, model, async () => {}).generate({
    prompt: "Find doors",
  });
  expect(turn.calls).toBe(2);
  expect(turn.published?.pool).toEqual([]);
  expect(available.every((names) => !names.includes("askDirection"))).toBe(
    true,
  );
  expect(() => turn.askDirection()).toThrow();
});

it("uses the same decoder identifier for evidence and run telemetry", async () => {
  const c = await setup();
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: c.trail.version,
    intent: "generate",
    idempotencyKey: "decoder-check",
  });
  const accepted = await c.runs.begin(c.owner, c.ip, input);
  await c.runs.execute(
    c.owner,
    accepted.run.id,
    input,
    accepted.trail,
    () => {},
  );
  const result = await c.runs.read(c.owner, accepted.run.id);
  expect(result.telemetry?.decoderVersion).toBe(QLOO_DECODER);
  expect(result.trail.current?.discovery.decoder).toBe(QLOO_DECODER);
});

it("requires clarification after a locked empty query, including at the tool boundary", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  const port = qlooPort({
    storage: c.storage,
    owner: c.owner,
    mode: "fixture",
  });
  const turn = new TurnTools(
    trail,
    "book",
    false,
    {
      ...port,
      insights: async (input) => {
        const result = await port.insights(input);
        return { entities: [], evidence: { ...result.evidence, results: [] } };
      },
    },
    async () => {},
  );
  let step = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const first = step++ === 0;
      if (!first) {
        expect((options.tools ?? []).map((tool) => tool.name)).toEqual([
          "askDirection",
        ]);
        expect(() => turn.publishDoors([])).toThrow();
      }
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: `step-${step}`,
            toolName: first ? "discoverDoors" : "askDirection",
            input: JSON.stringify(first ? { medium: "book" } : {}),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        warnings: [],
        usage,
      };
    },
  });
  await createBoundedAgent(turn, model, async () => {}).generate({
    prompt: "Find books",
  });
  expect(turn.asked).toBe("artist");
  expect(turn.published).toBeUndefined();
});

it.each(["limit", "paused", "timeout"] as const)(
  "preserves terminal %s during ranking without publishing the discovery",
  async (code) => {
    const c = await setup();
    const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
    const { samples } = await import("../src/lib/core/fixtures");
    trail.loves.push(samples[1]);
    const port = qlooPort({
      storage: c.storage,
      owner: c.owner,
      mode: "fixture",
    });
    const failure = new AppError(code, 503, 123456);
    const turn = new TurnTools(
      trail,
      "auto",
      false,
      {
        ...port,
        insights: async (input) => {
          if (input.candidates) throw failure;
          return port.insights(input);
        },
      },
      async () => {},
    );
    let step = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        const first = step++ === 0;
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `step-${step}`,
              toolName: first ? "discoverDoors" : "rankDoors",
              input: JSON.stringify(first ? { medium: "artist" } : {}),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          warnings: [],
          usage,
        };
      },
    });
    await expect(
      createBoundedAgent(turn, model, async () => {}).generate({
        prompt: "Find doors",
      }),
    ).rejects.toBe(failure);
    expect(step).toBe(2);
    expect(turn.published).toBeUndefined();
  },
);
