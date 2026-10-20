"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { samples, fixtureSearch } from "@/lib/core/fixtures";
import {
  label,
  media,
  plural,
  visibleDoors,
  defaultMedium,
  type Entity,
  type Generation,
  type Medium,
  type Mode,
  type OwnerTrail,
  type RunEvent,
} from "@/lib/core/types";
import { Button } from "./ui/button";
import { Drawer } from "./ui/drawer";
import { TrailKeepsake } from "./trail-keepsake";
import {
  connectionLine,
  rankingChange,
  rankingHeadline,
} from "@/lib/core/connections";
import { TryThis } from "./try-this";
import { BrandMark, EntityArt } from "./entity-art";
import { EntityView, EntityDescription, InformationLink } from "./entity-view";
import { comparisonReturnKey } from "./comparison-return";
import { EvidenceView } from "./evidence-view";
import {
  apiRequest,
  requestKey,
  useTrail,
  RequestError,
  type Failure,
} from "./use-trail";
type DrawerName =
  | "how"
  | "privacy"
  | "sources"
  | "saved"
  | "excluded"
  | "other"
  | "edit"
  | "share"
  | "steps"
  | "evidence"
  | "delete"
  | "revoke"
  | "branch"
  | undefined;
export function Workspace({
  initial,
  mode,
  initialError,
  liveSamples = [],
  localGuide = true,
}: {
  initial?: OwnerTrail;
  mode: Mode;
  initialError?: Failure;
  liveSamples?: Entity[];
  localGuide?: boolean;
}) {
  const router = useRouter();
  const [clockNow, setClockNow] = useState(0);
  const [shareNote, setShareNote] = useState("");
  const [sharing, setSharing] = useState(false);
  const shareGuard = useRef(false);
  const [keptDirection, setKeptDirection] = useState(false);
  const [continueSummary, setContinueSummary] = useState("");
  const flow = useTrail(initial),
    { trail, busy: flowBusy, offline, message, failure } = flow;
  const [drawer, changeDrawer] = useState<DrawerName>(),
    [ready, setReady] = useState(false),
    [query, setQuery] = useState(""),
    [medium, setMedium] = useState<Medium>("movie"),
    [results, setResults] = useState<Entity[]>(),
    [selected, setSelected] = useState<string>(),
    [searching, setSearching] = useState(false),
    [searchMessage, setSearchMessage] = useState(""),
    [searchRetryAt, setSearchRetryAt] = useState(0),
    [creating, setCreating] = useState(false),
    [exampleMode, setExampleMode] = useState(false),
    [newStart, setNewStart] = useState(false),
    [continueId, setContinueId] = useState<string>(),
    [destination, setDestination] = useState<Medium | "auto">("auto"),
    [lessObvious, setLessObvious] = useState(
      initial?.lessObvious ??
        initial?.current?.lessObvious ??
        initial?.generations.at(-1)?.lessObvious ??
        false,
    ),
    [evidence, setEvidence] = useState<{
      entity: Entity;
      generation: Generation;
    }>(),
    [share, setShare] = useState<{ shareId: string; token: string }>(),
    [branchPoint, setBranchPoint] = useState(0),
    [targetShare, setTargetShare] = useState<string>(),
    [dialogFailure, setDialogFailure] = useState("");
  const [previousTrail, setPreviousTrail] = useState<{
    id: string;
    rootName: string;
    choices: number;
  }>();
  const [trace, setTrace] = useState<{
    events: RunEvent[];
    guide: string;
    attempts: number;
    modelSteps: number;
    elapsedMs: number;
    notice?: string;
  }>();
  const drawerOpener = useRef<HTMLElement | null>(null);
  function setDrawer(next: DrawerName) {
    const focused = document.activeElement as HTMLElement | null;
    if (next && !focused?.closest('[role="dialog"]'))
      drawerOpener.current = focused;
    changeDrawer(next);
  }
  const stepsOpener = useRef<HTMLElement | null>(null);
  const traceSequence = useRef(0);
  const busy = flowBusy || creating;
  const creatingRef = useRef(false);
  const creationIntent = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const evidenceOpener = useRef<HTMLElement | null>(null);
  const shareIntent = useRef<
    { path: string; version: number; note: string; key: string } | undefined
  >(undefined);
  const mainRef = useRef<HTMLElement>(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const searchSequence = useRef(0);
  const searchResultHeading = useRef<HTMLHeadingElement>(null);
  const rootInput = useRef<HTMLInputElement>(null);
  const searchController = useRef<AbortController | undefined>(undefined),
    panel = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    apiRequest<{
      current?: string;
      previous?: string;
      previousSummary?: { rootName: string; choices: number };
      continuation?: { rootName: string; choices: number };
    }>("/api/session", {})
      .then((s) => {
        setReady(true);
        flow.setFailure((current) =>
          current?.operation === "session" ? undefined : current,
        );
        if (sessionAttempt > 0)
          requestAnimationFrame(() =>
            (trail ? panel.current : rootInput.current)?.focus(),
          );
        if (!initial && window.location.pathname === "/") {
          setNewStart(true);
          setCreating(false);
          creatingRef.current = false;
        }
        setContinueId(s.current);
        if (s.previous && s.previousSummary)
          setPreviousTrail({ id: s.previous, ...s.previousSummary });
        if (s.continuation)
          setContinueSummary(
            `${s.continuation.rootName} · ${s.continuation.choices} of 3 discoveries`,
          );
        if (new URL(window.location.href).searchParams.get("deleted") === "1")
          flow.setMessage("Your trail was deleted.");
      })
      .catch((error) => {
        const detail =
          error instanceof RequestError &&
          error.detail.error &&
          error.detail.heading
            ? error.detail
            : {
                error: "session",
                heading: "We couldn't start your session.",
                body: "Try connecting again, or open an example.",
              };
        flow.setFailure({ ...detail, operation: "session" });
        flow.setMessage(detail.heading);
      });
    if (initialError) flow.setFailure(initialError);
  }, [sessionAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!initial || sessionStorage.getItem("rabbit-focus-trail") !== initial.id)
      return;
    sessionStorage.removeItem("rabbit-focus-trail");
    const frame = requestAnimationFrame(() => panel.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [initial]);
  useEffect(() => {
    if (!initial) return;
    let frame: number | undefined;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(comparisonReturnKey) ?? "null",
      );
      if (saved?.path === `/t/${initial.id}`) {
        sessionStorage.removeItem(comparisonReturnKey);
        const generation = initial.generations.find(
          (g) => g.id === saved.generationId,
        );
        const entity = generation?.pool.find((e) => e.id === saved.entityId);
        frame = requestAnimationFrame(() => {
          if (generation && entity) {
            setEvidence({ generation, entity });
            setDrawer("evidence");
          }
          window.scrollTo(0, Number.isFinite(saved.scroll) ? saved.scroll : 0);
        });
      }
    } catch {
      /* No optional comparison navigation state. */
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [initial]);
  useEffect(() => {
    if (!failure?.retryAt && !searchRetryAt) return;
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [failure?.retryAt, searchRetryAt]);
  const currentMode = newStart
    ? exampleMode
      ? "fixture"
      : mode
    : (trail?.mode ?? mode);
  const anchor = trail?.steps.at(-1)?.entity ?? trail?.root;
  const doors = trail ? visibleDoors(trail) : [];
  const changed = () => {
    setDestination("auto");
    setKeptDirection(false);
    requestAnimationFrame(() => panel.current?.focus());
  };
  async function find(event: FormEvent) {
    event.preventDefault();
    if (
      searching ||
      creatingRef.current ||
      (currentMode !== "fixture" && Date.now() < searchRetryAt)
    )
      return;
    setSearchMessage("");
    flow.setFailure(undefined);
    const q = query.trim();
    if (q.length < 2) {
      setSearchMessage("Enter at least two characters.");
      rootInput.current?.focus();
      return;
    }
    if (q.length > 120) {
      setSearchMessage("Keep the title under 120 characters.");
      rootInput.current?.focus();
      return;
    }
    if (
      exampleMode ||
      (newStart && trail?.mode === "fixture" && currentMode === "fixture") ||
      ((!ready || offline) && currentMode === "fixture")
    ) {
      const entities = fixtureSearch(q, medium);
      setSelected(undefined);
      setResults(entities.length ? entities : undefined);
      if (!entities.length)
        setSearchMessage(
          "This example only includes the starting points shown. Choose one, or reconnect to search.",
        );
      else requestAnimationFrame(() => searchResultHeading.current?.focus());
      return;
    }
    if (offline) {
      setSearchMessage(
        "This example only includes the starting points shown. Choose one, or reconnect to search.",
      );
      return;
    }
    const sequence = ++searchSequence.current;
    setSearching(true);
    setResults(undefined);
    setSelected(undefined);
    const controller = new AbortController();
    searchController.current = controller;
    try {
      const result = await apiRequest<{ entities: Entity[] }>(
        "/api/search",
        { query: q, medium },
        "POST",
        controller.signal,
      );
      if (controller.signal.aborted || sequence !== searchSequence.current)
        return;
      setResults(result.entities);
      flow.setMessage(
        result.entities.length
          ? `${result.entities.length} starting ${result.entities.length === 1 ? "point" : "points"} found. Confirm your choice.`
          : "We couldn't find that starting point.",
      );
      requestAnimationFrame(() => searchResultHeading.current?.focus());
    } catch (error) {
      if (!controller.signal.aborted && sequence === searchSequence.current) {
        flow.report(error);
        if (error instanceof RequestError && error.detail.retryAt) {
          setSearchRetryAt(error.detail.retryAt);
          setClockNow(Date.now());
        }
      }
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }
  async function create(entity: Entity, sample = false) {
    if (creatingRef.current) return;
    flow.setFailure(undefined);
    if (currentMode === "fixture" && (offline || !ready)) {
      flow.createLocalExample(entity, !ready && !offline);
      setNewStart(false);
      setExampleMode(true);
      if (sample) await flow.generate("auto", false);
      changed();
      return;
    }
    if (offline || !ready) return;
    creatingRef.current = true;
    setCreating(true);
    const signature = `${entity.id}:${sample}:${exampleMode}`;
    if (creationIntent.current?.signature !== signature)
      creationIntent.current = { signature, key: requestKey() };
    const creationKey = creationIntent.current.key;
    let navigating = false;
    try {
      if (
        sample &&
        !exampleMode &&
        mode === "live" &&
        !liveSamples.some((e) => e.id === entity.id)
      ) {
        setQuery(entity.name);
        setMedium(entity.medium);
        setNewStart(true);
        setSearchMessage(
          "Live examples need verified identities. Find and confirm this starting point to continue.",
        );
        return;
      }
      const result = await apiRequest<OwnerTrail>("/api/trails", {
        entityId: entity.id,
        sample,
        example: currentMode === "fixture",
        idempotencyKey: creationKey,
      });
      creationIntent.current = undefined;
      flow.update(result);
      setNewStart(false);
      setResults(undefined);
      setShare(undefined);
      setContinueId(result.id);
      flow.setMessage(
        trail
          ? "Your previous trail is kept."
          : `Starting with ${result.root.name}`,
      );
      await flow.generate("auto", false);
      changed();
      // Commit navigation through Next so the brand and Back render the correct page.
      sessionStorage.setItem("rabbit-focus-trail", result.id);
      navigating = true;
      router.replace(`/t/${result.id}`, { scroll: false });
    } catch (error) {
      flow.report(error);
    } finally {
      if (!navigating) {
        creatingRef.current = false;
        setCreating(false);
      }
    }
  }
  function invalidateSearch() {
    searchSequence.current++;
    searchController.current?.abort();
    setSearching(false);
    setResults(undefined);
    setSelected(undefined);
    setSearchMessage("");
  }
  const actionFocus = useRef<
    { action: string; rowIndex: number; index: number } | undefined
  >(undefined);
  function restoreActionFocus({
    action,
    rowIndex,
    index,
  }: {
    action: string;
    rowIndex: number;
    index: number;
  }) {
    if (["unsave", "removeExclusion"].includes(action) && rowIndex >= 0)
      requestAnimationFrame(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const rows = [...(dialog?.querySelectorAll("li") ?? [])];
        const row = rows[Math.min(rowIndex, rows.length - 1)];
        const target =
          row?.querySelector<HTMLElement>("button") ??
          dialog?.querySelector<HTMLElement>("h2");
        if (target) {
          if (target.tagName === "H2") target.tabIndex = -1;
          target.focus();
        }
      });
    if (["follow", "finish", "undo"].includes(action)) changed();
    if (["known", "reject"].includes(action))
      requestAnimationFrame(() => {
        const follows = [
          ...(mainRef.current?.querySelectorAll<HTMLButtonElement>(
            ".door-follow",
          ) ?? []),
        ].filter((button) => button.getClientRects().length > 0);
        if (follows.length)
          follows[Math.min(Math.max(0, index), follows.length - 1)].focus();
        else panel.current?.focus();
      });
  }
  async function act(action: string, entity?: Entity, generation?: Generation) {
    const removedButton = document.activeElement as HTMLElement;
    const drawerRows = [
      ...(removedButton.closest('[role="dialog"]')?.querySelectorAll("li") ??
        []),
    ];
    const rowIndex = drawerRows.indexOf(removedButton.closest("li")!);
    const index = entity ? doors.findIndex((e) => e.id === entity.id) : -1;
    actionFocus.current = { action, rowIndex, index };
    const acknowledged = await flow.action({
      action,
      ...(entity ? { entityId: entity.id } : {}),
      ...(generation ? { generationId: generation.id } : {}),
    });
    if (acknowledged && actionFocus.current)
      restoreActionFocus(actionFocus.current);
  }
  async function retryFlow() {
    const operation = failure?.operation;
    if (await flow.retry(destination, lessObvious)) {
      if (operation === "action" && actionFocus.current)
        restoreActionFocus(actionFocus.current);
      else changed();
    }
  }

  function openShare() {
    setShare(undefined);
    setDrawer("share");
    void createShare();
  }
  async function createShare() {
    if (!trail || offline) {
      flow.setMessage("Reconnect to make a share link.");
      return;
    }
    if (failure?.retryAt && Date.now() < failure.retryAt) return;
    if (shareGuard.current) return;
    shareGuard.current = true;
    setSharing(true);
    try {
      flow.setFailure(undefined);
      const current = await flow.syncOffline();
      const path = `/api/trails/${current.id}/shares`;
      if (
        shareIntent.current?.path !== path ||
        shareIntent.current.version !== current.version ||
        shareIntent.current.note !== shareNote.trim()
      )
        shareIntent.current = {
          path,
          version: current.version,
          note: shareNote.trim(),
          key: requestKey(),
        };
      const result = await apiRequest<{ shareId: string; token: string }>(
        path,
        {
          expectedVersion: shareIntent.current.version,
          idempotencyKey: shareIntent.current.key,
          note: shareNote.trim(),
        },
      );
      setShare(result);
      setDrawer("share");
    } catch (error) {
      flow.report(error, "share");
    } finally {
      shareGuard.current = false;
      setSharing(false);
    }
  }
  async function removeTrail() {
    if (!trail) return;
    setDialogFailure("");
    try {
      await apiRequest(
        `/api/trails/${trail.id}`,
        { expectedVersion: trail.version, idempotencyKey: requestKey() },
        "DELETE",
      );
      sessionStorage.removeItem(`rabbit-example:${trail.id}`);
      router.push("/?deleted=1");
    } catch {
      setDialogFailure("We couldn't delete this trail. Please try again.");
    }
  }
  async function revoke() {
    if (!targetShare) return;
    setDialogFailure("");
    try {
      await apiRequest(
        `/api/shares/${targetShare}`,
        { idempotencyKey: requestKey() },
        "DELETE",
      );
      setShare(undefined);
      setDrawer(undefined);
      flow.setMessage("This link no longer opens your trail.");
      if (trail)
        flow.update(
          await apiRequest<OwnerTrail>(
            `/api/trails/${trail.id}`,
            undefined,
            "GET",
          ),
        );
    } catch {
      setDialogFailure("We couldn't stop sharing this link. Please try again.");
    }
  }
  async function openSteps(run?: string) {
    const sequence = ++traceSequence.current;
    stepsOpener.current =
      drawer === "evidence"
        ? evidenceOpener.current
        : (document.activeElement as HTMLElement);
    setTrace({
      events: [],
      guide: "",
      attempts: 0,
      modelSteps: 0,
      elapsedMs: 0,
      notice: "Loading run history…",
    });
    setDrawer("steps");
    const generation = run
      ? trail?.generations.find((g) => g.runId === run)
      : (trail?.current ?? trail?.generations.at(-1));
    const id = run ?? flow.runId ?? generation?.runId;
    if (generation?.inherited) {
      setTrace({
        events: [],
        guide: "Shared connection",
        attempts: 0,
        modelSteps: 0,
        elapsedMs: 0,
        notice:
          "This step was inherited from a shared trail. Its connection is available in Why this?; the creator's private run history is not shared.",
      });
      return;
    }
    if (id && !id.startsWith("offline")) {
      try {
        // Reading a trace never restores a trail, even for this session's older runs.
        const result = await apiRequest<{
          trailId: string;
          events: RunEvent[];
          guide: string;
          attempts: number;
          modelSteps: number;
          elapsedMs: number;
        }>(`/api/runs/${id}?version=${trail?.version ?? 0}`, undefined, "GET");
        if (result.trailId !== trail?.id) throw new Error("Foreign trace");
        if (sequence === traceSequence.current) setTrace(result);
      } catch {
        if (sequence === traceSequence.current)
          setTrace({
            events: [],
            guide: "",
            attempts: 0,
            modelSteps: 0,
            elapsedMs: 0,
            notice:
              "This run history isn't available here. Your current trail is unchanged.",
          });
      }
    } else setTrace({ events: flow.events, guide: flow.guide, ...flow.stats });
  }
  function startAgain() {
    invalidateSearch();
    setExampleMode(currentMode === "fixture");
    setSearchRetryAt(0);
    setNewStart(true);
    requestAnimationFrame(() => rootInput.current?.focus());
  }
  function changeDirection() {
    const details =
      document.querySelector<HTMLDetailsElement>(".direction-details");
    if (details) details.open = true;
    requestAnimationFrame(
      () => (
        document.querySelector(".direction-details")?.setAttribute("open", ""),
        document.getElementById("destination")?.focus()
      ),
    );
  }
  const evidenceButton = (entity: Entity, generation: Generation) => (
    <Button
      aria-label={`Why this? ${entity.name}`}
      onClick={() => {
        evidenceOpener.current = document.activeElement as HTMLElement;
        setEvidence({ entity, generation });
        setDrawer("evidence");
      }}
    >
      Why this?
    </Button>
  );
  const savedButton = (entity: Entity, compact = false) => (
    <Button
      disabled={busy}
      aria-label={`${trail?.saved.some((e) => e.id === entity.id) ? "Saved" : "Save for later"} ${entity.name}`}
      aria-pressed={trail?.saved.some((e) => e.id === entity.id)}
      onClick={() =>
        act(
          trail?.saved.some((e) => e.id === entity.id) ? "unsave" : "save",
          entity,
        )
      }
    >
      {trail?.saved.some((e) => e.id === entity.id)
        ? "Saved"
        : compact
          ? "Save"
          : "Save for later"}
    </Button>
  );
  const loveButton = (entity: Entity) => (
    <Button
      disabled={busy}
      aria-label={`I love this: ${entity.name}`}
      aria-pressed={trail?.loves.some((e) => e.id === entity.id)}
      onClick={() =>
        act(
          trail?.loves.some((e) => e.id === entity.id) ? "unlove" : "love",
          entity,
        )
      }
    >
      I love this
    </Button>
  );
  const close = () => {
    traceSequence.current++;
    setDrawer(undefined);
    setDialogFailure("");
  };
  const actionFailure =
    failure?.operation === "action" ? (
      <section className="notice" role="alert">
        <h3>
          {failure.error === "invalid_seed" && trail?.steps.length
            ? `This ${anchor?.medium === "book" ? "book" : "discovery"} can’t lead to another discovery.`
            : failure.heading}
        </h3>
        <p>
          {failure.error === "invalid_seed" && trail?.steps.length
            ? "Keep it in your trail, or go back and choose another door."
            : failure.body}
        </p>
        {failure.retryAt ? (
          <p>
            Try again after{" "}
            {new Date(failure.retryAt).toLocaleString(undefined, {
              timeZoneName: "short",
            })}
            .
          </p>
        ) : null}
        {failure.error === "conflict" ? (
          <Button onClick={() => window.location.reload()}>
            Open latest version
          </Button>
        ) : (
          <Button
            disabled={
              busy ||
              offline ||
              (!!failure.retryAt && clockNow < failure.retryAt)
            }
            onClick={retryFlow}
          >
            Try again
          </Button>
        )}
      </section>
    ) : null;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header>
        <nav aria-label="Main">
          <Link prefetch={false} className="brand" href="/">
            <BrandMark /> Rabbit Hole
          </Link>
          <span className="nav-note">
            Film <span>—</span> Music <span>—</span> Books
          </span>
          <Button onClick={() => setDrawer("how")}>How it works</Button>
          {trail ? (
            <Link prefetch={false} href={`/t/${trail.id}`}>
              Your trail <span className="count">{trail.steps.length}</span>
            </Link>
          ) : null}
        </nav>
        {currentMode === "fixture" ? (
          <div className="mode-strip" data-testid="fixture-mode">
            Example mode. These connections are illustrative, not live Qloo
            results.{" "}
            <Button
              onClick={() => {
                if (mode === "live") {
                  invalidateSearch();
                  setSearchRetryAt(0);
                  setExampleMode(false);
                  setNewStart(true);
                  setDrawer(undefined);
                } else
                  flow.setMessage(
                    "Live connections aren't available right now.",
                  );
              }}
            >
              Use live connections
            </Button>
          </div>
        ) : null}
      </header>
      <main
        ref={mainRef}
        id="main"
        className={
          !trail || newStart
            ? "workspace home-workspace"
            : `workspace ${trail.status === "complete" ? "complete-workspace" : "active-workspace"}`
        }
      >
        {offline ? (
          <aside className="notice">
            <p>You&apos;re offline. You can still read this open trail.</p>
            <Button
              onClick={() => {
                flow.setMessage(
                  navigator.onLine
                    ? "Connection restored. Continue when you are ready."
                    : "You're still offline.",
                );
              }}
            >
              Try connection again
            </Button>
            {currentMode === "live" ? (
              <Button
                onClick={() => {
                  invalidateSearch();
                  setSearchRetryAt(0);
                  setExampleMode(true);
                  setNewStart(true);
                }}
              >
                Open offline example
              </Button>
            ) : null}
          </aside>
        ) : null}
        <div
          className={
            failure ||
            flow.generating ||
            /^(Added |Starting with )/.test(message) ||
            (trail?.current &&
              !busy &&
              (!message ||
                /^(Your doors are ready|Opening saved Qloo results|Found \d|Checking |Looking for |Illustrated:)/.test(
                  message,
                )))
              ? "live-status sr-only"
              : "live-status"
          }
          role="status"
          aria-live="polite"
        >
          {flow.generating ? "" : message}
          {flow.waiting && !flow.generating ? (
            <p>Still waiting. Your trail is safe.</p>
          ) : null}
        </div>
        {failure && !(drawer === "share" && failure.operation === "share") ? (
          <section className="notice" data-testid={`error-${failure.error}`}>
            <h2>
              {failure.error === "invalid_seed" && trail?.steps.length
                ? `This ${anchor?.medium === "book" ? "book" : "discovery"} can’t lead to another discovery.`
                : failure.heading}
            </h2>
            <p>
              {failure.error === "invalid_seed" && trail?.steps.length
                ? "Keep it in your trail, or go back and choose another door."
                : failure.body}
            </p>
            {failure.retryAt ? (
              <p>
                Try again after{" "}
                {new Date(failure.retryAt).toLocaleString(undefined, {
                  timeZoneName: "short",
                })}
                .
              </p>
            ) : null}
            <div className="actions">
              {failure.operation === "share" && failure.error !== "conflict" ? (
                <Button
                  disabled={
                    busy ||
                    offline ||
                    (!!failure.retryAt && clockNow < failure.retryAt)
                  }
                  onClick={openShare}
                >
                  Try again
                </Button>
              ) : failure.error === "invalid_seed" ? (
                trail?.steps.length && trail.canUndo ? (
                  <Button onClick={() => act("undo")}>
                    Back to other discoveries
                  </Button>
                ) : (
                  <Button onClick={startAgain}>Change starting point</Button>
                )
              ) : failure.operation === "read" ? (
                <Button
                  disabled={!!failure.retryAt && clockNow < failure.retryAt}
                  onClick={() => window.location.reload()}
                >
                  Reload trail
                </Button>
              ) : failure.operation === "session" ? (
                <Button
                  disabled={!!failure.retryAt && clockNow < failure.retryAt}
                  onClick={() => {
                    flow.setMessage("Connecting…");
                    setSessionAttempt((n) => n + 1);
                  }}
                >
                  Try again
                </Button>
              ) : failure.error === "conflict" ? (
                <Button onClick={() => window.location.reload()}>
                  Open latest version
                </Button>
              ) : failure.error === "unsaved" ? (
                <Button onClick={flow.saveResult}>Try saving again</Button>
              ) : trail && !["paused", "owner"].includes(failure.error) ? (
                <Button
                  disabled={
                    busy ||
                    offline ||
                    (!!failure.retryAt && clockNow < failure.retryAt)
                  }
                  onClick={retryFlow}
                >
                  Try again
                </Button>
              ) : null}
              {trail &&
              ["configuration", "limit", "paused"].includes(failure.error) ? (
                <Button onClick={() => flow.setFailure(undefined)}>
                  Keep my trail
                </Button>
              ) : null}
              {trail && ["qloo", "model"].includes(failure.error) ? (
                <Button
                  onClick={() => {
                    flow.setFailure(undefined);
                    changeDirection();
                  }}
                >
                  Change direction
                </Button>
              ) : null}
              {failure.error === "owner" ? (
                <Link prefetch={false} href="/">
                  Start a trail
                </Link>
              ) : null}
              <Button
                onClick={() => {
                  flow.setFailure(undefined);
                  invalidateSearch();
                  setSearchRetryAt(0);
                  setExampleMode(true);
                  setNewStart(true);
                }}
              >
                Open an example
              </Button>
            </div>
          </section>
        ) : null}
        {!trail || newStart ? (
          <section className={`start-scene ${results ? "identity-scene" : ""}`}>
            <div className="start-copy">
              <p className="eyebrow">Film · Music · Books</p>
              <h1 className="opening-question">
                What do <br />
                you <span>love?</span>
              </h1>
              <p className="opening-description">
                A film becomes music. Music opens a book. Follow three
                discoveries. Send a friend your trail.
              </p>
              {(!trail || newStart) && continueId ? (
                <aside>
                  <h2>Continue your trail</h2>
                  <p>{continueSummary}</p>
                  <Link prefetch={false} href={`/t/${continueId}`}>
                    Continue
                  </Link>
                  <Button onClick={() => setContinueId(undefined)}>
                    Start a new trail
                  </Button>
                </aside>
              ) : null}
              {previousTrail ? (
                <p className="previous-trail">
                  Previous trail:{" "}
                  <Link prefetch={false} href={`/t/${previousTrail.id}`}>
                    {previousTrail.rootName} · {previousTrail.choices}{" "}
                    discoveries
                  </Link>
                </p>
              ) : null}
              <h2 id="examples" tabIndex={-1}>
                Take the first step
              </h2>
              <ul className="sample-list">
                {(mode === "live" && !exampleMode && liveSamples.length === 3
                  ? liveSamples
                  : samples
                ).map((entity) => (
                  <li key={entity.id}>
                    <EntityArt entity={entity} compact layout="history" />
                    <Button
                      disabled={
                        busy || creating || (!ready && !offline && !exampleMode)
                      }
                      onClick={() => create(entity, true)}
                    >
                      {entity.name}
                      <span aria-hidden="true">↗</span>
                    </Button>
                    <p className="metadata">
                      {label[entity.medium]}
                      {entity.year
                        ? ` · ${entity.year}`
                        : entity.author
                          ? ` · ${entity.author}`
                          : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="own-start-label">
                Or start with your own favourite
              </p>
              <form className="start-form" onSubmit={find}>
                <label htmlFor="root-query">Your starting point</label>
                <input
                  id="root-query"
                  value={query}
                  ref={rootInput}
                  aria-invalid={
                    searchMessage === "Enter at least two characters." ||
                    searchMessage === "Keep the title under 120 characters."
                  }
                  onChange={(e) => {
                    invalidateSearch();
                    setQuery(e.target.value);
                  }}
                  placeholder="A title or musician"
                  aria-describedby="search-message"
                />
                <label htmlFor="root-medium">Type</label>
                <select
                  id="root-medium"
                  value={medium}
                  onChange={(e) => {
                    invalidateSearch();
                    setMedium(e.target.value as Medium);
                  }}
                >
                  {media.map((m) => (
                    <option key={m} value={m}>
                      {label[m]}
                    </option>
                  ))}
                </select>
                <div>
                  <Button
                    type="submit"
                    variant="default"
                    disabled={
                      (currentMode !== "fixture" && (!ready || offline)) ||
                      searching ||
                      creating ||
                      (currentMode !== "fixture" &&
                        !!searchRetryAt &&
                        clockNow < searchRetryAt)
                    }
                  >
                    Find it
                  </Button>
                </div>
              </form>
              <p id="search-message" role="status">
                {searchMessage}
              </p>
              {searchRetryAt > clockNow ? (
                <p className="metadata">
                  Try again after{" "}
                  {new Date(searchRetryAt).toLocaleString(undefined, {
                    timeZoneName: "short",
                  })}
                  .
                </p>
              ) : null}
              {searching ? (
                <p role="status">
                  Looking for ‘{query.trim()}’…{" "}
                  <Button onClick={invalidateSearch}>Cancel</Button>
                </p>
              ) : null}
              {results ? (
                results.length ? (
                  <section className="identity-results">
                    <p className="eyebrow">
                      {query.trim()} · {label[medium]}
                    </p>
                    <h1 ref={searchResultHeading} tabIndex={-1}>
                      Which one did you mean?
                    </h1>
                    <fieldset>
                      <legend>Choose a starting point</legend>
                      {results.map((entity) => (
                        <label key={entity.id}>
                          <input
                            type="radio"
                            name="identity"
                            value={entity.id}
                            checked={selected === entity.id}
                            onChange={() => setSelected(entity.id)}
                          />
                          <EntityView entity={entity} description={false} />
                        </label>
                      ))}
                    </fieldset>
                    <div className="actions identity-confirm">
                      <Button
                        variant="default"
                        disabled={!selected || creating}
                        onClick={() => {
                          const entity = results.find((e) => e.id === selected);
                          if (entity) create(entity);
                        }}
                      >
                        Start here
                      </Button>
                      <Button
                        onClick={() => {
                          setResults(undefined);
                          requestAnimationFrame(() =>
                            rootInput.current?.focus(),
                          );
                        }}
                      >
                        Search again
                      </Button>
                    </div>
                  </section>
                ) : (
                  <section className="identity-results">
                    <p className="eyebrow">
                      {query.trim()} · {label[medium]}
                    </p>
                    <h1 ref={searchResultHeading} tabIndex={-1}>
                      We couldn&apos;t find that starting point.
                    </h1>
                    <p>
                      Try another spelling, choose a different type, or start
                      with an example.
                    </p>
                    <Button
                      onClick={() => {
                        setResults(undefined);
                        requestAnimationFrame(() => rootInput.current?.focus());
                      }}
                    >
                      Search again
                    </Button>
                    <Button
                      onClick={() => {
                        setResults(undefined);
                        requestAnimationFrame(() =>
                          document.getElementById("examples")?.focus(),
                        );
                      }}
                    >
                      Try an example
                    </Button>
                  </section>
                )
              ) : null}
              {trail ? (
                <Button onClick={() => setNewStart(false)}>
                  Keep this trail
                </Button>
              ) : null}
            </div>
            <figure className="opening-art">
              <EntityArt
                entity={
                  currentMode === "live" && liveSamples[0]
                    ? liveSamples[0]
                    : samples[0]
                }
              />
              <figcaption>
                <span>
                  {
                    (currentMode === "live" && liveSamples[0]
                      ? liveSamples[0]
                      : samples[0]
                    ).name
                  }
                </span>
                <span>
                  {
                    label[
                      (currentMode === "live" && liveSamples[0]
                        ? liveSamples[0]
                        : samples[0]
                      ).medium
                    ]
                  }
                </span>
              </figcaption>
              <Button
                className="opening-enter"
                variant="default"
                disabled={
                  busy || creating || (!ready && !offline && !exampleMode)
                }
                onClick={() =>
                  create(
                    currentMode === "live" && liveSamples[0]
                      ? liveSamples[0]
                      : samples[0],
                    true,
                  )
                }
              >
                Enter the rabbit hole
              </Button>
            </figure>
          </section>
        ) : (
          <>
            <div className="scene-heading">
              {trail.status === "complete" ? (
                <p className="eyebrow">One favourite. Three turns.</p>
              ) : null}
              <h1
                ref={trail.status === "complete" ? panel : undefined}
                tabIndex={-1}
              >
                {trail.status === "complete"
                  ? "Here's where you went"
                  : trail.steps.length
                    ? `From ${anchor?.name}`
                    : `Starting with ${trail.root.name}`}
              </h1>
              {trail.status === "complete" ? (
                <p>
                  From {trail.root.name} through {trail.steps.length}{" "}
                  {trail.steps.length === 1 ? "discovery" : "discoveries"}.
                </p>
              ) : null}
              {trail.status === "complete" ? (
                <Button
                  variant="default"
                  disabled={busy || offline || !!flow.preview}
                  onClick={openShare}
                >
                  Share this trail
                </Button>
              ) : (
                <Button onClick={startAgain}>Change starting point</Button>
              )}
            </div>
            {trail.status !== "complete" ? (
              <ol className="path-summary" aria-label="Your chosen path">
                {[trail.root, ...trail.steps.map((step) => step.entity)].map(
                  (entity, index, path) => (
                    <li
                      key={entity.id}
                      aria-current={
                        index === path.length - 1 ? "step" : undefined
                      }
                    >
                      <EntityArt entity={entity} compact layout="history" />
                      <span>{entity.name}</span>
                    </li>
                  ),
                )}
              </ol>
            ) : null}
            {trail.status === "complete" ? (
              <TrailKeepsake
                root={trail.root}
                steps={trail.steps}
                onEvidence={(entity, generation) => {
                  setEvidence({ entity, generation });
                  setDrawer("evidence");
                }}
              />
            ) : (
              <details
                key={`${trail.status}:${trail.steps.length}`}
                className="path-history"
              >
                <summary>Trail details</summary>
                <h2 className="sr-only">Chosen discoveries</h2>
                <ol className="trail">
                  <li>
                    <span className="stop-index">
                      00 <span>The beginning</span>
                    </span>
                    <EntityArt
                      entity={trail.root}
                      compact
                      layout="history"
                      count={trail.steps.length + 1}
                    />
                    <EntityView
                      entity={trail.root}
                      heading
                      description={false}
                    />
                    <details className="stop-details" open>
                      <summary>Starting point details</summary>
                      <EntityDescription entity={trail.root} />
                      <div className="actions">
                        {loveButton(trail.root)}
                        {savedButton(trail.root)}
                      </div>
                    </details>
                    <InformationLink entity={trail.root} compact />
                  </li>
                  {trail.steps.map((step, index) => (
                    <li key={`${step.entity.id}:${step.generation.id}`}>
                      <span className="stop-index">
                        {String(index + 1).padStart(2, "0")}{" "}
                        <span>{label[step.entity.medium]}</span>
                      </span>
                      <EntityArt
                        entity={step.entity}
                        index={index + 1}
                        compact
                        layout="history"
                        count={trail.steps.length + 1}
                      />
                      <EntityView
                        entity={step.entity}
                        heading
                        description={false}
                      />
                      <details className="stop-details" open>
                        <summary
                          aria-label={`Discovery details: ${step.entity.name}`}
                        >
                          Discovery details
                        </summary>
                        <EntityDescription entity={step.entity} />
                        <p>
                          {step.generation.discovery.source === "synthetic"
                            ? `An illustrative door from ${step.anchor.name}.`
                            : `Found from ${step.anchor.name} through Qloo.`}
                        </p>
                        <div className="actions">
                          {savedButton(step.entity)}
                          {loveButton(step.entity)}
                          {evidenceButton(step.entity, step.generation)}
                        </div>
                      </details>
                      <InformationLink entity={step.entity} compact />
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {trail.status !== "complete" ? (
              <section
                className="discovery-panel"
                aria-busy={busy}
                key={trail.current?.id ?? `next-${trail.steps.length}`}
              >
                <h2
                  ref={panel}
                  tabIndex={-1}
                  aria-label={
                    trail.current
                      ? `From ${anchor?.name} into ${plural[trail.current.medium]}`
                      : undefined
                  }
                >
                  {trail.current
                    ? `Into ${plural[trail.current.medium]}`
                    : trail.steps.length
                      ? "One door further"
                      : "Go into"}
                </h2>
                <p>Choice {trail.steps.length + 1} of 3</p>
                {!trail.current && anchor ? (
                  <div className="next-anchor">
                    <EntityArt entity={anchor} compact layout="connection" />
                    <div>
                      <p className="eyebrow">
                        {trail.steps.length
                          ? "Added to your trail"
                          : "Your starting point"}
                      </p>
                      <EntityView entity={anchor} heading description={false} />
                      <p className="next-connection">
                        {trail.steps.length
                          ? connectionLine(
                              anchor,
                              trail.steps.at(-1)!.generation,
                            )
                          : null}
                      </p>
                      <TryThis entity={anchor} />
                      <p className="next-destination">
                        {destination === "auto"
                          ? `Next, the guide will explore ${plural[defaultMedium(trail.root, trail.steps)]}`
                          : `${label[destination]} next`}
                      </p>
                    </div>
                  </div>
                ) : null}
                {flow.generating ? (
                  <div
                    className="pending-panel"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="waiting-mark" aria-hidden="true">
                      ↗
                    </span>
                    <h3>{message || "Finding your next doors"}</h3>
                    {flow.waiting ? (
                      <p>Still waiting. Your trail is safe.</p>
                    ) : null}
                    <Button onClick={flow.stop}>Stop</Button>
                  </div>
                ) : null}
                {trail.current ? (
                  <>
                    <details className="guide-summary">
                      <summary>
                        {trail.current.ranking
                          ? rankingHeadline(trail.current)
                          : "How the guide found these"}
                      </summary>
                      <p>
                        {currentMode === "fixture"
                          ? "Illustrative connections"
                          : `Explored ${trail.current.pool.length} Qloo connections.`}
                      </p>
                      {trail.current.ranking ? (
                        <p>{rankingChange(trail.current)}</p>
                      ) : null}
                      <button type="button" onClick={() => openSteps()}>
                        See its choices
                      </button>
                    </details>

                    {doors.length < 3 ? (
                      <>
                        <h3>
                          {doors.length
                            ? `${doors.length} doors from here`
                            : trail.current.pool.length
                              ? "You've tried these doors."
                              : "No doors from here yet."}
                        </h3>
                        <p>
                          {doors.length
                            ? "This is what we found with your choices."
                            : trail.current.pool.length
                              ? "Find another set or go a different way."
                              : "Try another medium, or loosen the popularity limit."}
                        </p>
                      </>
                    ) : null}
                    <ul className="doors discovery-doors">
                      {doors.map((entity, index) => (
                        <li key={entity.id}>
                          <EntityArt
                            entity={entity}
                            index={index + 1}
                            compact
                            layout="door"
                          />
                          <span className="door-index" aria-hidden="true">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <EntityView
                            entity={entity}
                            heading
                            description={false}
                            shortTitle
                          />
                          <p className="door-connection">
                            {connectionLine(entity, trail.current!)}
                          </p>

                          <div className="door-explore">
                            <TryThis entity={entity} />
                          </div>
                          <div className="actions">
                            <Button
                              className="door-follow"
                              aria-label={`Add to trail: ${entity.name}`}
                              variant="default"
                              disabled={busy}
                              onClick={() =>
                                act("follow", entity, trail.current)
                              }
                            >
                              Add to trail
                            </Button>
                            <Button
                              disabled={busy}
                              aria-label={`I know this: ${entity.name}`}
                              onClick={() =>
                                act("known", entity, trail.current)
                              }
                            >
                              I know this
                            </Button>
                            <details
                              className="door-details"
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.currentTarget.open = false;
                                  event.currentTarget
                                    .querySelector("summary")
                                    ?.focus();
                                }
                              }}
                            >
                              <summary
                                aria-label={`More options for ${entity.name}`}
                              >
                                More
                              </summary>
                              <div className="door-menu">
                                {evidenceButton(entity, trail.current!)}
                                {savedButton(entity, true)}
                                <InformationLink entity={entity} compact />
                                <Button
                                  disabled={busy}
                                  aria-label={`Not for me: ${entity.name}`}
                                  onClick={() =>
                                    act("reject", entity, trail.current)
                                  }
                                >
                                  Not for me
                                </Button>
                              </div>
                            </details>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {trail.current.warnings
                      .filter(
                        (warning) =>
                          warning.includes("favourites check") ||
                          warning.includes("returned rankings for"),
                      )
                      .map((warning) => (
                        <p className="notice" key={warning}>
                          {warning}
                        </p>
                      ))}
                    {trail.current.warnings.some((warning) =>
                      /details (?:are|were) missing/.test(warning),
                    ) ? (
                      <aside className="notice partial-notice">
                        <h3>Some details are missing.</h3>
                        <p>These doors have checked names and connections.</p>
                      </aside>
                    ) : null}
                  </>
                ) : null}
                {trail.directionRequest && !keptDirection ? (
                  <aside className="notice">
                    <h3>{trail.message}</h3>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setKeptDirection(false);
                        flow.generate(trail.directionRequest!, lessObvious);
                      }}
                    >
                      Try {plural[trail.directionRequest]}
                    </Button>
                    <Button onClick={() => setKeptDirection(true)}>
                      Keep my direction
                    </Button>
                  </aside>
                ) : null}
                <details
                  className={`direction-details${!trail.current ? " direction-initial" : ""}`}
                >
                  <summary>
                    {trail.current
                      ? `Direction · ${destination === "auto" ? "Surprise me" : label[destination]}${lessObvious ? " · Less obvious" : ""}`
                      : "Choose your next medium"}
                  </summary>
                  <div className="direction-panel">
                    <label htmlFor="destination">Go into</label>
                    <select
                      id="destination"
                      value={destination}
                      disabled={busy}
                      onChange={(e) =>
                        setDestination(e.target.value as Medium | "auto")
                      }
                    >
                      <option value="auto">Surprise me</option>
                      {media
                        .filter((m) => m !== anchor?.medium)
                        .map((m) => (
                          <option value={m} key={m}>
                            {label[m]}
                          </option>
                        ))}
                    </select>
                    <p className="metadata">
                      {destination === "auto"
                        ? "Let the guide choose a new medium for this trail."
                        : `${label[destination]} selected. We'll keep this direction.`}
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={lessObvious}
                        disabled={busy}
                        onChange={(e) => setLessObvious(e.target.checked)}
                      />
                      Something less obvious
                    </label>
                    <p className="metadata">
                      Try less widely known picks. New to you isn’t guaranteed.
                    </p>
                  </div>
                </details>
                <div className="actions next-actions">
                  <Button
                    variant={trail.current ? "secondary" : "default"}
                    disabled={
                      busy ||
                      (currentMode === "live" && offline) ||
                      (!!failure?.retryAt && clockNow < failure.retryAt) ||
                      ["paused", "invalid_seed"].includes(failure?.error ?? "")
                    }
                    onClick={async () => {
                      setKeptDirection(false);
                      await flow.generate(destination, lessObvious);
                      requestAnimationFrame(() => panel.current?.focus());
                    }}
                  >
                    {trail.current
                      ? doors.length
                        ? "Refresh doors"
                        : "Find more doors"
                      : destination === "auto"
                        ? "Find the next doors"
                        : `Find ${plural[destination]} from here`}
                  </Button>
                  {lessObvious && !doors.length ? (
                    <Button onClick={() => setLessObvious(false)}>
                      Use the usual range
                    </Button>
                  ) : null}
                </div>
              </section>
            ) : null}
            {flow.preview ? (
              <section aria-label="Unsaved preview">
                <h2>These doors aren&apos;t saved yet.</h2>
                <ul>
                  {flow.preview.pool.slice(0, 3).map((e) => (
                    <li key={e.id}>
                      <EntityView entity={e} />
                    </li>
                  ))}
                </ul>
                <Button onClick={flow.saveResult}>Try saving again</Button>
              </section>
            ) : null}
            <div className="actions trail-tools">
              {trail.steps.length ? (
                <>
                  {trail.status !== "complete" ? (
                    <Button
                      disabled={busy || offline || !!flow.preview}
                      onClick={openShare}
                    >
                      Share this trail
                    </Button>
                  ) : null}
                  {trail.status !== "complete" ? (
                    <Button disabled={busy} onClick={() => act("finish")}>
                      Finish my trail
                    </Button>
                  ) : (
                    <Button onClick={() => setDrawer("edit")}>
                      Try another way
                    </Button>
                  )}
                </>
              ) : (
                <Link prefetch={false} href="/">
                  Back to the start
                </Link>
              )}
              {trail.canUndo ? (
                <Button disabled={busy} onClick={() => act("undo")}>
                  Undo
                </Button>
              ) : null}
              {trail.saved.length ? (
                <Button
                  aria-label={`Open saved discoveries (${trail.saved.length})`}
                  onClick={() => setDrawer("saved")}
                >
                  Saved ({trail.saved.length})
                </Button>
              ) : null}
              <details className="tools-menu">
                <summary>Trail tools</summary>
                <div className="actions">
                  <Button onClick={() => setDrawer("saved")}>
                    Saved discoveries
                  </Button>
                  <Button onClick={() => setDrawer("excluded")}>
                    Excluded from this trail
                  </Button>
                  <Button onClick={() => setDrawer("other")}>
                    Other doors
                  </Button>
                  <Button onClick={() => setDrawer("edit")}>Edit trail</Button>
                  <Button onClick={startAgain}>Start somewhere new</Button>
                  <Button onClick={() => openSteps()}>
                    {currentMode === "fixture"
                      ? "Example steps"
                      : "Agent steps"}
                  </Button>
                </div>
              </details>
            </div>
            <p className="retention-note">Your trail is kept for 30 days.</p>
            {flow.queued ? (
              <p className="notice">
                This example has changes saved in this browser.{" "}
                {offline ? (
                  "Reconnect to make a share link."
                ) : (
                  <Button
                    onClick={() => flow.syncOffline(true).catch(flow.report)}
                  >
                    Save example online
                  </Button>
                )}
              </p>
            ) : null}
          </>
        )}
      </main>
      <footer>
        <Button onClick={() => setDrawer("privacy")}>Privacy</Button>
        <Button onClick={() => setDrawer("sources")}>Sources</Button>
      </footer>
      <Drawer
        open={drawer === "how"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="How it works"
      >
        <p>
          Start with something you love. Follow three discoveries across films,
          music and books. Keep the trail, or send its link to a friend.
        </p>
        <p>
          Qloo finds cultural connections.{" "}
          {localGuide
            ? "A deterministic guide chooses the next medium and checks empty results. No language model is running."
            : "An AI agent chooses where to look next."}{" "}
          Following something does not mean you like it.
        </p>
        {currentMode === "fixture" ? (
          <p>
            In this example, the guide is deterministic and no agent or Qloo
            request runs.
          </p>
        ) : null}
      </Drawer>
      <Drawer
        open={drawer === "sources"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Sources"
      >
        {currentMode === "fixture" ? (
          <p>
            Example mode. These connections are illustrative, not live Qloo
            results.
          </p>
        ) : null}
        <p>
          Connections come from Qloo. Titles and descriptions use the source
          shown on each discovery. A connection does not mean one work
          influenced another.
        </p>
        <p>
          <Link
            prefetch={false}
            href="https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide"
            target="_blank"
            rel="noreferrer"
          >
            Qloo API
          </Link>{" "}
          ·{" "}
          <Link
            prefetch={false}
            href="https://docs.qloo.com/docs/interpreting-affinity-scores"
            target="_blank"
            rel="noreferrer"
          >
            How connections work
          </Link>
        </p>
        <Link
          prefetch={false}
          href="/compare"
          onClick={() => {
            if (trail)
              sessionStorage.setItem(
                comparisonReturnKey,
                JSON.stringify({
                  path: `/t/${trail.id}`,
                  scroll: window.scrollY,
                }),
              );
          }}
        >
          Qloo ordering audit
        </Link>
      </Drawer>
      <Drawer
        open={drawer === "privacy"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Privacy"
      >
        <p>
          No account is needed. We keep your trail in this browser&apos;s
          session and on our server for 30 days. A shared link shows the chosen
          trail to anyone who has it. Searches and rejected choices are not
          shared. Qloo and our AI provider process the inputs needed to find
          discoveries.
        </p>
        <p>
          Development memory storage resets on restart. Only synthetic examples
          are stored in this browser; live data stays on the server.
        </p>
        <Link prefetch={false} href="/privacy">
          Retention and provider details
        </Link>
        {trail ? (
          <p>
            <Button
              disabled={busy || offline}
              onClick={() => setDrawer("delete")}
            >
              Delete my trail
            </Button>
          </p>
        ) : null}
      </Drawer>
      <Drawer
        open={drawer === "delete"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Delete this trail?"
      >
        {dialogFailure ? <p role="alert">{dialogFailure}</p> : null}
        <p>
          This removes your saved trail and stops its shared links. Other
          people&apos;s independent versions will stay.
        </p>
        <Button onClick={removeTrail}>Delete trail</Button>
        <Button onClick={close}>Keep trail</Button>
      </Drawer>
      <Drawer
        open={drawer === "evidence"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title={`Why ${evidence?.entity.name ?? "this"}?`}
      >
        {evidence ? (
          <EvidenceView
            {...evidence}
            onSteps={() => openSteps(evidence?.generation.runId)}
          />
        ) : null}
      </Drawer>
      <Drawer
        open={drawer === "steps"}
        onClose={close}
        returnFocus={() => stepsOpener.current}
        title={currentMode === "fixture" ? "Example steps" : "What happened"}
      >
        {currentMode === "fixture" ? (
          <p>These steps illustrate the flow. No agent or Qloo request ran.</p>
        ) : (
          <p>{trace?.guide ?? flow.guide}</p>
        )}
        <ol>
          {(trace?.events ?? flow.events)
            .filter(
              (e) =>
                currentMode !== "fixture" ||
                e.message !==
                  "These steps illustrate the flow. No agent or Qloo request ran.",
            )
            .map((e) => (
              <li key={`${e.runId}:${e.sequence}`}>{e.message}</li>
            ))}
        </ol>
        {trace?.notice ? (
          <p>{trace.notice}</p>
        ) : !(trace?.events ?? flow.events).length ? (
          <p>No steps to show yet.</p>
        ) : null}
        {!trace?.notice ? (
          <p>
            Actual Qloo calls:{" "}
            {currentMode === "fixture"
              ? 0
              : (trace?.attempts ?? flow.stats.attempts)}
            . Actual model calls:{" "}
            {currentMode === "fixture"
              ? 0
              : (trace?.modelSteps ?? flow.stats.modelSteps)}
            . Wall time: {trace?.elapsedMs ?? flow.stats.elapsedMs} ms.
          </p>
        ) : null}
        {trail?.generations.map((g) => (
          <p key={g.id}>
            {g.anchor.name} → {label[g.medium]} ·{" "}
            {g.discovery.cache === "hit"
              ? "Saved Qloo results"
              : g.discovery.source === "synthetic"
                ? "Illustrative"
                : "Qloo"}{" "}
            · {g.discovery.elapsedMs} ms
          </p>
        ))}
      </Drawer>
      <Drawer
        open={drawer === "saved"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Saved discoveries"
      >
        {actionFailure}
        {trail?.saved.length ? (
          <ul>
            {trail.saved.map((e) => (
              <li key={e.id}>
                <EntityView entity={e} />
                {savedButton(e)}
                <InformationLink entity={e} />
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p>Nothing saved yet.</p>
            <p>Use ‘Save for later’ on a door you want to return to.</p>
          </>
        )}
      </Drawer>
      <Drawer
        open={drawer === "excluded"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Excluded from this trail"
      >
        {actionFailure}
        {trail?.excluded.length ? (
          <ul>
            {trail.excluded.map((x) => (
              <li key={x.entity.id}>
                <EntityView entity={x.entity} />
                <p>{x.reason === "known" ? "Known" : "Skipped"}</p>
                <Button
                  disabled={busy}
                  onClick={() => act("removeExclusion", x.entity)}
                >
                  Remove exclusion
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing excluded yet.</p>
        )}
      </Drawer>
      <Drawer
        open={drawer === "other"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Other doors"
      >
        {actionFailure}
        {trail?.generations.some((g) =>
          g.pool.some((e) => !trail.steps.some((s) => s.entity.id === e.id)),
        ) ? (
          <ul>
            {trail.generations.flatMap((g) =>
              g.pool
                .filter((e) => !trail.steps.some((s) => s.entity.id === e.id))
                .map((e) => (
                  <li key={`${g.id}:${e.id}`}>
                    <EntityView entity={e} />
                    {savedButton(e)}
                    {evidenceButton(e, g)}
                  </li>
                )),
            )}
          </ul>
        ) : (
          <p>No other doors to show yet.</p>
        )}
      </Drawer>
      <Drawer
        open={drawer === "edit"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Edit trail"
      >
        <Button
          onClick={() => {
            close();
            startAgain();
          }}
        >
          Change starting point
        </Button>
        <ol>
          {trail?.steps.map((s, i) => (
            <li key={s.entity.id}>
              {s.entity.name}{" "}
              <Button
                onClick={() => {
                  setBranchPoint(i + 1);
                  setDrawer("branch");
                }}
                disabled={i + 1 >= 3}
              >
                Go back here
              </Button>
            </li>
          ))}
        </ol>
        {trail ? (
          <Button
            onClick={() => {
              setBranchPoint(0);
              setDrawer("branch");
            }}
          >
            Try another way from {trail.root.name}
          </Button>
        ) : null}
        <h3>Shared versions</h3>
        {trail?.sharedVersions.length ? (
          <ul>
            {trail.sharedVersions.map((s) => (
              <li key={s.id}>
                {s.root} · {new Date(s.createdAt).toLocaleString()}{" "}
                <Button
                  onClick={() => {
                    setTargetShare(s.id);
                    setDrawer("revoke");
                  }}
                >
                  Stop sharing
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No shared versions yet.</p>
        )}
      </Drawer>
      <Drawer
        open={drawer === "branch"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title={`Try another way from ${branchPoint ? trail?.steps[branchPoint - 1]?.entity.name : trail?.root.name}?`}
      >
        {actionFailure}
        <p>
          Your current trail will stay in its history. New choices will make a
          new version.
        </p>
        <Button
          disabled={busy}
          onClick={async () => {
            if (await flow.action({ action: "branch", branchPoint })) {
              changed();
              close();
            }
          }}
        >
          Try another way
        </Button>
        <Button onClick={close}>Keep this trail</Button>
      </Drawer>
      <Drawer
        open={drawer === "share"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Send the trail"
      >
        {failure?.operation === "share" ? (
          <section
            className="notice"
            role="alert"
            data-testid={`error-${failure.error}`}
          >
            <h3>
              {failure.error === "invalid_seed" && trail?.steps.length
                ? `This ${anchor?.medium === "book" ? "book" : "discovery"} can’t lead to another discovery.`
                : failure.heading}
            </h3>
            <p>
              {failure.error === "invalid_seed" && trail?.steps.length
                ? "Keep it in your trail, or go back and choose another door."
                : failure.body}
            </p>
            {failure.error === "conflict" ? (
              <Button onClick={() => window.location.reload()}>
                Open latest version
              </Button>
            ) : (
              <Button
                disabled={
                  sharing || (!!failure.retryAt && clockNow < failure.retryAt)
                }
                onClick={createShare}
              >
                Try again
              </Button>
            )}
          </section>
        ) : null}
        <p role="status">
          {message === "Link copied." || message.startsWith("Couldn't copy")
            ? message
            : ""}
        </p>
        <p>
          A little journey for someone else. They can keep the beginning and
          choose a different ending.
        </p>
        {sharing ? <p role="status">Making your trail link…</p> : null}
        {!share && !sharing ? (
          <div className="share-note">
            <label htmlFor="share-note">
              Leave a line for your friend{" "}
              <span>Optional · shared with the link</span>
            </label>
            <input
              id="share-note"
              value={shareNote}
              maxLength={240}
              placeholder="The discovery I’d start with is…"
              onChange={(event) => setShareNote(event.target.value)}
            />
          </div>
        ) : null}
        {!share ? (
          <Button
            variant="default"
            disabled={
              busy ||
              offline ||
              sharing ||
              (!!failure?.retryAt && clockNow < failure.retryAt)
            }
            onClick={createShare}
          >
            Create trail link
          </Button>
        ) : null}
        {share ? (
          <>
            <Image
              className="share-preview"
              src={`/s/${share.token}/opengraph-image`}
              width={1200}
              height={630}
              unoptimized
              alt="Your trail’s link preview"
            />
            <button
              className="story-evidence"
              type="button"
              onClick={() => setShare(undefined)}
            >
              Add a note for your friend
            </button>
            <label htmlFor="trail-link">Trail link</label>
            <input
              id="trail-link"
              readOnly
              value={share ? `${window.location.origin}/s/${share.token}` : ""}
              onFocus={(e) => e.currentTarget.select()}
              style={{ width: "100%" }}
            />
            <div className="actions">
              <Button
                variant="default"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${window.location.origin}/s/${share!.token}`,
                    );
                    flow.setMessage("Link copied.");
                  } catch {
                    flow.setMessage(
                      "Couldn't copy the link. Select it and copy it yourself.",
                    );
                  }
                }}
              >
                Copy link
              </Button>
              {share ? (
                <Link
                  prefetch={false}
                  href={`/s/${share.token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Preview as a visitor
                </Link>
              ) : null}
              <Button
                onClick={() => {
                  setTargetShare(share?.shareId);
                  setDrawer("revoke");
                }}
              >
                Stop sharing
              </Button>
            </div>
          </>
        ) : null}
      </Drawer>
      <Drawer
        open={drawer === "revoke"}
        onClose={close}
        returnFocus={() => drawerOpener.current}
        title="Stop sharing this link?"
      >
        {dialogFailure ? <p role="alert">{dialogFailure}</p> : null}
        <p>People with the link won&apos;t be able to open it again.</p>
        <Button onClick={revoke}>Stop sharing</Button>
        <Button onClick={close}>Keep sharing</Button>
      </Drawer>
    </>
  );
}
