"use client";
import Image from "next/image";
import { useState, type CSSProperties } from "react";
import { label, type Entity } from "@/lib/core/types";

function trailSizes(count: number, index: number) {
  const slot = (
    columns: number,
    gutter: number,
    gap: number,
    width = "100vw",
  ) => {
    const n = Math.min(count, columns);
    const padding = index === count - 1 ? 0 : gap + 1;
    return `calc((${width} - ${2 * gutter + (n - 1) * gap + n * padding}px) / ${n})`;
  };
  return `(max-width: 700px) 192px, (max-width: 755px) ${slot(2, 32, 16)}, (max-width: 991px) ${slot(3, 32, 16)}, (max-width: 1100px) ${slot(4, 32, 16)}, (max-width: 1600px) ${slot(4, 56, 24)}, ${slot(4, 56, 24, "1600px")}`;
}

/** Qloo-provided media, with original typography/geometry when unavailable. */
export function EntityArt({
  entity,
  index = 0,
  compact = false,
  layout = "opening",
  count = 4,
}: {
  entity: Entity;
  index?: number;
  compact?: boolean;
  layout?: "opening" | "door" | "history" | "trail" | "connection";
  count?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (entity.imageUrl && failedUrl !== entity.imageUrl)
    return (
      <div
        className={`entity-art qloo-art art-${entity.medium} ${compact ? "art-compact" : ""}`}
      >
        <Image
          fill
          sizes={
            layout === "connection"
              ? "(max-width: 700px) calc((100vw - 84px) / 2), 258px"
              : layout === "history"
                ? "48px"
                : layout === "door"
                  ? "(max-width: 920px) 192px, (max-width: 1100px) calc((100vw - 120px) / 3), (max-width: 1600px) calc((100vw - 168px) / 3), 478px"
                  : layout === "trail"
                    ? trailSizes(count, index)
                    : "(max-width: 700px) 90vw, 48vw"
          }
          ref={(node) => {
            // An SSR image may fail before React attaches its error listener.
            if (node?.complete && node.naturalWidth === 0)
              setFailedUrl(entity.imageUrl);
          }}
          src={entity.imageUrl}
          alt=""
          loading={compact ? "lazy" : "eager"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(entity.imageUrl)}
        />
      </div>
    );
  const words = entity.name.split(/\s+/);
  const longest = Math.max(...words.map((word) => word.length));
  // Composition follows the length and available identity metadata, never an invented aesthetic.
  const variation =
    entity.medium === "movie" ? (entity.year ?? 0) % 3 : words.length % 3;
  return (
    <div
      className={`entity-art art-${entity.medium} art-variant-${variation} ${compact ? "art-compact" : ""}`}
      aria-hidden="true"
      style={
        { "--title-fit": `${Math.min(20, 145 / longest)}cqw` } as CSSProperties
      }
    >
      {!compact ? (
        <div className="art-topline">
          <span>{label[entity.medium]}</span>
          <span>{String(index).padStart(2, "0")}</span>
        </div>
      ) : null}
      <svg className="art-geometry" viewBox="0 0 600 600" fill="none">
        {entity.medium === "artist" ? (
          variation === 0 ? (
            [220, 175, 130, 85].map((r) => (
              <circle key={r} cx="400" cy="160" r={r} />
            ))
          ) : variation === 1 ? (
            [0, 1, 2, 3, 4, 5, 6].map((n) => (
              <path key={n} d={`M${40 + n * 75} 0v${180 + n * 45}h45V0`} />
            ))
          ) : (
            [0, 1, 2, 3, 4].map((n) => (
              <ellipse
                key={n}
                cx="480"
                cy="140"
                rx={150 + n * 35}
                ry={80 + n * 30}
                transform="rotate(-35 480 140)"
              />
            ))
          )
        ) : entity.medium === "book" ? (
          [0, 35, 70].map((r) => (
            <ellipse
              key={r}
              cx="350"
              cy="300"
              rx="130"
              ry="250"
              transform={`rotate(${r} 350 300)`}
            />
          ))
        ) : (
          <>
            <circle cx="430" cy="170" r="240" />
            <circle cx="430" cy="170" r="190" />
            <path d="M0 395 600 100M0 455 600 160M0 515 600 220M0 575 600 280M130 0v600M450 0v600" />
          </>
        )}
      </svg>
      <span className="art-title">{entity.name}</span>
      <div className="art-bottomline">
        <span>
          {entity.author ?? entity.disambiguation ?? entity.year ?? ""}
        </span>
        <span />
      </div>
    </div>
  );
}
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 36 40"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="18" cy="20" rx="14" ry="18" transform="rotate(28 18 20)" />
      <ellipse cx="18" cy="20" rx="9" ry="12" transform="rotate(28 18 20)" />
      <ellipse cx="18" cy="20" rx="3" ry="5" transform="rotate(28 18 20)" />
    </svg>
  );
}
