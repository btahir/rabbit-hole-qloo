"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  Generation,
  Medium,
  OwnerTrail,
  RunEvent,
} from "@/lib/core/types";
import {
  localAction,
  localGeneration,
  newLocalExample,
  type LocalAction,
} from "@/lib/core/fixture-local";
export type Failure = {
  error: string;
  heading: string;
  body: string;
  retryAt?: number;
  operation?: "share" | "action" | "generate" | "session" | "read";
};
export class RequestError extends Error {
  constructor(public detail: Failure) {
    super(detail.heading);
  }
}
export const requestKey = () => crypto.randomUUID();
export async function apiRequest<T>(
  path: string,
  value?: unknown,
  method = "POST",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new RequestError(result);
  return result as T;
}
const subscribeConnection = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};
type OfflineIntent =
  | { kind: "action"; choice: LocalAction; key: string }
  | {
      kind: "generate";
      destination: Medium | "auto";
      lessObvious: boolean;
      key: string;
    };
export function useTrail(initial?: OwnerTrail) {
  const [trail, setTrail] = useState(initial),
    [generating, setGenerating] = useState(!!initial?.activeRun),
    [mutating, setMutating] = useState(false),
    [syncing, setSyncing] = useState(false),
    [failure, setFailure] = useState<Failure>(),
    [message, setMessage] = useState(initial?.message ?? ""),
    [events, setEvents] = useState<RunEvent[]>([]),
    [runId, setRunId] = useState<string | undefined>(initial?.activeRun),
    [recoveryId, setRecoveryId] = useState<string | undefined>(
      initial?.activeRun,
    ),
    [preview, setPreview] = useState<Generation>(),
    [waiting, setWaiting] = useState(false),
    [guide, setGuide] = useState("Deterministic local guide"),
    [stats, setStats] = useState({ attempts: 0, modelSteps: 0, elapsedMs: 0 });
  const busy = generating || mutating || syncing;
  const syncFlight = useRef<Promise<OwnerTrail> | undefined>(undefined);
  const operation = useRef(false);
  const heldRun = useRef(initial?.activeRun);
  const terminalRun = useRef<string | undefined>(undefined);
  const detachedExample = useRef(false);
  const failedSync = useRef(false);
  const failedAction = useRef<
    { path?: string; body?: unknown; choice: LocalAction } | undefined
  >(undefined);
  const previewReceipt = useRef<string | undefined>(undefined);
  const saveIntent = useRef<{ runId: string; key: string } | undefined>(
    undefined,
  );
  const pendingRun = useRef<
    | {
        trailId: string;
        key: string;
        cancelled: boolean;
        id?: string;
        cancellation?: Promise<unknown>;
      }
    | undefined
  >(undefined);
  const offline = useSyncExternalStore(
    subscribeConnection,
    () => !navigator.onLine,
    () => false,
  );
  const trailRef = useRef(initial),
    streamRef = useRef<AbortController | undefined>(undefined),
    startRef = useRef<number>(0),
    queue = useRef<OfflineIntent[]>([]),
    baseline = useRef<number | undefined>(undefined),
    localUndo = useRef<{ path?: OwnerTrail; reaction?: OwnerTrail }>({}),
    [queued, setQueued] = useState(false);
  const update = (value: OwnerTrail) => {
    trailRef.current = value;
    setTrail(value);
    if (value.mode === "fixture")
      sessionStorage.setItem(
        `rabbit-example:${value.id}`,
        JSON.stringify({
          trail: value,
          queue: queue.current,
          baseline: baseline.current,
          undo: localUndo.current,
        }),
      );
  };
  function report(error: unknown, operation?: Failure["operation"]) {
    const detail =
      error instanceof RequestError
        ? error.detail
        : {
            error: "network",
            heading: "We couldn't finish that action.",
            body: "Your trail is safe. Try again.",
          };
    setFailure({ ...detail, operation });
    setMessage(detail.heading);
  }
  async function replay(
    id: string,
    display = true,
    forceTrail = false,
    signal?: AbortSignal,
  ) {
    const result = await apiRequest<{
      trail?: OwnerTrail;
      state: string;
      events: RunEvent[];
      error?: string;
      retryAt?: number;
      guide: string;
      attempts: number;
      modelSteps: number;
      elapsedMs: number;
    }>(
      `/api/runs/${id}${forceTrail ? "" : `?version=${trailRef.current?.version ?? 0}`}`,
      undefined,
      "GET",
      signal,
    );
    signal?.throwIfAborted();
    if (result.trail && result.trail.id !== trailRef.current?.id)
      throw new Error("Run belongs to a different trail.");
    const terminal = !["running", "reserved"].includes(result.state);
    const stale =
      (heldRun.current && heldRun.current !== id) ||
      (terminalRun.current === id && !terminal) ||
      (result.trail && result.trail.version < (trailRef.current?.version ?? 0));
    if (display && !stale) {
      setEvents(result.events);
      if (result.trail) update(result.trail);
      setGuide(result.guide);
      setStats({
        attempts: result.attempts,
        modelSteps: result.modelSteps,
        elapsedMs: result.elapsedMs,
      });
      if (result.events.length) setMessage(result.events.at(-1)!.message);
      if (terminal) {
        terminalRun.current = id;
        if (heldRun.current === id) heldRun.current = undefined;
        setRecoveryId((current) => (current === id ? undefined : current));
        setGenerating(false);
        setWaiting(false);
        setRunId(id);
        if (result.state === "committed") setFailure(undefined);
        if (result.error && result.state !== "committed") {
          const { errorCopy } = await import("@/lib/core/errors");
          const copy =
            errorCopy[result.error as keyof typeof errorCopy] ??
            errorCopy.model;
          setFailure({
            error: result.error,
            heading: copy[0],
            body: copy[1],
            retryAt: result.retryAt,
          });
        }
      } else {
        setFailure((current) =>
          current?.error === "network" ? undefined : current,
        );
        heldRun.current = id;
        setRecoveryId(id);
        setGenerating(true);
      }
    }
    return { ...result, trail: result.trail ?? trailRef.current! };
  }
  async function generateOnline(
    value: OwnerTrail,
    destination: Medium | "auto",
    lessObvious: boolean,
    key = requestKey(),
    restoring = false,
  ) {
    const controller = new AbortController();
    const pending: NonNullable<typeof pendingRun.current> = {
      trailId: value.id,
      key,
      cancelled: false,
      id: undefined as string | undefined,
    };
    pendingRun.current = pending;
    setRunId(undefined);
    streamRef.current = controller;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
      // The request identity also cancels work accepted before its headers arrived.
      void apiRequest(
        `/api/runs/${pending.id ?? "pending"}/cancel`,
        {
          idempotencyKey: requestKey(),
          ...(!pending.id ? { trailId: pending.trailId, requestKey: key } : {}),
        },
        "POST",
        AbortSignal.timeout(5000),
      ).catch(() => {});
    }, 45_000);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trailId: value.id,
          expectedVersion: value.version,
          intent: "generate",
          destination,
          lessObvious,
          idempotencyKey: key,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new RequestError(await response.json());
      const id = response.headers.get("x-run-id")!;
      pending.id = id;
      if (!restoring) heldRun.current = id;
      if (pending.cancelled) {
        if (!restoring) setRecoveryId(id);
        return trailRef.current!;
      }
      setRunId(id);
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffered = "";
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          buffered += decoder.decode(part.value, { stream: true });
          const blocks = buffered.split("\n\n");
          buffered = blocks.pop()!;
          for (const block of blocks) {
            const line = block.split("\n").find((l) => l.startsWith("data: "));
            if (!line || line === "data: [DONE]") continue;
            const chunk = JSON.parse(line.slice(6));
            if (chunk.type === "data-run" && !pending.cancelled && !restoring) {
              const event = chunk.data.event as RunEvent;
              setEvents((prev) => [
                ...prev.filter(
                  (e) =>
                    e.sequence !== event.sequence || e.runId !== event.runId,
                ),
                event,
              ]);
              setMessage(event.message);
              if (chunk.data.preview) {
                setPreview(chunk.data.preview);
                previewReceipt.current = chunk.data.receipt;
                setFailure({
                  error: "unsaved",
                  heading: "These doors aren't saved yet.",
                  body: "Keep this page open and try saving again.",
                });
              }
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          if (timedOut) throw error;
          return trailRef.current!;
        }
        if (!navigator.onLine)
          throw error; /* read the held run, never resubmit */
      }
      if (pending.cancelled) return trailRef.current!;
      let result = await replay(id, !restoring, restoring, controller.signal);
      // Replaying offline intents must await each acknowledged generation before
      // applying its queued follow/reaction. It never starts replacement work.
      while (restoring && ["running", "reserved"].includes(result.state)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        controller.signal.throwIfAborted();
        result = await replay(id, false, true, controller.signal);
      }
      if (restoring && result.state !== "committed")
        throw new RequestError({
          error: result.error ?? "interrupted",
          heading: "This step was interrupted. Your saved trail is safe.",
          body: "Try again",
        });
      return result.trail;
    } catch (error) {
      // A dropped stream never means the accepted work stopped. Reconcile that
      // run until terminal; do not submit another generation to recover it.
      if (pending.id && heldRun.current === pending.id && !restoring)
        setRecoveryId(pending.id);
      if (timedOut)
        throw new RequestError({
          error: "timeout",
          heading: "This step took too long.",
          body: "Your trail is safe. Try again when you're ready.",
        });
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }
  useEffect(() => {
    // Initial restoration reads browser-only example state after hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (initial?.mode === "fixture") {
      try {
        const raw = sessionStorage.getItem(`rabbit-example:${initial.id}`);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.queue?.length) {
            queue.current = saved.queue;
            baseline.current = saved.baseline;
            localUndo.current = saved.undo ?? {};
            if (!saved.undo) saved.trail.canUndo = false;
            trailRef.current = saved.trail;
            setTrail(saved.trail);
            setQueued(true);
          }
        }
      } catch {
        /* a stored example is optional */
      }
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      streamRef.current?.abort();
    };
  }, [initial]);
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => {
      if (Date.now() - startRef.current >= 10_000) setWaiting(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [generating]);
  useEffect(() => {
    const id = recoveryId;
    if (!id) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 2000;
      try {
        const result = await replay(id, true, false, controller.signal);
        if (!["running", "reserved"].includes(result.state)) return;
      } catch (error) {
        if (!active) return;
        report(error);
        delay =
          error instanceof RequestError && error.detail.retryAt
            ? Math.max(2000, error.detail.retryAt - Date.now())
            : 5000;
      }
      if (active) timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
    // Reads only the held run and never creates one on mount or refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryId]);
  function enqueue(intent: OfflineIntent) {
    baseline.current ??= trailRef.current!.version;
    queue.current.push(intent);
    setQueued(true);
  }
  function syncOffline(standalone = false): Promise<OwnerTrail> {
    if (syncFlight.current) return syncFlight.current;
    setSyncing(true);
    if (standalone) setFailure(undefined);
    syncFlight.current = replayOfflineQueue()
      .then((value) => {
        failedSync.current = false;
        return value;
      })
      .catch((error) => {
        failedSync.current = standalone;
        throw error;
      })
      .finally(() => {
        syncFlight.current = undefined;
        setSyncing(false);
      });
    return syncFlight.current;
  }
  async function replayOfflineQueue(): Promise<OwnerTrail> {
    let current = trailRef.current!;
    if (!queue.current.length) return current;
    if (!navigator.onLine) throw new Error("Reconnect to save this example.");
    if (current.id.startsWith("local-")) await apiRequest("/api/session", {});
    const saved = current.id.startsWith("local-")
      ? await apiRequest<OwnerTrail>("/api/trails", {
          entityId: current.root.id,
          sample: true,
          example: true,
          idempotencyKey: current.id,
        })
      : await apiRequest<OwnerTrail>(
          `/api/trails/${current.id}`,
          undefined,
          "GET",
        );
    if (saved.version !== (baseline.current ?? 1))
      throw new RequestError({
        error: "conflict",
        heading: "This trail changed in another tab.",
        body: "Open the latest version to keep going.",
      });
    current = saved;
    const local = { ...trailRef.current!, id: saved.id };
    if (trailRef.current!.id !== saved.id) update(local);
    current = saved;
    while (queue.current.length) {
      const intent = queue.current[0];
      if (intent.kind === "generate")
        current = await generateOnline(
          current,
          intent.destination,
          intent.lessObvious,
          intent.key,
          true,
        );
      else
        current = await apiRequest<OwnerTrail>(
          `/api/trails/${current.id}/actions`,
          {
            expectedVersion: current.version,
            idempotencyKey: intent.key,
            choice: {
              ...intent.choice,
              ...(["follow", "known", "reject"].includes(intent.choice.action)
                ? { generationId: current.current?.id }
                : {}),
            },
          },
        );
      queue.current.shift();
      baseline.current = current.version;
      // The synthetic view and only the unacknowledged suffix survive reload.
      sessionStorage.setItem(
        `rabbit-example:${current.id}`,
        JSON.stringify({
          trail: { ...local, id: current.id },
          queue: queue.current,
          baseline: baseline.current,
          undo: localUndo.current,
        }),
      );
    }
    queue.current = [];
    detachedExample.current = false;
    baseline.current = undefined;
    localUndo.current = {};
    setQueued(false);
    update(current);
    setMessage(current.message ?? "Your example is saved online.");
    window.history.replaceState(null, "", `/t/${current.id}`);
    return current;
  }
  async function generate(destination: Medium | "auto", lessObvious: boolean) {
    if (!trailRef.current || operation.current || heldRun.current) return;
    operation.current = true;
    const intent = {
      trailId: trailRef.current.id,
      key: requestKey(),
      cancelled: false,
    };
    pendingRun.current = intent;
    setRunId(undefined);
    failedAction.current = undefined;
    setFailure(undefined);
    setPreview(undefined);
    setMessage("Finding your next doors");
    setEvents([]);
    setWaiting(false);
    if (
      (!navigator.onLine || detachedExample.current) &&
      trailRef.current.mode === "fixture"
    ) {
      enqueue({
        kind: "generate",
        destination,
        lessObvious,
        key: requestKey(),
      });
      update(localGeneration(trailRef.current, destination, lessObvious));
      setMessage(
        "These steps illustrate the flow. No agent or Qloo request ran.",
      );
      operation.current = false;
      return true;
    }
    setGenerating(true);
    startRef.current = Date.now();
    try {
      const value = await syncOffline();
      if (!intent.cancelled) {
        await generateOnline(value, destination, lessObvious, intent.key);
        return (
          !intent.cancelled && !heldRun.current && !!trailRef.current?.current
        );
      }
    } catch (e) {
      if (!pendingRun.current?.cancelled) report(e, "generate");
    } finally {
      await pendingRun.current?.cancellation?.catch(() => {});
      operation.current = false;
      setGenerating(!!heldRun.current);
      if (!heldRun.current) setWaiting(false);
    }
  }
  async function action(choice: LocalAction, retry = false): Promise<boolean> {
    const value = trailRef.current;
    if (!value || operation.current) return false;
    operation.current = true;
    if (!retry) failedAction.current = { choice };
    else if (failedAction.current) choice = failedAction.current.choice;
    setFailure(undefined);
    if (
      (!navigator.onLine || detachedExample.current) &&
      value.mode === "fixture"
    ) {
      if (choice.action === "undo") {
        const lane = localUndo.current.reaction ? "reaction" : "path";
        const before = localUndo.current[lane];
        if (before) {
          const next = {
            ...value,
            version: value.version + 1,
            message: "Undone.",
          };
          if (lane === "reaction")
            Object.assign(next, {
              saved: before.saved,
              loves: before.loves,
              excluded: before.excluded,
            });
          else
            Object.assign(next, {
              root: before.root,
              steps: before.steps,
              generations: before.generations,
              current: before.current,
              status: before.status,
              revision: before.revision,
              directionRequest: before.directionRequest,
            });
          delete localUndo.current[lane];
          next.canUndo = !!(
            localUndo.current.path || localUndo.current.reaction
          );
          enqueue({ kind: "action", choice, key: requestKey() });
          update(next);
        }
        failedAction.current = undefined;
        operation.current = false;
        return true;
      }
      if (["follow", "branch", "finish"].includes(choice.action)) {
        localUndo.current.path = structuredClone(value);
        delete localUndo.current.reaction;
      } else localUndo.current.reaction = structuredClone(value);
      enqueue({ kind: "action", choice, key: requestKey() });
      update(localAction(value, choice));
      failedAction.current = undefined;
      operation.current = false;
      return true;
    }
    setMutating(true);
    setMessage("Saving your choice…");
    try {
      const current = await syncOffline();
      const intent =
        retry && failedAction.current?.path
          ? failedAction.current
          : {
              path: `/api/trails/${current.id}/actions`,
              choice,
              body: {
                expectedVersion: current.version,
                idempotencyKey: requestKey(),
                choice: {
                  ...choice,
                  ...(["follow", "known", "reject"].includes(choice.action)
                    ? { generationId: current.current?.id }
                    : {}),
                },
              },
            };
      failedAction.current = intent;
      const result = await apiRequest<OwnerTrail>(intent.path!, intent.body);
      failedAction.current = undefined;
      update(result);
      setMessage(result.message ?? "");
      return true;
    } catch (e) {
      report(e, "action");
      return false;
    } finally {
      operation.current = false;
      setMutating(false);
    }
  }
  async function stop() {
    const pending = pendingRun.current;
    const id = pending?.id ?? runId;
    if (pending) pending.cancelled = true;
    const cancellation = pending?.trailId.startsWith("local-")
      ? Promise.resolve()
      : apiRequest(`/api/runs/${id ?? "pending"}/cancel`, {
          idempotencyKey: requestKey(),
          ...(!id && pending
            ? { trailId: pending.trailId, requestKey: pending.key }
            : {}),
        });
    if (pending) pending.cancellation = cancellation;
    streamRef.current?.abort();
    setMessage("Stopping this step…");
    try {
      await cancellation;
      if (id) await replay(id);
      setMessage("Stopped. Your trail is safe.");
    } catch (e) {
      report(e);
    } finally {
      operation.current = false;
      if (heldRun.current) setRecoveryId(heldRun.current);
      setGenerating(!!heldRun.current);
      if (!heldRun.current) setWaiting(false);
    }
  }
  async function saveResult() {
    if (!trailRef.current || !runId || operation.current) return;
    operation.current = true;
    setMutating(true);
    try {
      if (saveIntent.current?.runId !== runId)
        saveIntent.current = { runId, key: requestKey() };
      const result = await apiRequest<OwnerTrail>("/api/agent", {
        trailId: trailRef.current.id,
        expectedVersion: trailRef.current.version,
        intent: "saveResult",
        receipt: previewReceipt.current,
        runId,
        idempotencyKey: saveIntent.current.key,
      });
      update(result);
      setFailure(undefined);
      setPreview(undefined);
      saveIntent.current = undefined;
    } catch (e) {
      report(e);
    } finally {
      operation.current = false;
      setMutating(false);
    }
  }
  const createLocalExample = (
    root: import("@/lib/core/types").Entity,
    detached = false,
  ) => {
    detachedExample.current = detached;
    queue.current = [];
    baseline.current = 1;
    localUndo.current = {};
    const value = newLocalExample(root);
    update(value);
    return value;
  };
  return {
    createLocalExample,
    trail,
    update,
    busy,
    generating,
    mutating,
    failure,
    setFailure,
    message,
    setMessage,
    offline,
    events,
    runId,
    preview,
    waiting,
    guide,
    stats,
    queued,
    generate,
    retry: (destination: Medium | "auto", lessObvious: boolean) =>
      failedAction.current
        ? action({ action: "retry" }, true)
        : failedSync.current
          ? syncOffline(true).catch(report)
          : generate(destination, lessObvious),
    action,
    stop,
    replay,
    report,
    saveResult,
    syncOffline,
  };
}
