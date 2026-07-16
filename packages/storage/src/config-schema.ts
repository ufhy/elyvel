/** File visibility — an abstraction over local permissions / S3 ACLs. */
export type Visibility = 'public' | 'private'

/** Permission mappings for the `local` driver (mirrors Laravel's `permissions` block). */
export interface LocalPermissions {
  file?: { public?: number, private?: number }
  dir?: { public?: number, private?: number }
}

export interface LocalDiskConfig {
  driver: 'local'
  /** Root directory, relative to the app root (e.g. `storage/app`). */
  root: string
  /** Base URL prepended by `url()` (default `/storage`). */
  url?: string
  /** Default visibility for written files. Default `private`. */
  visibility?: Visibility
  /** Throw on failed writes instead of returning false. Default `false`. */
  throw?: boolean
  /** Permission mappings for public/private files and directories. */
  permissions?: LocalPermissions
}

export interface S3DiskConfig {
  driver: 's3'
  bucket: string
  region?: string
  /** Custom endpoint for S3-compatible services (R2, Spaces, MinIO…). */
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  /** Use path-style URLs (`endpoint/bucket/key`) — required by most non-AWS services. */
  usePathStyleEndpoint?: boolean
  /** Base URL prepended by `url()` (else derived from endpoint/bucket). */
  url?: string
  visibility?: Visibility
  throw?: boolean
}

/** A path-prefixed view over another configured disk (Laravel's `scoped` driver). */
export interface ScopedDiskConfig {
  driver: 'scoped'
  /** Name of the disk to wrap. */
  disk: string
  /** Path prefix applied to every operation. */
  prefix: string
}

export type DiskConfig = LocalDiskConfig | S3DiskConfig | ScopedDiskConfig

/** Shape of `config/filesystems.ts`. Author it with {@link defineStorageConfig}. */
export interface StorageConfig {
  /** Default disk name. Default `local`. */
  default?: string
  /** Named disks. */
  disks?: Record<string, DiskConfig>
}

export function defineStorageConfig(config: StorageConfig): StorageConfig {
  return config
}
