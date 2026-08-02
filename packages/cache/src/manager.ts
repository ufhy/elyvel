import type { CacheConfig, CacheStoreConfig } from './config-schema'
import type { CacheStore } from './store'
import { DriverRegistry } from '@elyvel/support'
import { RedisClient } from 'bun'
import { Repository } from './repository'
import { DatabaseStore, FileStore, MemoryStore, RedisStore } from './store'

/** Resolves named cache stores into {@link Repository} instances, à la Laravel's CacheManager. */
export class CacheManager {
  private readonly repositories = new Map<string, Repository>()
  private readonly defaultStore: string

  constructor(private readonly config: CacheConfig = {}) {
    this.defaultStore = config.default ?? 'memory'
  }

  /** Get a store repository by name (or the default). */
  store(name?: string): Repository {
    const key = name ?? this.defaultStore
    let repo = this.repositories.get(key)
    if (!repo) {
      repo = this.build(key)
      this.repositories.set(key, repo)
    }
    return repo
  }

  /** Built-ins go through the same door `extend()` uses. */
  private readonly stores = new DriverRegistry<CacheStore, CacheStoreConfig>(
    'Cache driver',
    'Register it with `CacheManager.extend(name, factory)` from a provider.',
  )
    .register('memory', () => new MemoryStore())
    .register('database', () => new DatabaseStore())
    .register('file', (cfg: CacheStoreConfig) => new FileStore(
      (cfg as { path?: string }).path ?? 'storage/framework/cache',
    ))
    .register('redis', (cfg: CacheStoreConfig) => {
      const url = (cfg as { url?: string }).url
      return new RedisStore(url ? new RedisClient(url) : new RedisClient(), (cfg as { prefix?: string }).prefix ?? 'cache:')
    })

  private build(name: string): Repository {
    const cfg: CacheStoreConfig | undefined
      = this.config.stores?.[name] ?? (name === 'memory' ? { driver: 'memory' } : undefined)
    if (!cfg) {
      throw new Error(`[elyvel] Cache store "${name}" is not defined in config/cache.ts.`)
    }
    return new Repository(this.stores.resolve(cfg.driver ?? 'memory', cfg))
  }

  /**
   * Register a cache backend the framework doesn't ship — Laravel's
   * `Cache::extend()`. Memcached, DynamoDB, a shared in-cluster store: the
   * `CacheStore` interface was public, the list of usable names was not.
   */
  extend(name: string, factory: (config: CacheStoreConfig, name: string) => CacheStore): this {
    this.stores.extend(name, factory)
    this.repositories.delete(name)
    return this
  }

  /** Every store driver this manager can build. */
  availableDrivers(): string[] {
    return this.stores.names()
  }
}

// ── process-wide default (set by the CacheServiceProvider at boot) ──────────
let defaultManager: CacheManager | null = null

export function setDefaultCache(manager: CacheManager): void {
  defaultManager = manager
}

/** The default cache repository (or a named store). Falls back to an in-memory store. */
export function cache(store?: string): Repository {
  if (!defaultManager)
    defaultManager = new CacheManager()
  return defaultManager.store(store)
}
