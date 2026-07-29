import { randomUUID } from 'node:crypto'

export const DEFAULT_QUEUE = 'default'

export interface QueuedRecord {
  id: string
  body: string
  attempts: number
  /** The named queue this job belongs to (for release / priority workers). */
  queue: string
}

export interface PushOptions {
  delaySeconds?: number
  attempts?: number
  /** Named queue (priority lane). Defaults to `'default'`. */
  queue?: string
}

/**
 * A queue backend. `push` enqueues a serialized job body (optionally delayed,
 * onto a named queue); `pop` reserves the next ready job (attempts already
 * incremented) from the given queues in priority order and removes it;
 * `release` re-queues it (for retry) onto its own queue, preserving attempts.
 */
export interface QueueStore {
  push(body: string, options?: PushOptions): Promise<void>
  pop(queues?: string[]): Promise<QueuedRecord | null>
  release(record: QueuedRecord, delaySeconds: number): Promise<void>
  size(queue?: string): Promise<number>
}

const now = () => Date.now()

/** In-memory queue (per-process; dev/tests). */
export class MemoryQueueStore implements QueueStore {
  private entries: {
    id: string
    body: string
    attempts: number
    availableAt: number
    queue: string
  }[] = []

  async push(body: string, options: PushOptions = {}): Promise<void> {
    this.entries.push({
      id: randomUUID(),
      body,
      attempts: options.attempts ?? 0,
      availableAt: now() + (options.delaySeconds ?? 0) * 1000,
      queue: options.queue ?? DEFAULT_QUEUE,
    })
  }

  async pop(queues: string[] = [DEFAULT_QUEUE]): Promise<QueuedRecord | null> {
    const t = now()
    // Honor queue priority: exhaust the first queue's ready jobs before the next.
    for (const queue of queues) {
      const ready = this.entries
        .filter(e => e.queue === queue && e.availableAt <= t)
        .sort((a, b) => a.availableAt - b.availableAt)
      const next = ready[0]
      if (!next)
        continue
      this.entries = this.entries.filter(e => e !== next)
      return { id: next.id, body: next.body, attempts: next.attempts + 1, queue: next.queue }
    }
    return null
  }

  async release(record: QueuedRecord, delaySeconds: number): Promise<void> {
    this.entries.push({
      id: record.id,
      body: record.body,
      attempts: record.attempts,
      availableAt: now() + delaySeconds * 1000,
      queue: record.queue,
    })
  }

  async size(queue?: string): Promise<number> {
    return queue ? this.entries.filter(e => e.queue === queue).length : this.entries.length
  }
}

/** Minimal Redis client (Bun's `RedisClient` satisfies this via `send`). */
export interface RedisLike {
  send(command: string, args: string[]): Promise<unknown>
}

/** Redis queue — one sorted set per named queue, scored by availability time. */
export class RedisQueueStore implements QueueStore {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = 'queues',
  ) {}

  private key(queue: string): string {
    return `${this.prefix}:${queue}`
  }

  async push(body: string, options: PushOptions = {}): Promise<void> {
    const queue = options.queue ?? DEFAULT_QUEUE
    const member = JSON.stringify({
      id: randomUUID(),
      body,
      attempts: options.attempts ?? 0,
      queue,
    })
    await this.client.send('ZADD', [
      this.key(queue),
      String(now() + (options.delaySeconds ?? 0) * 1000),
      member,
    ])
  }

  async pop(queues: string[] = [DEFAULT_QUEUE]): Promise<QueuedRecord | null> {
    for (const queue of queues) {
      // Reading the next member and removing it are two separate commands, so
      // another worker can take it in between — and workers polling the same
      // Redis queue from separate processes is the normal deployment. Claiming
      // the job regardless meant BOTH workers ran it (verified: two pops
      // returned the same id). `ZREM` reports how many members it actually
      // removed, so only the worker that removed it owns the job; a loser
      // retries this queue rather than running someone else's job.
      while (true) {
        const found = (await this.client.send('ZRANGEBYSCORE', [
          this.key(queue),
          '-inf',
          String(now()),
          'LIMIT',
          '0',
          '1',
        ])) as string[] | null
        const member = found?.[0]
        if (!member)
          break // nothing ready on this queue — try the next one
        const removed = Number(await this.client.send('ZREM', [this.key(queue), member]))
        if (removed === 0)
          continue // lost the race; the set shrank, so this terminates
        const parsed = JSON.parse(member)
        return {
          id: parsed.id,
          body: parsed.body,
          attempts: parsed.attempts + 1,
          queue: parsed.queue ?? queue,
        }
      }
    }
    return null
  }

  async release(record: QueuedRecord, delaySeconds: number): Promise<void> {
    const member = JSON.stringify({
      id: record.id,
      body: record.body,
      attempts: record.attempts,
      queue: record.queue,
    })
    await this.client.send('ZADD', [
      this.key(record.queue),
      String(now() + delaySeconds * 1000),
      member,
    ])
  }

  async size(queue: string = DEFAULT_QUEUE): Promise<number> {
    return Number(await this.client.send('ZCARD', [this.key(queue)]))
  }
}

/** DB adapter for the `database` queue driver (kept DB-agnostic, wired by the app). */
export interface QueueDbAdapter {
  insert(
    id: string,
    body: string,
    attempts: number,
    availableAt: number,
    queue: string,
  ): Promise<void>
  /**
   * Atomically take the earliest ready job among `queues` (in priority order)
   * and remove it — in ONE statement, e.g. `DELETE FROM jobs WHERE id = (
   * SELECT id ... ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED)
   * RETURNING *`. A `SELECT` followed by a separate `DELETE` is not enough:
   * two workers polling the same table both see the same row and both run the
   * job, so anything non-idempotent happens twice.
   */
  takeReady(
    now: number,
    queues: string[],
  ): Promise<{ id: string, body: string, attempts: number, queue: string } | null>
  count(queue?: string): Promise<number>
}

let dbAdapter: QueueDbAdapter | null = null
export function configureDatabaseQueue(adapter: QueueDbAdapter): void {
  dbAdapter = adapter
}
function requireAdapter(): QueueDbAdapter {
  if (!dbAdapter)
    throw new Error('[elyvel] database queue needs configureDatabaseQueue(...).')
  return dbAdapter
}

export class DatabaseQueueStore implements QueueStore {
  async push(body: string, options: PushOptions = {}): Promise<void> {
    await requireAdapter().insert(
      randomUUID(),
      body,
      options.attempts ?? 0,
      now() + (options.delaySeconds ?? 0) * 1000,
      options.queue ?? DEFAULT_QUEUE,
    )
  }

  async pop(queues: string[] = [DEFAULT_QUEUE]): Promise<QueuedRecord | null> {
    const row = await requireAdapter().takeReady(now(), queues)
    return row ? { id: row.id, body: row.body, attempts: row.attempts + 1, queue: row.queue } : null
  }

  async release(record: QueuedRecord, delaySeconds: number): Promise<void> {
    await requireAdapter().insert(
      record.id,
      record.body,
      record.attempts,
      now() + delaySeconds * 1000,
      record.queue,
    )
  }

  async size(queue?: string): Promise<number> {
    return requireAdapter().count(queue)
  }
}
