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
  /**
   * Store only if the key is absent, in ONE indivisible step, returning
   * whether this caller was the one that stored it.
   *
   * `Repository.add()` is the once-only guard people reach for (send this
   * email once, dispatch this job once), and composing it from
   * `get()`-then-`put()` leaves an `await` between the check and the write —
   * so concurrent callers all saw an absent key and all returned `true`.
   * Implement it wherever the backend can do it in one operation (`SET NX`,
   * `INSERT … ON CONFLICT DO NOTHING`, or just synchronously for an
   * in-process store); otherwise the racy fallback is used.
   */
  add?(key: string, value: unknown, seconds?: number): Promise<boolean>
  /**
   * Read and delete in one indivisible step (Redis `GETDEL`). Same reasoning
   * as {@link add}: `pull()` is used for single-use values, and a
   * `get()`-then-`forget()` pair can hand the same value to two callers.
   */
  pull?<T = unknown>(key: string): Promise<T | undefined>
  /**
   * Delete `key` only if its stored value still equals `expected`, in ONE
   * indivisible step. Returns whether this caller was the one that deleted it.
   *
   * This is what makes {@link Repository.lock} safe. A lock holder whose TTL has
   * already lapsed must NOT delete the key — by then a peer may legitimately hold
   * it, and an unconditional delete would hand the same lock to a third caller
   * while the peer still believed it was theirs. (That exact bug existed in the
   * scheduler's own mutex.) Comparing the owner token and deleting in one step is
   * the only way to get that right; a `get()`-then-`forget()` pair reopens the
   * race it is meant to close.
   *
   * A store that implements this AND {@link add} can back locks; one that doesn't
   * says so rather than handing out a lock that can't be released safely.
   */
  forgetIf?(key: string, expected: unknown): Promise<boolean>
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
    const alive = entry !== undefined && !expired(entry, Date.now())
    const current = alive ? Number(entry.value) : 0
    const next = current + by
    // Carry the window forward only while the entry is still alive. Reusing an
    // ALREADY-PAST `expiresAt` wrote a value that was expired on arrival, so a
    // counter reset to 0 by expiry could never climb past 1 again — every
    // subsequent increment re-read 0 and re-stored a dead entry. A counter that
    // silently stops counting is worse than one that resets.
    this.entries.set(key, { value: next, expiresAt: alive ? entry.expiresAt : undefined })
    return next
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.increment(key, -by)
  }

  /** Atomic by construction: no `await` between the check and the set. */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    const entry = this.entries.get(key)
    if (entry !== undefined && !expired(entry, Date.now()))
      return false
    this.entries.set(key, {
      value,
      expiresAt: seconds !== undefined ? Date.now() + seconds * 1000 : undefined,
    })
    return true
  }

  /** Atomic by construction — compare and delete in one synchronous step. */
  async forgetIf(key: string, expected: unknown): Promise<boolean> {
    const entry = this.entries.get(key)
    if (entry === undefined || expired(entry, Date.now()))
      return false
    if (!Object.is(entry.value, expected) && JSON.stringify(entry.value) !== JSON.stringify(expected))
      return false
    this.entries.delete(key)
    return true
  }

  /** Atomic by construction: the read and delete happen in one synchronous step. */
  async pull<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key)
    this.entries.delete(key)
    if (entry === undefined || expired(entry, Date.now()))
      return undefined
    return entry.value as T
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
    // 0700/0600 rather than the default 0755/0644 — a cache entry routinely holds
    // whatever the app decided was expensive to recompute, which is often a user
    // record or a token, and the defaults left all of it world-readable.
    mkdirSync(dir, { recursive: true, mode: 0o700 })
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
    writeFileSync(this.path(key), JSON.stringify(entry), { mode: 0o600 })
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
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
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

  /** Single-process atomic, with the same cross-process caveat as `increment` (see the class doc). */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    if (this.read(key) !== undefined)
      return false
    this.write(key, {
      value,
      expiresAt: seconds !== undefined ? Date.now() + seconds * 1000 : undefined,
    })
    return true
  }

  /** Single-process atomic, same caveat as `add`. */
  async forgetIf(key: string, expected: unknown): Promise<boolean> {
    const current = this.read(key)
    if (current === undefined || JSON.stringify(current) !== JSON.stringify(expected))
      return false
    await this.forget(key)
    return true
  }

  /** Single-process atomic, same caveat as `add`. */
  async pull<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.read(key)
    const file = this.path(key)
    if (existsSync(file))
      unlinkSync(file)
    return entry?.value as T | undefined
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
   * Delete `key` only if its stored value is still exactly `value`, in ONE
   * statement, returning whether this call deleted it:
   *
   * ```sql
   * DELETE FROM cache WHERE key = ? AND value = ?
   * ```
   *
   * Optional, but required for `Cache.lock()` to be safe across processes:
   * without it `DatabaseStore` falls back to read-then-delete, which can release
   * a lock a peer has since acquired.
   */
  forgetIf?(key: string, value: string): Promise<boolean>
  /**
   * Atomically add `by` to the numeric value stored at `key` (creating it
   * at `by` if absent) and return the new value — e.g. a single
   * `INSERT ... ON CONFLICT DO UPDATE SET value = value + ?` / `UPDATE ...
   * SET value = value + ?` statement. Optional: without it, `DatabaseStore`
   * falls back to a plain read-then-write, which races under concurrent
   * increments from multiple processes sharing the same table.
   *
   * **An expired row MUST count as absent** — reset it to `by` rather than
   * adding to the stale value, and clear its `expires_at`. `DatabaseStore`
   * cannot enforce this for you: it delegates in one call precisely so the
   * whole operation stays atomic, and re-reading the row here first would
   * cost the round-trip that makes this worth having. A naive
   * `SET value = value + ?` keeps accumulating on top of a value the rest of
   * the store already treats as gone, so a quota counter never resets. One
   * statement can do both:
   *
   * ```sql
   * INSERT INTO cache (key, value, expires_at) VALUES (?, ?, NULL)
   * ON CONFLICT (key) DO UPDATE SET
   *   value = CASE
   *     WHEN cache.expires_at IS NOT NULL AND cache.expires_at <= ? THEN excluded.value
   *     ELSE cache.value + excluded.value
   *   END,
   *   expires_at = CASE
   *     WHEN cache.expires_at IS NOT NULL AND cache.expires_at <= ? THEN NULL
   *     ELSE cache.expires_at
   *   END
   * RETURNING value
   * ```
   */
  increment?(key: string, by: number): Promise<number>
  /**
   * Store only if absent, in one statement, returning whether this call
   * stored it — e.g. `INSERT INTO cache (key, value, expires_at) VALUES
   * (?, ?, ?) ON CONFLICT (key) DO NOTHING` and reporting the affected row
   * count. **An expired row must count as absent**, so a DO NOTHING alone
   * isn't enough if stale rows can linger; either sweep them or use
   * `DO UPDATE ... WHERE cache.expires_at IS NOT NULL AND cache.expires_at <= ?`.
   * Without this, `add()` degrades to a racy read-then-write.
   */
  add?(key: string, value: string, expiresAt: number | null): Promise<boolean>
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
    // Read the raw row rather than going through `get()`, so the expiry is
    // visible: this used to `put(key, next)` with no `seconds`, which wrote
    // `expiresAt: null` and so DISCARDED the window of a still-live key —
    // turning a TTL'd counter immortal on its first increment, unlike every
    // other store. Alive keeps its window; expired or absent starts fresh
    // (no expiry), matching MemoryStore/FileStore/Redis `INCRBY`.
    const row = await adapter.read(key)
    const alive = row !== undefined && (row.expiresAt === null || Date.now() < row.expiresAt)
    const current = alive ? Number(JSON.parse(row.value)) : 0
    const next = current + by
    await adapter.write(key, JSON.stringify(next), alive ? row.expiresAt : null)
    return next
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.increment(key, -by)
  }

  /**
   * Atomic only when the adapter implements `add`. Without it this is the same
   * racy read-then-write `Repository` would have done anyway, so nothing is
   * lost — but it also isn't a guarantee. See the `CacheDbAdapter.add` doc.
   */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    const adapter = requireAdapter()
    const expiresAt = seconds !== undefined ? Date.now() + seconds * 1000 : null
    if (adapter.add)
      return adapter.add(key, JSON.stringify(value), expiresAt)
    if ((await this.get(key)) !== undefined)
      return false
    await adapter.write(key, JSON.stringify(value), expiresAt)
    return true
  }

  async forgetIf(key: string, expected: unknown): Promise<boolean> {
    const adapter = requireAdapter()
    if (adapter.forgetIf)
      return adapter.forgetIf(key, JSON.stringify(expected))
    // Without the adapter primitive this is a read-then-delete across an await —
    // fine on a single instance, racy across several sharing the table. Wire
    // `forgetIf` on the adapter for a lock that is safe cross-process.
    const current = await this.get(key)
    if (current === undefined || JSON.stringify(current) !== JSON.stringify(expected))
      return false
    await adapter.forget(key)
    return true
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
    // A zero/negative TTL means "already expired" — the memory/file stores make
    // the value immediately unreadable, so match that here rather than flooring
    // to a 1-second EX (which would keep it alive for a second). Redis has no
    // "expired on write", so just don't store it (and clear any prior value).
    if (seconds !== undefined && seconds <= 0) {
      await this.forget(key)
      return
    }
    const args = [this.k(key), JSON.stringify(value)]
    if (seconds !== undefined)
      args.push('EX', String(Math.max(1, Math.ceil(seconds))))
    await this.client.send('SET', args)
  }

  async forget(key: string): Promise<void> {
    await this.client.send('DEL', [this.k(key)])
  }

  /**
   * Delete only THIS store's keys. `FLUSHDB` would wipe the entire Redis
   * database — and the `prefix` option exists precisely because that database
   * is normally shared with sessions, throttle counters and the queue, so
   * `cache().flush()` used to destroy all of those too. Scans instead of
   * `KEYS` so a large keyspace doesn't block the server.
   */
  async flush(): Promise<void> {
    let cursor = '0'
    do {
      const reply = (await this.client.send('SCAN', [
        cursor,
        'MATCH',
        `${this.prefix}*`,
        'COUNT',
        '500',
      ])) as [string, string[]] | null
      if (!reply)
        break
      cursor = reply[0]
      const keys = reply[1] ?? []
      if (keys.length > 0)
        await this.client.send('DEL', keys)
    } while (cursor !== '0')
  }

  async increment(key: string, by = 1): Promise<number> {
    return Number(await this.client.send('INCRBY', [this.k(key), String(by)]))
  }

  /** `SET key value NX [EX s]` — genuinely atomic, and across processes too. */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    // A zero/negative TTL means "already expired"; mirror `put`'s handling
    // rather than storing something unreadable and reporting success.
    if (seconds !== undefined && seconds <= 0)
      return false
    const args = [this.k(key), JSON.stringify(value), 'NX']
    if (seconds !== undefined)
      args.push('EX', String(Math.max(1, Math.ceil(seconds))))
    // Redis replies OK on success and nil when NX prevented the write.
    return (await this.client.send('SET', args)) !== null
  }

  /**
   * Compare-and-delete in ONE round trip via `EVAL`. A `GET` followed by `DEL`
   * would reopen the very race this closes: the key can expire and be re-acquired
   * by a peer between the two commands, and we'd delete THEIR lock.
   */
  async forgetIf(key: string, expected: unknown): Promise<boolean> {
    const removed = await this.client.send('EVAL', [
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      '1',
      this.k(key),
      JSON.stringify(expected),
    ])
    return Number(removed) === 1
  }

  /** `GETDEL` — read and delete in one round trip, so no two callers can both consume it. */
  async pull<T = unknown>(key: string): Promise<T | undefined> {
    const raw = (await this.client.send('GETDEL', [this.k(key)])) as string | null
    return raw === null || raw === undefined ? undefined : (JSON.parse(raw) as T)
  }

  async decrement(key: string, by = 1): Promise<number> {
    return Number(await this.client.send('DECRBY', [this.k(key), String(by)]))
  }
}
