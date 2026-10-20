// Operator-only, explicitly invoked. Never called by rendering or a public route.
import { setTimeout as delay } from "node:timers/promises";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  executeComparisonArm,
  COMPARISON_PROMPT,
  type FrozenBrief,
} from "../src/lib/core/comparison-runner";
import { redisClient, store } from "../src/lib/core/store";
import { TrailService } from "../src/lib/core/service";
import { RunService, agentInput } from "../src/lib/core/runs";
import { claimInsights } from "../src/lib/core/limits";
import { qlooPort } from "../src/lib/core/qloo";
import { randomId, hash } from "../src/lib/core/crypto";
import { comparisons, type ComparisonCase } from "../src/lib/core/comparisons";
import { MODEL, verifiedModelConfig } from "../src/lib/core/model-config";
import { evaluationId } from "../src/lib/core/evaluation-id";
import { assert } from "../src/lib/core/errors";
import { liveIdentitySchema } from "../src/lib/core/activated-samples";
const live = process.argv.includes("--live");
if (!live) {
  await mkdir(".cache", { recursive: true });
  await writeFile(
    ".cache/comparison-results.json",
    JSON.stringify(comparisons, null, 2),
    { mode: 0o600 },
  );
  console.log(
    "Saved five labelled illustrative comparisons. Live arms were not run.",
  );
} else {
  assert(
    process.env.QLOO_API_KEY && process.env.ANTHROPIC_API_KEY,
    "configuration",
    503,
  );
  await verifiedModelConfig();
  const entity = liveIdentitySchema;
  const briefSchema = z
    .object({
      id: z.enum([
        "mood-for-love",
        "prince",
        "left-hand",
        "nina-simone",
        "kindred",
      ]),
      seed: entity,
      medium: z.enum(["movie", "artist", "book"]),
      catalog: z.array(entity).length(12),
      eligibleIds: z.array(z.uuid()).min(1).max(12),
      explicitLoves: z.array(entity).max(6),
      exclusions: z.array(z.uuid()).max(96),
      lessObvious: z.literal(false),
      frozenAt: z.iso.datetime(),
      catalogVersion: z.string().max(100),
    })
    .strict();
  // Owner supplies confirmed canonical identities before observing either arm.
  const briefs = z
    .array(briefSchema)
    .length(5)
    .parse(
      JSON.parse(await readFile(".cache/comparison-briefs.json", "utf8")),
    ) as FrozenBrief[];
  assert(new Set(briefs.map((b) => b.id)).size === 5);
  const storage = store(),
    service = new TrailService(storage),
    runs = new RunService(storage);
  const owner = hash(randomId()),
    ip = hash(randomId());
  await service.session(owner, ip);
  const output: ComparisonCase[] = [];
  for (const brief of briefs) {
    const arms: ComparisonCase["arms"] = [];
    for (const condition of ["with", "without"] as const) {
      await service.rememberIdentities(owner, [brief.seed]);
      let trail = await service.create(owner, ip, brief.seed.id, randomId());
      const input = agentInput.parse({
        trailId: trail.id,
        expectedVersion: trail.version,
        intent: "generate",
        destination: brief.medium,
        idempotencyKey: randomId(),
      });
      let runId: string | undefined;
      try {
        const accepted = await runs.begin(owner, ip, input, {
          promptVersion: COMPARISON_PROMPT,
        });
        runId = accepted.run.id;
        await storage.transact((db) => {
          db.runs[runId!].state = "running";
        });
        const signal = AbortSignal.timeout(45_000);
        const port = qlooPort({
          storage,
          owner,
          mode: "live",
          runId,
          trailId: trail.id,
          signal,
        });
        const result = await executeComparisonArm(brief, condition, {
          model: createAnthropic()(process.env.ANTHROPIC_MODEL || MODEL),
          signal,
          onStep: async () => {
            await storage.transact((db) => {
              const r = db.runs[runId!];
              assert(r.modelSteps < 4);
              r.modelSteps++;
            });
          },
          affinity: async () => {
            await storage.transact((db) =>
              claimInsights(db.trails[trail.id], db.runs[runId!]),
            );
            return port.insights({
              anchor: brief.seed,
              medium: brief.medium,
              exclusions: brief.exclusions,
              lessObvious: brief.lessObvious,
              catalog: brief.catalog.filter((e) =>
                brief.eligibleIds!.includes(e.id),
              ),
            });
          },
        });
        const entities = result.ids.map((id) =>
          brief.catalog.find((e) => e.id === id)!,
        );
        arms.push({
          condition,
          entities,
          status: entities.length ? "ok" : "empty",
          note: entities.length
            ? "Saved live paired arm."
            : "This arm returned no eligible doors.",
          evidence: result.evidence,
        });
        await runs.finishComparison(owner, runId!, result);
      } catch (error) {
        arms.push({
          condition,
          entities: [],
          status: "failed",
          note:
            error instanceof Error && "code" in error
              ? String(error.code)
              : "model",
        });
        if (runId)
          await runs.finishComparison(
            owner,
            runId,
            undefined,
            error instanceof Error && "code" in error
              ? String(error.code)
              : "model",
          );
      }
      trail = await service.read(owner, trail.id, ip);
      void trail;
    }
    output.push({
      id: brief.id,
      title: `${brief.seed.name} → ${brief.medium}`,
      seed: brief.seed,
      destination: brief.medium,
      frozenAt: brief.frozenAt,
      catalogVersion: brief.catalogVersion,
      promptVersion: COMPARISON_PROMPT,
      model: process.env.ANTHROPIC_MODEL || MODEL,
      source: "qloo",
      catalog: brief.catalog,
      eligibleIds: brief.eligibleIds,
      constraints: {
        loves: brief.explicitLoves.map((e) => e.id),
        excluded: brief.exclusions,
        lessObvious: brief.lessObvious,
      },
      arms,
    });
    // Respect the same three/minute session cap; no operator quota bypass.
    if (brief !== briefs.at(-1)) await delay(61_000);
  }
  await writeFile(
    ".cache/comparison-results.json",
    JSON.stringify(output, null, 2),
    { mode: 0o600 },
  );
  const redis = redisClient();
  if (redis) {
    const namespace = `rabbit-hole:${process.env.ENTITLEMENT_NAMESPACE || "default"}`;
    const ids: string[] = [];
    for (const pair of output) {
      const id = evaluationId(pair);
      ids.push(id);
      await redis.set(
        `${namespace}:evaluation:${id}`,
        { ...pair, evaluationId: id },
        { nx: true, ex: 30 * 86400 },
      );
    }
    await redis.set(`${namespace}:comparisons:v2`, ids, { ex: 30 * 86400 });
  }
  console.log(
    "Saved five paired cases, including failures. No outcome or user-benefit claim is implied.",
  );
}
