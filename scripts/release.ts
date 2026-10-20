import { databaseClient, migrateDatabase } from "../src/lib/core/postgres";
import { redisClient, store } from "../src/lib/core/store";
import { provisionAllowance } from "../src/lib/core/qloo-allowance";
import { prepareDemo } from "../src/lib/core/release";
import { AppError } from "../src/lib/core/errors";

const sql = databaseClient();
const log = (event: Record<string, unknown>) =>
  console.log(JSON.stringify(event));
try {
  if (!sql) throw new Error("missing database");
  // Schema failures block the release; provider/warming failures never do.
  await migrateDatabase(sql);
  log({ stage: "migration", status: "ready" });
  try {
    const redis = redisClient();
    if (!redis) throw new Error("missing KV");
    const created = await provisionAllowance(redis);
    log({ stage: "allowance", status: created ? "created" : "preserved" });
    log({ stage: "warming", ...(await prepareDemo(sql, redis, store(), log)) });
  } catch (error) {
    log({
      stage: "warming",
      status: "unavailable",
      reason: error instanceof AppError ? error.code : "storage-or-provider",
    });
  }
} catch {
  console.error(
    "Release migration failed. Check DATABASE_URL and database permissions.",
  );
  process.exitCode = 1;
} finally {
  await sql?.end();
}
