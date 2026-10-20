import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { setup, key } from "./helpers";
import {
  TurnTools,
  createBoundedAgent,
  runLocalGuide,
} from "../src/lib/core/agent";
import {
  qlooPort,
  type DiscoveryResult,
  type QlooPort,
} from "../src/lib/core/qloo";
import { AppError } from "../src/lib/core/errors";
async function tools(requested: "auto" | "book" = "auto") {
  const c = await setup(),
    trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  const port = qlooPort({
    storage: c.storage,
    owner: c.owner,
    mode: "fixture",
    runId: key(),
  });
  const events: string[] = [];
  const turn = new TurnTools(trail, requested, true, port, async (e) => {
    events.push(e);
  });
  return { c, trail, port, events, turn };
}
beforeEach(() => vi.stubEnv("QLOO_MODE", "fixture"));
describe("narrow agent tools", () => {
  it("forbids locked-medium changes, same-medium hops, reordering, fabricated IDs and extra Insights", async () => {
    const { turn } = await tools("book");
    await expect(turn.discoverDoors("artist")).rejects.toThrow();
    await expect(turn.discoverDoors("movie")).rejects.toThrow();
    await turn.discoverDoors("book");
    expect(() => turn.publishDoors(["invented"])).toThrow();
    expect(() =>
      turn.publishDoors(turn.discovery!.entities.map((e) => e.id).reverse()),
    ).toThrow();
    await expect(turn.discoverDoors("artist")).rejects.toThrow();
    turn.publishDoors(turn.discovery!.entities.map((e) => e.id));
    expect(turn.published!.lessObvious).toBe(true);
  });
  it("separates rank evidence from single-anchor discovery and only uses explicit loves", async () => {
    const { turn } = await tools();
    await turn.discoverDoors("artist");
    await expect(
      turn.rankDoors(turn.discovery!.entities.map((e) => e.id)),
    ).rejects.toThrow();
    turn.trail.loves.push(turn.discovery!.entities[0]);
    await turn.rankDoors(turn.discovery!.entities.map((e) => e.id));
    turn.publishDoors(turn.ranking!.entities.map((e) => e.id));
    expect(turn.published!.discovery.loves).toEqual([]);
    expect(turn.published!.ranking!.loves).toHaveLength(2);
    expect(
      turn.published!.pool.every((e) =>
        turn.published!.discovery.results.some((r) => r.id === e.id),
      ),
    ).toBe(true);
  });
  it("does not treat discovery failures as empty; failed ranking may disclose the original order", async () => {
    const { trail, port, events } = await tools();
    const failed = new TurnTools(
      trail,
      "auto",
      false,
      {
        ...port,
        insights: async () => {
          throw new AppError("qloo", 502);
        },
      },
      async (e) => {
        events.push(e);
      },
    );
    await expect(runLocalGuide(failed)).rejects.toMatchObject({ code: "qloo" });
    expect(failed.published).toBeUndefined();
    expect(() => failed.publishDoors([])).toThrow();
  });
  it("recovers only after observing a valid empty collection and never loosens explicit popularity", async () => {
    const { trail, port, events } = await tools();
    let attempts = 0;
    const spy = vi.fn<QlooPort["insights"]>(async (input) => {
      const result = await port.insights(input);
      attempts++;
      return attempts === 1
        ? {
            ...result,
            entities: [],
            evidence: { ...result.evidence, results: [] },
          }
        : result;
    });
    const turn = new TurnTools(
      trail,
      "auto",
      true,
      { ...port, insights: spy },
      async (e) => {
        events.push(e);
      },
    );
    await runLocalGuide(turn);
    expect(spy.mock.calls.map((c) => c[0].medium)).toEqual(["artist", "book"]);
    expect(spy.mock.calls.every((c) => c[0].lessObvious)).toBe(true);
    expect(turn.published!.medium).toBe("book");
    attempts = 0;
    const locked = new TurnTools(
      trail,
      "book",
      true,
      { ...port, insights: spy },
      async () => {},
    );
    await runLocalGuide(locked);
    expect(locked.asked).toBe("artist");
    expect(locked.published).toBeUndefined();
  });
  it("uses the actual ToolLoopAgent with a mock model observing empty before choosing its recovery tool", async () => {
    const { trail, port, events } = await tools();
    let query = 0,
      step = 0;
    const insight = async (
      input: Parameters<QlooPort["insights"]>[0],
    ): Promise<DiscoveryResult> => {
      const result = await port.insights(input);
      return ++query === 1
        ? {
            ...result,
            entities: [],
            evidence: { ...result.evidence, results: [] },
          }
        : result;
    };
    const turn = new TurnTools(
      trail,
      "auto",
      false,
      { ...port, insights: insight },
      async (e) => {
        events.push(e);
      },
    );
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const current = ++step;
        const base = {
          warnings: [],
          usage: {
            inputTokens: {
              total: 100,
              noCache: 100,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
        };
        if (current === 4)
          return {
            ...base,
            content: [{ type: "text", text: '{"action":"publish"}' }],
            finishReason: { unified: "stop", raw: undefined },
          };
        if (current === 2) {
          const content = options.prompt.at(-1)!.content;
          const text =
            typeof content === "string"
              ? content
              : content
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("");
          expect(JSON.parse(text).result.status).toBe("empty");
        }
        const toolName = current === 3 ? "publishDoors" : "discoverDoors";
        const input =
          current === 3
            ? {
                connections: turn.discovery!.entities.map((e, index) => ({
                  door: index + 1,
                  sentence: `Try ${e.name} from here.`,
                })),
              }
            : { medium: current === 1 ? "artist" : "book" };
        return {
          ...base,
          content: [
            {
              type: "tool-call",
              toolCallId: `call-${current}`,
              toolName,
              input: JSON.stringify(input),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
        };
      },
    });
    const agent = createBoundedAgent(turn, model, async () => {});
    await agent.generate({ prompt: "Find doors from the confirmed anchor." });
    expect(step).toBe(3);
    expect(turn.published!.medium).toBe("book");
    expect(query).toBe(2);
  });
  it("blocks a fifth model step and oversize model input before it reaches the provider", async () => {
    const { turn } = await tools();
    const model = new MockLanguageModelV4();
    await expect(
      createBoundedAgent(turn, model, async () => {}).generate({
        prompt: "x".repeat(8001),
      }),
    ).rejects.toMatchObject({ code: "model" });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("model loop ceiling", () => {
  it("stops a model that keeps requesting tools after four steps", async () => {
    const { turn } = await tools();
    let step = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: `repeat-${++step}`,
            toolName: "discoverDoors",
            input: '{"medium":"artist"}',
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        warnings: [],
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
      }),
    });
    try {
      await createBoundedAgent(turn, model, async () => {}).generate({
        prompt: "Find doors.",
      });
    } catch {
      /* no valid final structured output */
    }
    expect(step).toBe(4);
    expect(turn.calls).toBe(1);
  });
});
