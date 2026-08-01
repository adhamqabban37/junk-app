import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * Returns connection options, not a constructed IORedis instance. Handing
 * BullMQ a pre-built client meant it wouldn't close it on app shutdown
 * (it only closes connections it created itself) -- that left every e2e
 * test that bootstraps the full app hanging after the test run finished.
 * Passing options instead lets BullMQ own the connection lifecycle.
 * maxRetriesPerRequest: null is required by BullMQ's blocking commands.
 */
export function createRedisConnectionOptions(
  config: ConfigService,
): RedisOptions {
  const url = new URL(
    config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
  );
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}
