import type { RedisLike } from './store'

/**
 * Graceful worker restart (Laravel's `queue:restart`). A worker records when it
 * started; `queue:restart` writes a newer timestamp; workers that started
 * before it finish their current job then exit (a supervisor restarts them).
 * Needs a shared store (cache/db) via {@link configureRestartSignal}; without
 * one, `queue:restart` reports that it's unavailable.
 */
export interface RestartSignal {
  /** The epoch ms of the last restart request, or null if none. */
  requestedAt(): Promise<number | null>
  /** Record a restart request now. */
  request(): Promise<void>
}

/**
 * Redis-backed restart signal — makes `queue:restart` actually reach worker
 * processes running elsewhere. There is no in-memory default for this one
 * (unlike the rate limiter/broadcaster/scheduler-mutex): an in-memory signal
 * would only ever be visible to the process that called
 * `configureRestartSignal`, and `queue:restart` is itself a separate
 * short-lived CLI invocation from the worker process(es) it's meant to
 * reach — so a "single process" default isn't even useful as a fallback,
 * only a shared store like this is. Same Bun built-in `RedisClient`
 * convention as `RedisRateLimiterStore`/`RedisBroadcaster`/`RedisScheduleMutex`.
 */
export class RedisRestartSignal implements RestartSignal {
  constructor(
    private readonly client: RedisLike,
    private readonly key = 'elyvel:queue:restart',
  ) {}

  async requestedAt(): Promise<number | null> {
    const raw = await this.client.send('GET', [this.key])
    return raw === null || raw === undefined ? null : Number(raw)
  }

  async request(): Promise<void> {
    await this.client.send('SET', [this.key, String(Date.now())])
  }
}

let signal: RestartSignal | null = null
export function configureRestartSignal(store: RestartSignal): void {
  signal = store
}
export function restartSignal(): RestartSignal | null {
  return signal
}
