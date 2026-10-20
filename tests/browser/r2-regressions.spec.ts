import { test, expect } from "./fixtures";
import { openControls } from "./controls";
import type { Page } from "@playwright/test";
async function home(page: Page) {
  await page.goto("/");
  await expect(
    page
      .getByRole("button", { name: "Find it", exact: true })
      .filter({ visible: true }),
  ).toBeEnabled();
}
async function sample(page: Page) {
  await home(page);
  await page
    .getByRole("button", { name: "In the Mood for Love", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  await expect(page).toHaveURL(/\/t\//);
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release: () => release() };
}
test("one creation under a double click and correct brand navigation/continuation", async ({
  page,
}) => {
  await home(page);
  await expect(
    page
      .getByRole("button", { name: "In the Mood for Love", exact: true })
      .filter({ visible: true }),
  ).toBeEnabled();
  const held = gate();
  let requests = 0;
  await page.route("**/api/trails", async (route) => {
    requests++;
    await held.promise;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "In the Mood for Love", exact: true })
    .filter({ visible: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(
    page
      .getByRole("button", { name: "Prince", exact: true })
      .filter({ visible: true }),
  ).toBeDisabled();
  expect(requests).toBe(1);
  held.release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  await expect(page).toHaveURL(/\/t\//);
  await page
    .getByRole("link", { name: "Rabbit Hole", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "What do you love?", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { name: "Continue your trail", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Continue", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
});
test("Stop works before headers and late acceptance cannot populate doors", async ({
  page,
}) => {
  await home(page);
  const held = gate();
  let pending = false;
  await page.route("**/api/agent", async (route) => {
    pending = true;
    await held.promise;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: "Prince", exact: true })
    .filter({ visible: true })
    .click();
  const stop = page
    .getByRole("button", { name: "Stop", exact: true })
    .filter({ visible: true });
  await expect(stop).toBeEnabled();
  expect(pending).toBe(true);
  await stop.click();
  await expect(
    page
      .getByText("Stopped. Your trail is safe.", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  held.release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/agent");
  await page
    .getByRole("button", {
      name: /^Find (?:the next doors|.* from here)/,
      exact: true,
    })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
});
test("saving is a guarded mutation with no stale generation Stop", async ({
  page,
}) => {
  await sample(page);
  await openControls(page, "doors");
  const held = gate();
  let calls = 0;
  await page.route("**/actions", async (route) => {
    calls++;
    await held.promise;
    await route.continue();
  });
  const save = page
    .getByRole("button", { name: /^Save for later(?: |:)/ })
    .filter({ visible: true })
    .first();
  await save.click();
  await expect(
    page.getByText("Saving your choice…", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Stop", exact: true })
      .filter({ visible: true }),
  ).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(calls).toBe(1);
  held.release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page
      .getByRole("button", { name: /^Saved(?: |:)/ })
      .filter({ visible: true }),
  ).toHaveCount(1);
});
test("search cooldown blocks click and Enter and editing type discards a held search", async ({
  page,
}) => {
  await home(page);
  await page.clock.install();
  let calls = 0;
  await page.route("**/api/search", async (route) => {
    calls++;
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "60" },
      json: {
        error: "limit",
        heading: "Let's pause for a moment.",
        body: "Try again later.",
        retryAt: await page.evaluate(() => Date.now() + 60000),
      },
    });
  });
  const input = page.getByLabel("Your starting point", { exact: true });
  await input.fill("After Life");
  await page
    .getByRole("button", { name: "Find it", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: "Find it", exact: true })
      .filter({ visible: true }),
  ).toBeDisabled();
  await input.press("Enter");
  expect(calls).toBe(1);
  await page.clock.fastForward(61000);
  await expect(
    page
      .getByRole("button", { name: "Find it", exact: true })
      .filter({ visible: true }),
  ).toBeEnabled();
  await page.unroute("**/api/search");
  const held = gate();
  await page.route("**/api/search", async (route) => {
    try {
      const response = await route.fetch();
      await held.promise;
      await route.fulfill({ response });
    } catch {
      /* Search cancellation may abort the upstream request. */
    }
  });
  await page
    .getByRole("button", { name: "Find it", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText("Looking for ‘After Life’…", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Type", { exact: true }).selectOption("book");
  held.release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page
      .getByRole("heading", { name: "Which one did you mean?", exact: true })
      .filter({ visible: true }),
  ).toHaveCount(0);
});
test("keyboard search completion and door removal preserve explicit focus", async ({
  page,
}) => {
  await home(page);
  const input = page.getByLabel("Your starting point", { exact: true });
  await input.fill("x");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  await input.fill("After Life");
  await input.press("Enter");
  await expect(
    page
      .getByRole("heading", { name: "Which one did you mean?", exact: true })
      .filter({ visible: true }),
  ).toBeFocused();
  await page.getByRole("radio").check();
  await page
    .getByRole("button", { name: "Start here", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/t\//);
  await openControls(page, "doors");
  await page
    .getByRole("button", { name: /^I know this(?: |:)/ })
    .filter({ visible: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true })
      .first(),
  ).toBeFocused();
});
test("partially persisted offline queue resumes its suffix after reload", async ({
  page,
  context,
}) => {
  await sample(page);
  await context.setOffline(true);
  await openControls(page, "doors");
  await page
    .getByRole("button", { name: /^Save for later(?: |:)/ })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /^Save for later(?: |:)/ })
    .filter({ visible: true })
    .first()
    .click();
  await context.setOffline(false);
  let actions = 0;
  await page.route("**/actions", async (route) => {
    actions++;
    if (actions === 2)
      await route.fulfill({
        status: 503,
        json: {
          error: "storage",
          heading: "We can't save right now.",
          body: "Try again.",
        },
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Save example online", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByTestId("error-storage")).toBeVisible();
  await page.unroute("**/actions");
  await page.reload();
  await page
    .getByRole("button", { name: "Save example online", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: "Save example online", exact: true })
      .filter({ visible: true }),
  ).toHaveCount(0);
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
  ).toHaveCount(2);
});
test("first online action after a locally created example uses its synchronized identity", async ({
  page,
  context,
}) => {
  await home(page);
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Prince", exact: true })
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
  await context.setOffline(false);
  await openControls(page, "history");
  await page
    .getByRole("button", { name: /^Save for later(?: |:)/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("button", { name: /^Saved(?: |:)/ })
      .filter({ visible: true }),
  ).toHaveCount(1);
  await expect(page).toHaveURL(/\/t\/(?!local-)/);
  await expect(page.getByTestId("error-owner")).toHaveCount(0);
});
test("compact decisions, usable touch targets and persistent drawer dismissal", async ({
  browser,
}) => {
  for (const width of [1440, 390, 320, 720]) {
    const auditContext = await browser.newContext({
      extraHTTPHeaders: {
        "x-forwarded-for": `192.0.2.${Math.floor(width / 10) % 250}`,
      },
    });
    const page = await auditContext.newPage();
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await sample(page);
    const follows = await page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true })
      .evaluateAll((elements) =>
        elements.map((el) => ({
          top: el.getBoundingClientRect().top,
          bottom: el.getBoundingClientRect().bottom,
        })),
      );
    if (width === 1440)
      expect(follows.every((rect) => rect.bottom <= 900)).toBe(true);
    if (width === 390) expect(follows[0].bottom).toBeLessThan(844);
    if (process.env.RABBIT_SHOTS_DIR)
      await page.screenshot({
        path: `${process.env.RABBIT_SHOTS_DIR}/compact-${width}.png`,
        animations: "disabled",
      });
    const titles = await page
      .locator(".discovery-doors h3")
      .filter({ visible: true })
      .evaluateAll((elements) =>
        elements.map((el) => ({
          name: el.textContent,
          top: el.getBoundingClientRect().top,
        })),
      );
    // Readable full introductions may extend below a phone viewport.
    expect(titles.length).toBe(3);
    expect(titles[0].top).toBeLessThan(844);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const bad = await page.locator("button,a,summary").evaluateAll((elements) =>
      elements
        .filter(
          (el) =>
            el.getClientRects().length &&
            !el.closest("details:not([open]) > :not(summary)"),
        )
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 43.5 || r.height < 43.5;
        })
        .map((el) => el.textContent),
    );
    expect(bad).toEqual([]);
    await openControls(page, "doors");
    await page
      .getByRole("button", { name: /^Why this\?(?: |:)/ })
      .filter({ visible: true })
      .first()
      .click();
    const close = page
      .getByRole("button", { name: "Close", exact: true })
      .filter({ visible: true });
    await expect(close).toBeVisible();
    expect((await close.boundingBox())!.y).toBeLessThan(100);
    await page
      .getByRole("dialog")
      .locator(".dialog-body")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(close).toBeInViewport();
    await close.click();
    await auditContext.close();
  }
});
test("hashed scripts and versioned fonts cache while owner documents remain private", async ({
  page,
}) => {
  await home(page);
  const script = await page
    .locator('script[src*="/_next/static/"]')
    .first()
    .getAttribute("src");
  const response = await page.request.get(script!);
  expect(response.headers()["cache-control"]).toContain("immutable");
  const font = await page.request.get("/fonts/anton-v1.woff2");
  expect(font.headers()["cache-control"]).toContain("immutable");
  await page
    .getByRole("button", { name: "Prince", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  expect(
    (await page.request.get(page.url())).headers()["cache-control"],
  ).toContain("no-store");
});

test("offline and server versions can coincide without reusing local generation IDs", async ({
  page,
  context,
}) => {
  await home(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Prince", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Add to trail:/ }),
  ).toHaveCount(3);
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Save example online", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save example online", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Add to trail:/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "One door further", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("error-conflict")).toHaveCount(0);
});
