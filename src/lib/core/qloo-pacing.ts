import "server-only";
import { sleep } from "../qloo/client";
import { redisClient } from "./store";

let nextStart = 0;
const acquire = `local now=tonumber(ARGV[1]); local next=tonumber(redis.call('GET',KEYS[1]) or '0'); if next>now then return next-now end; redis.call('SET',KEYS[1],now+520,'PX',2000); return 0`;
/** Project KV: two starts/second leaves room for the other entry.
 * Local starts retain the four/second development ceiling. */
export async function paceQloo(signal: AbortSignal) {
  const redis = redisClient();
  if (redis) {
    for (;;) {
      signal.throwIfAborted();
      const wait = Number(
        await redis.eval(
          acquire,
          [
            `qloo:credential:${process.env.QLOO_CREDENTIAL_SCOPE ?? "local"}:request-pacing:v1`,
          ],
          [Date.now()],
        ),
      );
      if (!wait) return;
      await sleep(wait, signal);
    }
  }
  const wait = Math.max(0, nextStart - Date.now());
  nextStart = Date.now() + wait + 260;
  await sleep(wait, signal);
}
