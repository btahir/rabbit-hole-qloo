import { databaseClient, migrateDatabase } from "../src/lib/core/postgres";

const sql = databaseClient();
if (!sql) {
  console.log("DATABASE_URL is unset; using the KV or local memory store.");
} else {
  try {
    await migrateDatabase(sql);
    console.log("Rabbit Hole database is ready.");
  } catch {
    console.error(
      "Database migration failed. Check DATABASE_URL and database permissions.",
    );
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
