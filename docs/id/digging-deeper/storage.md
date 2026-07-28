# File Storage

Satu API yang tidak terikat disk tertentu untuk membaca dan menulis file —
disk lokal saat dev, S3 (atau layanan kompatibel S3 mana pun — R2, Spaces,
MinIO) di production, ditukar cukup lewat config.

## Konfigurasi

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

Dua driver sungguhan: `local` (file di bawah `root` relatif terhadap
aplikasi) dan `s3` (API kompatibel S3 mana pun lewat `S3Client` native
Bun — tanpa dependency `aws-sdk`). Satu lagi, `scoped`, membungkus disk
bernama lain dengan prefix path — tampilan terbatas atas disk yang sudah
kamu definisikan, tanpa menduplikasi kredensialnya.

## Membaca & menulis

```ts
import { storage } from '@elyvel/storage'

await storage().put('greeting.txt', 'hello')
await storage().get('greeting.txt')       // 'hello'
await storage().getBytes('avatar.png')    // Uint8Array
await storage().json('config.json')       // JSON yang sudah di-parse

await storage().exists('greeting.txt')
await storage().missing('greeting.txt')

storage().url('avatar.png')                       // URL publik
await storage().temporaryUrl('report.pdf', 3600)   // presigned, khusus S3 — lihat di bawah

await storage().size('avatar.png')
await storage().lastModified('avatar.png')  // unix seconds
await storage().mimeType('avatar.png')

storage('s3').get('backups/latest.tar.gz') // disk bernama tertentu, bukan yang default
```

## File yang diupload

```ts
route().post('/posts', async ({ body }) => {
  const path = await storage().putFile('covers', body.cover) // nama acak, ekstensi tetap
  await storage().putFileAs('covers', body.cover, 'custom-name.jpg') // nama eksplisit
  return Post.create({ cover_image: path })
})
```

Operasi lain: `prepend(path, data)`/`append(path, data)` (`append` di
local adalah penulisan `O_APPEND` yang benar-benar atomik; `prepend` di
kedua driver adalah read-then-write dan bisa race di bawah penulis
konkuren), `copy(from, to)`, `move(from, to)`, `delete(paths)` (menerima
satu path atau array).

## Direktori

```ts
await storage().files('covers')          // satu level
await storage().allFiles('covers')       // rekursif
await storage().directories('covers')
await storage().allDirectories('covers')

await storage().makeDirectory('covers/2026')
await storage().deleteDirectory('covers/2026') // hapus rekursif
```

Di S3 tidak ada konsep direktori sungguhan — `makeDirectory` menulis key
nol-byte yang berakhiran `/`, dan listing direktori diturunkan dari
prefix key — tapi API-nya terbaca identik dengan driver local baik dari
sisi mana pun.

## Visibility

```ts
await storage().put('secret.txt', 'shh', 'private')
await storage().getVisibility('secret.txt')      // 'private'
await storage().setVisibility('secret.txt', 'public')
```

Di `local`, visibility dipetakan ke permission file unix sungguhan (bisa
dikonfigurasi per-disk lewat tabel `permissions`). Di `s3`, visibility
hanya mempengaruhi ACL kalengan yang diterapkan **saat penulisan** (
`public-read` vs `private`) — `getVisibility`/`setVisibility` tidak
membaca atau menulis ulang ACL object yang sudah ada, mereka hanya
mencerminkan default yang dikonfigurasi disk-nya.

## S3 & presigned URL

```ts
await storage().temporaryUrl('invoices/123.pdf', 3600)          // presigned GET, 1 jam
await storage().temporaryUploadUrl('uploads/new.png', 3600)      // presigned PUT
```

Presigned URL memungkinkan client mengupload atau mengunduh langsung
ke/dari S3 tanpa mem-proxy byte-nya lewat server aplikasimu. `endpoint` +
`usePathStyleEndpoint: true` mengarahkan driver yang sama ke layanan
kompatibel S3 mana pun selain AWS — R2, Spaces, atau MinIO lokal untuk
dev/CI.

::: warning Driver local tidak punya presigned URL
`temporaryUrl`/`temporaryUploadUrl` throw di driver `local` — tidak ada
mekanisme signed-request untuk file disk biasa. Pakai `s3`, atau layani
file lewat route signed-mu sendiri jika kamu butuh ini secara lokal.
:::

## Testing

```ts
import { fakeStorage } from '@elyvel/storage'

beforeEach(() => {
  fakeStorage() // menukar disk default dengan disk temp-dir yang terisolasi
})

test('mengupload cover image', async () => {
  await storage().put('covers/test.jpg', imageBytes)
  expect(await storage().exists('covers/test.jpg')).toBe(true)
})
```

Setiap pemanggilan mendapat direktori throwaway-nya sendiri di bawah temp
dir OS, jadi test tidak pernah menyentuh `storage/app` sungguhan atau
bucket S3 sungguhan.

## Belum didukung

Hanya driver `local` dan `s3` yang ada — tidak ada SFTP, FTP, atau
Dropbox. Juga tidak ada flag read-only disk. Keduanya perlu diketahui
sebelum kamu mencoba memakainya.
