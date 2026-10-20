import { openControls } from "./controls";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { errorCopy } from "../../src/lib/core/errors";

async function capture(page: Page, name: string) {
  const directory = process.env.RABBIT_SHOTS_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const dialog = document.querySelector(".dialog-popup");
    if (dialog) dialog.scrollTop = 0;
    return document.fonts.ready;
  });
  if (name.startsWith("03-search-empty"))
    await page
      .getByRole("heading", {
        name: "We couldn't find that starting point.",
        exact: true,
      })
      .filter({ visible: true })
      .scrollIntoViewIfNeeded();
  if (name.startsWith("04-identity"))
    await page
      .getByRole("heading", { name: "Which one did you mean?", exact: true })
      .filter({ visible: true })
      .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
  if (
    /^(06-doors|10-complete|12-visitor|15-comparison-index|16-comparison-blind|17-comparison-sources|20-returning)/.test(
      name,
    )
  )
    await page.screenshot({
      path: resolve(directory, `${name}-full.png`),
      fullPage: true,
      animations: "disabled",
    });
}
async function noOverflow(page: Page) {
  const smallTargets = await page
    .locator("button")
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.getClientRects().length &&
            element.getBoundingClientRect().height < 43.5,
        )
        .map((element) => element.textContent),
    );
  expect(smallTargets).toEqual([]);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth
      ? []
      : [...document.querySelectorAll("main *")]
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            right: el.getBoundingClientRect().right,
            text: el.textContent?.slice(0, 60),
          })),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    JSON.stringify(overflow),
  ).toBe(true);
}
for (const width of [1440, 390]) {
  test(`complete design and recovery states at ${width}`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const shot = (name: string) => capture(page, `${name}-${width}`);
    await page.goto("/");
    await expect(
      page
        .getByRole("button", { name: "Find it", exact: true })
        .filter({ visible: true }),
    ).toBeEnabled();
    await shot("01-start");
    await page
      .getByRole("button", { name: "Find it", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText("Enter at least two characters."),
    ).toBeVisible();
    await shot("02-validation");
    await page
      .getByLabel("Your starting point", { exact: true })
      .fill("Not a catalog title");
    await page
      .getByRole("button", { name: "Find it", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole("heading", {
          name: "We couldn't find that starting point.",
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot("03-search-empty");
    await page
      .getByRole("button", { name: "Search again", exact: true })
      .filter({ visible: true })
      .click();
    await page
      .getByLabel("Your starting point", { exact: true })
      .fill("Prince");
    await page.getByLabel("Type", { exact: true }).selectOption("artist");
    await page
      .getByRole("button", { name: "Find it", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole("button", { name: "Start here", exact: true })
        .filter({ visible: true }),
    ).toBeDisabled();
    await shot("04-identity");
    await page.getByRole("radio").check();
    await page
      .getByRole("button", { name: "Start here", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/t\//);
    await expect(
      page
        .locator(".path-summary")
        .filter({ hasText: "Prince" })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot("05-confirmed-doors");
    // Empty owner drawers must stay read-only and usable before a run.
    for (const [button, name] of [
      ["Saved discoveries", "saved-empty"],
      ["Excluded from this trail", "excluded-empty"],
      ["Other doors", "other-empty"],
      ["How it works", "how"],
      ["Sources", "sources"],
      ["Privacy", "privacy"],
    ]) {
      await openControls(page, "tools");
      const trigger = page
        .getByRole("button", { name: button, exact: true })
        .filter({ visible: true });
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(name);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await expect(
      page
        .getByRole("button", { name: /^Add to trail:/ })
        .filter({ visible: true }),
    ).toHaveCount(3);
    await shot("06-doors");
    await noOverflow(page);
    await openControls(page, "doors");
    await page
      .getByRole("button", { name: /^Why this\?(?: |:)/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page.locator(".connection-caption").filter({ visible: true }),
    ).toBeVisible();
    await shot("07-evidence");
    await page
      .getByText("Qloo evidence & source details", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Example steps", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByText(
          "These steps illustrate the flow. No agent or Qloo request ran.",
        )
        .first(),
    ).toBeVisible();
    await shot("08-steps");
    await page.keyboard.press("Escape");
    // All typed failures preserve the real existing path and doors. Test-only transport injection.
    for (const code of [
      "qloo",
      "configuration",
      "contract",
      "model",
      "timeout",
      "limit",
      "paused",
      "storage",
      "unsaved",
      "conflict",
      "owner",
    ] as const) {
      await page.route("**/api/agent", (route) =>
        route.fulfill({
          status: code === "limit" ? 429 : 503,
          json: {
            error: code,
            heading: errorCopy[code][0],
            body: errorCopy[code][1],
            ...(code === "limit" ? { retryAt: Date.now() + 60000 } : {}),
          },
        }),
      );
      await openControls(page, "direction");
      const refresh = page
        .getByRole("button", {
          name: "Refresh doors",
          exact: true,
        })
        .filter({ visible: true });
      // Only this transport response is injected; the stable path is server-owned.
      await refresh.click();
      await expect(page.getByTestId(`error-${code}`)).toBeVisible();
      await expect(
        page
          .getByRole("button", { name: /^Add to trail:/ })
          .filter({ visible: true }),
      ).toHaveCount(3);
      await shot(`error-${code}`);
      await page.unroute("**/api/agent");
      if (["limit", "paused"].includes(code))
        await page
          .getByRole("button", { name: "Keep my trail", exact: true })
          .filter({ visible: true })
          .click();
    }
    await page.reload();
    await openControls(page, "doors");
    await page
      .getByRole("button", { name: /^Save for later(?: |:)/ })
      .filter({ visible: true })
      .last()
      .click();
    await openControls(page, "tools");
    await page
      .getByRole("button", { name: "Saved discoveries", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: /^Saved(?: |:)/ })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot("saved-populated");
    await page.keyboard.press("Escape");
    await openControls(page, "doors");
    await page
      .getByRole("button", { name: /^I know this(?: |:)/ })
      .filter({ visible: true })
      .first()
      .click();
    await openControls(page, "tools");
    await page
      .getByRole("button", { name: "Excluded from this trail", exact: true })
      .filter({ visible: true })
      .click();
    await shot("excluded-populated");
    await page
      .getByRole("button", { name: "Remove exclusion", exact: true })
      .filter({ visible: true })
      .click();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page
        .getByRole("heading", { name: "One door further", exact: true })
        .filter({ visible: true }),
    ).toBeFocused();
    await shot("09-direction");
    await page
      .getByRole("button", { name: /^Find the next doors/, exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole("button", { name: /^Add to trail:/ })
        .filter({ visible: true }),
    ).toHaveCount(3);
    await openControls(page, "doors");
    await page
      .getByRole("button", { name: /^Not for me(?: |:)/ })
      .filter({ visible: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Find the next doors/, exact: true })
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
      .click();
    await expect(
      page
        .getByRole("heading", { name: "Here's where you went", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    const overlappingIntroductions = await page
      .locator(".complete-workspace .story-trail > li")
      .filter({ visible: true })
      .evaluateAll(
        (items) =>
          items.filter((item) => {
            const title = item.querySelector(":scope > .entity");
            const introduction = item.querySelector(
              ":scope > .story-connection",
            );
            return (
              title &&
              introduction &&
              introduction.getBoundingClientRect().height > 0 &&
              introduction.getBoundingClientRect().top <
                title.getBoundingClientRect().bottom &&
              introduction.getBoundingClientRect().bottom >
                title.getBoundingClientRect().top
            );
          }).length,
      );
    expect(overlappingIntroductions).toBe(0);
    await shot("10-complete");
    await noOverflow(page);
    await openControls(page, "tools");
    await page
      .getByRole("button", { name: "Other doors", exact: true })
      .filter({ visible: true })
      .click();
    await shot("other-populated");
    await page.keyboard.press("Escape");
    await openControls(page, "tools");
    await page
      .getByRole("button", { name: "Edit trail", exact: true })
      .filter({ visible: true })
      .click();
    await shot("edit");
    await page
      .getByRole("button", { name: "Go back here", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await shot("branch-confirmation");
    await page
      .getByRole("button", { name: "Keep this trail", exact: true })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("button", { name: "Share this trail", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByLabel("Trail link", { exact: true })).toHaveValue(
      /\/s\//,
    );
    const shareUrl = await page
      .getByLabel("Trail link", { exact: true })
      .inputValue();
    await shot("11-share");
    const friendContext = await browser.newContext({
      viewport: { width, height: width === 1440 ? 900 : 844 },
    });
    const friend = await friendContext.newPage();
    await friend.goto(shareUrl);
    await expect(
      friend
        .getByRole("heading", {
          name: "Look where this led.",
          exact: true,
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await capture(friend, `12-visitor-${width}`);
    await friend
      .getByRole("button", { name: "Make your own trail", exact: true })
      .filter({ visible: true })
      .click();
    await expect(friend.getByRole("dialog")).toBeVisible();
    await capture(friend, `13-fork-selector-${width}`);
    await friend
      .getByRole("button", { name: "Make my version", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      friend.getByText(
        "Your version starts here. Choose a direction to find new doors.",
        { exact: true },
      ),
    ).toBeVisible();
    await capture(friend, `14-fork-draft-${width}`);
    await openControls(friend, "history");
    await expect(
      friend
        .getByRole("button", { name: /^I love this(?: |:)/ })
        .filter({ visible: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await friendContext.close();
    await page
      .getByRole("button", { name: "Stop sharing", exact: true })
      .filter({ visible: true })
      .click();
    await shot("revoke-confirmation");
    await page.route("**/api/shares/*", (route) =>
      route.fulfill({ status: 503, json: { error: "storage" } }),
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Stop sharing", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "We couldn't stop sharing this link.",
    );
    await shot("revoke-failure");
    await page.unroute("**/api/shares/*");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Stop sharing", exact: true })
      .filter({ visible: true })
      .click();
    const ownerUrl = page.url();
    await page
      .getByRole("button", { name: "Privacy", exact: true })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("button", { name: "Delete my trail", exact: true })
      .filter({ visible: true })
      .click();
    await shot("delete-confirmation");
    await page.route("**/api/trails/*", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 503, json: { error: "storage" } })
        : route.continue(),
    );
    await page
      .getByRole("button", { name: "Delete trail", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "We couldn't delete this trail. Please try again.",
    );
    await shot("delete-failure");
    await page.unroute("**/api/trails/*");
    await page
      .getByRole("button", { name: "Keep trail", exact: true })
      .filter({ visible: true })
      .click();
    await page.goto("/compare");
    await expect(
      page
        .getByRole("heading", { name: "Five saved comparisons" })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot("15-comparison-index");
    await page.locator("ol a").first().click();
    await expect(
      page
        .getByRole("heading", { name: "Version A", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot("16-comparison-blind");
    await page
      .getByRole("button", { name: "Neither", exact: true })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("button", { name: "Show sources", exact: true })
      .filter({ visible: true })
      .click();
    await shot("17-comparison-sources");
    await noOverflow(page);
    await page.goto("/privacy");
    await shot("18-retention");
    await page.goto(shareUrl);
    await expect(
      page
        .getByRole("heading", {
          name: "This trail isn't available.",
          exact: true,
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot("19-unavailable");
    await page.goto(ownerUrl);
    await page
      .getByRole("link", { name: "Rabbit Hole", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole("heading", { name: "Continue your trail", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await shot("20-returning");
  });
}
