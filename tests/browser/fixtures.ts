import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test as base, expect, chromium } from "@playwright/test";
// Use only the installed Chromium headless shell, with the plain launch contract.
export const test = base.extend({
  extraHTTPHeaders: async ({}, provide, info) => {
    // Independent test visitors use documentation-range addresses; application limits stay enabled.
    const suffix =
      ([...info.testId].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 250) + 1;
    await provide({ "x-forwarded-for": `192.0.2.${suffix}` });
  },
  page: async ({ page }, provide, info) => {
    const writes: Promise<void>[] = [];
    if (process.env.RABBIT_LIVE_E2E && process.env.RABBIT_SHOTS_DIR) {
      const directory = process.env.RABBIT_SHOTS_DIR;
      await mkdir(directory, { recursive: true });
      page.on("response", (response) => {
        if (!/\/api\/runs\/[^/?]+(?:\?|$)/.test(response.url())) return;
        writes.push(
          response
            .json()
            .then((run) =>
              appendFile(
                join(directory, "live-runs.jsonl"),
                JSON.stringify({
                  test: info.title,
                  id: run.id,
                  state: run.state,
                  modelSteps: run.modelSteps,
                  attempts: run.attempts,
                  insights: run.insights,
                  elapsedMs: run.elapsedMs,
                  telemetry: run.telemetry,
                }) + "\n",
              ),
            )
            .catch(() => {}),
        );
      });
    }
    await provide(page);
    await Promise.all(writes);
  },
  browser: [
    async ({}, use) => {
      const browser = await chromium.launch();
      await use(browser);
      await browser.close();
    },
    { scope: "worker" },
  ],
});
export { expect };
