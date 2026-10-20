import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  executeComparisonArm,
  type FrozenBrief,
} from "../src/lib/core/comparison-runner";
import { comparisons, comparisonDifference } from "../src/lib/core/comparisons";
import { qlooPort } from "../src/lib/core/qloo";
import { MemoryStore } from "../src/lib/core/store";
function model(ids: string[], inspect?: (options: unknown) => void) {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      inspect?.(options);
      return {
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
        ...(step++ === 0
          ? {
              content: [
                {
                  type: "tool-call" as const,
                  toolCallId: "inspect-1",
                  toolName: "inspectCandidates",
                  input: "{}",
                },
              ],
              finishReason: { unified: "tool-calls" as const, raw: undefined },
            }
          : {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ candidateIds: ids }),
                },
              ],
              finishReason: { unified: "stop" as const, raw: undefined },
            }),
      };
    },
  });
}
describe("matched comparison protocol", () => {
  it("freezes five briefs and 12-item catalogs, retains a neutral and an empty arm", () => {
    expect(comparisons).toHaveLength(5);
    expect(comparisons.every((c) => c.catalog.length === 12)).toBe(true);
    expect(
      comparisons.some((c) => c.arms.some((a) => a.status === "empty")),
    ).toBe(true);
    expect(
      comparisons.some(
        (c) =>
          comparisonDifference(c) === "Both versions chose the same doors.",
      ),
    ).toBe(true);
  });
  it("gives both arms identical metadata and never calls Insights from the baseline", async () => {
    const item = comparisons[0],
      catalog = item.catalog.map((entity) => ({
        ...entity,
        description: "FROZEN COMMON DESCRIPTION",
      }));
    const brief: FrozenBrief = {
      id: item.id,
      seed: item.seed,
      medium: item.destination,
      catalog,
      explicitLoves: [],
      exclusions: [item.seed.id],
      lessObvious: false,
      frozenAt: item.frozenAt,
      catalogVersion: item.catalogVersion,
    };
    const port = qlooPort({
      storage: new MemoryStore(),
      owner: "test",
      mode: "fixture",
    });
    const affinity = vi.fn(async () =>
      port.insights({
        anchor: brief.seed,
        medium: brief.medium,
        exclusions: [],
        lessObvious: false,
      }),
    );
    const modelInputs: unknown[] = [];
    const baseline = await executeComparisonArm(brief, "without", {
      model: model(
        catalog.slice(0, 2).map((e) => e.id),
        (options) => modelInputs.push(options),
      ),
      affinity,
      onStep: async () => {},
    });
    expect(baseline.evidence).toBeUndefined();
    expect(affinity).not.toHaveBeenCalled();
    const result = await affinity();
    const ids = result.entities.slice(0, 2).map((e) => e.id);
    let metadataInput = "";
    const affinityInputs: unknown[] = [];
    affinity.mockImplementation(async () => ({
      ...result,
      entities: result.entities.map((entity) => ({
        ...entity,
        description: "UPSTREAM CONFLICT MUST NOT APPEAR",
      })),
    }));
    affinity.mockClear();
    const withQloo = await executeComparisonArm(brief, "with", {
      model: model(ids.slice().reverse(), (options) => {
        metadataInput += JSON.stringify(options);
        affinityInputs.push(options);
      }),
      affinity,
      onStep: async () => {},
    });
    expect(affinity).toHaveBeenCalledTimes(1);
    expect(withQloo.ids).toEqual(ids);
    expect(metadataInput).not.toContain("UPSTREAM CONFLICT MUST NOT APPEAR");
    for (const entity of result.entities)
      expect(metadataInput).toContain(entity.name);
    function candidateHashes(input: unknown): Map<string, string> {
      const hashes = new Map<string, string>();
      function walk(value: unknown) {
        if (typeof value === "string" && value.startsWith("{")) {
          try {
            walk(JSON.parse(value));
          } catch {}
          return;
        }
        if (!value || typeof value !== "object") return;
        const object = value as Record<string, unknown>;
        if (Array.isArray(object.candidates))
          for (const candidate of object.candidates) {
            hashes.set(
              candidate.id,
              createHash("sha256")
                .update(JSON.stringify(candidate))
                .digest("hex"),
            );
            expect(candidate.description).toBe("FROZEN COMMON DESCRIPTION");
          }
        for (const child of Object.values(object)) walk(child);
      }
      walk(input);
      return hashes;
    }
    const baselineHashes = candidateHashes(modelInputs),
      affinityHashes = candidateHashes(affinityInputs);
    expect(baselineHashes.size).toBe(12);
    expect(affinityHashes.size).toBeGreaterThan(0);
    for (const [id, digest] of affinityHashes)
      expect(digest).toBe(baselineHashes.get(id));
    expect(withQloo.evidence?.kind).toBe("discovery");
  });
  it("rejects a fabricated baseline member and unverified popularity comparison before paid execution", async () => {
    const c = comparisons[0],
      brief: FrozenBrief = {
        id: c.id,
        seed: c.seed,
        medium: c.destination,
        catalog: c.catalog,
        explicitLoves: [],
        exclusions: [],
        lessObvious: false,
        frozenAt: c.frozenAt,
        catalogVersion: c.catalogVersion,
      };
    const affinity = vi.fn();
    await expect(
      executeComparisonArm(brief, "without", {
        model: model(["invented"]),
        affinity,
        onStep: async () => {},
      }),
    ).rejects.toMatchObject({ code: "contract" });
    const provider = model([]);
    await expect(
      executeComparisonArm({ ...brief, lessObvious: true }, "without", {
        model: provider,
        affinity,
        onStep: async () => {},
      }),
    ).rejects.toMatchObject({ code: "configuration" });
    expect(provider.doGenerateCalls).toHaveLength(0);
  });
});

it("refuses a live comparison catalog with fewer than twelve commonly eligible choices before either model runs", async () => {
  const item = comparisons[0];
  const brief: FrozenBrief = {
    id: item.id,
    seed: item.seed,
    medium: item.destination,
    catalog: item.catalog.map((e) => ({ ...e, source: "Qloo" })),
    eligibleIds: item.catalog.slice(0, 4).map((e) => e.id),
    explicitLoves: [item.seed],
    exclusions: [],
    lessObvious: false,
    frozenAt: item.frozenAt,
    catalogVersion: item.catalogVersion,
  };
  const onStep = vi.fn();
  const affinity = vi.fn();
  for (const condition of ["with", "without"] as const)
    await expect(
      executeComparisonArm(brief, condition, {
        model: model([]),
        onStep,
        affinity,
      }),
    ).rejects.toMatchObject({ code: "configuration" });
  expect(onStep).not.toHaveBeenCalled();
  expect(affinity).not.toHaveBeenCalled();
});
