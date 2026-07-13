import { randomUUID } from 'node:crypto'

export interface QueuedRecord {
  id: string
  body: string
  attempts: number
}

/**
 * A queue backend. `push` enqueues a serialized job body (optionally delayed);
 * `pop` reserves the next ready job (attempts already incremented) and removes
 * it; `release` re-queues it (for retry) preserving the attempt count.
 */
export interface QueueStore {
  push(body: string, delaySeconds?: number, attempts?: number): Promise<void>
  pop(): Promise<QueuedRecord | null>
  release(record: QueuedRecord, delaySeconds: number): Promise<void>
  size(): Promise<number>
}

const now = () => Date.now()

/** In-memory queue (per-process; dev/tests). */
export class MemoryQueueStore implements QueueStore {
  private entries: { id: string; body: string; attempts: number; availableAt: number }[] = []
  async push(body: string, delaySeconds = 0, attempts = 0): Promise<void> {
    this.entries.push({ id: randomUUID(), body, attempts, availableAt: now() + delaySeconds * 1000 })
  }
  async pop(): Promise<QueuedRecord | null> {
    const t = now()
    const ready = this.entries.filter((e) => e.availableAt <= t).sort((a, b) => a.availableAt - b.availableAt)
    const next = ready[0]
    if (!next) return null
    this.entries = this.entries.filter((e) => e !== next)
    return { id: next.id, body: next.body, attempts: next.attempts + 1 }
  }
  async release(record: QueuedRecord, delaySeconds: number): Promise<void> {
    this.entries.push({ id: record.id, body: record.body, attempts: record.attempts, availableAt: now() + delaySeconds * 1000 })
  }
  async size(): Promise<number> {
    return this.entries.length
  }
}

/** Minimal Redis client (Bun's `RedisClient` satisfies this via `send`). */
export interface RedisLike {
  send(command: string, args: string[]): Promise<unknown>
}

/** Redis queue — a sorted set scored by availability time (supports delays). */
export class RedisQueueStore implements QueueStore {
  constructor(
    private readonly client: RedisLike,
    private readonly key = 'queues:default',
  ) {}
  async push(body: string, delaySeconds = 0, attempts = 0): Promise<void> {
    const member = JSON.stringify({ id: randomUUID(), body, attempts })
    await this.client.send('ZADD', [this.key, String(now() + delaySeconds * 1000), member])
  }
  async pop(): Promise<QueuedRecord | null> {
    const found = (await this.client.send('ZRANGEBYSCORE', [
      this.key,
      '-inf',
      String(now()),
      'LIMIT',
      '0',
      '1',
    ])) as string[] | null
    const member = found?.[0]
    if (!member) return null
    await this.client.send('ZREM', [this.key, member])
    const { id, body, attempts } = JSON.parse(member)
    return { id, body, attempts: attempts + 1 }
  }
  async release(record: QueuedRecord, delaySeconds: number): Promise<void> {
    const member = JSON.stringify({ id: record.id, body: record.body, attempts: record.attempts })
    await this.client.send('ZADD', [this.key, String(now() + delaySeconds * 1000), member])
  }
  async size(): Promise<number> {
    return Number(await this.client.send('ZCARD', [this.key]))
  }
}

/** DB adapter for the `database` queue driver (kept DB-agnostic, wired by the app). */
export interface QueueDbAdapter {
  insert(id: string, body: string, attempts: number, availableAt: number): Promise<void>
  /** Atomically take the earliest job with `available_at <= now` (and remove it). */
  takeReady(now: number): Promise<{ id: string; body: string; attempts: number } | null>
  count(): Promise<number>
}

let dbAdapter: QueueDbAdapter | null = null
export function configureDatabaseQueue(adapter: QueueDbAdapter): void {
  dbAdapter = adapter
}
function requireAdapter(): QueueDbAdapter {
  if (!dbAdapter) throw new Error('[elysia-ravel] database queue needs configureDatabaseQueue(...).')
  return dbAdapter
}

export class DatabaseQueueStore implements QueueStore {
  async push(body: string, delaySeconds = 0, attempts = 0): Promise<void> {
    await requireAdapter().insert(randomUUID(), body, attempts, now() + delaySeconds * 1000)
  }
  async pop(): Promise<QueuedRecord | null> {
    const row = await requireAdapter().takeReady(now())
    return row ? { id: row.id, body: row.body, attempts: row.attempts + 1 } : null
  }
  async release(record: QueuedRecord, delaySeconds: number): Promise<void> {
    await requireAdapter().insert(record.id, record.body, record.attempts, now() + delaySeconds * 1000)
  }
  async size(): Promise<number> {
    return requireAdapter().count()
  }
}
