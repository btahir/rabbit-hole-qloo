import { expect, test } from "@playwright/test";

test("Sources keeps the owner trail as the comparison return destination", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Prince", exact: true }).click();
  await expect(page).toHaveURL(/\/t\//);
  await expect(
    page.locator(".door-follow").filter({ visible: true }),
  ).toHaveCount(3);
  const original = page.url();
  await page
    .getByRole("button", { name: "Sources", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Qloo ordering audit", exact: true })
    .click();
  await expect(page).toHaveURL(/\/compare$/);
  await expect(
    page.getByRole("link", { name: "Back to the trail", exact: true }),
  ).toHaveAttribute("href", new URL(original).pathname);
  await page
    .getByRole("link", { name: "Back to the trail", exact: true })
    .click();
  await expect(page).toHaveURL(original);
});
