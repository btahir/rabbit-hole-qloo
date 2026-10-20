import { openControls } from "./controls";
import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
async function sample(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(
    page
      .getByRole("heading", { name: "What do you love?" })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "In the Mood for Love", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/t\//);
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  await openControls(page, "doors");
}
test("three discoveries, rejection/refill, save, evidence, immutable share and independent fork", async ({
  page,
  browser,
}) => {
  const started = performance.now();
  await sample(page);
  await page
    .getByRole("button", { name: /^Why this\?(?: |:)/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator(".connection-caption")).toBeVisible();
  await expect(
    page.getByText("Illustrative connection.", { exact: false }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await openControls(page, "doors");
  await page
    .getByRole("button", { name: /^Save for later(?: |:)/ })
    .filter({ visible: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: /^Add to trail:/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("heading", { name: "One door further" })
      .filter({ visible: true }),
  ).toBeVisible();
  await openControls(page, "direction");
  await page
    .getByRole("checkbox", { name: "Something less obvious" })
    .filter({ visible: true })
    .check();
  await page
    .getByRole("button", { name: /^Find the next doors/, exact: true })
    .filter({ visible: true })
    .click();
  await openControls(page, "doors");
  await expect(
    page
      .getByRole("button", { name: /^Not for me(?: |:)/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  const rejected = await page
    .locator(".doors > li")
    .first()
    .getByRole("heading")
    .textContent();
  await openControls(page, "doors");
  await page
    .getByRole("button", { name: /^Not for me(?: |:)/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  await expect(
    page
      .locator(".doors")
      .getByRole("heading", { name: rejected!, exact: true })
      .filter({ visible: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Add to trail:/ })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /^Find the next doors/, exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: /^Add to trail:/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("heading", { name: "Here's where you went" })
      .filter({ visible: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("heading", { name: "Here's where you went" })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Share this trail", exact: true })
    .filter({ visible: true })
    .click();
  const shareUrl = await page
    .getByLabel("Trail link", { exact: true })
    .inputValue();
  const visitor = await browser.newContext(),
    friend = await visitor.newPage();
  await friend.goto(shareUrl);
  await expect(
    friend
      .getByRole("heading", { name: "Look where this led." })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    friend
      .getByRole("button", { name: "Saved discoveries", exact: true })
      .filter({ visible: true }),
  ).toHaveCount(0);
  await friend
    .getByRole("button", { name: "Make your own trail" })
    .filter({ visible: true })
    .click();
  await friend
    .getByRole("button", { name: "Make my version" })
    .filter({ visible: true })
    .click();
  await expect(
    friend.getByText(
      "Your version starts here. Choose a direction to find new doors.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    friend
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(0);
  await friend
    .getByRole("button", {
      name: /^Find (?:the next doors|.* from here)/,
      exact: true,
    })
    .filter({ visible: true })
    .click();
  await expect(
    friend
      .getByRole("button", { name: /^Add to trail:/ })
      .filter({ visible: true }),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Stop sharing", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Stop sharing", exact: true })
    .filter({ visible: true })
    .click();
  await friend.goto(shareUrl);
  await expect(
    friend
      .getByRole("heading", { name: "This trail isn't available." })
      .filter({ visible: true }),
  ).toBeVisible();
  await visitor.close();
  const elapsedMs = Math.round(performance.now() - started);
  expect(elapsedMs).toBeLessThan(60_000);
  if (process.env.RABBIT_SHOTS_DIR) {
    await mkdir(process.env.RABBIT_SHOTS_DIR, { recursive: true });
    await writeFile(
      resolve(process.env.RABBIT_SHOTS_DIR, "judge-path.json"),
      JSON.stringify(
        {
          source: "local synthetic fixtures, not live Qloo",
          elapsedMs,
          includes:
            "three discoveries, evidence, save, rejection/refill, reload, isolated visitor, fork, new branch and revocation",
          measuredAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }
});
test("manual identity confirmation, shorter finish, mobile reflow and browser-offline example edits", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Your starting point", { exact: true }).fill("Prince");
  await page.getByLabel("Type", { exact: true }).selectOption("artist");
  await page
    .getByRole("button", { name: "Find it", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "Which one did you mean?" })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Start here", exact: true })
      .filter({ visible: true }),
  ).toBeDisabled();
  await page.getByRole("radio").check();
  await page
    .getByRole("button", { name: "Start here", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/t\//);
  await expect(
    page
      .getByRole("button", { name: /^Add to trail: / })
      .filter({ visible: true }),
  ).toHaveCount(3);
  await context.setOffline(true);
  await expect(
    page.getByText("You're offline. You can still read this open trail."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Add to trail:/ })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Finish my trail", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "Here's where you went" })
      .filter({ visible: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Save example online", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: "Save example online", exact: true })
      .filter({ visible: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Share this trail", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByLabel("Trail link", { exact: true })).toBeVisible();
});
test("five comparison cases disclose synthetic arms and permit a blind choice before source reveal", async ({
  page,
}) => {
  await page.goto("/compare");
  await expect(
    page
      .getByRole("heading", { name: "Five saved comparisons" })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.locator("ol a")).toHaveCount(5);
  await page.locator("ol a").first().click();
  await expect(
    page
      .getByRole("heading", { name: "Version A", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Both", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText("Your choice is saved for this comparison.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show sources" })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "With Qloo affinity", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  const savedVote = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem(
        Object.keys(sessionStorage).find((key) =>
          key.startsWith("rabbit-vote:"),
        )!,
      )!,
    ),
  );
  await page.reload();
  await expect(
    page
      .getByRole("heading", { name: "With Qloo affinity", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  const second = await page.context().newPage();
  await second.goto(page.url());
  await second
    .getByRole("button", { name: "Version A", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    second.getByText("Your choice is saved for this comparison.", {
      exact: true,
    }),
  ).toBeVisible();
  const acceptedVote = await second.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem(
        Object.keys(sessionStorage).find((key) =>
          key.startsWith("rabbit-vote:"),
        )!,
      )!,
    ),
  );
  expect(acceptedVote.choice).toBe("Both");
  expect(acceptedVote.reverse).toBe(savedVote.reverse);
  const staleVote = await page.request.post(
    `/api/comparisons/${page.url().split("/").at(-1)}/votes`,
    {
      headers: { origin: new URL(page.url()).origin },
      data: {
        choice: "Left",
        armOrder: ["with", "without"],
        familiarity: [],
        caseVersion: "old-case-version",
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(staleVote.status()).toBe(409);
  await second.close();
});
