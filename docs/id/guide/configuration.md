# Konfigurasi

Semua konfigurasi aplikasi elyvel berada di direktori `config/` — satu file
per concern, masing-masing sebuah modul TypeScript bertipe. Karena config adalah kode biasa, editor-mu
melakukan autocomplete pada setiap opsi dan salah ketik akan gagal saat type-check.

## Config app

`config/app.ts` adalah entry point. `defineAppConfig` menetapkan tipenya:

```ts
// config/app.ts
import { defineAppConfig } from '@elyvel/core'
import { EloquentServiceProvider } from '@elyvel/database'
import { I18nServiceProvider } from '@elyvel/i18n'
import { AppServiceProvider } from '../app/providers/AppServiceProvider'

export default defineAppConfig({
  name: process.env.APP_NAME ?? 'my-app',
  env: process.env.APP_ENV ?? 'local',
  key: process.env.APP_KEY, // signs cookies; powers `encrypted` casts
  port: Number(process.env.PORT ?? 3000),

  // Tampilkan halaman debug detail untuk 500 yang tidak tertangkap di luar
  // production (default true di sana; selalu mati di production apa pun ini).
  debug: process.env.APP_ENV !== 'production',
  // Timezone untuk *tampilan* tanggal — penyimpanan selalu tetap UTC. Default `UTC`.
  timezone: 'Asia/Makassar',

  // Service providers booted at startup.
  providers: [EloquentServiceProvider, I18nServiceProvider, AppServiceProvider],
})
```

## Environment

Nilai spesifik environment berada di `.env` dan dibaca melalui `process.env`:

```ini
APP_NAME="My App"
APP_ENV=local
APP_KEY=            # set with: bun run key:generate
PORT=3000
DB_CONNECTION=sqlite
```

::: warning APP_KEY wajib ada
`APP_KEY` menandatangani cookie session dan mengenkripsi model cast `encrypted`. Aplikasi
tidak akan boot tanpanya — jalankan `bun run key:generate` setelah instalasi.
:::

## Membaca config saat runtime

Gunakan helper global `config()` (seperti `config()` di Laravel) di mana saja setelah boot —
dot-path dengan fallback opsional:

```ts
import { config } from '@elyvel/core'

config<string>('app.env')                 // 'local'
config<string>('auth.loginPath', '/login') // fallback when unset
```

## File konfigurasi yang tersedia

Setiap starter menyertakan file yang dibutuhkannya; sisanya tersedia untuk ditambahkan seiring
kamu mengadopsi sebuah package.

| File | Mengonfigurasi |
| --- | --- |
| `app.ts` | Nama, environment, halaman debug, timezone, key, port, provider |
| `database.ts` | Koneksi database (Eloquent) |
| `session.ts` | Driver cookie/session |
| `logging.ts` | Channel log & formatting |
| `i18n.ts` | Locale, fallback, path translation |
| `openapi.ts` | Pembuatan OpenAPI / dokumentasi API |
| `cache.ts` | Cache store |
| `queue.ts` | Koneksi queue & worker |
| `mail.ts` | Transport mailer |
| `filesystems.ts` | Storage disk (local / S3) |
| `broadcasting.ts` | Broadcasting WebSocket |
| `auth.ts` | Autentikasi — lihat [Autentikasi](/id/security/authentication) |
| `middleware.ts` | Middleware global, alias, dan group |

`auth.ts`, `middleware.ts`, dan `mail.ts` dikirim bersama starter kit `vue`/`spa`
(yang merangkai Better Auth beserta emailnya); aplikasi backend-only
menambahkannya secara manual saat membutuhkannya.

## Service provider

Array `providers` di `config/app.ts` mendaftar provider yang akan di-boot. Method
`register()` setiap provider mengikat service ke dalam container; `boot()`-nya menjalankan
logika startup setelah semuanya terdaftar. Lihat [Service Container](/id/digging-deeper/container)
untuk API binding lengkapnya.

### Package auto-discovery

Kamu tidak perlu mendaftarkan provider sebuah package secara manual. Saat `bun install`, hook
`postinstall` menjalankan `elyvel package:discover`, yang memindai package
`@elyvel/*` yang terinstal dan menulis `bootstrap/providers.generated.ts`. Framework
menggabungkannya dengan `providers` yang kamu konfigurasi saat boot — sehingga menambahkan sebuah package
biasanya cukup dengan menginstalnya. Kecualikan sebuah package dengan `dontDiscover` di
`config/app.ts` jika kamu perlu mendaftarkannya secara manual.
