// Bounded local operating check; twenty independent sessions, ordinary quotas.
import { writeFile } from "node:fs/promises";
import { activatedSamples } from "../src/lib/core/activated-samples";
import { MemoryStore } from "../src/lib/core/store";
import { TrailService } from "../src/lib/core/service";
import { RunService, agentInput } from "../src/lib/core/runs";
import { randomId } from "../src/lib/core/crypto";
import { media, visibleDoors } from "../src/lib/core/types";
if (!process.env.QLOO_DEV_CACHE_DIR)
  throw new Error("Development disk cache required.");
const roots = await activatedSamples();
if (roots.length !== 3) throw new Error("Prepare reviewed live samples first.");
const storage = new MemoryStore(),
  service = new TrailService(storage),
  runs = new RunService(storage);
const observations = [];
for (let i = 0; i < 20; i++) {
  const owner = randomId(),
    ip = randomId(),
    root = roots[i % 3];
  await service.session(owner, ip);
  const trail = await service.create(owner, ip, root.id, randomId(), true);
  const destination = media.filter((m) => m !== root.medium)[
    Math.floor(i / 3) % 2
  ];
  const lessObvious = Math.floor(i / 6) % 2 === 1;
  const input = agentInput.parse({
    trailId: trail.id,
    expectedVersion: trail.version,
    intent: "generate",
    destination,
    lessObvious,
    idempotencyKey: randomId(),
  });
  const started = performance.now();
  const accepted = await runs.begin(owner, ip, input);
  await runs.execute(owner, accepted.run.id, input, accepted.trail, () => {});
  const result = await runs.read(owner, accepted.run.id);
  const latest = await service.read(owner, trail.id);
  observations.push({
    root: root.name,
    destination,
    lessObvious,
    elapsedMs: Math.round(performance.now() - started),
    state: result.state,
    error: result.error,
    attempts: result.attempts,
    modelSteps: result.modelSteps,
    source: latest.current?.discovery.cache,
    providerMs: latest.current?.discovery.elapsedMs,
    doors: visibleDoors(latest).length,
  });
}
const percentile = (values: number[], fraction: number) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const times = observations.map((row) => row.elapsedMs);
const report = {
  at: new Date().toISOString(),
  scope:
    "Local production-core calls with in-memory storage and private development cache; no model, hosting or remote Redis latency.",
  turns: observations.length,
  p50: percentile(times, 0.5),
  p95: percentile(times, 0.95),
  attempts: observations.reduce((n, row) => n + row.attempts, 0),
  observations,
};
await writeFile(
  ".cache/live-performance.json",
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
