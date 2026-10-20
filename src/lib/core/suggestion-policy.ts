import type { QlooEntity } from "../qloo/schemas";

const unsuitableTitles = new Set([
  "lolita",
  "naked lunch",
  "dogtooth",
  "enter the void",
  "the tale",
  "for sama",
  "the act of killing",
  "circus of books",
]);
// These identities were returned as candidates but failed as subsequent anchors.
const unusableAnchors = new Set([
  // Prince opening: excluded as an onward seed after live discovery validation.
  "bf077e87-9221-451e-a4a3-61a5475c1671",
  "71572e5b-47bd-4de2-9b19-5a27973dfec4",
  "17aa0b10-a5b7-435e-a130-2c2f38e319cc",
  "f93f9ee9-1994-4aaa-818f-ef6424abae5d",
  "4d73c871-cc0f-4fc8-88cd-7c59b26e087e",
]);
const explicitTags =
  /(?:child sexual abuse|sexual abuse|incest|pornography|sexual exploitation|graphic violence|mass murder|torture)/i;

/** Applies only to suggested doors, never to the user's confirmed starting point.
 * Ratings/tags are incomplete; this is a bounded editorial filter, not a safety guarantee. */
export function eligibleSuggestion(row: QlooEntity): boolean {
  if (
    unsuitableTitles.has(row.name.trim().toLowerCase()) ||
    unusableAnchors.has((row.entity_id ?? row.id ?? "").toLowerCase())
  )
    return false;
  const rating = row.properties?.content_rating ?? row.content_rating;
  const movie = [row.type, row.subtype, ...(row.types ?? [])].includes(
    "urn:entity:movie",
  );
  if (
    movie &&
    (typeof rating !== "string" || !["G", "PG", "PG-13"].includes(rating))
  )
    return false;
  if (typeof rating === "string" && !["G", "PG", "PG-13"].includes(rating))
    return false;
  return !(row.tags ?? []).some((tag) =>
    explicitTags.test(
      "name" in tag && typeof tag.name === "string" ? tag.name : "",
    ),
  );
}
