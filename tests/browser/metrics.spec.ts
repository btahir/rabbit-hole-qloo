import { test, expect } from "./fixtures";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

test("twenty local production live-data turns and browser loading measurements", async ({
  browser,
}) => {
  test.skip(
    !process.env.RABBIT_METRICS || !process.env.RABBIT_LIVE_E2E,
    "Explicit measured live run only",
  );
  test.setTimeout(240_000);
  const turns: {
    elapsedMs: number;
    modelSteps: number;
    telemetry: unknown;
    cache: string;
    attempts: number;
    payloadBytes: number;
    source: string;
    errors: string[];
  }[] = [];
  const loads: unknown[] = [];
  for (let i = 0; i < 20; i++) {
    const context = await browser.newContext({
      viewport: { width: i % 2 ? 390 : 1440, height: i % 2 ? 844 : 900 },
      extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${i + 1}` },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const scripts: Promise<number>[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "script")
        scripts.push(response.body().then((body) => gzipSync(body).byteLength));
    });
    await page.addInitScript(() => {
      const state = { lcpMs: 0, cls: 0 };
      Object.assign(window, { rabbitMetrics: state });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcpMs = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        })[])
          if (!entry.hadRecentInput) state.cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    const root = [
      "In the Mood for Love",
      "Prince",
      "The Left Hand of Darkness",
    ][i % 3];
    await expect(
      page.getByRole("button", { name: root, exact: true }),
    ).toBeEnabled();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((img) => img.decode().catch(() => {})),
      );
    });
    loads.push({
      viewport: i % 2 ? 390 : 1440,
      ...(await page.evaluate(
        () => (window as unknown as { rabbitMetrics: object }).rabbitMetrics,
      )),
      initialJsGzipEstimate: (await Promise.all(scripts)).reduce(
        (a, b) => a + b,
        0,
      ),
    });
    const start = performance.now();
    await page.getByRole("button", { name: root, exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Add to trail: / }),
    ).toHaveCount(3);
    const elapsedMs = Math.round(performance.now() - start);
    const response = await page.request.get(
      `/api/trails/${page.url().split("/").at(-1)}`,
    );
    const raw = await response.body();
    const trail = JSON.parse(raw.toString());
    const run = await (
      await page.request.get(`/api/runs/${trail.current.runId}`)
    ).json();
    turns.push({
      modelSteps: run.modelSteps,
      telemetry: run.telemetry,
      elapsedMs,
      cache: trail.current.discovery.cache,
      attempts: trail.counters.attempts,
      payloadBytes: raw.byteLength,
      source: trail.current.discovery.source,
      errors,
    });
    expect(errors).toEqual([]);
    await context.close();
  }
  const ordered = turns.map((t) => t.elapsedMs).sort((a, b) => a - b);
  const report = {
    scope:
      "Twenty first turns across three approved roots, alternating fresh desktop/mobile contexts; local production server, real Anthropic agent, cached real Qloo data, memory store. Browser LCP/CLS are unthrottled local observations, JS gzip is a body-compression estimate. No Lighthouse or field INP.",
    turns,
    loads,
    p50Ms: ordered[9],
    p95Ms: ordered[18],
    errors: turns.reduce((n, t) => n + t.errors.length, 0),
  };
  if (process.env.RABBIT_SHOTS_DIR) {
    await mkdir(process.env.RABBIT_SHOTS_DIR, { recursive: true });
    await writeFile(
      resolve(process.env.RABBIT_SHOTS_DIR, "browser-performance.json"),
      JSON.stringify(report, null, 2),
    );
  }
});
