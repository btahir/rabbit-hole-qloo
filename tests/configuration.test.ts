import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/core/http";
import { emptyDatabase } from "../src/lib/core/store";
import { reserve } from "../src/lib/core/limits";
import type { Run, Trail } from "../src/lib/core/types";
import { clientIp, qlooAllocation } from "../src/lib/core/config";
import { secret, encryptToken, decryptToken } from "../src/lib/core/crypto";

afterEach(() => vi.unstubAllEnvs());

it("uses the public demo allocation with no optional configuration", () => {
  for (const name of [
    "QLOO_CREDENTIAL_SCOPE",
    "QLOO_QUOTA_RESETS_AT",
    "QLOO_PROJECT_CALL_ALLOWANCE",
    "QLOO_PROJECT_ALLOCATION_VERIFIED",
    "QLOO_ACCESS_VALID_UNTIL",
  ])
    vi.stubEnv(name, "");
  const allocation = qlooAllocation(Date.parse("2026-10-19T00:00:00Z"));
  expect(allocation.scope).toBe("rabbit-hole");
  expect(allocation.ceiling).toBe(2500);
  expect(allocation.reset).toBe(Date.parse("2026-11-18T00:00:00Z"));
  expect(() => qlooAllocation(allocation.reset)).toThrow();
  vi.stubEnv("QLOO_QUOTA_RESETS_AT", "2026-12-15T00:00:00Z");
  expect(() => qlooAllocation(Date.parse("2026-12-01T00:00:00Z"))).toThrow();
});

it("trusts only the last proxy hop on Tiffin, with an explicit opt-out", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.11, 198.51.100.42",
  });
  vi.stubEnv("TIFFIN_URL", "");
  vi.stubEnv("TRUST_PROXY", "");
  expect(clientIp(headers)).toBe("local");
  vi.stubEnv("TIFFIN_URL", "https://demo.example");
  expect(clientIp(headers)).toBe("198.51.100.42");
  headers.set("x-forwarded-for", "bad input");
  expect(clientIp(headers)).toBe("local");
  headers.set("x-forwarded-for", "2001:db8::1");
  expect(clientIp(headers)).toBe("2001:db8::1");
  vi.stubEnv("TRUST_PROXY", "0");
  expect(clientIp(headers)).toBe("local");
});

it("derives a stable, domain-separated share key while preserving explicit keys", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("SHARE_TOKEN_SECRET", "");
  expect(secret("share")).not.toBe(secret("session"));
  const encrypted = encryptToken("a shared link token", "share");
  expect(decryptToken(encrypted, "share")).toBe("a shared link token");
  vi.stubEnv("SHARE_TOKEN_SECRET", "x".repeat(32));
  expect(secret("share")).toBe("x".repeat(32));
  expect(() => decryptToken(encrypted, "share")).toThrow();
});

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
