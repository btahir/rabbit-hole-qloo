import "server-only";
import { z } from "zod";
import { assert } from "./errors";
import { hash, randomId, encryptToken, decryptToken } from "./crypto";
import { RETENTION, admit, type AtomicStore } from "./store";
import { applyLimits } from "./limits";
import { activatedSamples } from "./activated-samples";
import { configuredMode, fixtureCatalog, samples } from "./fixtures";
import {
  visibleDoors,
  type Database,
  type Entity,
  type Generation,
  type OwnerTrail,
  type PublicTrail,
  type Session,
  type Share,
  type Trail,
} from "./types";
export const keySchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[\w-]+$/);
const id = z.string().min(1).max(100);
export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum([
        "follow",
        "save",
        "unsave",
        "love",
        "unlove",
        "known",
        "reject",
        "removeExclusion",
      ]),
      entityId: id,
      generationId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("branch"),
      branchPoint: z.number().int().min(0).max(2),
    })
    .strict(),
  z.object({ action: z.literal("finish") }).strict(),
  z.object({ action: z.literal("undo") }).strict(),
]);
export type TrailAction = z.infer<typeof actionSchema>;
export function getSession(db: Database, owner: string, now: number): Session {
  const session = db.sessions[owner];
  assert(session && session.expiresAt > now, "owner", 403);
  return session;
}
export function owned(
  db: Database,
  owner: string,
  id: string,
  now: number,
): Trail {
  const trail = db.trails[id];
  assert(trail && trail.owner === owner && trail.expiresAt > now, "owner", 403);
  return trail;
}
export function projectOwner(db: Database, trail: Trail): OwnerTrail {
  return {
    id: trail.id,
    mode: trail.mode,
    version: trail.version,
    root: trail.root,
    status: trail.status,
    revision: trail.revision,
    steps: trail.steps,
    generations: trail.generations,
    current: trail.current,
    loves: trail.loves,
    saved: trail.saved,
    excluded: trail.excluded,
    shown: trail.shown,
    counters: trail.counters,
    createdAt: trail.createdAt,
    expiresAt: trail.expiresAt,
    activeRun: trail.activeRun,
    directionRequest: trail.directionRequest,
    lessObvious: trail.lessObvious,
    message: trail.message,
    canUndo: !!(trail.undo || trail.pathUndo || trail.reactionUndo),
    sharedVersions: Object.values(db.shares)
      .filter((s) => s.trailId === trail.id && !s.revoked)
      .map((s) => ({
        id: s.id,
        version: s.version,
        createdAt: s.createdAt,
        root: s.snapshot.root.name,
      })),
  };
}
export function publicGeneration(
  gen: Generation,
  selected: Entity,
): Generation {
  return {
    ...gen,
    pool: [selected],
    connections: gen.connections?.[selected.id]
      ? { [selected.id]: gen.connections[selected.id] }
      : undefined,
    ranking: undefined,
    personalRankingApplied: !!gen.ranking || gen.personalRankingApplied,
    warnings: gen.warnings.filter((w) => !w.includes("favourites")),
    discovery: {
      ...gen.discovery,
      loves: [],
      exclusionsHash: "",
      results: gen.discovery.results.filter((r) => r.id === selected.id),
    },
  };
}
export function projectPublic(trail: Trail, now: number): PublicTrail {
  return {
    mode: trail.mode,
    root: trail.root,
    steps: trail.steps.map((s) => ({
      ...s,
      generation: publicGeneration(s.generation, s.entity),
    })),
    createdAt: now,
    expiresAt: now + RETENTION,
  };
}
function saveRevision(trail: Trail, now: number) {
  trail.history.push({
    id: trail.revision,
    parent: trail.history.at(-1)?.id,
    root: trail.root,
    steps: structuredClone(trail.steps),
    generations: structuredClone(trail.generations),
    status: trail.status,
    createdAt: new Date(now).toISOString(),
  });
  trail.history = trail.history.slice(-24);
  trail.revision = randomId();
}
function snapshot(trail: Trail, kind: "path" | "reaction") {
  // Each undo lane restores only its own fields; neither can refund usage.
  if (trail.undo) {
    if (trail.undo.kind === "path")
      trail.pathUndo = { ...trail.undo, kind: "path" };
    else trail.reactionUndo = { ...trail.undo, kind: "reaction" };
    delete trail.undo;
  }
  if (kind === "reaction") {
    trail.reactionUndo = {
      kind,
      snapshot: JSON.stringify({
        saved: trail.saved,
        loves: trail.loves,
        excluded: trail.excluded,
      }),
    };
  } else {
    trail.pathUndo = {
      kind,
      snapshot: JSON.stringify({
        root: trail.root,
        steps: trail.steps,
        generations: trail.generations,
        current: trail.current,
        status: trail.status,
        revision: trail.revision,
        directionRequest: trail.directionRequest,
      }),
    };
    delete trail.reactionUndo;
  }
}
function findEntity(trail: Trail, entityId: string): Entity {
  const e = [
    trail.root,
    ...trail.steps.map((s) => s.entity),
    ...trail.generations.flatMap((g) => g.pool),
    ...trail.saved,
    ...trail.excluded.map((x) => x.entity),
  ].find((e) => e.id === entityId);
  assert(e);
  return e;
}
export class TrailService {
  constructor(
    public storage: AtomicStore,
    public now: () => number = Date.now,
  ) {}
  async session(owner: string, ip: string) {
    const now = this.now();
    const existing = await this.storage.transact(
      (db) => !!db.sessions[owner] && db.sessions[owner].expiresAt > now,
    );
    await admit(this.storage, owner, ip, existing ? "read" : "session", now);
    return this.storage.transact((db) => {
      if (!db.sessions[owner]) {
        assert(Object.keys(db.sessions).length < 5000, "storage", 503);
        db.sessions[owner] = {
          idHash: owner,
          createdAt: now,
          expiresAt: now + RETENTION,
          identities: [],
        };
      }
      const s = getSession(db, owner, now);
      return {
        current: s.current,
        continuation:
          s.current && db.trails[s.current]
            ? {
                rootName: db.trails[s.current].root.name,
                choices: db.trails[s.current].steps.length,
              }
            : undefined,
        previous: s.previous,
        previousSummary:
          s.previous &&
          db.trails[s.previous]?.owner === owner &&
          db.trails[s.previous].expiresAt > now
            ? {
                rootName: db.trails[s.previous].root.name,
                choices: db.trails[s.previous].steps.length,
              }
            : undefined,
        mode: configuredMode(),
      };
    }, now);
  }
  async create(
    owner: string,
    ip: string,
    entityId: string,
    key: string,
    sample = false,
    example = false,
  ) {
    const activated =
      sample && !example && configuredMode() === "live"
        ? await activatedSamples()
        : [];
    const now = this.now();
    await admit(this.storage, owner, ip, "replay", now);
    return this.storage.transact((db) => {
      const session = getSession(db, owner, now);
      const existing = Object.values(db.trails).find(
        (t) => t.owner === owner && t.idempotency[`create_${key}`],
      );
      if (existing) return projectOwner(db, existing);
      applyLimits(db, owner, ip, "write", now);
      const mode = example ? "fixture" : configuredMode();
      // Synthetic IDs are never accepted in live mode; live examples need operator activation.
      const entity =
        (example
          ? fixtureCatalog.find((e) => e.id === entityId)
          : session.identities.find((e) => e.id === entityId)) ??
        (sample
          ? (mode === "fixture" ? samples : activated).find(
              (e) => e.id === entityId,
            )
          : undefined);
      assert(
        entity &&
          (mode === "fixture"
            ? entity.id.startsWith("fixture:")
            : !entity.id.startsWith("fixture:")),
      );
      const trail: Trail = {
        id: randomId(),
        owner,
        mode,
        version: 1,
        root: entity,
        status: "draft",
        revision: randomId(),
        history: [],
        steps: [],
        generations: [],
        loves: [entity],
        saved: [],
        excluded: [],
        shown: [],
        counters: { runs: 0, insights: 0, attempts: 0, searches: 0 },
        createdAt: now,
        expiresAt: now + RETENTION,
        idempotency: { [`create_${key}`]: { version: 1, action: "create" } },
      };
      db.trails[trail.id] = trail;
      session.expiresAt = Math.max(session.expiresAt, trail.expiresAt);
      session.previous = session.current;
      session.current = trail.id;
      return projectOwner(db, trail);
    }, now);
  }
  async read(owner: string, trailId: string, ip = owner) {
    const now = this.now();
    await admit(this.storage, owner, ip, "read", now);
    return this.storage.transact((db) => {
      return projectOwner(db, owned(db, owner, trailId, now));
    }, now);
  }
  async action(
    owner: string,
    ip: string,
    trailId: string,
    version: number,
    key: string,
    input: TrailAction,
  ) {
    const now = this.now();
    await admit(this.storage, owner, ip, "replay", now);
    return this.storage.transact((db) => {
      const trail = owned(db, owner, trailId, now);
      if (trail.idempotency[key]) {
        assert(trail.idempotency[key].action === input.action);
        return projectOwner(db, trail);
      }
      assert(trail.version === version, "conflict", 409);
      assert(!trail.activeRun, "conflict", 409);
      // Request admission includes replays; new shares/forks retain their stricter allowance.
      if (input.action === "undo") {
        const undo = trail.reactionUndo ?? trail.pathUndo ?? trail.undo;
        assert(undo);
        const before = JSON.parse(undo.snapshot) as Trail;
        if (undo.kind === "reaction") {
          trail.saved = before.saved;
          trail.loves = before.loves;
          trail.excluded = before.excluded;
          delete trail.reactionUndo;
        } else {
          for (const field of [
            "root",
            "steps",
            "generations",
            "current",
            "status",
            "revision",
            "directionRequest",
          ] as const)
            Object.assign(trail, { [field]: before[field] });
          delete trail.pathUndo;
        }
        delete trail.undo;
        trail.message = "Undone.";
      } else if (input.action === "branch") {
        assert(input.branchPoint <= trail.steps.length);
        snapshot(trail, "path");
        saveRevision(trail, now);
        trail.steps = trail.steps.slice(0, input.branchPoint);
        delete trail.directionRequest;
        trail.generations = trail.steps.map((s) => s.generation);
        delete trail.current;
        trail.status = "draft";
        trail.message = "Your version starts here.";
      } else if (input.action === "finish") {
        assert(trail.steps.length > 0);
        snapshot(trail, "path");
        saveRevision(trail, now);
        trail.status = "complete";
        delete trail.current;
      } else {
        const entity = findEntity(trail, input.entityId);
        if (
          input.action === "follow" ||
          input.action === "known" ||
          input.action === "reject"
        ) {
          assert(
            trail.status !== "complete" &&
              trail.current?.id === input.generationId &&
              visibleDoors(trail).some((e) => e.id === entity.id),
            "conflict",
            409,
          );
          assert(
            trail.current!.discovery.results.some((e) => e.id === entity.id),
            "contract",
            502,
          );
          if (input.action === "follow") {
            assert(trail.steps.length < 3);
            snapshot(trail, "path");
            saveRevision(trail, now);
            trail.steps.push({
              entity,
              anchor: trail.current!.anchor,
              generation: structuredClone(trail.current!),
              selectedAt: new Date(now).toISOString(),
            });
            delete trail.current;
            trail.status = trail.steps.length === 3 ? "complete" : "active";
            trail.message = `Added ${entity.name} to your trail.`;
          } else {
            snapshot(trail, "reaction");
            trail.excluded.push({ entity, reason: input.action });
            trail.message =
              input.action === "known"
                ? `We'll leave ${entity.name} out.`
                : `Skipped ${entity.name}. We'll leave it out of this trail.`;
            if (visibleDoors(trail).length)
              trail.message += " Used another result already found.";
            trail.shown = [
              ...new Set([
                ...trail.shown,
                ...visibleDoors(trail).map((e) => e.id),
              ]),
            ];
          }
        } else {
          snapshot(trail, "reaction");
          if (input.action === "save") {
            if (!trail.saved.some((e) => e.id === entity.id))
              trail.saved.push(entity);
            trail.message = `Saved ${entity.name}.`;
          }
          if (input.action === "unsave") {
            trail.saved = trail.saved.filter((e) => e.id !== entity.id);
            trail.message = `Removed ${entity.name} from saved discoveries.`;
          }
          if (input.action === "love") {
            assert(
              [trail.root.id, ...trail.steps.map((s) => s.entity.id)].includes(
                entity.id,
              ),
            );
            if (!trail.loves.some((e) => e.id === entity.id)) {
              assert(trail.loves.length < 6);
              trail.loves.push(entity);
            }
            trail.message = "Added to the things you love.";
          }
          if (input.action === "unlove") {
            trail.loves = trail.loves.filter((e) => e.id !== entity.id);
            trail.message = "Removed from the things you love.";
          }
          if (input.action === "removeExclusion") {
            trail.excluded = trail.excluded.filter(
              (e) => e.entity.id !== entity.id,
            );
            trail.message = "Exclusion removed.";
          }
        }
      }
      trail.version++;
      trail.idempotency[key] = { version: trail.version, action: input.action };
      trail.idempotency = Object.fromEntries(
        Object.entries(trail.idempotency).slice(-256),
      );
      return projectOwner(db, trail);
    }, now);
  }
  async remove(owner: string, trailId: string, version: number, ip = owner) {
    const now = this.now();
    await admit(this.storage, owner, ip, "replay", now);
    return this.storage.transact((db) => {
      if (db.deletions[trailId]?.owner === owner) return { deleted: true };
      const trail = owned(db, owner, trailId, now);
      assert(trail.version === version, "conflict", 409);
      assert(!trail.activeRun, "conflict", 409);
      for (const [id, share] of Object.entries(db.shares))
        if (share.trailId === trailId) delete db.shares[id];
      for (const [id, run] of Object.entries(db.runs))
        if (run.trailId === trailId) delete db.runs[id];
      const session = db.sessions[owner];
      if (session?.current === trailId) delete session.current;
      if (session?.previous === trailId) delete session.previous;
      db.deletions[trailId] = { owner, expiresAt: now + RETENTION };
      delete db.trails[trailId];
      return { deleted: true };
    }, now);
  }
  async share(
    owner: string,
    ip: string,
    trailId: string,
    version: number,
    key: string,
    note = "",
  ) {
    assert(note.trim().length <= 240, "input", 400);
    note = note.trim();
    const now = this.now();
    await admit(this.storage, owner, ip, "replay", now);
    return this.storage.transact((db) => {
      const trail = owned(db, owner, trailId, now);
      assert(trail.version === version, "conflict", 409);
      assert(trail.steps.length && !trail.activeRun, "conflict", 409);
      const existing = Object.values(db.shares).find(
        (s) =>
          s.trailId === trailId &&
          s.version === version &&
          !s.revoked &&
          (s.snapshot.note ?? "") === note,
      );
      if (existing)
        return {
          shareId: existing.id,
          token: decryptToken(existing.ciphertext, existing.id),
          expiresAt: existing.expiresAt,
        };
      applyLimits(db, owner, ip, "write", now);
      const token = randomId(),
        id = randomId(),
        expiresAt = Math.min(now + RETENTION, trail.expiresAt);
      const share: Share = {
        id,
        owner,
        trailId,
        version,
        tokenHash: hash(token),
        ciphertext: encryptToken(token, id),
        snapshot: projectPublic(trail, now),
        createdAt: now,
        expiresAt,
        revoked: false,
      };
      share.snapshot.expiresAt = expiresAt;
      if (note) share.snapshot.note = note;
      db.shares[id] = share;
      trail.idempotency[`share_${key}`] = { action: "share", version };
      return { shareId: id, token, expiresAt };
    }, now);
  }
  async visitor(token: string, owner: string, ip: string) {
    const now = this.now();
    await admit(this.storage, owner, ip, "read", now);
    return this.storage.transact((db) => {
      const share = Object.values(db.shares).find(
        (s) => s.tokenHash === hash(token),
      );
      assert(share && !share.revoked && share.expiresAt > now, "missing", 404);
      return share.snapshot;
    }, now);
  }
  async revoke(owner: string, shareId: string, ip = owner) {
    const now = this.now();
    return this.storage.transact((db) => {
      const s = db.shares[shareId];
      assert(s && s.owner === owner, "owner", 403);
      applyLimits(db, owner, ip, "write", now);
      s.revoked = true;
      s.ciphertext = "";
      return { revoked: true };
    }, now);
  }
  async fork(
    owner: string,
    ip: string,
    token: string,
    point: number,
    key: string,
    love: boolean,
  ) {
    const now = this.now();
    await admit(this.storage, owner, ip, "replay", now);
    return this.storage.transact((db) => {
      const session = getSession(db, owner, now);
      const existing = db.forks[`${owner}:${key}`];
      if (existing && db.trails[existing])
        return projectOwner(db, db.trails[existing]);
      applyLimits(db, owner, ip, "write", now);
      const share = Object.values(db.shares).find(
        (s) => s.tokenHash === hash(token),
      );
      assert(share && !share.revoked && share.expiresAt > now, "missing", 404);
      assert(point >= 0 && point <= share.snapshot.steps.length && point < 3);
      const prefix = structuredClone(share.snapshot.steps.slice(0, point)),
        root = structuredClone(share.snapshot.root);
      for (const step of prefix) step.generation.inherited = true;
      const trail: Trail = {
        id: randomId(),
        owner,
        mode: share.snapshot.mode,
        version: 1,
        root,
        steps: prefix,
        status: "draft",
        revision: randomId(),
        history: [],
        generations: prefix.map((s) => s.generation),
        loves: love ? [root] : [],
        saved: [],
        excluded: [],
        shown: prefix.map((s) => s.entity.id),
        counters: { runs: 0, insights: 0, attempts: 0, searches: 0 },
        createdAt: now,
        expiresAt: now + RETENTION,
        idempotency: {},
        message:
          "Your version starts here. Choose a direction to find new doors.",
      };
      db.trails[trail.id] = trail;
      session.expiresAt = Math.max(session.expiresAt, trail.expiresAt);
      db.forks[`${owner}:${key}`] = trail.id;
      session.previous = session.current;
      session.current = trail.id;
      return projectOwner(db, trail);
    }, now);
  }
  async rememberIdentities(owner: string, entities: Entity[]) {
    const now = this.now();
    await this.storage.transact((db) => {
      const s = getSession(db, owner, now);
      s.identities = [...entities, ...s.identities]
        .filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i)
        .slice(0, 100);
    }, now);
  }
}
export function fixtureIdentity(id: string) {
  return fixtureCatalog.find((e) => e.id === id);
}
