import "server-only";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { z } from "zod";
import {
  media,
  type Generation,
  type Run,
  type RunEvent,
  type Trail,
} from "./types";
import { errorCopy, AppError, assert } from "./errors";
import {
  MODEL,
  INPUT_RATE,
  OUTPUT_RATE,
  verifiedModelConfig,
} from "./model-config";
import { randomId, encryptToken, decryptToken } from "./crypto";
import { claimInsights, dayKey, reserve, RESERVATION, settle } from "./limits";
import { RETENTION, admit, type AtomicStore } from "./store";
import { keySchema, owned, projectOwner, getSession } from "./service";
import { qlooPort, QLOO_DECODER } from "./qloo";
import { runGuide, TurnTools, usesModel, PROMPT_VERSION } from "./agent";
export const agentInput = z
  .object({
    trailId: z.string().max(100),
    expectedVersion: z.number().int().min(1),
    intent: z.enum(["generate", "refresh", "findMore", "retry", "saveResult"]),
    destination: z.enum(["auto", ...media]).default("auto"),
    lessObvious: z.boolean().default(false),
    idempotencyKey: keySchema,
    runId: z.string().max(100).optional(),
    receipt: z.string().max(12000).optional(),
  })
  .strict();
export type AgentInput = z.infer<typeof agentInput>;
const controllers = new Map<string, AbortController>();
const unsaved = new Map<
  string,
  {
    owner: string;
    generation: Generation;
    actualCost?: number;
    usage?: { inputTokens?: number; outputTokens?: number };
    expiresAt: number;
  }
>();
export class RunService {
  constructor(
    public storage: AtomicStore,
    public now: () => number = Date.now,
  ) {}
  async begin(
    owner: string,
    ip: string,
    input: AgentInput,
    protocol?: { promptVersion: string },
  ) {
    await admit(this.storage, owner, ip, "replay", this.now());
    const current = await this.storage.transact((db) =>
      owned(db, owner, input.trailId, this.now()),
    );
    if (current.mode === "live" && process.env.INFERENCE_PAUSED === "1")
      throw new AppError("paused", 503);
    if (usesModel(current.mode)) await verifiedModelConfig();
    const now = this.now();
    return this.storage.transact((db) => {
      const trail = owned(db, owner, input.trailId, now);
      assert(
        !getSession(db, owner, now).cancelledRuns?.includes(
          `${input.trailId}:${input.idempotencyKey}`,
        ),
        "cancelled",
        409,
      );
      const existing = Object.values(db.runs).find(
        (r) =>
          r.trailId === trail.id &&
          r.owner === owner &&
          r.key === input.idempotencyKey,
      );
      if (existing) return { run: existing, trail, started: false };
      assert(trail.version === input.expectedVersion, "conflict", 409);
      assert(trail.status !== "complete" && trail.steps.length < 3);
      const anchor = trail.steps.at(-1)?.entity ?? trail.root;
      assert(
        input.destination === "auto" || input.destination !== anchor.medium,
      );
      const run: Run = {
        id: randomId(),
        owner,
        trailId: trail.id,
        expectedVersion: trail.version,
        key: input.idempotencyKey,
        state: "reserved",
        events: [],
        createdAt: now,
        leaseUntil: now + 60_000,
        expiresAt: Math.min(now + RETENTION, trail.expiresAt),
        attempts: 0,
        insights: 0,
        modelSteps: 0,
        elapsedMs: 0,
        reserved: usesModel(trail.mode) ? RESERVATION : 0,
        settled: false,
        telemetry: {
          model: usesModel(trail.mode)
            ? process.env.ANTHROPIC_MODEL || MODEL
            : trail.mode === "fixture"
              ? "synthetic illustration"
              : "explicit development guide",
          promptVersion: protocol?.promptVersion ?? PROMPT_VERSION,
          decoderVersion: QLOO_DECODER,
          priceContract: usesModel(trail.mode)
            ? "anthropic-haiku-5.5-2026-10-19"
            : "no-model",
          inputRate: usesModel(trail.mode) ? INPUT_RATE : undefined,
          outputRate: usesModel(trail.mode) ? OUTPUT_RATE : undefined,
          costStatus: "reserved",
        },
        day: dayKey(now),
      };
      reserve(db, trail, run, ip, now);
      trail.lessObvious = input.lessObvious;
      run.events.push({
        sequence: 1,
        runId: run.id,
        type: "status",
        message:
          trail.mode === "fixture"
            ? "These steps illustrate the flow. No agent or Qloo request ran."
            : "Waiting for a place to start…",
        at: now,
      });
      return { run, trail, started: true };
    }, now);
  }
  async finishComparison(
    owner: string,
    runId: string,
    result?: {
      inputTokens?: number;
      outputTokens?: number;
      actualCost?: number;
    },
    error?: string,
  ) {
    const now = this.now();
    await this.storage.transact((db) => {
      const run = db.runs[runId];
      assert(run?.owner === owner, "owner", 403);
      if (!["running", "reserved"].includes(run.state)) return;
      run.state = error ? "failed" : "committed";
      run.error = error;
      run.elapsedMs = now - run.createdAt;
      run.leaseUntil = now;
      if (db.trails[run.trailId]?.activeRun === runId)
        delete db.trails[run.trailId].activeRun;
      settle(db, run, result?.actualCost);
      if (run.telemetry)
        Object.assign(run.telemetry, {
          inputTokens: result?.inputTokens,
          outputTokens: result?.outputTokens,
          actualMicrodollars: result?.actualCost,
          costStatus: result?.actualCost === undefined ? "unknown" : "settled",
        });
    }, now);
  }
  async read(
    owner: string,
    runId: string,
    after?: number,
  ): Promise<
    ReturnType<RunService["readProjection"]> & {
      trail: import("./types").OwnerTrail;
    }
  >;
  async read(
    owner: string,
    runId: string,
    after: number,
    knownVersion: number,
  ): Promise<ReturnType<RunService["readProjection"]>>;
  async read(owner: string, runId: string, after = 0, knownVersion?: number) {
    void knownVersion; // Accepted for old clients; it is not a projection revision.
    return this.storage.transact(
      (db) => this.readProjection(db, owner, runId, after),
      this.now(),
    );
  }
  private readProjection(
    db: import("./types").Database,
    owner: string,
    runId: string,
    after: number,
  ) {
    const now = this.now();
    const run = db.runs[runId];
    assert(run && run.owner === owner, "owner", 403);
    const { owner: _owner, key: _key, ...safe } = run;
    void _owner;
    void _key;
    return {
      ...safe,
      events: run.events.filter((e) => e.sequence > after),
      // Path version alone cannot describe activeRun, cancellation or expiry.
      // Every replay carries the authoritative projection, including at equal version.
      trail: projectOwner(db, owned(db, owner, run.trailId, now)),
      guide: run.modelSteps ? "AI agent" : "Deterministic local guide",
    };
  }
  async cancelPending(owner: string, trailId: string, key: string) {
    const id = await this.storage.transact((db) => {
      owned(db, owner, trailId, this.now()).message =
        "Stopped. Your trail is safe.";
      const session = getSession(db, owner, this.now());
      session.cancelledRuns = [
        ...new Set([...(session.cancelledRuns ?? []), `${trailId}:${key}`]),
      ].slice(-64);
      return Object.values(db.runs).find(
        (r) => r.owner === owner && r.trailId === trailId && r.key === key,
      )?.id;
    });
    return id ? this.cancel(owner, id) : { state: "cancelled" };
  }
  async cancel(owner: string, runId: string) {
    const now = this.now();
    const result = await this.storage.transact((db) => {
      const run = db.runs[runId];
      assert(run && run.owner === owner, "owner", 403);
      if (["reserved", "running", "unsaved"].includes(run.state)) {
        run.state = "cancelled";
        run.error = "cancelled";
        run.leaseUntil = now;
        run.events.push({
          sequence: run.events.length + 1,
          runId,
          type: "error",
          message: errorCopy.cancelled[0],
          at: now,
        });
        const trail = db.trails[run.trailId];
        if (trail?.activeRun === runId) {
          delete trail.activeRun;
          trail.message = "Stopped. Your trail is safe.";
        }
      }
      return { state: run.state };
    }, now);
    controllers.get(runId)?.abort(new AppError("cancelled", 409));
    unsaved.delete(runId);
    return result;
  }
  private async commit(
    owner: string,
    runId: string,
    generation: Generation,
    actualCost?: number,
    explicitSave = false,
    usage?: { inputTokens?: number; outputTokens?: number },
  ) {
    const now = this.now();
    return this.storage.transact((db) => {
      const run = db.runs[runId];
      if (explicitSave && run?.owner === owner && run.state === "committed") {
        const trail = owned(db, owner, run.trailId, now);
        assert(
          run.committedGenerationId === generation.id ||
            (!run.committedGenerationId &&
              [
                ...trail.generations,
                ...trail.history.flatMap((revision) => revision.generations),
              ].some((g) => g.id === generation.id && g.runId === runId)),
          "conflict",
          409,
        );
        return projectOwner(db, trail);
      }
      assert(
        run &&
          run.owner === owner &&
          (["running", "unsaved"].includes(run.state) ||
            (explicitSave && run.state === "expired")),
        "cancelled",
        409,
      );
      // An interrupted result may be saved explicitly only while the original
      // version still matches. It never starts inference or revives cancellation.
      const trail = owned(db, owner, run.trailId, now);
      assert(
        trail.version === run.expectedVersion &&
          (!trail.activeRun || trail.activeRun === runId),
        "conflict",
        409,
      );
      if (run.state !== "unsaved" && run.state !== "expired")
        assert(run.leaseUntil > now, "interrupted", 409);
      trail.current = generation;
      delete trail.directionRequest;
      trail.generations.push(generation);
      trail.status = "active";
      trail.version++;
      trail.shown = [
        ...new Set([
          ...trail.shown,
          ...generation.pool.slice(0, 3).map((e) => e.id),
        ]),
      ];
      delete trail.activeRun;
      run.state = "committed";
      run.committedGenerationId = generation.id;
      // The immutable generation is retained by the trail, not duplicated on the run.
      run.elapsedMs = now - run.createdAt;
      run.leaseUntil = now;
      settle(db, run, actualCost);
      if (run.telemetry)
        Object.assign(run.telemetry, usage, {
          actualMicrodollars: actualCost,
          costStatus: actualCost === undefined ? "unknown" : "settled",
          cache: generation.discovery.cache,
        });
      run.events.push({
        runId,
        sequence: run.events.length + 1,
        type: "complete",
        message: "Your doors are ready.",
        at: now,
      });
      return projectOwner(db, trail);
    }, now);
  }
  async saveResult(owner: string, runId: string, receipt?: string) {
    for (const [id, value] of unsaved)
      if (value.expiresAt <= this.now()) unsaved.delete(id);
    let result = unsaved.get(runId);
    if (receipt) {
      try {
        const payload = decryptToken(receipt, `preview:${owner}:${runId}`);
        result = JSON.parse(
          inflateRawSync(Buffer.from(payload, "base64url"), {
            maxOutputLength: 256 * 1024,
          }).toString(),
        );
      } catch {
        throw new AppError("unsaved", 503);
      }
    }
    assert(
      result &&
        result.owner === owner &&
        result.expiresAt > this.now() &&
        result.generation.runId === runId,
      "unsaved",
      503,
    );
    const trail = await this.commit(
      owner,
      runId,
      result.generation,
      result.actualCost,
      true,
      result.usage,
    );
    unsaved.delete(runId);
    return trail;
  }
  async execute(
    owner: string,
    runId: string,
    input: AgentInput,
    trail: Trail,
    emit: (event: RunEvent, preview?: Generation, receipt?: string) => void,
  ) {
    for (const [id, value] of unsaved)
      if (value.expiresAt <= this.now()) unsaved.delete(id);
    if (unsaved.size >= 100) unsaved.delete(unsaved.keys().next().value!);
    const controller = new AbortController();
    controllers.set(runId, controller);
    const deadline = setTimeout(
      () => controller.abort(new AppError("timeout", 504)),
      45_000,
    );
    const signal = controller.signal;
    // A Stop handled by another worker changes shared state. Observe it while
    // waiting on providers too, then propagate the abort into their transports.
    let checkingCancellation = false;
    const cancellationPoll = setInterval(async () => {
      if (checkingCancellation || signal.aborted) return;
      checkingCancellation = true;
      try {
        const state = await this.storage.transact(
          (db) => db.runs[runId]?.state,
          this.now(),
        );
        if (!state || state === "cancelled" || state === "expired")
          controller.abort(
            new AppError(
              state === "expired" ? "interrupted" : "cancelled",
              409,
            ),
          );
      } catch {
        controller.abort(new AppError("storage", 503));
      } finally {
        checkingCancellation = false;
      }
    }, 500);
    const event = async (message: string) => {
      if (signal.aborted) throw signal.reason;
      if (trail.mode === "fixture") message = `Illustrated: ${message}`;
      const value = await this.storage.transact((db) => {
        const run = db.runs[runId];
        assert(
          run && ["running", "reserved"].includes(run.state),
          "cancelled",
          409,
        );
        const e: RunEvent = {
          sequence: run.events.length + 1,
          runId,
          type: "status",
          message,
          at: this.now(),
        };
        run.events.push(e);
        return e;
      });
      emit(value);
    };
    try {
      await this.storage.transact((db) => {
        const r = db.runs[runId];
        assert(r && r.state === "reserved", "cancelled", 409);
        r.state = "running";
      });
      const port = qlooPort({
        storage: this.storage,
        owner,
        mode: trail.mode,
        runId,
        trailId: trail.id,
        signal,
        onEvent: event,
      });
      const turn = new TurnTools(
        trail,
        input.destination,
        input.lessObvious,
        port,
        event,
        async () => {
          if (signal.aborted) throw signal.reason;
          if (trail.mode === "live")
            await this.storage.transact((db) => {
              const r = db.runs[runId];
              assert(r?.state === "running", "cancelled", 409);
              claimInsights(db.trails[trail.id], r);
            });
        },
        signal,
      );
      const result = await runGuide(turn, async () => {
        await this.storage.transact((db) => {
          const r = db.runs[runId];
          if (process.env.INFERENCE_PAUSED === "1")
            throw new AppError("paused", 503);
          assert(r?.state === "running" && r.modelSteps < 4, "model", 502);
          r.modelSteps++;
        });
      });
      if (signal.aborted) throw signal.reason;
      if (turn.asked) {
        await event(
          `No ${pluralName(input.destination)} from here yet. Try ${pluralName(turn.asked!)}?`,
        );
        await this.storage.transact((db) => {
          const run = db.runs[runId];
          assert(run.state === "running", "cancelled", 409);
          run.state = "committed";
          run.elapsedMs = this.now() - run.createdAt;
          run.leaseUntil = this.now();
          const t = db.trails[trail.id];
          assert(
            t.activeRun === runId && t.version === run.expectedVersion,
            "conflict",
            409,
          );
          delete t.activeRun;
          t.directionRequest = turn.asked;
          t.message = `No ${pluralName(input.destination)} from here yet. Try ${pluralName(turn.asked!)}?`;
          t.version++;
          run.events.push({
            sequence: run.events.length + 1,
            runId,
            type: "complete",
            message: t.message,
            at: this.now(),
          });
          settle(db, run, result.actualCost);
          if (run.telemetry)
            Object.assign(run.telemetry, result.usage, {
              actualMicrodollars: result.actualCost,
              costStatus:
                result.actualCost === undefined ? "unknown" : "settled",
            });
        });
      } else {
        assert(turn.published, "model", 502);
        unsaved.set(runId, {
          owner,
          generation: turn.published,
          actualCost: result.actualCost,
          usage: result.usage,
          expiresAt: this.now() + 20 * 60_000,
        });
        try {
          await this.commit(
            owner,
            runId,
            turn.published,
            result.actualCost,
            false,
            result.usage,
          );
          unsaved.delete(runId);
        } catch (e) {
          if (e instanceof AppError && e.code !== "storage") {
            unsaved.delete(runId);
            throw e;
          }
          emit(
            {
              sequence: 999,
              runId,
              type: "error",
              message: errorCopy.unsaved[0],
              at: this.now(),
            },
            turn.published,
            encryptToken(
              deflateRawSync(
                Buffer.from(JSON.stringify(unsaved.get(runId))),
              ).toString("base64url"),
              `preview:${owner}:${runId}`,
            ),
          );
          try {
            await this.storage.transact((db) => {
              const r = db.runs[runId];
              if (r.state === "running") {
                r.state = "unsaved";
                r.error = "unsaved";
              }
            });
          } catch {
            /* local preview remains disabled */
          }
          return;
        }
      }
      const current = await this.read(owner, runId);
      for (const e of current.events.filter((e) => e.type === "complete"))
        emit(e);
    } catch (error) {
      const failure =
        signal.aborted && signal.reason instanceof AppError
          ? signal.reason
          : error instanceof AppError
            ? error
            : new AppError("model", 502);
      try {
        const value = await this.storage.transact((db) => {
          const run = db.runs[runId];
          if (!run || !["reserved", "running", "unsaved"].includes(run.state))
            return;
          run.state = failure.code === "cancelled" ? "cancelled" : "failed";
          run.error = failure.code;
          run.retryAt = failure.retryAt;
          run.leaseUntil = this.now();
          run.elapsedMs = this.now() - run.createdAt;
          const t = db.trails[run.trailId];
          if (t?.activeRun === runId) delete t.activeRun;
          const e: RunEvent = {
            sequence: run.events.length + 1,
            runId,
            type: "error",
            message: failure.message,
            at: this.now(),
          };
          run.events.push(e);
          return e;
        });
        if (value) emit(value);
      } catch {
        emit({
          sequence: 999,
          runId,
          type: "error",
          message: errorCopy.storage[0],
          at: this.now(),
        });
      }
    } finally {
      clearTimeout(deadline);
      clearInterval(cancellationPoll);
      controllers.delete(runId);
    }
  }
}
function pluralName(medium: string) {
  return medium === "artist" ? "music" : medium === "movie" ? "films" : "books";
}
