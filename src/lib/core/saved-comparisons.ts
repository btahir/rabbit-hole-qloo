import "server-only";
import { readFile } from "node:fs/promises";
import { redisClient } from "./store";
import { comparisons, type ComparisonCase } from "./comparisons";
import { evaluationId } from "./evaluation-id";
export async function savedComparisons(): Promise<ComparisonCase[]> {
  const redis = redisClient();
  const identify = (records: ComparisonCase[]) =>
    records.map((item) => ({ ...item, evaluationId: evaluationId(item) }));
  if (!redis) {
    if (
      process.env.QLOO_MODE !== "fixture" &&
      (process.env.NODE_ENV !== "production" ||
        (process.env.ALLOW_MEMORY_STORE === "1" &&
          /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(
            process.env.APP_ORIGIN ?? "",
          )))
    ) {
      try {
        return identify(
          JSON.parse(await readFile(".cache/comparison-results.json", "utf8")),
        );
      } catch {
        /* Unprepared local environment shows explicitly labelled examples. */
      }
    }
    return identify(comparisons);
  }
  const namespace = `rabbit-hole:${process.env.ENTITLEMENT_NAMESPACE || "default"}`;
  const current = await redis.get<string[]>(`${namespace}:comparisons:v2`);
  if (current?.length) {
    const records = await redis.mget<(ComparisonCase | null)[]>(
      ...current.map((id) => `${namespace}:evaluation:${id}`),
    );
    if (records.every((item) => item !== null))
      return identify(records as ComparisonCase[]);
  }
  const records = await redis.get<ComparisonCase[]>(
    `rabbit-hole:${process.env.ENTITLEMENT_NAMESPACE || "default"}:comparisons:v1`,
  );
  return identify(records?.length ? records : comparisons);
}
