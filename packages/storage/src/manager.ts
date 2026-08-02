import type { DiskConfig, LocalDiskConfig, S3DiskConfig, StorageConfig } from './config-schema'
import type { FilesystemDisk } from './disk'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DriverRegistry } from '@elyvel/support'
import { LocalDisk, S3Disk, ScopedDisk } from './disk'

/** Resolves named disks into {@link FilesystemDisk} instances, à la Laravel's FilesystemManager. */
export class FilesystemManager {
  private readonly disks = new Map<string, FilesystemDisk>()
  private readonly defaultDisk: string

  constructor(private readonly config: StorageConfig = {}) {
    this.defaultDisk = config.default ?? 'local'
  }

  /** Get a disk by name (or the default). */
  disk(name?: string): FilesystemDisk {
    const key = name ?? this.defaultDisk
    let disk = this.disks.get(key)
    if (!disk) {
      const cfg = this.config.disks?.[key]
      if (!cfg)
        throw new Error(`[elyvel] Disk "${key}" is not defined in config/filesystems.ts.`)
      disk = this.resolve(cfg)
      this.disks.set(key, disk)
    }
    return disk
  }

  /** Built-ins go through the same door `extend()` uses. */
  private readonly drivers = new DriverRegistry<FilesystemDisk, DiskConfig>(
    'Storage disk driver',
    'Register it with `FilesystemManager.extend(name, factory)` from a provider.',
  )
    .register('local', (cfg: DiskConfig) => new LocalDisk(cfg as LocalDiskConfig & { root: string }))
    .register('s3', (cfg: DiskConfig) => new S3Disk(cfg as S3DiskConfig))
    .register('scoped', (cfg: DiskConfig) => {
      const scoped = cfg as { disk: string, prefix: string }
      return new ScopedDisk(this.disk(scoped.disk), scoped.prefix)
    })

  /** Build a disk on-demand from an inline config (Laravel's `Storage::build`). */
  build(config: DiskConfig): FilesystemDisk {
    return this.resolve(config)
  }

  /**
   * Register a disk driver the framework doesn't ship — Laravel's
   * `Storage::extend()`. Any S3-compatible service with its own SDK, an FTP or
   * WebDAV disk, an in-house blob store: `FilesystemDisk` was always public, but
   * only three names could ever be configured.
   */
  extend(name: string, factory: (config: DiskConfig, name: string) => FilesystemDisk): this {
    this.drivers.extend(name, factory)
    this.disks.clear()
    return this
  }

  /** Every disk driver this manager can build. */
  availableDrivers(): string[] {
    return this.drivers.names()
  }

  private resolve(config: DiskConfig): FilesystemDisk {
    return this.drivers.resolve(config.driver ?? 'local', config)
  }
}

// ── process-wide default (set by the StorageServiceProvider at boot) ─────────
let defaultManager: FilesystemManager | null = null

export function setDefaultStorage(manager: FilesystemManager): void {
  defaultManager = manager
}

/** The default disk (or a named disk). */
export function storage(disk?: string): FilesystemDisk {
  if (!defaultManager)
    throw new Error('[elyvel] Storage is not configured. Register StorageServiceProvider.')
  return defaultManager.disk(disk)
}

/**
 * Swap the default disk (and, when a name is given, that named disk) for a
 * throwaway local disk under the OS temp dir — Laravel's `Storage::fake`.
 * Returns the fake disk. Call it in tests before exercising uploads.
 */
export function fakeStorage(name = 'local'): FilesystemDisk {
  const root = join(tmpdir(), `elyvel-storage-${crypto.randomUUID()}`)
  const disk = new LocalDisk({ driver: 'local', root, url: '/storage', visibility: 'public' })
  const manager = new FilesystemManager({ default: name })
  // Seed the cache so `disk(name)` and the default both return the fake.
  ;(manager as unknown as { disks: Map<string, FilesystemDisk> }).disks.set(name, disk)
  setDefaultStorage(manager)
  return disk
}
