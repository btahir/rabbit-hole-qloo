import { afterEach, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { setup } from "./helpers";
import { TurnTools, runGuide } from "../src/lib/core/agent";
import { qlooPort } from "../src/lib/core/qloo";
import { samples } from "../src/lib/core/fixtures";
const provider = vi.hoisted(() => ({ model: undefined as unknown }));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => () => provider.model,
}));
vi.mock("../src/lib/core/model-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/core/model-config")>()),
  verifiedModelConfig: async () => ({
    model: "openai/test-only",
    input: 0,
    output: 0,
  }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

it.each(["full", "locked-empty", "text-only"])(
  "runs bounded terminal tools through runGuide: %s",
  async (scenario) => {
    const c = await setup();
    const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
    trail.mode = "live";
    trail.loves.push(samples[1]);
    const port = qlooPort({
      storage: c.storage,
      owner: c.owner,
      mode: "fixture",
      runId: "agent-test",
    });
    const insights = vi.fn(
      async (input: Parameters<typeof port.insights>[0]) => {
        const result = await port.insights(input);
        return scenario === "full" && !input.candidates
          ? {
              ...result,
              entities: result.entities.map((e) => ({
                ...e,
                description: undefined,
              })),
            }
          : result;
      },
    );
    const hydration = vi.fn(port.describeEntities);
    if (scenario === "locked-empty")
      insights.mockImplementation(async (input) => {
        const result = await port.insights(input);
        return {
          ...result,
          entities: [],
          evidence: { ...result.evidence, results: [] },
        };
      });
    const turn = new TurnTools(
      trail,
      scenario === "locked-empty" ? "book" : "auto",
      false,
      { ...port, insights, describeEntities: hydration },
      async () => {},
    );
    let count = 0;
    provider.model = new MockLanguageModelV4({
      doGenerate: async () => {
        const n = count++;
        if (scenario === "text-only")
          return {
            content: [{ type: "text", text: '{"action":"publish"}' }],
            finishReason: { unified: "stop", raw: undefined },
            warnings: [],
            usage,
          };
        const toolName =
          scenario === "locked-empty"
            ? ["discoverDoors", "askDirection"][n]
            : [
                "discoverDoors",
                "describeEntities",
                "rankDoors",
                "publishDoors",
              ][n];
        if (!toolName) throw new Error("A fifth model generation is forbidden");
        const input =
          toolName === "discoverDoors"
            ? { medium: scenario === "locked-empty" ? "book" : "artist" }
            : toolName === "describeEntities"
              ? {}
              : toolName === "askDirection"
                ? {}
                : toolName === "rankDoors"
                  ? {}
                  : {
                      connections: turn.discovery!.entities.map((e, index) => ({
                        door: index + 1,
                        sentence: "A new turn from here.",
                      })),
                    };
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `step-${n}`,
              toolName,
              input: JSON.stringify(input),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          warnings: [],
          usage,
        };
      },
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "mock-only");
    const steps = vi.fn(async () => {});
    if (scenario === "text-only") {
      await expect(runGuide(turn, steps)).rejects.toMatchObject({
        code: "model",
      });
      expect(turn.published).toBeUndefined();
    } else {
      await expect(runGuide(turn, steps)).resolves.toMatchObject({
        stub: false,
      });
      expect(count).toBe(scenario === "full" ? 4 : 2);
      expect(insights).toHaveBeenCalledTimes(scenario === "full" ? 2 : 1);
      if (scenario === "full") {
        expect(hydration).toHaveBeenCalledTimes(1);
        expect(turn.published?.personalRankingApplied).toBe(true);
      } else {
        expect(turn.asked).toBe("artist");
        expect(turn.published).toBeUndefined();
      }
    }
  },
);
