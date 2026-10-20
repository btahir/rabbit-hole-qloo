import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 2,
  timeout: 45_000,
  expect: { timeout: process.env.RABBIT_LIVE_E2E ? 20_000 : 5_000 },
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3437", headless: true },
  reporter: "list",
  webServer: {
    command: "bun --bun next start --hostname 127.0.0.1 --port 3437",
    url: "http://127.0.0.1:3437",
    reuseExistingServer: false,
    env: {
      APP_ORIGIN: "http://127.0.0.1:3437",
      ALLOW_MEMORY_STORE: "1",
      QLOO_MODE: process.env.RABBIT_LIVE_E2E ? "live" : "fixture",
      QLOO_DEV_CACHE_DIR: ".cache/qloo",
      NEXT_TELEMETRY_DISABLED: "1",
      // Test visitors send documentation-range x-forwarded-for addresses so
      // per-IP limits stay on without every test sharing one bucket.
      TRUST_PROXY: "1",
    },
  },
});
