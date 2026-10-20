import Link from "next/link";
import { label, type Entity } from "@/lib/core/types";
export function EntityView({
  entity,
  heading = false,
  description = true,
  shortTitle = false,
}: {
  entity: Entity;
  heading?: boolean;
  description?: boolean;
  shortTitle?: boolean;
}) {
  const title =
    shortTitle && entity.medium === "book" && entity.name.includes(": ")
      ? entity.name.split(": ")[0]
      : entity.name;
  const detail =
    entity.medium === "movie"
      ? entity.year
      : entity.medium === "book"
        ? (entity.author ?? entity.disambiguation ?? entity.year)
        : entity.disambiguation === entity.name
          ? undefined
          : entity.disambiguation;
  return (
    <div className="entity">
      <p className="metadata">
        {label[entity.medium]}
        {detail ? ` · ${detail}` : ""}
      </p>
      {heading ? (
        <h3
          className={title.length > 65 ? "long-entity-title" : undefined}
          aria-label={title !== entity.name ? entity.name : undefined}
        >
          {title}
        </h3>
      ) : (
        <p className="entity-name">{entity.name}</p>
      )}
      {description ? <EntityDescription entity={entity} /> : null}
    </div>
  );
}
export function readableDescription(value: string): string {
  value = value.replace(/<[^>]*>/g, "");
  const complete = value.match(/^(.{20,}?[.!?])(?:\s|$)/)?.[1];
  return complete ?? value;
}
export function EntityDescription({ entity }: { entity: Entity }) {
  return entity.description ? (
    <p className="entity-description">
      {readableDescription(entity.description)}
      <cite className="description-source">
        Source: {entity.descriptionSource ?? entity.source}
      </cite>
    </p>
  ) : null;
}
export function InformationLink({
  entity,
  compact = false,
  brief = false,
}: {
  entity: Entity;
  compact?: boolean;
  brief?: boolean;
}) {
  return entity.informationUrl ? (
    <Link
      prefetch={false}
      href={entity.informationUrl}
      aria-label={
        compact || entity.medium === "artist"
          ? `Open ${entity.medium === "movie" ? "film" : entity.medium}: ${entity.name}`
          : `About ${entity.name}`
      }
      className="information-link"
      target="_blank"
      rel="noopener noreferrer"
    >
      {entity.informationUrl.includes("spotify.com")
        ? brief
          ? "Spotify"
          : "Open on Spotify"
        : entity.informationUrl.includes("goodreads.com")
          ? brief
            ? "Goodreads"
            : "About this book"
          : entity.informationUrl.includes("imdb.com")
            ? brief
              ? "IMDb"
              : "About this film"
            : `About this ${entity.medium === "movie" ? "film" : entity.medium}`}
      <span aria-hidden="true">↗</span>
    </Link>
  ) : null;
}
