import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { label, type PublicTrail } from "./types";
export const imageSize = { width: 1200, height: 630 };
export async function renderTrailImage(snapshot: PublicTrail) {
  const font = await readFile(join(process.cwd(), "public/fonts/anton-og.ttf"));
  const path = [snapshot.root, ...snapshot.steps.map((step) => step.entity)];
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#131411",
        color: "#f2f0e9",
        width: "100%",
        height: "100%",
        padding: "42px 48px",
        fontFamily: "Anton",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 24,
          letterSpacing: 2,
        }}
      >
        <span>RABBIT HOLE</span>
        <span style={{ color: "#e4f260" }}>
          {snapshot.mode === "fixture"
            ? "ILLUSTRATIVE TRAIL"
            : "A TRAIL FOR YOU"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 40,
          lineHeight: 1.1,
          marginTop: 24,
          marginBottom: 24,
        }}
      >
        ONE THING LED TO ANOTHER.
      </div>
      <div
        style={{ display: "flex", flexGrow: 1, borderTop: "2px solid #e4f260" }}
      >
        {path.map((entity, i) => (
          <div
            key={entity.id}
            style={{
              display: "flex",
              flexDirection: "column",
              width: `${100 / path.length}%`,
              padding: "24px 22px 16px",
              borderRight:
                i < path.length - 1
                  ? "1px solid #626657"
                  : "0px solid transparent",
              background: i === path.length - 1 ? "#e4f260" : "#131411",
              color: i === path.length - 1 ? "#131411" : "#f2f0e9",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 20,
                marginBottom: 24,
              }}
            >
              <span>{String(i).padStart(2, "0")}</span>
              <span>{label[entity.medium].toUpperCase()}</span>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: entity.name.length > 35 ? 36 : 46,
                lineHeight: 1.2,
              }}
            >
              {entity.name.length > 80
                ? `${entity.name.slice(0, 77)}…`
                : entity.name}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: "auto",
                paddingTop: 12,
                fontSize: 20,
              }}
            >
              {i === path.length - 1 ? "03 →" : "→"}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 24,
          fontSize: 20,
          color: "#a9ada0",
        }}
      >
        <span>FILMS. MUSIC. BOOKS.</span>
        <span>KEEP THE BEGINNING. CHOOSE YOUR OWN ENDING.</span>
      </div>
    </div>,
    {
      ...imageSize,
      fonts: [{ name: "Anton", data: font, style: "normal", weight: 400 }],
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
