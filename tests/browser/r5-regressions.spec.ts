import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { openControls } from "./controls";
const button = (page: Page, name: string) =>
  page
    .getByRole("button", {
      name:
        name === "Continue"
          ? /^Find the next doors/
          : name === "Go somewhere else"
            ? /^Find (?:the next doors|.* from here)/
            : [
                  "Continue",
                  "Add to trail",
                  "Why this?",
                  "Save for later",
                  "Saved",
                  "I love this",
                  "I know this",
                  "Not for me",
                ].includes(name)
              ? new RegExp(
                  `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |:)`,
                )
              : name,
      exact: true,
    })
    .filter({ visible: true });
async function sample(page: Page) {
  await page.goto("/");
  await button(page, "In the Mood for Love").click();
  await expect(page).toHaveURL(/\/t\//);
  await expect(button(page, "Add to trail")).toHaveCount(3);
}

test("an ended stream keeps polling the accepted run until doors commit without generation replay", async ({
  page,
}) => {
  test.skip(!!process.env.RABBIT_LIVE_E2E, "Fixture recovery protocol");
  await sample(page);
  await button(page, "Add to trail").first().click();
  let starts = 0,
    reads = 0;
  await page.route("**/api/agent", async (route) => {
    starts++;
    const response = await route.fetch();
    await route.fulfill({ response, body: "" });
  });
  await page.route("**/api/runs/*", async (route) => {
    const response = await route.fetch();
    const result = await response.json();
    reads++;
    if (reads === 1) {
      const version = Number(
        new URL(route.request().url()).searchParams.get("version"),
      );
      await route.fulfill({
        response,
        json: {
          ...result,
          state: "running",
          events: result.events.slice(0, 1),
          trail: {
            ...result.trail,
            version,
            activeRun: result.id,
            current: undefined,
            generations: [],
          },
        },
      });
    } else await route.fulfill({ response });
  });
  await button(page, "Continue").click();
  await expect(button(page, "Add to trail")).toHaveCount(3);
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(starts).toBe(1);
  await expect(page.locator('[data-testid^="error-"]')).toHaveCount(0);
});

test("syncing an offline example generation does not block the next Continue", async ({
  page,
  context,
}) => {
  test.skip(!!process.env.RABBIT_LIVE_E2E, "Fixture-only offline path");
  await sample(page);
  await context.setOffline(true);
  await button(page, "Add to trail").first().click();
  await button(page, "Continue").click();
  await expect(button(page, "Add to trail")).toHaveCount(3);
  await context.setOffline(false);
  await button(page, "Save example online").click();
  await expect(button(page, "Save example online")).toHaveCount(0);
  await button(page, "Add to trail").first().click();
  await button(page, "Continue").click();
  await expect(button(page, "Add to trail")).toHaveCount(3);
});

test("share conflict preserves latest-version recovery and cooldown blocks a new request", async ({
  page,
}) => {
  await sample(page);
  await button(page, "Add to trail").first().click();
  await button(page, "Finish my trail").click();
  let calls = 0;
  await page.route("**/api/trails/*/shares", async (route) => {
    calls++;
    await route.fulfill({
      status: 409,
      json: {
        error: "conflict",
        heading: "This trail changed in another tab.",
        body: "Open the latest version to keep going.",
      },
    });
  });
  await button(page, "Share this trail").click();
  await expect(button(page, "Open latest version")).toBeVisible();
  await expect(button(page, "Try again")).toHaveCount(0);
  await page.unroute("**/api/trails/*/shares");
  await page.reload();
  await page.route("**/api/trails/*/shares", async (route) => {
    calls++;
    await route.fulfill({
      status: 429,
      json: {
        error: "limit",
        heading: "Let's pause for a moment.",
        body: "Try again after the time shown.",
        retryAt: Date.now() + 60_000,
      },
    });
  });
  await button(page, "Share this trail").click();
  await expect(button(page, "Try again")).toBeDisabled();
  await page.keyboard.press("Escape");
  await button(page, "Share this trail").click();
  await expect(button(page, "Create trail link")).toBeDisabled();
  expect(calls).toBe(2);
});

test("saved drawer retries its exact failed action and replacement dialogs return to the page trigger", async ({
  page,
}) => {
  await sample(page);
  await openControls(page, "doors");
  await button(page, "Save for later").first().click();
  await openControls(page, "tools");
  await button(page, "Saved discoveries").click();
  const intents: unknown[] = [];
  await page.route("**/api/trails/*/actions", async (route) => {
    intents.push(route.request().postDataJSON());
    if (intents.length === 1) await route.abort("connectionfailed");
    else await route.continue();
  });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Saved(?: |:)/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your trail is safe");
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(dialog).toContainText("Nothing saved yet.");
  expect(intents[1]).toEqual(intents[0]);
  await page.keyboard.press("Escape");
  await button(page, "Privacy").click();
  await button(page, "Delete my trail").click();
  await button(page, "Keep trail").click();
  await expect(button(page, "Privacy")).toBeFocused();
  await openControls(page, "tools");
  await button(page, "Edit trail").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Change starting point", exact: true })
    .click();
  await expect(
    page.getByLabel("Your starting point", { exact: true }),
  ).toBeFocused();
});

test("visitor fork cooldown and revoked link retain their typed recovery", async ({
  page,
  browser,
}) => {
  await sample(page);
  await button(page, "Add to trail").first().click();
  await button(page, "Finish my trail").click();
  await button(page, "Share this trail").click();
  const link = await page
    .getByLabel("Trail link", { exact: true })
    .inputValue();
  const context = await browser.newContext();
  const visitor = await context.newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole("navigation", { name: "Main" })).toBeVisible();
  await button(visitor, "Make your own trail").click();
  await visitor.route("**/api/forks", (route) =>
    route.fulfill({
      status: 429,
      json: {
        error: "limit",
        heading: "Let's pause for a moment.",
        body: "Try again after the time shown.",
        retryAt: Date.now() + 60_000,
      },
    }),
  );
  await button(visitor, "Make my version").click();
  await expect(button(visitor, "Make my version")).toBeDisabled();
  await expect(visitor.getByRole("dialog")).toContainText(
    "Let's pause for a moment.",
  );
  await visitor.unroute("**/api/forks");
  await visitor.reload();
  await button(visitor, "Make your own trail").click();
  await visitor.route("**/api/forks", (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: "missing",
        heading: "This trail isn't available.",
        body: "The link may have expired or stopped being shared.",
      },
    }),
  );
  await button(visitor, "Make my version").click();
  await expect(
    visitor.getByRole("dialog").getByRole("link", { name: "Start a trail" }),
  ).toBeVisible();
  await expect(button(visitor, "Make my version")).toBeDisabled();
  await context.close();
});

test("explicit example manual search makes no live request and switching back clears fixture identity", async ({
  page,
  context,
}) => {
  test.skip(!process.env.RABBIT_LIVE_E2E, "Requires live page configuration");
  await page.goto("/");
  await expect(button(page, "Find it")).toBeEnabled();
  await context.setOffline(true);
  await button(page, "Open offline example").click();
  await context.setOffline(false);
  let searches = 0;
  await page.route("**/api/search", async (route) => {
    searches++;
    await route.abort();
  });
  await page
    .getByLabel("Your starting point", { exact: true })
    .fill("Spirited Away");
  await button(page, "Find it").click();
  await page.getByRole("radio").first().check();
  await button(page, "Start here").click();
  await expect(page).toHaveURL(/\/t\//);
  await expect(
    page.getByTestId("fixture-mode").filter({ visible: true }),
  ).toBeVisible();
  expect(searches).toBe(0);
  await button(page, "Use live connections").click();
  await expect(
    page.getByTestId("fixture-mode").filter({ visible: true }),
  ).toHaveCount(0);
  await expect(button(page, "Start here")).toHaveCount(0);
  await button(page, "Prince").click();
  await expect(button(page, "Add to trail")).toHaveCount(3);
  await expect(
    page.getByTestId("fixture-mode").filter({ visible: true }),
  ).toHaveCount(0);
});

test("live sample identities remain available after owner reload and Change starting point", async ({
  page,
}) => {
  test.skip(!process.env.RABBIT_LIVE_E2E, "Requires activated live identities");
  await sample(page);
  await page.reload();
  await openControls(page, "tools");
  await button(page, "Edit trail").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Change starting point", exact: true })
    .click();
  await button(page, "Prince").click();
  await expect(button(page, "Add to trail")).toHaveCount(3);
  await expect(
    page.getByText("Live examples need verified identities.", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("fixture-mode").filter({ visible: true }),
  ).toHaveCount(0);
});
