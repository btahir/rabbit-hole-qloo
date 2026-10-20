"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import type { Entity, Generation, PublicTrail } from "@/lib/core/types";
import { PageFooter, PageHeader } from "./page-chrome";
import { TrailKeepsake } from "./trail-keepsake";
import { Drawer } from "./ui/drawer";
import { Button } from "./ui/button";
import { EvidenceView } from "./evidence-view";
import {
  apiRequest,
  requestKey,
  RequestError,
  type Failure,
} from "./use-trail";
export function Visitor({
  snapshot,
  token,
}: {
  snapshot: PublicTrail;
  token: string;
}) {
  const router = useRouter();
  const [point, setPoint] = useState(0),
    [forking, setForking] = useState(false),
    [love, setLove] = useState(false),
    [ready, setReady] = useState(false),
    [sessionAttempt, setSessionAttempt] = useState(0),
    [failure, setFailure] = useState<Failure>(),
    [clockNow, setClockNow] = useState(0),
    [evidence, setEvidence] = useState<{
      entity: Entity;
      generation: Generation;
    }>();
  const report = (error: unknown) =>
    setFailure(
      error instanceof RequestError
        ? error.detail
        : {
            error: "network",
            heading: "We couldn't start your version just now.",
            body: "Try again in a moment.",
          },
    );
  useEffect(() => {
    if (!failure?.retryAt) return;
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [failure?.retryAt]);
  const cooling = !!failure?.retryAt && clockNow < failure.retryAt;
  const unavailable = failure?.error === "missing";
  useEffect(() => {
    apiRequest("/api/session", {})
      .then(() => {
        setReady(true);
        setFailure(undefined);
      })
      .catch(report);
  }, [sessionAttempt]);
  const forkGuard = useRef(false);
  const forkIntent = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const [submitting, setSubmitting] = useState(false);
  async function fork() {
    if (
      forkGuard.current ||
      unavailable ||
      (failure?.retryAt && Date.now() < failure.retryAt)
    )
      return;
    forkGuard.current = true;
    setSubmitting(true);
    setFailure(undefined);
    const signature = `${token}:${point}:${love}`;
    if (forkIntent.current?.signature !== signature)
      forkIntent.current = { signature, key: requestKey() };
    try {
      const result = await apiRequest<{ id: string }>("/api/forks", {
        shareToken: token,
        branchPoint: point,
        loveStartingPoint: love,
        idempotencyKey: forkIntent.current.key,
      });
      router.push(`/t/${result.id}`);
    } catch (error) {
      report(error);
      forkGuard.current = false;
      setSubmitting(false);
    }
  }
  const recovery = failure ? (
    <section className="notice" role="alert">
      <h2>{failure.heading}</h2>
      <p>{failure.body}</p>
      {failure.retryAt ? (
        <p>
          Try again after{" "}
          {new Date(failure.retryAt).toLocaleString(undefined, {
            timeZoneName: "short",
          })}
          .
        </p>
      ) : null}
      {unavailable ? (
        <Link href="/" prefetch={false}>
          Start a trail
        </Link>
      ) : null}
    </section>
  ) : null;
  return (
    <>
      <header>
        <PageHeader />
        {snapshot.mode === "fixture" ? (
          <div className="mode-strip">
            Example mode. These connections are illustrative, not live Qloo
            results.
          </div>
        ) : null}
      </header>
      <main className="visitor-workspace complete-workspace" id="main">
        <div className="recipient-heading">
          <div>
            <p className="eyebrow">A trail from your friend</p>
            <h1>Look where this led.</h1>
          </div>
          <Button
            disabled={!ready || cooling || unavailable}
            onClick={() => setForking(true)}
          >
            Take a different turn →
          </Button>
        </div>
        {!forking ? recovery : null}
        {!ready && failure && !unavailable ? (
          <Button
            disabled={cooling}
            onClick={() => setSessionAttempt((n) => n + 1)}
          >
            Try again
          </Button>
        ) : null}
        {snapshot.note ? (
          <blockquote className="sender-note">
            <span>A note from your friend</span>
            {snapshot.note}
          </blockquote>
        ) : null}
        <TrailKeepsake
          root={snapshot.root}
          steps={snapshot.steps}
          onEvidence={(entity, generation) =>
            setEvidence({ entity, generation })
          }
        />
        <section className="fork-invitation">
          <p className="eyebrow">Same beginning. Your own ending.</p>
          <h2>Where would you take it?</h2>
          <Button
            variant="default"
            disabled={!ready || cooling || unavailable}
            onClick={() => setForking(true)}
          >
            Make your own trail
          </Button>
          <p>Your friend’s original stays unchanged.</p>
        </section>
        <p>
          <Link prefetch={false} href="/">
            Start with something else
          </Link>
        </p>
        <p>
          This unlisted trail expires{" "}
          {new Date(snapshot.expiresAt).toLocaleString(undefined, {
            timeZoneName: "short",
          })}
          .
        </p>
      </main>
      <PageFooter />
      <Drawer
        open={forking}
        onClose={() => setForking(false)}
        title="Where would you like to start?"
      >
        {recovery}
        <fieldset>
          <legend>Starting point</legend>
          <label>
            <input
              type="radio"
              name="branch"
              checked={point === 0}
              onChange={() => setPoint(0)}
            />
            Start at {snapshot.root.name}
          </label>
          {snapshot.steps.map((s, i) => (
            <label key={s.entity.id}>
              <input
                type="radio"
                name="branch"
                disabled={i + 1 === 3}
                checked={point === i + 1}
                onChange={() => setPoint(i + 1)}
              />
              <span className="branch-choice">
                After {s.entity.name}
                {i + 1 === 3 ? (
                  <small>
                    This trail already has three discoveries. Choose an earlier
                    stop.
                  </small>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={love}
            onChange={(e) => setLove(e.target.checked)}
          />
          I love this starting point
        </label>
        <Button
          variant="default"
          disabled={submitting || cooling || unavailable}
          onClick={fork}
        >
          {submitting ? "Making your version…" : "Make my version"}
        </Button>
      </Drawer>
      <Drawer
        title={`Why ${evidence?.entity.name ?? "this"}?`}
        open={!!evidence}
        onClose={() => setEvidence(undefined)}
      >
        {evidence ? <EvidenceView {...evidence} publicView /> : null}
      </Drawer>
    </>
  );
}
