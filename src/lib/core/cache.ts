import "server-only";
import type { RedisPort } from "./store";
import { RedisCache } from "../qloo/cache";
// Cache metadata and values are private; cache eviction never touches trail state.
const SET_BOUNDED = `
local previous = tonumber(redis.call('HGET', KEYS[3], KEYS[1]) or '0')
local total = tonumber(redis.call('GET', KEYS[4]) or '0') - previous
local bytes = string.len(KEYS[1]) + string.len(ARGV[1])
if bytes > 33554432 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], KEYS[1])
redis.call('HSET', KEYS[3], KEYS[1], bytes)
total = total + bytes
while total > 33554432 or redis.call('ZCARD', KEYS[2]) > 2000 do
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0)[1]
  if not oldest then break end
  total = total - tonumber(redis.call('HGET', KEYS[3], oldest) or '0')
  redis.call('DEL', oldest); redis.call('HDEL', KEYS[3], oldest); redis.call('ZREM', KEYS[2], oldest)
end
redis.call('SET', KEYS[4], total)
return 1`;
export function boundedRedisCache(redis: RedisPort, namespace: string) {
  const prefix = `rabbit-cache:${namespace}`;
  return new RedisCache({
    get: async (key) => {
      const value = await redis.get(key);
      return value === null
        ? null
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
    },
    setPx: async (key, value, px) => {
      await redis.eval(
        SET_BOUNDED,
        [key, `${prefix}:lru`, `${prefix}:sizes`, `${prefix}:bytes`],
        [value, px, Date.now()],
      );
    },
    del: async (key) => {
      await redis.del(key);
    },
  });
}
