import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiskConfig, LocalDiskConfig, S3DiskConfig, StorageConfig } from './config-schema'
import { type FilesystemDisk, LocalDisk, S3Disk, ScopedDisk } from './disk'

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
      if (!cfg) throw new Error(`[elysia-ravel] Disk "${key}" is not defined in config/filesystems.ts.`)
      disk = this.resolve(cfg)
      this.disks.set(key, disk)
    }
    return disk
  }

  /** Build a disk on-demand from an inline config (Laravel's `Storage::build`). */
  build(config: DiskConfig): FilesystemDisk {
    return this.resolve(config)
  }

  private resolve(config: DiskConfig): FilesystemDisk {
    if (config.driver === 's3') return new S3Disk(config as S3DiskConfig)
    if (config.driver === 'scoped') return new ScopedDisk(this.disk(config.disk), config.prefix)
    return new LocalDisk(config as LocalDiskConfig & { root: string })
  }
}

// ── process-wide default (set by the StorageServiceProvider at boot) ─────────
let defaultManager: FilesystemManager | null = null

export function setDefaultStorage(manager: FilesystemManager): void {
  defaultManager = manager
}

/** The default disk (or a named disk). */
export function storage(disk?: string): FilesystemDisk {
  if (!defaultManager) throw new Error('[elysia-ravel] Storage is not configured. Register StorageServiceProvider.')
  return defaultManager.disk(disk)
}

/**
 * Swap the default disk (and, when a name is given, that named disk) for a
 * throwaway local disk under the OS temp dir — Laravel's `Storage::fake`.
 * Returns the fake disk. Call it in tests before exercising uploads.
 */
export function fakeStorage(name = 'local'): FilesystemDisk {
  const root = join(tmpdir(), `ravel-storage-${crypto.randomUUID()}`)
  const disk = new LocalDisk({ driver: 'local', root, url: '/storage', visibility: 'public' })
  const manager = new FilesystemManager({ default: name })
  // Seed the cache so `disk(name)` and the default both return the fake.
  ;(manager as unknown as { disks: Map<string, FilesystemDisk> }).disks.set(name, disk)
  setDefaultStorage(manager)
  return disk
}
