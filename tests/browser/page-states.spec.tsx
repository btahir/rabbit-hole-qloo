import { test, expect } from "./fixtures";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
// Visual coverage of the actual route-state components; no public diagnostics route is added.
test("route loading and application error components at both sizes", async ({
  page,
}) => {
  await page.goto("/");
  const styles = await page
    .locator("link[rel=stylesheet]")
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).href),
    );
  const css = (
    await Promise.all(
      styles.map(async (href) => (await page.request.get(href)).text()),
    )
  ).join("\n");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const name of ["route-loading", "application-error"]) {
      const markup = execFileSync(
        process.execPath,
        ["--import", "tsx", "tests/browser/render-page-state.ts", name],
        { encoding: "utf8" },
      );
      await page.setContent(`<style>${css}</style>${markup}`);
      await page.evaluate(() => document.fonts.ready);
      await expect(
        page
          .getByRole("link", { name: "Rabbit Hole", exact: true })
          .filter({ visible: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (process.env.RABBIT_SHOTS_DIR) {
        await mkdir(process.env.RABBIT_SHOTS_DIR, { recursive: true });
        await page.screenshot({
          path: resolve(process.env.RABBIT_SHOTS_DIR, `${name}-${width}.png`),
          animations: "disabled",
        });
      }
    }
  }
});
