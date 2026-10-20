"use client";
import Link from "next/link";
import { label } from "@/lib/core/types";
import type { Entity, Generation, Evidence } from "@/lib/core/types";
import { connectionLine, rankingChange } from "@/lib/core/connections";
import { comparisonReturnKey } from "./comparison-return";
import { EntityArt } from "./entity-art";
import { TryThis } from "./try-this";
import { EntityDescription } from "./entity-view";
import { Button } from "./ui/button";
function Receipt({ evidence, entity }: { evidence: Evidence; entity: Entity }) {
  const entry = evidence.results.find((r) => r.id === entity.id);
  return (
    <dl className="query-receipt">
      <dt>Anchor ID</dt>
      <dd>{evidence.anchor.id}</dd>
      <dt>Destination ID</dt>
      <dd>{entity.id}</dd>
      <dt>Query</dt>
      <dd>
        {evidence.endpoint} · filter.type=urn:entity:{evidence.medium} · take=12
        · sort_by=affinity · feature.explainability=true
      </dd>
      <dt>Signal IDs</dt>
      <dd>
        {(evidence.kind === "ranking" ? evidence.loves : [evidence.anchor])
          .map((e) => e.id)
          .join(", ")}
      </dd>
      <dt>Source / cache</dt>
      <dd>
        {evidence.source} / {evidence.cache}
      </dd>
      <dt>Checked</dt>
      <dd>{evidence.checkedAt}</dd>
      <dt>Decoder</dt>
      <dd>{evidence.decoder}</dd>
      <dt>Exclusions / popularity ceiling</dt>
      <dd>
        {evidence.exclusionsCount} / {evidence.popularityMax ?? "usual range"}
      </dd>
      <dt>Returned membership</dt>
      <dd>{entry ? `Yes · position ${entry.position}` : "Not returned"}</dd>
      <dt>Explanation</dt>
      <dd>{entry?.explanation?.status ?? "missing"}</dd>
    </dl>
  );
}
export function EvidenceView({
  entity,
  generation,
  publicView = false,
  onSteps,
}: {
  entity: Entity;
  generation: Generation;
  publicView?: boolean;
  onSteps?: () => void;
}) {
  const evidence = generation.discovery,
    entry = evidence.results.find((x) => x.id === entity.id);
  const synthetic = evidence.source === "synthetic";
  return (
    <div className="evidence-content">
      {synthetic ? (
        <p className="notice">
          Illustrative connection. No live Qloo request ran.
        </p>
      ) : null}
      <div className="connection-art" aria-hidden="true">
        <EntityArt entity={evidence.anchor} compact layout="connection" />
        <span>→</span>
        <EntityArt entity={entity} compact layout="connection" />
      </div>
      <p className="connection-caption">{connectionLine(entity, generation)}</p>
      <TryThis entity={entity} expanded />
      <p className="connection-limit">
        The guide’s reading of the metadata. Qloo connects audiences’ tastes; it
        does not explain themes or influence.
      </p>
      {!publicView && generation.ranking ? (
        <section>
          <h3>How the guide narrowed it down</h3>
          <p>{rankingChange(generation, entity)}</p>
          <p>{rankingChange(generation)}</p>
          <p>Checked against the favourites you chose:</p>
          <ul>
            {generation.ranking.loves.map((love) => (
              <li key={love.id}>{love.name}</li>
            ))}
          </ul>
          <ol className="evidence-shortlist">
            {generation.pool.slice(0, 3).map((candidate) => (
              <li key={candidate.id}>
                {candidate.name}
                {candidate.id === entity.id ? " · this door" : ""}
              </li>
            ))}
          </ol>
        </section>
      ) : generation.personalRankingApplied ? (
        <p>
          The creator&apos;s private favourites affected the ordering. This
          receipt shows the single-anchor discovery; their preferences are not
          shared.
        </p>
      ) : null}
      <details className="technical-evidence">
        <summary>Qloo evidence &amp; source details</summary>
        <EntityDescription entity={entity} />
        <p>
          From {evidence.anchor.name} to {entity.name}. Checked{" "}
          {new Date(evidence.checkedAt).toLocaleString()}.
        </p>
        <details>
          <summary>Query details</summary>
          <dl>
            <dt>Endpoint</dt>
            <dd>{evidence.endpoint}</dd>
            <dt>Output category</dt>
            <dd>{label[evidence.medium]}</dd>
            <dt>Exclusions</dt>
            <dd>
              {evidence.exclusionsCount} checked by the app
              {evidence.upstreamExclusionsCount !== undefined
                ? `; ${evidence.upstreamExclusionsCount} sent upstream`
                : ""}
            </dd>
            {evidence.popularityMax !== undefined ? (
              <>
                <dt>Popularity ceiling</dt>
                <dd>{evidence.popularityMax}</dd>
              </>
            ) : null}
            <dt>Checked</dt>
            <dd>
              <time dateTime={evidence.checkedAt}>
                {new Date(evidence.checkedAt).toLocaleString(undefined, {
                  timeZoneName: "short",
                })}
              </time>
            </dd>
            <dt>Source</dt>
            <dd>
              {synthetic
                ? "Synthetic example"
                : evidence.cache === "hit"
                  ? "Saved Qloo results"
                  : "Live Qloo"}
            </dd>
          </dl>
          {evidence.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <p>
            We kept this door because it had a checked identity and wasn&apos;t
            on your visited or skipped list.
          </p>
        </details>
        <h3>Qloo&apos;s evidence</h3>
        <h4>Single-anchor discovery</h4>
        <Receipt evidence={evidence} entity={entity} />
        <p>Position {entry?.position ?? "unavailable"} in this response</p>
        {!synthetic && entry?.affinity !== undefined ? (
          <p>Returned affinity: {entry.affinity}</p>
        ) : null}
        {synthetic ? (
          <p>This example contains no live Qloo explanation.</p>
        ) : entry?.explanation?.status === "returned" ? (
          entry.explanation.contributions.map((contribution) => (
            <p key={contribution.entityId}>
              Returned contribution from{" "}
              {evidence.anchor.id === contribution.entityId
                ? evidence.anchor.name
                : "a confirmed input"}
              : {contribution.value}
            </p>
          ))
        ) : (
          <p>
            {entry?.explanation?.status === "unsupported"
              ? "Explanation data was returned in a format this view cannot display yet."
              : evidence.warnings.some((warning) =>
                    warning.includes("could not compute"),
                  )
                ? "Qloo reported that explanation data was unavailable for this response."
                : "Qloo didn't return a detailed explanation for this connection."}
          </p>
        )}
        {generation.ranking && !publicView ? (
          <>
            <h4>Separate favourites ranking</h4>
            <Receipt evidence={generation.ranking} entity={entity} />
            <p>
              Separate favourites ranking · checked{" "}
              {new Date(generation.ranking.checkedAt).toLocaleString(
                undefined,
                {
                  timeZoneName: "short",
                },
              )}
            </p>
            <p>
              Position{" "}
              {generation.ranking.results.find((e) => e.id === entity.id)
                ?.position ?? "not returned"}{" "}
              in the personal ranking response
            </p>
            {generation.ranking.results.find((e) => e.id === entity.id)
              ?.affinity !== undefined ? (
              <p>
                Returned personal-ranking affinity:{" "}
                {
                  generation.ranking.results.find((e) => e.id === entity.id)
                    ?.affinity
                }
              </p>
            ) : null}
            {generation.ranking.results
              .find((result) => result.id === entity.id)
              ?.explanation?.contributions.map((contribution) => (
                <p key={contribution.entityId}>
                  Returned personal-ranking contribution from{" "}
                  {generation.ranking!.loves.find(
                    (love) => love.id === contribution.entityId,
                  )?.name ?? "a confirmed input"}
                  : {contribution.value}
                </p>
              ))}
          </>
        ) : null}
        {onSteps ? (
          <Button onClick={onSteps}>
            {synthetic ? "Example steps" : "Agent steps"}
          </Button>
        ) : null}
        <Link
          prefetch={false}
          href="/compare"
          onClick={() => {
            if (!publicView && /^\/t\/[\w-]{8,100}$/.test(location.pathname))
              sessionStorage.setItem(
                comparisonReturnKey,
                JSON.stringify({
                  path: location.pathname,
                  scroll: window.scrollY,
                  entityId: entity.id,
                  generationId: generation.id,
                }),
              );
          }}
        >
          Qloo ordering audit
        </Link>
      </details>
    </div>
  );
}
