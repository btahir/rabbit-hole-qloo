import type { Page } from "@playwright/test";
export async function openControls(
  page: Page,
  kind: "doors" | "tools" | "history" | "direction",
) {
  const selectors = {
    doors: ".discovery-doors .door-details",
    tools: ".tools-menu",
    history: ".active-workspace .path-history",
    direction: ".direction-details",
  };
  if (
    (await page.locator(`${selectors[kind]}[open]`).count()) &&
    !(await page.locator(`${selectors[kind]}:not([open])`).count())
  )
    return;
  await page
    .locator(`${selectors[kind]} > summary`)
    .filter({ visible: true })
    .first()
    .waitFor();
  const closed = page
    .locator(`${selectors[kind]}:not([open]) > summary`)
    .filter({ visible: true });
  while (await closed.count()) await closed.first().click();
}
