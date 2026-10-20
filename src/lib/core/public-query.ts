import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { randomId } from "./crypto";
import { AppError } from "./errors";
import type { RedisPort } from "./store";

// Only activated, non-personal sample queries may enter this handoff. A job
// owns its transport; cancelling a visitor cancels that visitor's wait only.
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
export function publicQueryCoordinator() {
  const flights = new Map<string, Promise<unknown>>();
  return async function query<T>(
    key: string,
    work: () => Promise<T>,
    redis?: RedisPort,
    signal?: AbortSignal,
    reuse: (value: T) => T = (value) => value,
  ): Promise<T> {
    signal?.throwIfAborted();
    let flight = flights.get(key) as Promise<T> | undefined;
    const joined = !!flight;
    if (!flight) {
      if (flights.size >= 128) throw new AppError("limit", 429);
      flight = (async () => {
        if (!redis) return work();
        const lock = `rabbit-public:${key}:lease`,
          result = `rabbit-public:${key}:result`;
        const token = randomId(),
          deadline = Date.now() + 14_000;
        while (Date.now() < deadline) {
          const saved = await redis.get<{ value: T }>(result);
          if (saved) return reuse(saved.value);
          if (await redis.set(lock, token, { nx: true, px: 15_000 })) {
            try {
              // Another worker may have finished between GET and acquiring the lease.
              const completed = await redis.get<{ value: T }>(result);
              if (completed) return reuse(completed.value);
              const value = await work();
              await redis.set(result, { value }, { px: 15_000 });
              return value;
            } finally {
              await redis.eval(RELEASE, [lock], [token]);
            }
          }
          await delay(50);
        }
        throw new AppError("timeout", 504);
      })();
      flights.set(key, flight);
      void flight
        .finally(() => {
          if (flights.get(key) === flight) flights.delete(key);
        })
        .catch(() => {});
    }
    const waiting = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000);
    return new Promise<T>((resolve, reject) => {
      const abort = () =>
        reject(
          new AppError(
            signal?.aborted ? "cancelled" : "timeout",
            signal?.aborted ? 409 : 504,
          ),
        );
      waiting.addEventListener("abort", abort, { once: true });
      flight!.then(
        (value) => {
          waiting.removeEventListener("abort", abort);
          resolve(structuredClone(joined ? reuse(value) : value));
        },
        (error) => {
          waiting.removeEventListener("abort", abort);
          reject(error);
        },
      );
      if (waiting.aborted) abort();
    });
  };
}
export const publicQuery = publicQueryCoordinator();
