import type { Page, Route } from "@playwright/test";
import { test, expect } from "./fixtures";

// A cold visitor clicks before the session request returns, often before
// hydration. That first click must start the action and show progress at once.
// Each button must be clickable within a second while the session is held back.
const delay = (ms: number) => async (route: Route) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await route.continue().catch(() => {});
};
const visible = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: true }).filter({ visible: true });
const doors = (page: Page) =>
  page.getByRole("button", { name: /^Add to trail: / });
function count(page: Page, path: string) {
  const seen = { n: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(path)) seen.n++;
  });
  return seen;
}
const progress = (page: Page) =>
  page.locator('[aria-busy="true"], html[data-early-pending]').first();

for (const width of [1440, 390])
  test(`the first opening click works before hydration and the session at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    // Hold back the chunk with the start buttons' code, so the click lands
    // on server-rendered HTML before React hydrates it.
    await page.route("**/_next/static/chunks/**", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes("Enter the rabbit hole"))
        await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ response, body }).catch(() => {});
    });
    await page.route("**/api/session", delay(3000));
    const trails = count(page, "/api/trails");
    await page.goto("/", { waitUntil: "commit" });
    // Desktop's hero button; on phones the first sample is the opening action.
    const enter = visible(
      page,
      width === 1440 ? "Enter the rabbit hole" : "In the Mood for Love",
    );
    await expect(enter).toBeEnabled({ timeout: 1000 });
    const hydrated = await page.evaluate(() => !!window.__rhLive);
    await enter.click();
    await expect(progress(page)).toBeAttached({ timeout: 1000 });
    await expect(page).toHaveURL(/\/t\//, { timeout: 15_000 });
    await expect(doors(page)).toHaveCount(3);
    expect(hydrated).toBe(false);
    expect(trails.n).toBe(1);
  });

test("a sample starter clicked during session bootstrap starts once", async ({
  page,
}) => {
  await page.route("**/api/session", delay(2500));
  const trails = count(page, "/api/trails");
  await page.goto("/", { waitUntil: "commit" });
  const prince = visible(page, "Prince");
  await expect(prince).toBeEnabled({ timeout: 1000 });
  await prince.click();
  await expect(progress(page)).toBeAttached({ timeout: 1000 });
  await prince.click({ timeout: 500 }).catch(() => {});
  await expect(page).toHaveURL(/\/t\//, { timeout: 15_000 });
  await expect(doors(page)).toHaveCount(3);
  expect(trails.n).toBe(1);
});

test("Find it submitted during session bootstrap searches instead of reloading", async ({
  page,
}) => {
  await page.route("**/api/session", delay(2500));
  await page.goto("/");
  await page.getByLabel("Your starting point", { exact: true }).fill("Prince");
  await page.getByLabel("Type", { exact: true }).selectOption("artist");
  await expect(visible(page, "Find it")).toBeEnabled({ timeout: 1000 });
  await visible(page, "Find it").click();
  await expect(
    page.getByRole("heading", { name: "Which one did you mean?" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole("radio").first().check();
  await visible(page, "Start here").click();
  await expect(page).toHaveURL(/\/t\//, { timeout: 15_000 });
});

test("a share link's first fork click works while its session loads", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await visible(page, "In the Mood for Love").click();
  await expect(page).toHaveURL(/\/t\//);
  await doors(page).first().click();
  await visible(page, "Finish my trail").click();
  await visible(page, "Share this trail").click();
  const link = page.getByLabel("Trail link", { exact: true });
  await expect(link).toBeVisible();
  const shareUrl = await link.inputValue();
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "192.0.2.252" },
  });
  const visitor = await context.newPage();
  await visitor.route("**/api/session", delay(3000));
  await visitor.goto(new URL(shareUrl).pathname, { waitUntil: "commit" });
  const make = visible(visitor, "Make your own trail");
  await expect(make).toBeEnabled({ timeout: 1000 });
  await make.click();
  await expect(
    visitor.getByRole("heading", { name: "Where would you like to start?" }),
  ).toBeVisible({ timeout: 5000 });
  await visible(visitor, "Make my version").click();
  await expect(visitor).toHaveURL(/\/t\//, { timeout: 15_000 });
  await context.close();
});
