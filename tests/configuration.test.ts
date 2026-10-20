import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/core/http";
import { emptyDatabase } from "../src/lib/core/store";
import { reserve } from "../src/lib/core/limits";
import type { Run, Trail } from "../src/lib/core/types";

afterEach(() => vi.unstubAllEnvs());

it("starts an offline session with the blank environment template", async () => {
  for (const name of [
    "APP_ORIGIN",
    "DATABASE_URL",
    "REDIS_URL",
    "SESSION_SECRET",
    "SHARE_TOKEN_SECRET",
  ])
    vi.stubEnv(name, "");
  const response = await api(
    "session",
    new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
});

it("uses default spend caps for blank values while retaining an explicit zero cap", () => {
  vi.stubEnv("DAILY_BUDGET_USD", "");
  vi.stubEnv("TOTAL_BUDGET_USD", "");
  const db = emptyDatabase();
  const trail = {
    id: "trail",
    mode: "live",
    counters: { runs: 0, insights: 0, attempts: 0 },
  } as Trail;
  const run = { id: "run", owner: "owner", reserved: 20_000 } as Run;
  reserve(db, trail, run, "ip", Date.now());
  expect(db.budgets.cumulative).toBe(20_000);
  vi.stubEnv("DAILY_BUDGET_USD", "0");
  expect(() =>
    reserve(emptyDatabase(), trail, run, "ip", Date.now()),
  ).toThrow();
});
