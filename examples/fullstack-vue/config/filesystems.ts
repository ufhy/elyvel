import { defineStorageConfig } from '@elyvel/storage'

/**
 * File storage. `local` writes under `storage/app` by default — add an `s3`
 * disk (or an S3-compatible service like R2/Spaces/MinIO) for cloud storage.
 *
 * `visibility: 'public'` because this app's only upload (a post's cover
 * image) is meant to be seen by every reader — served via the `staticFiles`
 * mount at `/storage` in `config/middleware.ts`.
 */
export default defineStorageConfig({
  default: process.env.FILESYSTEM_DISK ?? 'local',
  disks: {
    local: { driver: 'local', root: 'storage/app', url: '/storage', visibility: 'public' },
    // s3: {
    //   driver: 's3',
    //   bucket: process.env.AWS_BUCKET!,
    //   region: process.env.AWS_DEFAULT_REGION,
    //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    // },
  },
})
