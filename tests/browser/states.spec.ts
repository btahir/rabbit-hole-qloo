import { openControls } from "./controls";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { OwnerTrail } from "../../src/lib/core/types";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
async function shot(page: Page, name: string, width: number) {
  if (!process.env.RABBIT_SHOTS_DIR) return;
  await mkdir(process.env.RABBIT_SHOTS_DIR, { recursive: true });
  await page.evaluate(() => {
    scrollTo(0, 0);
    return document.fonts.ready;
  });
  if (name === "partial-metadata")
    await page
      .getByRole("heading", { name: "Some details are missing.", exact: true })
      .filter({ visible: true })
      .scrollIntoViewIfNeeded();
  if (name === "unsaved-preview")
    await page
      .getByRole("region", { name: "Unsaved preview", exact: true })
      .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(process.env.RABBIT_SHOTS_DIR, `${name}-${width}.png`),
    animations: "disabled",
  });
}
for (const width of [1440, 390]) {
  test(`sparse, empty, partial, waiting, stopped, offline and reflow at ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "The Left Hand of Darkness", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/t\//);
    await expect(
      page
        .getByRole("button", { name: /^Add to trail:/ })
        .filter({ visible: true }),
    ).toHaveCount(3);
    const id = page.url().split("/").at(-1)!;
    const original: OwnerTrail = await (
      await page.request.get(`/api/trails/${id}`)
    ).json();
    async function render(value: OwnerTrail) {
      // Browser storage supports synthetic examples only. No public test switch or live state injection.
      await page.evaluate(
        ({ value, id }) =>
          sessionStorage.setItem(
            `rabbit-example:${id}`,
            JSON.stringify({
              trail: value,
              baseline: value.version,
              queue: [
                {
                  kind: "action",
                  choice: { action: "save", entityId: value.root.id },
                  key: "fixture-presentation-only",
                },
              ],
            }),
          ),
        { value, id },
      );
      await page.reload();
    }
    for (const count of [2, 1, 0]) {
      const value = structuredClone(original);
      value.current!.pool = value.current!.pool.slice(0, count);
      await render(value);
      await expect(
        page
          .getByRole("button", { name: /^Add to trail:/ })
          .filter({ visible: true }),
      ).toHaveCount(count);
      await expect(
        page.getByRole("heading", {
          name: count ? `${count} doors from here` : "No doors from here yet.",
          exact: true,
        }),
      ).toBeVisible();
      await shot(page, count ? `sparse-${count}` : "empty", width);
    }
    const exhausted = structuredClone(original);
    exhausted.excluded = exhausted.current!.pool.map((entity) => ({
      entity,
      reason: "known",
    }));
    await render(exhausted);
    await expect(
      page
        .getByRole("heading", {
          name: "You've tried these doors.",
          exact: true,
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot(page, "exhausted", width);
    const partial = structuredClone(original);
    partial.current!.warnings = [
      "Some details are missing. These doors have checked names and connections.",
    ];
    partial.current!.pool[0].description =
      "A verified metadata description is shown only when it is supplied.";
    await render(partial);
    await expect(
      page
        .getByRole("heading", {
          name: "Some details are missing.",
          exact: true,
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot(page, "partial-metadata", width);
    const locked = structuredClone(original);
    locked.current!.pool = [];
    locked.directionRequest = "artist";
    locked.message = "No films from here yet. Try music?";
    await render(locked);
    await expect(
      page
        .getByRole("button", { name: "Keep my direction", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot(page, "locked-direction", width);
    await page
      .getByRole("button", { name: "Keep my direction", exact: true })
      .filter({ visible: true })
      .click();
    await page.evaluate(
      (id) => sessionStorage.removeItem(`rabbit-example:${id}`),
      id,
    );
    const sessionReady = page.waitForResponse((response) =>
      response.url().endsWith("/api/session"),
    );
    await page.reload();
    await sessionReady;
    await context.setOffline(true);
    await expect(
      page.getByText("You're offline. You can still read this open trail."),
    ).toBeVisible();
    await shot(page, "offline", width);
    await context.setOffline(false);
    // Synthetic accepted SSE plus a held replay request exercises truthful pending/cancel UI.
    let release!: () => void;
    let cancelled = false;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/agent", (route) =>
      route.fulfill({
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "test-held",
        },
        body: `data: ${JSON.stringify({ type: "data-run", data: { event: { runId: "test-held", sequence: 1, message: "Waiting for a place to start…" } } })}\n\n`,
      }),
    );
    await page.route(/\/api\/runs\/test-held(?:\?.*)?$/, async (route) => {
      if (!cancelled) await gate;
      await route
        .fulfill({
          json: {
            trail: original,
            state: "cancelled",
            events: [],
            guide: "Deterministic local guide",
            attempts: 0,
            modelSteps: 0,
            elapsedMs: 11000,
          },
        })
        .catch(() => {});
    });
    await page.route("**/api/runs/test-held/cancel", async (route) => {
      cancelled = true;
      release();
      await route.fulfill({ json: {} });
    });
    await page.clock.install();
    await openControls(page, "direction");
    await page
      .getByRole("button", { name: "Refresh doors", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole("heading", {
          name: "Finding your next doors",
          exact: true,
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot(page, "loading", width);
    await page.clock.fastForward(11000);
    await expect(
      page.getByText("Still waiting. Your trail is safe."),
    ).toBeVisible();
    await shot(page, "still-waiting", width);
    await page
      .getByRole("button", { name: "Stop", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText("Stopped. Your trail is safe.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Still waiting. Your trail is safe."),
    ).toHaveCount(0);
    release();
    await shot(page, "stopped", width);
    await page.unroute("**/api/agent");
    await page.unroute(/\/api\/runs\/test-held(?:\?.*)?$/);
    await page.route("**/api/agent", async (route) => {
      const input = route.request().postDataJSON();
      if (input.intent === "saveResult") {
        await route.fulfill({ json: original });
        return;
      }
      await route.fulfill({
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "test-preview",
        },
        body: `data: ${JSON.stringify({ type: "data-run", data: { event: { runId: "test-preview", sequence: 1, message: "These doors aren't saved yet." }, preview: original.current } })}\n\n`,
      });
    });
    await page.route(/\/api\/runs\/test-preview(?:\?.*)?$/, (route) =>
      route.fulfill({
        json: {
          trail: original,
          state: "failed",
          events: [],
          error: "unsaved",
          guide: "Deterministic local guide",
          attempts: 0,
          modelSteps: 0,
          elapsedMs: 5,
        },
      }),
    );
    await openControls(page, "direction");
    await page
      .getByRole("button", { name: "Refresh doors", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Unsaved preview", exact: true }),
    ).toBeVisible();
    await shot(page, "unsaved-preview", width);
    await page
      .getByRole("region", { name: "Unsaved preview", exact: true })
      .getByRole("button", { name: "Try saving again", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Unsaved preview", exact: true }),
    ).toHaveCount(0);
    for (const smallWidth of [320, 720]) {
      await page.setViewportSize({ width: smallWidth, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
}

test("keyboard path, reduced motion, real stale version conflict and deletion", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page
      .getByRole("button", { name: "Find it", exact: true })
      .filter({ visible: true }),
  ).toBeEnabled();
  // First tab reveals the skip control, then native sequential keyboard navigation reaches search.
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("link", { name: "Skip to content", exact: true })
      .filter({ visible: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByLabel("Your starting point", { exact: true }).focus();
  await page.keyboard.type("After Life");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Type", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("heading", { name: "Which one did you mean?", exact: true })
      .filter({ visible: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Start here", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Start here", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page
      .locator(".path-summary")
      .filter({ hasText: "After Life" })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  expect(
    await page
      .locator(".discovery-doors")
      .filter({ visible: true })
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await openControls(page, "doors");
  const why = page
    .getByRole("button", { name: /^Why this\?(?: |:)/ })
    .filter({ visible: true })
    .first();
  await why.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: /^Why / }).filter({ visible: true }),
  ).toBeFocused();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("[role=dialog]"),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(why).toBeFocused();
  const second = await context.newPage();
  await second.goto(page.url());
  await openControls(second, "history");
  await second
    .getByRole("button", { name: /^I love this(?: |:)/ })
    .filter({ visible: true })
    .click();
  await openControls(page, "doors");
  await page
    .getByRole("button", { name: /^Save for later(?: |:)/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("heading", {
        name: "This trail changed in another tab.",
        exact: true,
      })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open latest version", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: /^Add to trail:/ })
    .filter({ visible: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("heading", { name: "One door further", exact: true })
      .filter({ visible: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Finish my trail", exact: true })
    .filter({ visible: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("heading", { name: "Here's where you went", exact: true })
      .filter({ visible: true }),
  ).toBeFocused();
  await openControls(page, "tools");
  await page
    .getByRole("button", { name: "Edit trail", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", {
      name: "Try another way from After Life",
      exact: true,
    })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Try another way", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator(".trail > li")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Undo", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "Here's where you went", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.locator(".story-trail > li")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Privacy", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Delete my trail", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Delete trail", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText("Your trail was deleted.", { exact: true }),
  ).toBeVisible();
  await second.reload();
  await expect(
    second
      .getByRole("heading", {
        name: "This trail belongs to another session.",
        exact: true,
      })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(second.locator(".story-trail > li")).toHaveCount(0);
  await second.close();
});
