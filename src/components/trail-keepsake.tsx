"use client";
import type { CSSProperties } from "react";
import {
  label,
  type Entity,
  type Generation,
  type Step,
} from "@/lib/core/types";
import { connectionLine } from "@/lib/core/connections";
import { EntityArt } from "./entity-art";
import { EntityView } from "./entity-view";
import { TryThis } from "./try-this";

/** The same finished object for its maker and the friend receiving it. */
export function TrailKeepsake({
  root,
  steps,
  onEvidence,
}: {
  root: Entity;
  steps: Step[];
  onEvidence: (entity: Entity, generation: Generation) => void;
}) {
  return (
    <section className="keepsake" aria-label="Your cultural trail">
      <div className="keepsake-caption">
        <span>One thing led to another</span>
        <span>
          {[root, ...steps.map((s) => s.entity)]
            .map((e) => label[e.medium])
            .join(" → ")}
        </span>
      </div>
      <ol
        className="story-trail"
        style={{ "--stop-count": steps.length + 1 } as CSSProperties}
      >
        {[
          { entity: root, step: undefined },
          ...steps.map((step) => ({ entity: step.entity, step })),
        ].map(({ entity, step }, index) => (
          <li key={entity.id} className={step ? "story-stop" : "story-start"}>
            <div className="story-number">
              <span>{String(index).padStart(2, "0")}</span>
              <span>{index ? label[entity.medium] : "Where it began"}</span>
            </div>
            <EntityArt
              entity={entity}
              index={index}
              compact
              layout="trail"
              count={steps.length + 1}
            />
            <EntityView
              entity={entity}
              heading
              description={false}
              shortTitle
            />
            {step ? (
              <p className="story-connection">
                {connectionLine(entity, step.generation)}
              </p>
            ) : null}
            <div className="story-bottom">
              {step ? <TryThis entity={entity} /> : null}
              {step ? (
                <button
                  type="button"
                  className="story-evidence"
                  aria-label={`Why this? ${entity.name}`}
                  onClick={() => onEvidence(entity, step.generation)}
                >
                  Why this?
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="keepsake-colophon">
        <span>Rabbit Hole</span>
        <span>
          {steps.length} {steps.length === 1 ? "discovery" : "discoveries"}
        </span>
      </div>
    </section>
  );
}
