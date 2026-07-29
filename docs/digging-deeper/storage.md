# File Storage

A single, disk-agnostic API for reading and writing files — local disk in
dev, S3 (or any S3-compatible service — R2, Spaces, MinIO) in production,
swapped by config alone.

## Configuration

```ts
// config/filesystems.ts
import { defineStorageConfig } from '@elyvel/storage'

export default defineStorageConfig({
  default: process.env.FILESYSTEM_DISK ?? 'local',
  disks: {
    local: { driver: 'local', root: 'storage/app', url: '/storage', visibility: 'public' },
    s3: {
      driver: 's3',
      bucket: process.env.AWS_BUCKET!,
      region: process.env.AWS_DEFAULT_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  },
})
```

Two real drivers: `local` (files under an app-relative `root`) and `s3`
(any S3-compatible API via Bun's native `S3Client` — no `aws-sdk`
dependency). A third, `scoped`, wraps another named disk with a path
prefix — a restricted view over a disk you've already defined, without
duplicating its credentials:

```ts
disks: {
  s3: { driver: 's3', bucket: 'app-uploads', /* ... */ },
  tenantUploads: { driver: 'scoped', disk: 's3', prefix: `tenants/${tenantId}` },
}
```

Every operation on `storage('tenantUploads')` is confined under that
prefix — a path that would escape it (e.g. via `../`) throws
`PathEscapeError` instead of silently reaching a sibling tenant's files.

## Reading & writing

```ts
import { storage } from '@elyvel/storage'

await storage().put('greeting.txt', 'hello')
await storage().get('greeting.txt')       // 'hello'
await storage().getBytes('avatar.png')    // Uint8Array
await storage().json('config.json')       // parsed JSON

await storage().exists('greeting.txt')
await storage().missing('greeting.txt')

storage().url('avatar.png')                       // public URL
await storage().temporaryUrl('report.pdf', 3600)   // presigned, S3 only — see below

await storage().size('avatar.png')
await storage().lastModified('avatar.png')  // unix seconds
await storage().mimeType('avatar.png')

storage('s3').get('backups/latest.tar.gz') // a specific named disk instead of the default
```

## Uploaded files

```ts
route().post('/posts', async ({ body }) => {
  const path = await storage().putFile('covers', body.cover) // random name, extension kept
  await storage().putFileAs('covers', body.cover, 'custom-name.jpg') // explicit name
  if (path === false)
    return status(500, { message: 'Upload failed.' })
  return Post.create({ cover_image: path })
})
```

Both return the stored path, or **`false`** if the write failed — the same
contract as `put()`. On a disk left at the default `throw: false` that's how a
failure arrives, so check it before persisting the path: otherwise the row
ends up pointing at a file that was never written. Set `throw: true` on the
disk if you'd rather have failures raise.

Other operations: `prepend(path, data)`/`append(path, data)` (local's
`append` is a real atomic `O_APPEND` write; `prepend` on either driver is
read-then-write and can race under concurrent writers), `copy(from, to)`,
`move(from, to)`, `delete(paths)` (accepts one path or an array).

::: warning `putFileAs` names, and what `mimeType` actually tells you
`putFileAs`'s `name` must be a plain filename — one containing `/`, `\`, or
`..` is rejected with a `PathEscapeError` rather than silently rewritten.
That matters because `name` is usually the client-supplied upload name, and
it gets joined onto the directory: without the check, `'../../other/x'`
walked out of the target directory (and out of a scoped disk's prefix).
Sanitize or replace the name yourself if you'd rather not surface the error —
or use `putFile`, which generates a random name and ignores the client's.

`mimeType()` is derived from the **file extension**, not sniffed from the
bytes, so `payload.php` renamed to `photo.png` reports `image/png`. Never
use it to decide whether an upload is safe — validate the content instead
with the `image`/`mimes` rules (they read the actual bytes, see
[Validation](/basics/validation#file-image-mimes-dimensions)).
:::

## Directories

```ts
await storage().files('covers')          // one level
await storage().allFiles('covers')       // recursive
await storage().directories('covers')
await storage().allDirectories('covers')

await storage().makeDirectory('covers/2026')
await storage().deleteDirectory('covers/2026') // recursive delete
```

On S3 there's no real directory concept — `makeDirectory` writes a
zero-byte key ending in `/`, and directory listing is derived from key
prefixes — but the API reads identically to the local driver either way.

## Visibility

```ts
await storage().put('secret.txt', 'shh', 'private')
await storage().getVisibility('secret.txt')      // 'private'
await storage().setVisibility('secret.txt', 'public')
```

On `local`, visibility maps to real unix file permissions (configurable
per-disk via a `permissions` table). On `s3`, visibility only affects the
canned ACL applied **at write time** (`public-read` vs `private`) —
`getVisibility`/`setVisibility` don't read or rewrite an existing object's
ACL, they just reflect the disk's configured default.

## S3 & presigned URLs

```ts
await storage().temporaryUrl('invoices/123.pdf', 3600)          // presigned GET, 1 hour
await storage().temporaryUploadUrl('uploads/new.png', 3600)      // presigned PUT
```

Presigned URLs let a client upload or download directly to/from S3 without
proxying the bytes through your app server. `endpoint` +
`usePathStyleEndpoint: true` point the same driver at any S3-compatible
service instead of AWS — R2, Spaces, or a local MinIO for dev/CI.

::: warning Local driver has no presigned URLs
`temporaryUrl`/`temporaryUploadUrl` throw on the `local` driver — there's
no signed-request mechanism for plain disk files. Use `s3`, or serve the
file through your own signed route if you need this locally.
:::

The third `options` argument passes extra S3 params through (e.g.
`ResponseContentDisposition`), but it **cannot** override the HTTP method or
the expiry — those are fixed by whichever function you called. That matters
if you ever forward client-supplied params into it: otherwise a request could
turn a read-only `temporaryUrl` into a `PUT` (an arbitrary object write) or
stretch its own expiry.

Note that `temporaryUploadUrl` signs no `Content-Type` or `Content-Length`
constraint, so whoever holds the URL can upload anything of any size until it
expires. Keep the expiry short, and validate the object after upload rather
than trusting what was sent.

## Testing

```ts
import { fakeStorage } from '@elyvel/storage'

beforeEach(() => {
  fakeStorage() // swaps the default disk for an isolated temp-dir disk
})

test('uploading a cover image', async () => {
  await storage().put('covers/test.jpg', imageBytes)
  expect(await storage().exists('covers/test.jpg')).toBe(true)
})
```

Each call gets its own throwaway directory under the OS temp dir, so tests
never touch real `storage/app` or a real S3 bucket.

## Not supported yet

Only `local` and `s3` drivers exist — no SFTP, FTP, or Dropbox. There's no
read-only disk flag either. Both are worth knowing before reaching for
them.
