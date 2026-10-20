import { MemoryStore, type AtomicStore } from "../src/lib/core/store";
import { TrailService } from "../src/lib/core/service";
import { RunService, agentInput } from "../src/lib/core/runs";
import { samples } from "../src/lib/core/fixtures";
import type { OwnerTrail } from "../src/lib/core/types";
let serial = 0;
export const key = () => `test-key-${++serial}`;
export async function setup() {
  const storage = new MemoryStore(),
    service = new TrailService(storage),
    runs = new RunService(storage);
  const owner = `owner-${key()}`,
    ip = `ip-${key()}`;
  await service.session(owner, ip);
  const trail = await service.create(owner, ip, samples[0].id, key(), true);
  return { storage, service, runs, owner, ip, trail };
}
export async function generate(
  context: Omit<Awaited<ReturnType<typeof setup>>, "storage"> & {
    storage: AtomicStore;
  },
  trail: OwnerTrail = context.trail,
) {
  const input = agentInput.parse({
    trailId: trail.id,
    expectedVersion: trail.version,
    intent: "generate",
    idempotencyKey: key(),
  });
  const started = await context.runs.begin(context.owner, context.ip, input);
  await context.runs.execute(
    context.owner,
    started.run.id,
    input,
    started.trail,
    () => {},
  );
  const result = await context.runs.read(context.owner, started.run.id);
  if (result.state !== "committed")
    throw new Error(result.error ?? result.state);
  return result.trail;
}
