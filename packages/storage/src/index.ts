import { StorageServiceProvider } from './provider'

export {
  defineStorageConfig,
  type DiskConfig,
  type LocalDiskConfig,
  type LocalPermissions,
  type S3DiskConfig,
  type ScopedDiskConfig,
  type StorageConfig,
  type Visibility,
} from './config-schema'
export {
  type Contents,
  type FilesystemDisk,
  LocalDisk,
  PathEscapeError,
  S3Disk,
  ScopedDisk,
  type Storable,
  type TemporaryUrlOptions,
} from './disk'
export { fakeStorage, FilesystemManager, setDefaultStorage, storage } from './manager'
export { StorageServiceProvider, StorageToken } from './provider'

/** Read by `elyvel package:discover` — see packages/core's discovery loader. */
export const elyvelProviders = [StorageServiceProvider]
