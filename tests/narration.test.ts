import { expect, it } from "vitest";
import { TurnTools } from "../src/lib/core/agent";
import { connectionLine } from "../src/lib/core/connections";
import { qlooPort } from "../src/lib/core/qloo";
import { setup } from "./helpers";

it("rejects a synopsis from another door while keeping narration tied to its own facts", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  const turn = new TurnTools(
    trail,
    "auto",
    false,
    qlooPort({ storage: c.storage, owner: c.owner, mode: "fixture" }),
    async () => {},
  );
  await turn.discoverDoors("artist");
  const [first, second] = turn.discovery!.entities;
  first.name = "Window Songs";
  first.narrativeFacts = "A pianist records intimate songs beside a window.";
  second.name = "Island Stories";
  second.narrativeFacts =
    "An explorer visits a distant island with a whimsical captain.";
  const ids = turn.discovery!.entities.map((entity) => entity.id);
  turn.publishDoors(
    ids,
    ids.map((_, index) =>
      index < 2
        ? "From the starting point, follow an explorer to a distant island with a whimsical captain."
        : "From the starting point, try another discovery.",
    ),
  );
  expect(turn.published!.connections?.[first.id]).toBeUndefined();
  expect(turn.published!.connections?.[second.id]).toContain("explorer");
  turn.published!.discovery.source = "qloo";
  expect(connectionLine(first, turn.published!)).toContain("pianist");
});
