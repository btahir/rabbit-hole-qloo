import { test, expect } from "./fixtures";
import { openControls } from "./controls";
for (const width of [1440, 390])
  test(`first drawer remains readable offline at ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "In the Mood for Love", exact: true })
      .click();
    await expect(page).toHaveURL(/\/t\//);
    await expect(
      page.locator(".door-follow").filter({ visible: true }),
    ).toHaveCount(3);
    await openControls(page, "doors");
    await context.setOffline(true);
    await page
      .getByRole("button", { name: /^Why this\?/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator(".door-follow").filter({ visible: true }),
    ).toHaveCount(3);
    await expect(
      page.getByText("Something went wrong.", { exact: true }),
    ).toHaveCount(0);
    await context.setOffline(false);
  });

test("an unavailable intermediate anchor returns to the previous doors", async ({
  page,
}) => {
  test.skip(!!process.env.RABBIT_LIVE_E2E, "Injected recovery uses fixtures");
  await page.goto("/");
  await page
    .getByRole("button", { name: "In the Mood for Love", exact: true })
    .click();
  await expect(page).toHaveURL(/\/t\//);
  const follows = page.locator(".door-follow").filter({ visible: true });
  await expect(follows).toHaveCount(3);
  const names = await follows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("aria-label")),
  );
  await follows.first().click();
  await page.route("**/api/agent", (route) =>
    route.fulfill({
      status: 422,
      json: {
        error: "invalid_seed",
        heading: "This starting point can't open new doors yet",
        body: "Qloo couldn't use this catalog identity.",
      },
    }),
  );
  await page
    .getByRole("button", { name: /^Find the next doors/ })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Back to other discoveries", exact: true })
    .click();
  await expect(follows).toHaveCount(3);
  expect(
    await follows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    ),
  ).toEqual(names);
});
