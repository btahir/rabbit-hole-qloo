import { expect, it } from "vitest";
import { setup, generate, key } from "./helpers";
import { visibleDoors } from "../src/lib/core/types";
import { eligibleSuggestion } from "../src/lib/core/suggestion-policy";
it("keeps sender notes explicit and immutable across shared versions", async () => {
  const c = await setup();
  let trail = await generate(c);
  trail = await c.service.action(
    c.owner,
    c.ip,
    trail.id,
    trail.version,
    key(),
    {
      action: "follow",
      entityId: visibleDoors(trail)[0].id,
      generationId: trail.current!.id,
    },
  );
  const first = await c.service.share(
    c.owner,
    c.ip,
    trail.id,
    trail.version,
    key(),
    "Try the music first.",
  );
  const replay = await c.service.share(
    c.owner,
    c.ip,
    trail.id,
    trail.version,
    key(),
    "Try the music first.",
  );
  const second = await c.service.share(
    c.owner,
    c.ip,
    trail.id,
    trail.version,
    key(),
    "The book is my next stop.",
  );
  expect(replay.token).toBe(first.token);
  expect(second.token).not.toBe(first.token);
  const one = await c.service.visitor(first.token, c.owner, c.ip);
  expect(one.note).toBe("Try the music first.");
  expect((await c.service.visitor(second.token, c.owner, c.ip)).note).toBe(
    "The book is my next stop.",
  );
  await expect(
    c.service.share(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      "x".repeat(241),
    ),
  ).rejects.toMatchObject({ code: "input" });
});
it("quarantines the observed failed philosophy anchor even in cached candidate results", () => {
  expect(
    eligibleSuggestion({
      entity_id: "71572e5b-47bd-4de2-9b19-5a27973dfec4",
      name: "A History of Western Philosophy",
      types: ["urn:entity:book"],
    }),
  ).toBe(false);
});
