import type { Token } from '@elyvel/core'
import type { CacheConfig } from './config-schema'
import { ServiceProvider, token } from '@elyvel/core'
import { CacheManager, setDefaultCache } from './manager'

export const CacheToken: Token<CacheManager> = token<CacheManager>('cache')

/**
 * Boots the cache from `config/cache.ts`, binds the {@link CacheManager} to
 * {@link CacheToken}, and sets it as the default used by the `cache()` helper.
 * File-store paths are resolved relative to the app root.
 */
export class CacheServiceProvider extends ServiceProvider {
  override register(): void {
    const config = this.app.config.get<CacheConfig>('cache', {})
    const stores: NonNullable<CacheConfig['stores']> = {}
    for (const [name, store] of Object.entries(config.stores ?? {})) {
      stores[name]
        = store.driver === 'file'
          ? { ...store, path: this.app.path(store.path ?? 'storage/framework/cache') }
          : store
    }
    const manager = new CacheManager({ ...config, stores })
    setDefaultCache(manager)
    this.app.container.instance(CacheToken, manager)
  }
}
