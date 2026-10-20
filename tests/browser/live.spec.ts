import { openControls } from "./controls";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
test.skip(
  !process.env.RABBIT_LIVE_E2E,
  "Explicit live run only; requires the private disk cache.",
);
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
async function capture(page: Page, name: string, width: number) {
  if (!process.env.RABBIT_SHOTS_DIR) return;
  await mkdir(process.env.RABBIT_SHOTS_DIR, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 1500)),
      Promise.all(
        [...document.images]
          .filter((image) => image.getBoundingClientRect().top < innerHeight)
          .map((image) => image.decode().catch(() => {})),
      ),
    ]);
  });
  await page.screenshot({
    path: resolve(process.env.RABBIT_SHOTS_DIR, `live-${name}-${width}.png`),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
for (const width of [1440, 390])
  test(`live judge path, evidence, images, immutable share and fork at ${width}`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(button(page, "In the Mood for Love")).toBeEnabled();
    await capture(page, "home", width);
    const started = performance.now();
    await button(page, "In the Mood for Love").click();
    await expect(page).toHaveURL(/\/t\//);
    await expect(button(page, "Add to trail")).toHaveCount(3);
    await capture(page, "doors", width);
    const tinder = page
      .locator(".discovery-doors > li")
      .filter({ visible: true })
      .filter({
        has: page.getByRole("heading", { name: "Tindersticks", exact: true }),
      });
    await openControls(page, "doors");
    await tinder.getByRole("button", { name: /^Why this\?(?: |:)/ }).click();
    await page
      .getByText("Qloo evidence & source details", { exact: true })
      .click();
    await expect(
      page.getByText("Returned contribution from In the Mood for Love: 1", {
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, "evidence", width);
    await button(page, "Agent steps").click();
    await expect(page.getByText("AI agent", { exact: true })).toBeVisible();
    await capture(page, "agent-steps", width);
    await page.keyboard.press("Escape");
    await tinder.getByRole("button", { name: /^Add to trail:/ }).click();
    await capture(page, "direction", width);
    await page
      .getByLabel("Something less obvious")
      .filter({ visible: true })
      .check();
    await button(page, "Continue").click();
    await expect(button(page, "Add to trail").first()).toBeVisible();
    await capture(page, "books", width);
    // Keep the returned order. Reject/refill is local and uses no additional inference.
    const candidates = page
      .locator(".discovery-doors > li")
      .filter({ visible: true });
    await candidates.first().locator(".door-details > summary").click();
    await button(page, "Not for me").first().click();
    await button(page, "Add to trail").first().click();
    await button(page, "Continue").click();
    await expect(button(page, "Add to trail").first()).toBeVisible();
    await capture(page, "films", width);
    await button(page, "Add to trail").first().click();
    await expect(
      page
        .getByRole("heading", { name: "Here's where you went", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await capture(page, "complete", width);
    const owner = await (
      await page.request.get(`/api/trails/${page.url().split("/").at(-1)}`)
    ).json();
    expect(owner.mode).toBe("live");
    expect(owner.steps).toHaveLength(3);
    expect(owner.counters.runs).toBe(3);
    expect(owner.history).toBeUndefined();
    await button(page, "Share this trail").click();
    await capture(page, "share", width);
    const link = await page
      .getByRole("link", { name: "Preview as a visitor", exact: true })
      .getAttribute("href");
    const context = await browser.newContext({
      viewport: { width, height: width === 1440 ? 900 : 844 },
      extraHTTPHeaders: {
        "x-forwarded-for": width === 1440 ? "192.0.2.231" : "192.0.2.232",
      },
    });
    const visitor = await context.newPage();
    await visitor.goto(link!);
    await capture(visitor, "visitor", width);
    await button(visitor, "Make your own trail").click();
    await button(visitor, "Make my version").click();
    await expect(visitor).toHaveURL(/\/t\//);
    await expect(button(visitor, "Go somewhere else")).toBeVisible();
    await capture(visitor, "fork", width);
    const elapsedMs = Math.round(performance.now() - started);
    expect(elapsedMs).toBeLessThan(60_000);
    expect(errors).toEqual([]);
    if (process.env.RABBIT_SHOTS_DIR)
      await writeFile(
        resolve(process.env.RABBIT_SHOTS_DIR, `live-judge-${width}.json`),
        JSON.stringify(
          {
            elapsedMs,
            steps: owner.steps.map(
              (s: { entity: { name: string } }) => s.entity.name,
            ),
            calls: owner.counters.attempts,
            runCount: owner.counters.runs,
            scope:
              "Local Bun production browser, real Anthropic agent with live or explicitly cached Qloo. Per-run model and provider counts are retained in live-runs.jsonl.",
          },
          null,
          2,
        ),
      );
    await context.close();
  });

for (const width of [1440, 390])
  test(`live manual identity, image failure and saved comparison disclosure at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.route("https://images.qloo.com/**", (route) =>
      route.fulfill({ status: 403, body: "Unavailable" }),
    );
    await page.route("**/_next/image?**", (route) =>
      route.fulfill({ status: 403, body: "Unavailable" }),
    );
    await page.goto("/");
    await expect(
      page
        .locator(
          width === 1440
            ? ".opening-art .art-geometry"
            : ".sample-list .art-geometry",
        )
        .first(),
    ).toBeVisible();
    await capture(page, "image-fallback", width);
    await page
      .getByLabel("Your starting point", { exact: true })
      .fill("Prince");
    await page.getByLabel("Type", { exact: true }).selectOption("artist");
    await button(page, "Find it").click();
    await expect(
      page.getByRole("heading", {
        name: "Which one did you mean?",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("radio").first().check();
    await capture(page, "search", width);
    await button(page, "Start here").click();
    await expect(page).toHaveURL(/\/t\//);
    await expect(
      page.locator(".discovery-panel > h2").filter({ visible: true }),
    ).toBeFocused();
    await expect(button(page, "Add to trail")).toHaveCount(3);
    await page.goto("/compare/mood-for-love");
    await expect(
      page.getByText(
        /This ordering audit compares Qloo order with authored catalog order/,
      ),
    ).toBeVisible();
    await capture(page, "comparison", width);
    await button(page, "Both").click();
    await button(page, "Show sources").click();
    await expect(
      page.getByRole("heading", { name: "With Qloo affinity", exact: true }),
    ).toBeVisible();
    await capture(page, "comparison-sources", width);
  });

for (const width of [1440, 390])
  test(`live own-input discovery from Moonlight at ${width}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/");
    await page
      .getByLabel("Your starting point", { exact: true })
      .fill("Moonlight");
    await button(page, "Find it").click();
    const identity = page
      .locator("fieldset label")
      .filter({ hasText: "2016" })
      .first();
    await expect(identity).toBeVisible();
    await capture(page, "own-input-identity", width);
    await identity.getByRole("radio").check();
    await button(page, "Start here").click();
    await expect(button(page, "Add to trail")).toHaveCount(3);
    await capture(page, "own-input-doors", width);
    const trail = await (
      await page.request.get(`/api/trails/${page.url().split("/").at(-1)}`)
    ).json();
    expect(trail.root.name).toBe("Moonlight");
    expect(trail.current.discovery.source).toBe("qloo");
    const run = await (
      await page.request.get(`/api/runs/${trail.current.runId}`)
    ).json();
    expect(run.modelSteps).toBeGreaterThan(0);
    expect(run.telemetry.model).toBe("claude-haiku-5-5");
  });
