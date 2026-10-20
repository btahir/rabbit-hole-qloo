import { test, expect } from "./fixtures";
import { openControls } from "./controls";
import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

async function shot(page: Page, name: string) {
  if (!process.env.RABBIT_SHOTS_DIR) return;
  await mkdir(process.env.RABBIT_SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: resolve(
      process.env.RABBIT_SHOTS_DIR,
      `${name}-${page.viewportSize()!.width}.png`,
    ),
    animations: "disabled",
  });
}

test("session cooldown preserves typed error, announces once and retries only bootstrap", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/session", async (route) => {
    if (++attempts === 1)
      await route.fulfill({
        status: 429,
        json: {
          error: "limit",
          heading: "Let's pause for a moment.",
          body: "Try again after the time shown.",
          retryAt: Date.now() + 2200,
        },
      });
    else await route.continue();
  });
  await page.goto("/");
  await expect(
    page.locator(".live-status").filter({ visible: true }),
  ).toContainText("Let's pause for a moment.");
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeDisabled();
  await expect(retry).toBeEnabled({ timeout: 5000 });
  await retry.click();
  await expect(page.locator('[data-testid="error-limit"]')).toHaveCount(0);
  await expect(
    page.getByLabel("Your starting point", { exact: true }),
  ).toBeFocused();
  expect(attempts).toBe(2);
});

test("comparison remains readable with denied browser storage and failed vote bootstrap", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage denied");
    };
    Storage.prototype.setItem = () => {
      throw new Error("storage denied");
    };
  });
  let attempts = 0;
  await page.route("**/api/session", async (route) => {
    if (++attempts === 1) await route.abort("connectionfailed");
    else await route.continue();
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/compare/mood-for-love");
  await expect(page.getByRole("status")).toContainText(
    "couldn't prepare voting",
  );
  await page.getByRole("button", { name: "Try voting again" }).click();
  await expect(
    page.getByRole("button", { name: "Both", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Your choice is saved");
  await page.getByRole("button", { name: "Show sources" }).click();
  await expect(
    page.getByRole("heading", { name: "With Qloo affinity", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("retry generation and retry unsave restore keyboard focus", async ({
  page,
}) => {
  test.skip(!!process.env.RABBIT_LIVE_E2E, "Fixture fault injection");
  await page.goto("/");
  await page
    .getByRole("button", { name: "In the Mood for Love", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Add to trail: / }),
  ).toHaveCount(3);
  await openControls(page, "doors");
  await page
    .getByRole("button", { name: /^Save for later / })
    .first()
    .click();
  await openControls(page, "tools");
  await page
    .getByRole("button", { name: "Saved discoveries", exact: true })
    .click();
  let calls = 0;
  await page.route("**/api/trails/*/actions", async (route) => {
    if (++calls === 1) await route.abort("connectionfailed");
    else await route.continue();
  });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Saved / }).click();
  await dialog.getByRole("button", { name: "Try again", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("heading", { name: "Saved discoveries" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^Add to trail: / })
    .first()
    .click();
  let runs = 0;
  await page.route("**/api/agent", async (route) => {
    if (++runs === 1) await route.abort("connectionfailed");
    else await route.continue();
  });
  await page
    .getByRole("button", { name: /^Find the next doors/, exact: true })
    .click();
  await page.getByRole("button", { name: "Try again", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /^Add to trail: / }),
  ).toHaveCount(3);
  await expect(
    page.locator(".discovery-panel > h2").filter({ visible: true }),
  ).toBeFocused();
});

for (const width of [1440, 390])
  test(`live book sample survives unavailable optional ranking at ${width}`, async ({
    page,
  }) => {
    test.skip(
      !process.env.RABBIT_LIVE_E2E,
      "Requires explicitly enabled live cached data",
    );
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "The Left Hand of Darkness", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Add to trail: The Devil and Daniel Johnston",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: /^Find the next doors/, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add to trail: Television", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^Find the next doors/, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /^Add to trail: / }),
    ).toHaveCount(3);
    await shot(page, "live-book-ranking-recovery");
    const trail = await (
      await page.request.get(`/api/trails/${page.url().split("/").at(-1)}`)
    ).json();
    expect(trail.current.personalRankingApplied).toBe(false);
    expect(trail.current.warnings).toContain(
      "These doors use the starting point only. The favourites check didn't finish.",
    );
    expect(trail.loves).toHaveLength(1);
    await page
      .getByRole("button", { name: /^Add to trail: / })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Here's where you went", exact: true }),
    ).toBeVisible();
    await shot(page, "live-book-complete");
  });
