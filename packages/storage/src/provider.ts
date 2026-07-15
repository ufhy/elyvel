import { ServiceProvider, type Token, token } from '@elysia-ravel/core'
import type { DiskConfig, StorageConfig } from './config-schema'
import { FilesystemManager, setDefaultStorage } from './manager'

export const StorageToken: Token<FilesystemManager> = token<FilesystemManager>('storage')

/**
 * Boots storage from `config/filesystems.ts`, binds the {@link FilesystemManager}
 * to {@link StorageToken}, and sets it as the default used by the `storage()`
 * helper. Local disk roots are resolved relative to the app root.
 */
export class StorageServiceProvider extends ServiceProvider {
  override register(): void {
    const config = this.app.config.get<StorageConfig>('filesystems', {})
    const disks: Record<string, DiskConfig> = {}
    for (const [name, disk] of Object.entries(config.disks ?? {})) {
      disks[name] =
        disk.driver === 'local'
          ? { ...disk, root: this.app.path(disk.root ?? 'storage/app') }
          : disk
    }
    const manager = new FilesystemManager({ ...config, disks })
    setDefaultStorage(manager)
    this.app.container.instance(StorageToken, manager)
  }
}
