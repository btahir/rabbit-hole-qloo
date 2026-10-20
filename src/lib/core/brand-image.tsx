import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ink = "#131411",
  paper = "#f2f0e9",
  acid = "#e4f260",
  muted = "#a9ada0";

/** Concentric tilted rings (the brand mark) drawn as a tunnel, as SVG. */
function tunnel(width: number, height: number) {
  const cx = width * 0.8,
    cy = height * 0.5,
    unit = height / 630;
  const rings = [
    [1.0, 0.16],
    [0.78, 0.28],
    [0.58, 0.48],
    [0.39, 0.74],
  ];
  const ellipses = rings
    .map(
      ([size, alpha]) =>
        `<ellipse cx="${cx}" cy="${cy}" rx="${360 * unit * size}" ry="${470 * unit * size}" fill="none" stroke="${acid}" stroke-opacity="${alpha}" stroke-width="${5 * unit}" transform="rotate(28 ${cx} ${cy})"/>`,
    )
    .join("");
  const core = `<ellipse cx="${cx}" cy="${cy}" rx="${72 * unit}" ry="${96 * unit}" fill="${acid}" transform="rotate(28 ${cx} ${cy})"/>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${ellipses}${core}</svg>`,
  )}`;
}

/** The site-wide share card (homepage OG/Twitter image and GitHub preview). */
export async function renderBrandImage(width: number, height: number) {
  const font = await readFile(join(process.cwd(), "public/fonts/anton-og.ttf"));
  const s = Math.min(width / 1200, height / 630);
  return new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        background: ink,
        color: paper,
        fontFamily: "Anton",
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img
        src={tunnel(width, height)}
        width={width}
        height={height}
        style={{ position: "absolute", left: 0, top: 0 }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: `${52 * s}px ${64 * s}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 30 * s,
            letterSpacing: 3 * s,
          }}
        >
          RABBIT HOLE
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 26 * s,
              letterSpacing: 4 * s,
              color: muted,
              marginBottom: 18 * s,
            }}
          >
            ONE FAVOURITE. THREE TURNS.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 150 * s,
              lineHeight: 0.98,
            }}
          >
            WHAT DO
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 150 * s,
              lineHeight: 0.98,
            }}
          >
            YOU&nbsp;<span style={{ color: acid }}>LOVE?</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 34 * s,
            letterSpacing: 2 * s,
          }}
        >
          {["FILM", "MUSIC", "BOOKS"].map((medium, i) => (
            <div key={medium} style={{ display: "flex", alignItems: "center" }}>
              <span
                style={{
                  display: "flex",
                  padding: `${8 * s}px ${18 * s}px`,
                  border: `2px solid ${i === 2 ? acid : "#626657"}`,
                  background: i === 2 ? acid : ink,
                  color: i === 2 ? ink : paper,
                }}
              >
                {medium}
              </span>
              {i < 2 ? (
                <span
                  style={{
                    display: "flex",
                    color: acid,
                    margin: `0 ${16 * s}px`,
                  }}
                >
                  →
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>,
    {
      width,
      height,
      fonts: [{ name: "Anton", data: font, style: "normal", weight: 400 }],
    },
  );
}
