import { test, expect } from "./fixtures";
import { openControls } from "./controls";
import type { Page } from "@playwright/test";
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
async function sample(page: Page, name = "In the Mood for Love") {
  await page.goto("/");
  await button(page, name).click();
  await expect(button(page, "Add to trail")).toHaveCount(3);
}

test("accepted refinement survives reload and both recent trails remain accessible", async ({
  page,
}) => {
  await sample(page);
  const first = page.url();
  await openControls(page, "direction");
  await page
    .getByLabel("Something less obvious")
    .filter({ visible: true })
    .check();
  await button(page, "Refresh doors").click();
  await expect(button(page, "Add to trail")).toHaveCount(3);
  await page.reload();
  await openControls(page, "direction");
  await expect(
    page.getByLabel("Something less obvious").filter({ visible: true }),
  ).toBeChecked();
  await sample(page, "Prince");
  await page.goto("/");
  const previous = page.locator(".previous-trail a");
  await expect(previous).toHaveAttribute("href", new URL(first).pathname);
  await previous.click();
  await expect(page).toHaveURL(first);
});

test("inherited run history never fetches a creator run or changes the fork", async ({
  page,
  browser,
}) => {
  await sample(page);
  await button(page, "Add to trail").first().click();
  await openControls(page, "tools");
  await button(page, "Share this trail").click();
  const link = await page
    .getByLabel("Trail link", { exact: true })
    .inputValue();
  const context = await browser.newContext();
  const recipient = await context.newPage();
  await recipient.goto(link);
  await button(recipient, "Make your own trail").click();
  await recipient.getByRole("radio").last().check();
  await button(recipient, "Make my version").click();
  await expect(recipient).toHaveURL(/\/t\//);
  const fork = recipient.url();
  let runReads = 0;
  recipient.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("/api/runs/"))
      runReads++;
  });
  await openControls(recipient, "history");
  await button(recipient, "Why this?").first().click();
  await recipient
    .getByText("Qloo evidence & source details", { exact: true })
    .click();
  await button(recipient, "Example steps").click();
  await expect(recipient.getByRole("dialog")).toContainText(
    "inherited from a shared trail",
  );
  expect(recipient.url()).toBe(fork);
  expect(runReads).toBe(0);
  await context.close();
});

test("saved removal keeps next action keyboard reachable and start over focuses search", async ({
  page,
}) => {
  await sample(page);
  await openControls(page, "doors");
  await button(page, "Save for later").first().click();
  await expect(button(page, "Saved")).toHaveCount(1);
  await button(page, "Save for later").first().click();
  await expect(button(page, "Saved")).toHaveCount(2);
  await openControls(page, "tools");
  await button(page, "Saved discoveries").click();
  const saved = page
    .getByRole("dialog")
    .getByRole("button", { name: /^Saved(?: |:)/ });
  await saved.first().click();
  await expect(saved).toHaveCount(1);
  await expect(saved).toBeFocused();
  expect(await saved.evaluate((node) => (node as HTMLElement).tabIndex)).toBe(
    0,
  );
  await page.keyboard.press("Escape");
  await openControls(page, "tools");
  await button(page, "Start somewhere new").click();
  await expect(
    page.getByLabel("Your starting point", { exact: true }),
  ).toBeFocused();
});
