import { test, expect } from "./fixtures";
import { openControls } from "./controls";
import type { Page } from "@playwright/test";
const visible = (page: Page, name: string) =>
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
  await expect(visible(page, "Find it")).toBeEnabled();
  await visible(page, "In the Mood for Love").click();
  await expect(page).toHaveURL(/\/t\//);
  await expect(visible(page, "Add to trail")).toHaveCount(3);
}
test("session bootstrap can be retried without losing typed input", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/session", (route) =>
    ++attempts === 1
      ? route.fulfill({ status: 503, json: {} })
      : route.continue(),
  );
  await page.goto("/");
  await expect(page.getByTestId("error-session")).toBeVisible();
  await page.getByLabel("Your starting point", { exact: true }).fill("Prince");
  await visible(page, "Try again").click();
  await expect(visible(page, "Find it")).toBeEnabled();
  await expect(
    page.getByLabel("Your starting point", { exact: true }),
  ).toHaveValue("Prince");
  expect(attempts).toBe(2);
});
test("an example works locally while bootstrap is unavailable", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/");
  await expect(page.getByTestId("error-session")).toBeVisible();
  await visible(page, "Open an example").click();
  await visible(page, "Prince").click();
  await expect(visible(page, "Add to trail")).toHaveCount(3);
  await visible(page, "Add to trail").first().click();
  await expect(
    page.getByRole("heading", { name: "One door further", exact: true }),
  ).toBeVisible();
  await expect(visible(page, "Save example online")).toBeVisible();
});
for (const kind of ["save", "follow", "lost-follow"] as const) {
  test(`retry preserves the exact ${kind} intent and never starts inference`, async ({
    page,
  }) => {
    await sample(page);
    let generations = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/agent")) generations++;
    });
    const bodies: unknown[] = [];
    await page.route("**/api/trails/*/actions", async (route) => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) {
        if (kind === "lost-follow") await route.fetch();
        await route.abort("connectionfailed");
      } else await route.continue();
    });
    if (kind === "save") {
      await openControls(page, "doors");
      await visible(page, "Save for later").first().click();
    } else await visible(page, "Add to trail").first().click();
    await expect(page.getByTestId("error-network")).toBeVisible();
    await visible(page, "Try again").click();
    await expect(page.getByTestId("error-network")).toHaveCount(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(generations).toBe(0);
    const saved = await (
      await page.request.get(`/api/trails/${page.url().split("/").at(-1)}`)
    ).json();
    expect(saved.counters.runs).toBe(1);
    expect(kind === "save" ? saved.saved.length : saved.steps.length).toBe(1);
    expect(saved.history).toBeUndefined();
  });
}
test("the 45-second deadline includes a request stalled before headers", async ({
  page,
}) => {
  await sample(page);
  await openControls(page, "direction");
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/agent", async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.clock.install();
  await visible(page, "Refresh doors").click();
  await expect(visible(page, "Stop")).toBeVisible();
  await page.clock.fastForward(46_000);
  await expect(page.getByTestId("error-timeout")).toBeVisible();
  await expect(visible(page, "Stop")).toHaveCount(0);
  await expect(visible(page, "Add to trail")).toHaveCount(3);
  release();
});
test("rejecting the entire sample pool focuses a visible destination", async ({
  page,
}) => {
  await sample(page);
  for (let i = 0; i < 12; i++) {
    await openControls(page, "doors");
    await visible(page, "I know this").first().click();
    await expect
      .poll(() =>
        page.locator(".discovery-doors > li").filter({ visible: true }).count(),
      )
      .toBe(Math.min(3, 11 - i));
  }
  await expect(
    page.getByRole("heading", {
      name: "You've tried these doors.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".discovery-panel > h2").filter({ visible: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("list", { name: "Your chosen path" }),
  ).toBeVisible();
});
for (const width of [1440, 390]) {
  test(`identity decision, route focus, chained drawers and comparison return at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/");
    await expect(visible(page, "Find it")).toBeEnabled();
    await page
      .getByLabel("Your starting point", { exact: true })
      .fill("Prince");
    await page.getByLabel("Type", { exact: true }).selectOption("artist");
    await visible(page, "Find it").click();
    const radio = page.getByRole("radio").filter({ visible: true });
    await expect(radio).toHaveCount(1);
    await radio.check();
    await expect(visible(page, "Start here")).toBeInViewport();
    await expect(page.locator(".opening-art")).toBeHidden();
    await visible(page, "Start here").click();
    await expect(page).toHaveURL(/\/t\//);
    await expect(
      page.locator(".discovery-panel > h2").filter({ visible: true }),
    ).toBeFocused();
    await openControls(page, "doors");
    const why = visible(page, "Why this?").first();
    await why.click();
    await page
      .getByText("Qloo evidence & source details", { exact: true })
      .click();
    await visible(page, "Example steps").click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: "Example steps", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(why).toBeFocused();
    await why.click();
    await page
      .getByText("Qloo evidence & source details", { exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Qloo ordering audit", exact: true })
      .click();
    await expect(page).toHaveURL(/\/compare$/);
    await page
      .getByRole("link", { name: "In the Mood for Love → music", exact: true })
      .click();
    await expect(page).toHaveURL(/\/compare\/mood-for-love$/);
    await page
      .getByRole("link", { name: "Back to the trail", exact: true })
      .click();
    await expect(page).toHaveURL(/\/t\//);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Why / })).toBeVisible();
  });
}
test("intermediate widths keep the form and Follow contents within their controls", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [320, 699, 700, 701, 768, 900, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const inputControl = page.getByLabel("Your starting point", {
      exact: true,
    });
    await expect(inputControl).toBeVisible();
    const input = await inputControl.boundingBox();
    expect(input!.width).toBeGreaterThan(150);
  }
  await visible(page, "Prince").click();
  await expect(page).toHaveURL(/\/t\//);
  for (const width of [320, 699, 700, 701, 768, 900, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await visible(page, "Add to trail").evaluateAll((buttons) =>
        buttons.every((el) => el.scrollWidth <= el.clientWidth),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test("visitor bootstrap recovers independently before forking", async ({
  page,
  browser,
}) => {
  await sample(page);
  await visible(page, "Add to trail").first().click();
  await visible(page, "Finish my trail").click();
  await visible(page, "Share this trail").click();
  const href = await page
    .getByRole("link", { name: "Preview as a visitor", exact: true })
    .getAttribute("href");
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "192.0.2.251" },
  });
  const visitor = await context.newPage();
  let attempts = 0;
  await visitor.route("**/api/session", (route) =>
    ++attempts === 1
      ? route.fulfill({ status: 503, json: {} })
      : route.continue(),
  );
  await visitor.goto(href!);
  await expect(visible(visitor, "Try again")).toBeVisible();
  await visible(visitor, "Try again").click();
  await expect(visible(visitor, "Make your own trail")).toBeEnabled();
  await visible(visitor, "Make your own trail").click();
  await visible(visitor, "Make my version").click();
  await expect(visitor).toHaveURL(/\/t\//);
  await context.close();
});
test("a lost share response retries the same snapshot without inference", async ({
  page,
}) => {
  await sample(page);
  await visible(page, "Add to trail").first().click();
  await visible(page, "Finish my trail").click();
  let generations = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/agent")) generations++;
  });
  const bodies: unknown[] = [];
  await page.route("**/api/trails/*/shares", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      await route.fetch();
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await visible(page, "Share this trail").click();
  await expect(page.getByTestId("error-network")).toBeVisible();
  await visible(page, "Try again").click();
  await expect(
    page.getByRole("link", { name: "Preview as a visitor", exact: true }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(generations).toBe(0);
});
for (const intent of ["save online", "follow"] as const)
  test(`offline sync retry retains ${intent} without new generation`, async ({
    page,
    context,
  }) => {
    await sample(page);
    await context.setOffline(true);
    await openControls(page, "doors");
    await visible(page, "Save for later").first().click();
    await expect(
      page.getByText(/This example has changes saved in this browser/),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(visible(page, "Save example online")).toBeVisible();
    let reads = 0,
      generations = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/agent")) generations++;
    });
    await page.route("**/api/trails/*", async (route) => {
      if (route.request().method() === "GET" && ++reads === 1)
        await route.abort("connectionfailed");
      else await route.continue();
    });
    await visible(
      page,
      intent === "follow" ? "Add to trail" : "Save example online",
    )
      .first()
      .click();
    await expect(page.getByTestId("error-network")).toBeVisible();
    await visible(page, "Try again").click();
    await expect(page.getByTestId("error-network")).toHaveCount(0);
    await expect(visible(page, "Save example online")).toHaveCount(0);
    const saved = await (
      await page.request.get(`/api/trails/${page.url().split("/").at(-1)}`)
    ).json();
    expect(saved.saved).toHaveLength(1);
    expect(saved.steps).toHaveLength(intent === "follow" ? 1 : 0);
    expect(generations).toBe(0);
  });
for (const width of [1440, 390]) {
  test(`one- and two-discovery finishes and another start at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await sample(page);
    for (const count of [1, 2]) {
      for (let stop = 0; stop < count; stop++) {
        await visible(page, "Add to trail").first().click();
        if (stop < count - 1) await visible(page, "Continue").click();
      }
      await visible(page, "Finish my trail").click();
      await expect(
        page
          .getByRole("heading", { name: "Here's where you went", exact: true })
          .filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page.locator(".story-trail > li").filter({ visible: true }),
      ).toHaveCount(count + 1);
      if (process.env.RABBIT_SHOTS_DIR)
        await page.screenshot({
          path: `${process.env.RABBIT_SHOTS_DIR}/early-finish-${count}-${width}.png`,
          animations: "disabled",
        });
      if (count === 1) {
        await page
          .getByRole("link", { name: "Rabbit Hole", exact: true })
          .filter({ visible: true })
          .click();
        await expect(visible(page, "Prince")).toBeEnabled();
        await visible(page, "Prince").click();
        await expect(page).toHaveURL(/\/t\//);
        await expect(visible(page, "Add to trail")).toHaveCount(3);
      }
    }
  });
}
