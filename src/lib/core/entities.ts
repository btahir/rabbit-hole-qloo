import type { QlooEntity } from "../qloo/schemas";
import type { Entity, Medium } from "./types";
import { assert } from "./errors";
export function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname === "images.qloo.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
    )
      return url.href;
  } catch {
    /* Missing or unsupported artwork uses our original fallback. */
  }
}
function englishSummary(value: unknown): string | undefined {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (
      item &&
      typeof item.value === "string" &&
      (item.language === "en" ||
        (Array.isArray(item.languages) && item.languages.includes("en")))
    )
      return item.value;
  }
}
function externalId(value: unknown, provider: string): unknown {
  if (!value || typeof value !== "object") return;
  const item = (value as Record<string, unknown>)[provider];
  const entry = Array.isArray(item) ? item[0] : item;
  return entry && typeof entry === "object"
    ? (entry as { id?: unknown }).id
    : undefined;
}
export function safeInformationUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash
    )
      return;
    if (
      u.hostname === "www.imdb.com" &&
      /^\/title\/tt\d{7,10}\/?$/.test(u.pathname)
    )
      return u.href;
    if (
      u.hostname === "www.goodreads.com" &&
      /^\/book\/show\/\d+[\w.-]*\/?$/.test(u.pathname)
    )
      return u.href;
    if (
      u.hostname === "open.spotify.com" &&
      /^\/artist\/[A-Za-z0-9]{22}$/.test(u.pathname)
    )
      return u.href;
    if (
      u.hostname === "musicbrainz.org" &&
      /^\/artist\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
        u.pathname,
      )
    )
      return u.href;
  } catch {
    /* unavailable links are omitted */
  }
}
export function normalizeEntity(
  raw: QlooEntity,
  expected: Medium,
  checkedAt: string,
): Entity {
  const id = (raw.entity_id ?? raw.id)!.toLowerCase();
  assert(
    !raw.id ||
      !raw.entity_id ||
      raw.id.toLowerCase() === raw.entity_id.toLowerCase(),
    "contract",
    502,
  );
  const categories = [raw.type, raw.subtype, ...(raw.types ?? [])].filter(
    (type): type is string => !!type && type !== "urn:entity",
  );
  assert(
    categories.length > 0 &&
      categories.every((type) => type === `urn:entity:${expected}`),
    "contract",
    502,
  );
  assert(raw.name.trim() && raw.name.length <= 300, "contract", 502);
  const p = raw.properties;
  const year =
    raw.release_year ??
    raw.publication_year ??
    p?.release_year ??
    p?.publication_year;
  const description =
    raw.short_description ??
    p?.short_description ??
    englishSummary(raw.short_descriptions) ??
    englishSummary(p?.short_descriptions) ??
    raw.description ??
    p?.description;
  const entity: Entity = {
    id,
    medium: expected,
    name: raw.name.trim(),
    source: "Qloo",
    checkedAt,
    schemaVersion: 1,
  };
  if (year != null) entity.year = year;
  if (raw.author ?? p?.author)
    entity.author = (raw.author ?? p?.author)!.slice(0, 200);
  if (raw.disambiguation ?? p?.disambiguation)
    entity.disambiguation = (raw.disambiguation ?? p?.disambiguation)!.slice(
      0,
      200,
    );
  if (description) {
    const clean = description
      .replace(/<[^>]*>/g, "")
      .replace(
        /&(?:amp|lt|gt|quot|apos);/g,
        (value) =>
          ({
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&apos;": "'",
          })[value]!,
      )
      .replace(/\s+/g, " ")
      .trim();
    entity.narrativeFacts =
      clean.match(/[^.!?]+[.!?]+(?=\s|$)/g)?.reduce((facts, sentence) => {
        const next = `${facts} ${sentence.trim()}`.trim();
        return next.length <= 600 ? next : facts;
      }, "") || undefined;
    entity.description =
      clean.length <= 160
        ? clean
        : (clean.slice(0, 160).match(/^(.{20,}?[.!?])(?:\s|$)/)?.[1] ??
          `${clean.slice(0, 157).replace(/\s+\S*$/, "")}…`);
  }
  const imageUrl = safeImageUrl(p?.image?.url ?? raw.image?.url);
  if (imageUrl) entity.imageUrl = imageUrl;
  // Never interpret taxonomy `url` / image.url as an information URL.
  const imdb =
    externalId(raw.external, "imdb") ?? externalId(p?.external, "imdb");
  const goodreads =
    externalId(raw.external, "goodreads") ??
    externalId(p?.external, "goodreads");
  if (
    expected === "movie" &&
    typeof imdb === "string" &&
    /^tt\d{7,10}$/.test(imdb)
  )
    entity.informationUrl = safeInformationUrl(
      `https://www.imdb.com/title/${imdb}/`,
    );
  if (
    expected === "book" &&
    typeof goodreads === "string" &&
    /^\d+$/.test(goodreads)
  )
    entity.informationUrl = safeInformationUrl(
      `https://www.goodreads.com/book/show/${goodreads}`,
    );
  if (expected === "artist") {
    const spotify =
      externalId(raw.external, "spotify") ?? externalId(p?.external, "spotify");
    const musicbrainz =
      externalId(raw.external, "musicbrainz") ??
      externalId(p?.external, "musicbrainz");
    if (typeof spotify === "string" && /^[A-Za-z0-9]{22}$/.test(spotify))
      entity.informationUrl = safeInformationUrl(
        `https://open.spotify.com/artist/${spotify}`,
      );
    else if (typeof musicbrainz === "string")
      entity.informationUrl = safeInformationUrl(
        `https://musicbrainz.org/artist/${musicbrainz}`,
      );
  }
  return entity;
}
