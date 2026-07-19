import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A cache backend. `seconds` undefined = store forever. */
export interface CacheStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  put(key: string, value: unknown, seconds?: number): Promise<void>
  forget(key: string): Promise<void>
  flush(): Promise<void>
  increment(key: string, by?: number): Promise<number>
  decrement(key: string, by?: number): Promise<number>
}

interface Entry {
  value: unknown
  expiresAt?: number
}

function expired(entry: Entry, now: number): boolean {
  return entry.expiresAt !== undefined && now >= entry.expiresAt
}

/** In-memory store (per-process). Great for tests and single-instance apps. */
export class MemoryStore implements CacheStore {
  private readonly entries = new Map<string, Entry>()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key)
    if (!entry)
      return undefined
    if (expired(entry, Date.now())) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value as T
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: seconds !== undefined ? Date.now() + seconds * 1000 : undefined,
    })
  }

  async forget(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async flush(): Promise<void> {
    this.entries.clear()
  }

  async increment(key: string, by = 1): Promise<number> {
    const entry = this.entries.get(key)
    const current = entry && !expired(entry, Date.now()) ? Number(entry.value) : 0
    const next = current + by
    this.entries.set(key, { value: next, expiresAt: entry?.expiresAt })
    return next
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.increment(key, -by)
  }
}

/**
 * File store — each key is a JSON file under `dir` (keyed by an md5 of the
 * key). `increment()`'s read-then-write is safe within one process (no
 * `await` sits between the read and the write, so nothing else in this
 * process's event loop can interleave) — but NOT safe if multiple separate
 * OS processes point at the same directory (e.g. an NFS-mounted `dir` shared
 * across instances): each process's own read-then-write can race the others'.
 * That's an unusual setup (sharing a filesystem cache directory across
 * instances is itself uncommon), and matches Laravel's own file cache driver,
 * which has the identical limitation. For real cross-process atomic
 * increments, use `RedisStore` or `DatabaseStore` with an adapter that
 * implements `increment` via a native atomic `UPDATE`.
 */
export class FileStore implements CacheStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private path(key: string): string {
    return join(this.dir, `${createHash('md5').update(key).digest('hex')}.json`)
  }

  private read(key: string): Entry | undefined {
    const file = this.path(key)
    if (!existsSync(file))
      return undefined
    try {
      const entry = JSON.parse(readFileSync(file, 'utf8')) as Entry
      if (expired(entry, Date.now())) {
        unlinkSync(file)
        return undefined
      }
      return entry
    }
    catch {
      return undefined
    }
  }

  private write(key: string, entry: Entry): void {
    writeFileSync(this.path(key), JSON.stringify(entry))
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.read(key)?.value as T | undefined
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    this.write(key, {
      value,
      expiresAt: seconds !== undefined ? Date.now() + seconds * 1000 : undefined,
    })
  }

  async forget(key: string): Promise<void> {
    const file = this.path(key)
    if (existsSync(file))
      unlinkSync(file)
  }

  async flush(): Promise<void> {
    rmSync(this.dir, { recursive: true, force: true })
    mkdirSync(this.dir, { recursive: true })
  }

  async increment(key: string, by = 1): Promise<number> {
    const entry = this.read(key)
    const next = (entry ? Number(entry.value) : 0) + by
    this.write(key, { value: next, expiresAt: entry?.expiresAt })
    return next
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.increment(key, -by)
  }
}

/**
 * DB-backed cache. The `cache` package stays DB-agnostic: the app injects an
 * adapter (wired to `@elyvel/database`) via {@link configureDatabaseCache}.
 * `expiresAt` is epoch-ms or null (forever).
 */
export interface CacheDbAdapter {
  read(key: string): Promise<{ value: string, expiresAt: number | null } | undefined>
  write(key: string, value: string, expiresAt: number | null): Promise<void>
  forget(key: string): Promise<void>
  flush(): Promise<void>
  /**
   * Atomically add `by` to the numeric value stored at `key` (creating it
   * at `by` if absent) and return the new value — e.g. a single
   * `INSERT ... ON CONFLICT DO UPDATE SET value = value + ?` / `UPDATE ...
   * SET value = value + ?` statement. Optional: without it, `DatabaseStore`
   * falls back to a plain read-then-write, which races under concurrent
   * increments from multiple processes sharing the same table.
   */
  increment?(key: string, by: number): Promise<number>
}

let dbAdapter: CacheDbAdapter | null = null
/** Wire the DB adapter used by the `database` cache store (call once at boot). */
export function configureDatabaseCache(adapter: CacheDbAdapter): void {
  dbAdapter = adapter
}
function requireAdapter(): CacheDbAdapter {
  if (!dbAdapter) {
    throw new Error(
      '[elyvel] database cache store needs configureDatabaseCache(...) at boot.',
    )
  }
  return dbAdapter
}

export class DatabaseStore implements CacheStore {
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await requireAdapter().read(key)
    if (!row)
      return undefined
    if (row.expiresAt !== null && Date.now() >= row.expiresAt) {
      await requireAdapter().forget(key)
      return undefined
    }
    return JSON.parse(row.value) as T
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    await requireAdapter().write(
      key,
      JSON.stringify(value),
      seconds !== undefined ? Date.now() + seconds * 1000 : null,
    )
  }

  async forget(key: string): Promise<void> {
    await requireAdapter().forget(key)
  }

  async flush(): Promise<void> {
    await requireAdapter().flush()
  }

  /** Uses the adapter's atomic `increment` when available; otherwise a non-atomic read-then-write. */
  async increment(key: string, by = 1): Promise<number> {
    const adapter = requireAdapter()
    if (adapter.increment)
      return adapter.increment(key, by)
    const current = Number((await this.get<number>(key)) ?? 0)
    const next = current + by
    await this.put(key, next)
    return next
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.increment(key, -by)
  }
}

/** Minimal Redis client (Bun's built-in `RedisClient` satisfies this via `send`). */
export interface RedisLike {
  send(command: string, args: string[]): Promise<unknown>
}

/** Redis-backed cache. Uses Bun's built-in Redis client (no external dep). */
export class RedisStore implements CacheStore {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = 'cache:',
  ) {}

  private k(key: string): string {
    return this.prefix + key
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = (await this.client.send('GET', [this.k(key)])) as string | null
    return raw === null || raw === undefined ? undefined : (JSON.parse(raw) as T)
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    const args = [this.k(key), JSON.stringify(value)]
    if (seconds !== undefined)
      args.push('EX', String(Math.max(1, Math.ceil(seconds))))
    await this.client.send('SET', args)
  }

  async forget(key: string): Promise<void> {
    await this.client.send('DEL', [this.k(key)])
  }

  async flush(): Promise<void> {
    await this.client.send('FLUSHDB', [])
  }

  async increment(key: string, by = 1): Promise<number> {
    return Number(await this.client.send('INCRBY', [this.k(key), String(by)]))
  }

  async decrement(key: string, by = 1): Promise<number> {
    return Number(await this.client.send('DECRBY', [this.k(key), String(by)]))
  }
}
