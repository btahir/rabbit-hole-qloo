import "server-only";
import postgres, { type Sql } from "postgres";
import type { RecordBackend, RecordWrite } from "./store";

const globalDatabase = globalThis as typeof globalThis & { rabbitSql?: Sql };

export function databaseClient(): Sql | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const configuredMax = Number(process.env.DATABASE_POOL_MAX);
  return (globalDatabase.rabbitSql ??= postgres(url, {
    prepare: false,
    max:
      Number.isSafeInteger(configuredMax) && configuredMax > 0
        ? Math.min(configuredMax, 5)
        : 5,
    idle_timeout: 20,
    connect_timeout: 5,
    onnotice: () => {},
  }));
}

// Run only from the release command. Builds receive read-only credentials.
export async function migrateDatabase(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS rabbit_hole_records (
      key text PRIMARY KEY,
      body text NOT NULL
    )
  `;
}

export class PostgresRecords implements RecordBackend {
  constructor(private sql: Sql) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const rows = await this.sql<{ body: string }[]>`
      SELECT body FROM rabbit_hole_records WHERE key = ${key}
    `;
    if (!rows.length) return null;
    // Normalized record bodies are JSON; metadata uses the same representation.
    return JSON.parse(rows[0].body) as T;
  }

  async commit(
    key: string,
    revision: number,
    writes: RecordWrite[],
    metadata: string,
  ): Promise<boolean> {
    return this.sql.begin(async (sql) => {
      await sql`
        INSERT INTO rabbit_hole_records (key, body)
        VALUES (${key}, '{"revision":0}')
        ON CONFLICT (key) DO NOTHING
      `;
      const [row] = await sql<{ body: string }[]>`
        SELECT body FROM rabbit_hole_records WHERE key = ${key} FOR UPDATE
      `;
      if (JSON.parse(row.body).revision !== revision) return false;
      for (const write of writes) {
        if (write.body === undefined) {
          await sql`DELETE FROM rabbit_hole_records WHERE key = ${write.key}`;
        } else {
          await sql`
            INSERT INTO rabbit_hole_records (key, body)
            VALUES (${write.key}, ${write.body})
            ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body
          `;
        }
      }
      await sql`UPDATE rabbit_hole_records SET body = ${metadata} WHERE key = ${key}`;
      return true;
    });
  }
}
