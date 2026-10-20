import "server-only";
import { isIP } from "node:net";
import { assert } from "./errors";

/** Stable project allocation; an expired window never rolls over automatically. */
export function qlooAllocation(now = Date.now()) {
  const scope = process.env.QLOO_CREDENTIAL_SCOPE || "rabbit-hole";
  const reset = Date.parse(
    process.env.QLOO_QUOTA_RESETS_AT || "2026-11-18T00:00:00Z",
  );
  const ceiling = Number(process.env.QLOO_PROJECT_CALL_ALLOWANCE || 2500);
  const validUntil = Date.parse(
    process.env.QLOO_ACCESS_VALID_UNTIL || "2026-12-01T00:00:00Z",
  );
  assert(
    /^[a-zA-Z0-9_-]{8,80}$/.test(scope) &&
      Number.isFinite(reset) &&
      reset > now &&
      Number.isFinite(validUntil) &&
      validUntil > now &&
      Number.isInteger(ceiling) &&
      ceiling > 0 &&
      ceiling <= 2500 &&
      (process.env.QLOO_PROJECT_ALLOCATION_VERIFIED || "1") === "1",
    "configuration",
    503,
  );
  return {
    scope,
    reset,
    ceiling,
    contract: JSON.stringify({ reset, ceiling }),
  };
}

/** Tiffin documents one trusted edge hop (XFF_DEPTH=1). Ignore supplied
 * left-hand entries; the rightmost address was appended by that edge. */
export function clientIp(headers: Pick<Headers, "get">) {
  const trust = process.env.TRUST_PROXY
    ? process.env.TRUST_PROXY === "1"
    : !!process.env.TIFFIN_URL;
  if (!trust) return "local";
  const address = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return address && isIP(address) ? address : "local";
}
