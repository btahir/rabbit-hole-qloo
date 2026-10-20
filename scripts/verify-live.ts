// Read-only provider data plus isolated local product state. No paid model is used.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { activatedSamples } from "../src/lib/core/activated-samples";
import { MemoryStore } from "../src/lib/core/store";
import { TrailService } from "../src/lib/core/service";
import { RunService, agentInput } from "../src/lib/core/runs";
import { randomId } from "../src/lib/core/crypto";
import { visibleDoors, type OwnerTrail } from "../src/lib/core/types";
import { qlooPort } from "../src/lib/core/qloo";
if (process.env.QLOO_MODE !== "live" || !process.env.QLOO_DEV_CACHE_DIR)
  throw new Error(
    "Explicit live mode and a private development cache are required.",
  );
if (process.env.ANTHROPIC_API_KEY)
  throw new Error("This check is for the disclosed no-model guide only.");
const count = async () => {
  const text = await readFile(
    `${process.env.QLOO_DEV_CACHE_DIR}/attempts.jsonl`,
    "utf8",
  ).catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.status === "started").length;
};
const before = await count();
const storage = new MemoryStore(),
  service = new TrailService(storage),
  runs = new RunService(storage);
const roots = await activatedSamples();
assert.equal(roots.length, 3);
const records: unknown[] = [];
for (const root of roots) {
  const owner = randomId(),
    ip = randomId();
  await service.session(owner, ip);
  let trail = await service.create(owner, ip, root.id, randomId(), true);
  const turn = async (lessObvious = false) => {
    const input = agentInput.parse({
      trailId: trail.id,
      expectedVersion: trail.version,
      intent: "generate",
      destination: "auto",
      lessObvious,
      idempotencyKey: randomId(),
    });
    const started = performance.now();
    const accepted = await runs.begin(owner, ip, input);
    await runs.execute(owner, accepted.run.id, input, accepted.trail, () => {});
    const replay = await runs.read(owner, accepted.run.id, 0, trail.version);
    assert.equal(replay.state, "committed");
    assert.equal(replay.modelSteps, 0);
    trail = replay.trail;
    const doors = visibleDoors(trail);
    assert(doors.length > 0);
    assert.equal(trail.current?.discovery.source, "qloo");
    for (const door of doors)
      assert(
        trail.current?.discovery.results.some(
          (result) => result.id === door.id,
        ),
      );
    records.push({
      root: root.name,
      anchor: trail.current?.anchor.name,
      doors: doors.map((door) => door.name),
      cache: trail.current?.discovery.cache,
      attempts: replay.attempts,
      modelSteps: replay.modelSteps,
      elapsedMs: Math.round(performance.now() - started),
      warnings: trail.current?.warnings,
    });
  };
  const act = async (choice: unknown) => {
    trail = await service.action(
      owner,
      ip,
      trail.id,
      trail.version,
      randomId(),
      choice as Parameters<TrailService["action"]>[5],
    );
  };
  await turn();
  if (root.medium !== "movie") continue;
  const first =
    visibleDoors(trail).find((door) => door.name === "Tindersticks") ??
    visibleDoors(trail)[0];
  await act({
    action: "follow",
    entityId: first.id,
    generationId: trail.current!.id,
  });
  await turn(true);
  await act({
    action: "reject",
    entityId: visibleDoors(trail)[0].id,
    generationId: trail.current!.id,
  });
  await act({
    action: "follow",
    entityId: visibleDoors(trail)[0].id,
    generationId: trail.current!.id,
  });
  await turn(true);
  await act({
    action: "follow",
    entityId: visibleDoors(trail)[0].id,
    generationId: trail.current!.id,
  });
  assert.equal(trail.status, "complete");
  assert.equal(trail.steps.length, 3);
  const shared = await service.share(
    owner,
    ip,
    trail.id,
    trail.version,
    randomId(),
  );
  const recipient = randomId(),
    recipientIp = randomId();
  await service.session(recipient, recipientIp);
  const snapshot = await service.visitor(shared.token, recipient, recipientIp);
  assert.equal(snapshot.steps.length, 3);
  const fork = await service.fork(
    recipient,
    recipientIp,
    shared.token,
    0,
    randomId(),
    false,
  );
  assert.notEqual(fork.id, trail.id);
  assert.equal(fork.steps.length, 0);
  assert.equal(fork.loves.length, 0);
  assert.equal(fork.counters.runs, 0);
  await service.revoke(owner, shared.shareId, ip);
  await assert.rejects(() =>
    service.visitor(shared.token, recipient, recipientIp),
  );
  records.push({
    completed: [root.name, ...trail.steps.map((step) => step.entity.name)],
    sharing: "passed",
    independentFork: "passed",
    revokedLink: "passed",
    calls: trail.counters.attempts,
  });
}
const manualOwner = randomId(),
  manualIp = randomId();
await service.session(manualOwner, manualIp);
const matches = await qlooPort({
  storage,
  owner: manualOwner,
  mode: "live",
}).resolveStart("Prince", "artist");
assert(matches.some((entity) => entity.name === "Prince"));
await service.rememberIdentities(manualOwner, matches);
const manual: OwnerTrail = await service.create(
  manualOwner,
  manualIp,
  matches.find((entity) => entity.name === "Prince")!.id,
  randomId(),
);
assert.equal(manual.mode, "live");
records.push({
  manualConfirmation: "Prince",
  mode: manual.mode,
  automaticRuns: manual.counters.runs,
});
const report = {
  at: new Date().toISOString(),
  scope:
    "Actual local services; live Qloo or saved responses, isolated memory storage, deterministic guide. No browser, hosted durability or model acceptance claim.",
  uncachedCalls: (await count()) - before,
  records,
};
await mkdir(".cache/r5-verification", { recursive: true });
await writeFile(
  ".cache/r5-verification/live.json",
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
