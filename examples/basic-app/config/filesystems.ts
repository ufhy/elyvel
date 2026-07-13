import { defineStorageConfig } from '@elysia-ravel/storage'

/**
 * Filesystem disks. `local` is private (storage/app); `public` is web-served
 * (storage/app/public → /storage); `s3` targets any S3-compatible service.
 * Use via the `storage()` helper: `await storage().put('path', contents)`.
 */
export default defineStorageConfig({
  default: process.env.FILESYSTEM_DISK ?? 'local',
  disks: {
    local: { driver: 'local', root: 'storage/app', visibility: 'private' },
    public: { driver: 'local', root: 'storage/app/public', url: '/storage', visibility: 'public' },
    s3: {
      driver: 's3',
      bucket: process.env.AWS_BUCKET ?? '',
      region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      usePathStyleEndpoint: process.env.AWS_USE_PATH_STYLE_ENDPOINT === 'true',
    },
  },
})
