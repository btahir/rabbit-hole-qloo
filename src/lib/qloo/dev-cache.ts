import {
  mkdir,
  readFile,
  rename,
  writeFile,
  appendFile,
  rm,
  stat,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CacheEntry } from "./cache";
import { encodeQuery, type Endpoint, type Query } from "./requests";
import { SCHEMA_VERSION } from "./schemas";

/** Explicit private local-development cache. No credentials, headers or owner
 * capabilities are written. Original timestamps survive process restarts. */
export class DevDiskCache {
  constructor(readonly directory: string) {}
  key(endpoint: Endpoint, query: Query) {
    return createHash("sha256")
      .update(
        JSON.stringify(["GET", endpoint, encodeQuery(query), SCHEMA_VERSION]),
      )
      .digest("hex");
  }
  async get(key: string): Promise<CacheEntry | undefined> {
    try {
      const entry = JSON.parse(
        await readFile(join(this.directory, `${key}.json`), "utf8"),
      );
      const age = Date.now() - Date.parse(entry.fetchedAt);
      if (age >= 0 && age < 7 * 86400_000 && "value" in entry) return entry;
    } catch {
      /* A missing or malformed local cache entry is a miss. */
    }
  }
  async set(key: string, entry: CacheEntry) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `${key}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
    await rename(temporary, file);
  }
  async attempt(endpoint: string, status: number | string, elapsedMs: number) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await appendFile(
      join(this.directory, "attempts.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        endpoint,
        status,
        elapsedMs,
      }) + "\n",
      { mode: 0o600 },
    );
  }
  async reserveAttempt(endpoint: string, signal?: AbortSignal | null) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = join(this.directory, "request.lock");
    for (;;) {
      signal?.throwIfAborted();
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const pid = Number(await readFile(join(lock, "pid"), "utf8"));
          if (Number.isInteger(pid) && pid > 0) process.kill(pid, 0);
          else if (Date.now() - (await stat(lock)).mtimeMs > 60_000)
            await rm(lock, { recursive: true, force: true });
        } catch (ownerError) {
          if ((ownerError as NodeJS.ErrnoException).code === "ESRCH")
            await rm(lock, { recursive: true, force: true });
          else if ((ownerError as NodeJS.ErrnoException).code === "ENOENT") {
            const info = await stat(lock).catch(() => undefined);
            if (info && Date.now() - info.mtimeMs > 60_000)
              await rm(lock, { recursive: true, force: true });
          }
        }
        await delay(50, undefined, { signal: signal ?? undefined });
      }
    }
    try {
      await writeFile(join(lock, "pid"), String(process.pid));
      await this.checkBudget();
      let next = 0;
      try {
        next = Number(
          await readFile(join(this.directory, "next-start"), "utf8"),
        );
      } catch {
        /* First call. */
      }
      await delay(Math.max(0, next - Date.now()), undefined, {
        signal: signal ?? undefined,
      });
      signal?.throwIfAborted();
      await writeFile(
        join(this.directory, "next-start"),
        String(Date.now() + 260),
        { mode: 0o600 },
      );
      await this.attempt(endpoint, "started", 0);
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  private async checkBudget() {
    let attempts = "";
    try {
      attempts = await readFile(join(this.directory, "attempts.jsonl"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (attempts.trim().split("\n").filter(Boolean).length >= 150)
      throw new Error("The development run's 150-attempt allowance is used.");
  }
}
