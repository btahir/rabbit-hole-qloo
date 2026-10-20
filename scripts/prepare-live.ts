// Explicit operator task; never runs on a page request. Inputs are reviewed,
// private catalog records, frozen before either comparison arm is selected.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { sampleReviewSchema } from "../src/lib/core/activated-samples";
import { entitySchema } from "../src/lib/qloo/schemas";
import { normalizeEntity } from "../src/lib/core/entities";
import { eligibleSuggestion } from "../src/lib/core/suggestion-policy";
import { qlooPort } from "../src/lib/core/qloo";
import { MemoryStore } from "../src/lib/core/store";
import { fixtureCatalog, samples } from "../src/lib/core/fixtures";
import { comparisons, type ComparisonCase } from "../src/lib/core/comparisons";
import { evaluationId } from "../src/lib/core/evaluation-id";
import type { Entity } from "../src/lib/core/types";

if (!process.env.QLOO_DEV_CACHE_DIR || !process.env.QLOO_API_KEY)
  throw new Error(
    "Set QLOO_DEV_CACHE_DIR and provide the local Qloo key before preparing live data.",
  );
const input = JSON.parse(
  await readFile(".cache/reviewed-identities.json", "utf8"),
);
const records = input.entities.map((raw: unknown) => entitySchema.parse(raw));
const normalizeName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const identities = fixtureCatalog.map((fixture) => {
  const row = records.find(
    (r: (typeof records)[number]) =>
      (r.types ?? [r.subtype ?? r.type]).includes(
        `urn:entity:${fixture.medium}`,
      ) && normalizeName(r.name).startsWith(normalizeName(fixture.name)),
  );
  if (!row) throw new Error(`Missing reviewed identity: ${fixture.name}`);
  const entity = normalizeEntity(row, fixture.medium, input.checkedAt);
  return { fixture, entity, eligible: eligibleSuggestion(row) };
});
// Reviews must pre-exist and match confirmed identities. Retrieval does not author attestations.
const reviews = z
  .array(sampleReviewSchema)
  .length(3)
  .parse(JSON.parse(await readFile(".cache/sample-reviews.json", "utf8")));
for (const sample of samples) {
  const entity = identities.find(
    (item) => item.fixture.id === sample.id,
  )!.entity;
  if (!reviews.some((review) => review.entityId.toLowerCase() === entity.id))
    throw new Error(`Missing review for ${entity.name}`);
}
const storage = new MemoryStore();
const port = qlooPort({
  storage,
  owner: "operator-live-preparation",
  mode: "live",
});
const roots: Entity[] = [];
for (const sample of samples) {
  const id = identities.find((x) => x.fixture.id === sample.id)!.entity;
  const [root] = await port.describeEntities([id.id], id.medium);
  if (!root) throw new Error(`Hydration failed for ${id.name}`);
  const direction =
    root.medium === "movie"
      ? "artist"
      : root.medium === "artist"
        ? "book"
        : "movie";
  const result = await port.insights({
    anchor: root,
    medium: direction,
    exclusions: [root.id],
    lessObvious: false,
  });
  if (!result.entities.length)
    throw new Error(`No checked first doors for ${root.name}`);
  roots.push(root);
  identities.find((x) => x.fixture.id === sample.id)!.entity = root;
  console.log(
    JSON.stringify({
      sample: root.name,
      firstDoors: result.entities.slice(0, 3).map((e) => e.name),
      cache: result.evidence.cache,
    }),
  );
}
await mkdir(".cache", { recursive: true, mode: 0o700 });
await writeFile(
  ".cache/activated-samples.json",
  JSON.stringify(
    roots.map((identity) => ({
      identity,
      activatedAt: new Date().toISOString(),
      review: reviews.find(
        (review) => review.entityId.toLowerCase() === identity.id,
      ),
    })),
  ),
  { mode: 0o600 },
);

const frozenAt = new Date().toISOString();
const briefs = comparisons.map((example) => ({
  example,
  seed: identities.find((x) => x.fixture.id === example.seed.id)!.entity,
  catalog: identities.filter((x) => x.entity.medium === example.destination),
}));
await writeFile(
  ".cache/comparison-inputs.json",
  JSON.stringify({ frozenAt, briefs }),
  { mode: 0o600 },
);
const output: ComparisonCase[] = [];
for (const { example, seed, catalog } of briefs) {
  const common = catalog.filter((x) => x.eligible).map((x) => x.entity);
  const baseline = common.slice(0, 3);
  let withArm: ComparisonCase["arms"][number];
  try {
    const result = await port.insights({
      anchor: seed,
      medium: example.destination,
      exclusions: [seed.id],
      lessObvious: false,
      catalog: common,
    });
    // Both arms render the same frozen metadata; only evidence/order differ.
    const entities = result.entities
      .slice(0, 3)
      .map((e) => common.find((x) => x.id === e.id)!);
    withArm = {
      condition: "with",
      entities,
      status: entities.length ? "ok" : "empty",
      note: "First eligible members in the saved Qloo order.",
      evidence: result.evidence,
    };
  } catch (error) {
    withArm = {
      condition: "with",
      entities: [],
      status: "failed",
      note:
        error instanceof Error ? error.message : "The affinity request failed.",
    };
  }
  const pair: ComparisonCase = {
    ...example,
    seed,
    source: "qloo",
    frozenAt,
    catalogVersion: "authored-catalog-1-live-identities-content-checked",
    promptVersion: "deterministic-catalog-order-1",
    model: "Deterministic first-three selector; no language model ran",
    catalog: catalog.map((x) => x.entity),
    eligibleIds: common.map((x) => x.id),
    constraints: { loves: [], excluded: [seed.id], lessObvious: false },
    arms: [
      withArm,
      {
        condition: "without",
        entities: baseline,
        status: baseline.length ? "ok" : "empty",
        note: "First eligible members in the original authored catalog order. No affinity request or language model.",
      },
    ],
  };
  pair.evaluationId = evaluationId(pair);
  output.push(pair);
  console.log(
    JSON.stringify({
      comparison: pair.id,
      status: withArm.status,
      with: withArm.entities.map((e) => e.name),
      without: baseline.map((e) => e.name),
    }),
  );
}
await writeFile(".cache/comparison-results.json", JSON.stringify(output), {
  mode: 0o600,
});
console.log(
  "Saved reviewed live samples and five deterministic paired comparisons. No model evaluation or user-benefit claim.",
);
