import "server-only";
import { AppError, assert } from "./errors";
import { redisClient } from "./store";

// Project-local allocation: ShipTiffin isolates keyspaces. The owner divides
// the credential allowance between apps; this project cannot spend another share.
export const RESERVE_CREDENTIAL_ATTEMPT = `
local now=tonumber(ARGV[1]); local reset=tonumber(ARGV[2]);
if now>=reset then return -3 end
local contract=ARGV[3]; local old=redis.call('HGET',KEYS[1],'contract')
if not old then return -4 end
if old~=contract then return -2 end
local used=tonumber(redis.call('HGET',KEYS[1],'used'))
if not used then return -4 end
local ceiling=tonumber(ARGV[5])
if used>=ceiling then return -1 end
redis.call('HSET',KEYS[1],'contract',contract,'used',used+1)
redis.call('PERSIST',KEYS[1])
return used+1`;

export async function reserveCredentialAttempt() {
  const local =
    process.env.NODE_ENV !== "production" ||
    (process.env.ALLOW_MEMORY_STORE === "1" &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
        process.env.APP_ORIGIN ?? "",
      ));
  if (local && !process.env.QLOO_CREDENTIAL_SCOPE) return;
  const scope = process.env.QLOO_CREDENTIAL_SCOPE ?? "";
  const reset = Date.parse(process.env.QLOO_QUOTA_RESETS_AT ?? "");
  const ceiling = Number(process.env.QLOO_PROJECT_CALL_ALLOWANCE);
  const prior = 0;
  assert(
    /^[a-zA-Z0-9_-]{8,80}$/.test(scope) &&
      Number.isFinite(reset) &&
      reset > Date.now() &&
      Number.isInteger(ceiling) &&
      ceiling > 0 &&
      ceiling <= 2500 &&
      process.env.QLOO_PROJECT_ALLOCATION_VERIFIED === "1",
    "configuration",
    503,
  );
  const redis = redisClient();
  assert(redis, "storage", 503);
  const contract = JSON.stringify({ reset, ceiling });
  let result: number;
  try {
    result = Number(
      await redis.eval(
        RESERVE_CREDENTIAL_ATTEMPT,
        [`qloo:credential:${scope}:allowance:v1`],
        [Date.now(), reset, contract, prior, ceiling],
      ),
    );
  } catch {
    throw new AppError("storage", 503);
  }
  if (result === -1) throw new AppError("paused", 503);
  assert(result > 0, "configuration", 503);
}
