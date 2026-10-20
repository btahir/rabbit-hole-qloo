"use client";
import { ReturnToTrail } from "./comparison-return";
import { PageHeader, PageFooter } from "@/components/page-chrome";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import {
  type ComparisonCase,
  comparisonDifference,
} from "@/lib/core/comparisons";
import { label } from "@/lib/core/types";
import { EntityView } from "./entity-view";
import { Button } from "./ui/button";
import { apiRequest, requestKey } from "./use-trail";
export function ComparisonView({ item }: { item: ComparisonCase }) {
  const [ready, setReady] = useState(false),
    [revealed, setRevealed] = useState(false),
    [reverse, setReverse] = useState(false),
    [choice, setChoice] = useState<string>(),
    [message, setMessage] = useState(""),
    [familiar, setFamiliar] = useState<string[]>([]);
  const voting = useRef(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionError, setSessionError] = useState(false);
  const storageKey = `rabbit-vote:${item.id}:${item.evaluationId}`;
  useEffect(() => {
    apiRequest("/api/session", {})
      .then(() => {
        let stored: string | null = null;
        try {
          stored = sessionStorage.getItem(storageKey);
        } catch {
          /* Optional persistence. */
        }
        let saved:
          | {
              reverse: boolean;
              choice?: string;
              familiar?: string[];
              revealed?: boolean;
            }
          | undefined;
        try {
          if (stored) saved = JSON.parse(stored);
        } catch {
          /* old votes have no frozen order */
        }
        const order =
          saved?.reverse ??
          crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 1;
        setReverse(order);
        setChoice(saved?.choice);
        setFamiliar(saved?.familiar ?? []);
        setRevealed(saved?.revealed ?? false);
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ ...saved, reverse: order }),
          );
        } catch {
          /* Keep the frozen order in memory. */
        }
        setSessionError(false);
        setMessage("");
        setReady(true);
      })
      .catch(() => {
        setSessionError(true);
        setMessage(
          "We couldn't prepare voting. You can still read both versions and show their sources.",
        );
      });
  }, [item.id, storageKey, sessionAttempt]);
  const arms = reverse ? [...item.arms].reverse() : item.arms;
  async function vote(value: string) {
    if (voting.current) return;
    voting.current = true;
    try {
      const result = await apiRequest<{
        vote: { choice: string; armOrder: string[]; familiarity: string[] };
      }>(`/api/comparisons/${item.id}/votes`, {
        choice: value,
        caseVersion: item.evaluationId,
        armOrder: arms.map((a) => a.condition),
        familiarity: familiar,
        idempotencyKey: requestKey(),
      });
      const accepted = result.vote;
      setChoice(accepted.choice);
      setReverse(accepted.armOrder[0] !== item.arms[0].condition);
      setFamiliar(accepted.familiarity);
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            reverse: accepted.armOrder[0] !== item.arms[0].condition,
            choice: accepted.choice,
            familiar: accepted.familiarity,
          }),
        );
      } catch {
        /* The server acknowledged the vote; memory preserves it. */
      }
      setMessage("Your choice is saved for this comparison.");
    } catch {
      setMessage("We couldn't save this choice. Try again.");
    } finally {
      voting.current = false;
    }
  }
  return (
    <>
      <PageHeader />
      <main id="main">
        <h1>
          {item.promptVersion === "deterministic-catalog-order-1"
            ? "Qloo ordering audit"
            : "With and without Qloo"}
        </h1>
        {item.source === "synthetic" ? (
          <p className="notice">
            <strong>Sample data.</strong> Both sets are synthetic illustrations.
            Live paired arms and consented evaluation have not run. No benefit
            or winner has been measured.
          </p>
        ) : (
          <p className="notice">
            Saved Qloo results compared with the same catalog without affinity.
            {item.promptVersion === "deterministic-catalog-order-1"
              ? " This ordering audit compares Qloo order with authored catalog order. The baseline ignores the starting point. No language model ran; recommendation quality has not been evaluated."
              : " Both use the same model."}{" "}
            No user-benefit claim has been established.
          </p>
        )}
        <h2>{item.title}</h2>
        <div className="compare-arms">
          {arms.map((arm, i) => (
            <section key={arm.condition} aria-labelledby={`arm-${i}`}>
              <h2 id={`arm-${i}`}>
                {revealed
                  ? arm.condition === "with"
                    ? "With Qloo affinity"
                    : "Without Qloo affinity"
                  : `Version ${i === 0 ? "A" : "B"}`}
              </h2>
              {arm.entities.length ? (
                <ul className="doors">
                  {arm.entities.map((e) => (
                    <li key={e.id}>
                      <EntityView entity={e} />
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`I already know ${e.name}, Version ${i === 0 ? "A" : "B"}`}
                          disabled={!ready || !!choice || revealed}
                          checked={familiar.includes(e.id)}
                          onChange={(event) =>
                            setFamiliar((prev) =>
                              event.target.checked
                                ? [...new Set([...prev, e.id])]
                                : prev.filter((id) => id !== e.id),
                            )
                          }
                        />
                        I already know this
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {arm.status === "failed"
                    ? "This version could not finish."
                    : item.source === "synthetic"
                      ? "No doors returned in this illustrative arm."
                      : "No doors returned in this saved version."}
                </p>
              )}
              {revealed ? <p>{arm.note}</p> : null}
            </section>
          ))}
        </div>
        <h2>Which set has something unfamiliar you&apos;d actually open?</h2>
        <div className="actions">
          {["Left", "Right", "Both", "Neither"].map((v) => (
            <Button
              key={v}
              disabled={!ready || !!choice || revealed}
              onClick={() => vote(v)}
            >
              {v === "Left" ? "Version A" : v === "Right" ? "Version B" : v}
            </Button>
          ))}
          <Button
            onClick={() => {
              setRevealed(true);
              try {
                const saved = JSON.parse(
                  sessionStorage.getItem(storageKey) ?? "{}",
                );
                sessionStorage.setItem(
                  storageKey,
                  JSON.stringify({ ...saved, revealed: true }),
                );
              } catch {
                /* Reveal remains available without browser storage. */
              }
            }}
          >
            Show sources
          </Button>
        </div>
        <p role="status">{message}</p>
        {sessionError ? (
          <Button onClick={() => setSessionAttempt((n) => n + 1)}>
            Try voting again
          </Button>
        ) : null}
        {revealed ? (
          <>
            <h2>What changed?</h2>
            <p>{comparisonDifference(item)}</p>
            <dl>
              <dt>Frozen</dt>
              <dd>{item.frozenAt}</dd>
              <dt>Catalog</dt>
              <dd>{item.catalogVersion}</dd>
              <dt>Model</dt>
              <dd>{item.model}</dd>
              <dt>Prompt</dt>
              <dd>{item.promptVersion}</dd>
              <dt>Constraints</dt>
              <dd>
                {item.constraints.loves.length} declared favourites;{" "}
                {item.constraints.excluded.length} exclusions;{" "}
                {item.constraints.lessObvious
                  ? "lower popularity ceiling"
                  : "usual popularity range"}
                .
              </dd>
            </dl>
            <details className="comparison-receipt">
              <summary>Frozen brief and query evidence</summary>
              <p>
                Starting point: {item.seed.name} ({item.seed.id}). Output:{" "}
                {label[item.destination]}.
              </p>
              <p>
                Declared favourites:{" "}
                {item.constraints.loves.join(", ") || "none"}. Exclusions:{" "}
                {item.constraints.excluded.join(", ") || "none"}. Popularity
                ceiling: {item.constraints.lessObvious ? "0.8" : "none"}.
              </p>
              <h3>Frozen catalog</h3>
              <ol>
                {item.catalog.map((entity) => (
                  <li key={entity.id}>
                    {entity.name} · {entity.id} ·{" "}
                    {!item.eligibleIds || item.eligibleIds.includes(entity.id)
                      ? "eligible"
                      : "ineligible"}
                  </li>
                ))}
              </ol>
              {item.arms.map((arm) => (
                <section key={arm.condition}>
                  <h3>
                    {arm.condition === "with"
                      ? "With Qloo affinity"
                      : "Without Qloo affinity"}{" "}
                    · {arm.status}
                  </h3>
                  <p>{arm.note}</p>
                  <p>
                    Displayed order:{" "}
                    {arm.entities
                      .map((entity) => `${entity.name} (${entity.id})`)
                      .join(" → ") || "none"}
                    .
                  </p>
                  {arm.evidence ? (
                    <>
                      <p>
                        {arm.evidence.endpoint} · {arm.evidence.source} · cache{" "}
                        {arm.evidence.cache} · checked {arm.evidence.checkedAt}{" "}
                        · {arm.evidence.decoder}
                      </p>
                      <p>
                        Single anchor: {arm.evidence.anchor.id}; output:{" "}
                        {arm.evidence.medium}; excluded:{" "}
                        {arm.evidence.exclusionsCount}; popularity ceiling:{" "}
                        {arm.evidence.popularityMax ?? "none"}.
                      </p>
                      <h4>Validated returned order</h4>
                      <ol>
                        {arm.evidence.results.map((result) => (
                          <li key={result.id}>
                            Position {result.position}:{" "}
                            {item.catalog.find(
                              (entity) => entity.id === result.id,
                            )?.name ?? result.id}{" "}
                            ({result.id})
                            {result.affinity === undefined
                              ? ""
                              : ` · returned affinity ${result.affinity}`}
                          </li>
                        ))}
                      </ol>
                      <p>
                        Eligible IDs absent from the validated response:{" "}
                        {(
                          item.eligibleIds ??
                          item.catalog.map((entity) => entity.id)
                        )
                          .filter(
                            (id) =>
                              !arm.evidence!.results.some(
                                (result) => result.id === id,
                              ),
                          )
                          .join(", ") || "none"}
                        .
                      </p>
                      {arm.evidence.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </>
                  ) : null}
                </section>
              ))}
            </details>
          </>
        ) : null}
        <details className="comparison-method">
          <summary>How this comparison works</summary>
          <p>
            The same starting point, eligible choices and{" "}
            {item.promptVersion === "deterministic-catalog-order-1"
              ? "deterministic selector"
              : "model"}
            . One version uses Qloo&apos;s taste connections; the other uses the
            same catalog metadata without those connections.
          </p>
          <p>
            This is a five-case catalog comparison, not a prediction that
            you&apos;ll enjoy a result.
          </p>
          <p>
            Output: {label[item.destination]}. Same {item.catalog.length}-item
            catalog
            {item.eligibleIds
              ? `, with ${item.eligibleIds.length} eligible choices,`
              : ""}{" "}
            and constraints in both arms. Without Qloo means without
            affinity/recommendation evidence; live arms share Qloo identity
            infrastructure.
          </p>
        </details>
        <Link prefetch={false} href="/compare">
          Five saved comparisons
        </Link>{" "}
        · <ReturnToTrail />
      </main>
      <PageFooter />
    </>
  );
}
