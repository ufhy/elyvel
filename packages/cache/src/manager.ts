import type { CacheConfig, CacheStoreConfig } from './config-schema'
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

  private build(name: string): Repository {
    const cfg: CacheStoreConfig | undefined
      = this.config.stores?.[name] ?? (name === 'memory' ? { driver: 'memory' } : undefined)
    if (!cfg) {
      throw new Error(`[elysia-ravel] Cache store "${name}" is not defined in config/cache.ts.`)
    }
    if (cfg.driver === 'file') {
      return new Repository(new FileStore(cfg.path ?? 'storage/framework/cache'))
    }
    if (cfg.driver === 'database') {
      return new Repository(new DatabaseStore())
    }
    if (cfg.driver === 'redis') {
      const client = cfg.url ? new RedisClient(cfg.url) : new RedisClient()
      return new Repository(new RedisStore(client, cfg.prefix ?? 'cache:'))
    }
    return new Repository(new MemoryStore())
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
