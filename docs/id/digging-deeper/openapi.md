# Dokumentasi OpenAPI

Dokumentasi API interaktif yang dihasilkan dari route bertipe milikmu —
tanpa anotasi, tanpa file spec terpisah yang perlu dijaga manual. Elysia
sudah menurunkan skema dari definisi route-mu; ini cuma menyambungkan
renderer-nya.

## Aktif secara default

Pasang peer opsional `@elysiajs/openapi` dan aplikasi otomatis mount UI docs di
`/openapi` (spec di `/openapi/json`) tanpa konfigurasi lain — memasangnya itulah
opt-in-nya.

Apakah ia tetap terbuka diputuskan di `config/openapi.ts` dan tidak di tempat
lain. Framework tidak mematikannya untukmu berdasarkan `APP_ENV`, sama seperti
Telescope milik Laravel yang hanya membaca `config('telescope.enabled')`. Config
hasil scaffold mematikannya di production, pada baris yang bisa kamu baca dan
ubah:

```ts
enabled: process.env.OPENAPI_ENABLED
  ? process.env.OPENAPI_ENABLED === 'true'
  : process.env.APP_ENV !== 'production',
```

Kalau diserahkan ke pengecekan environment yang tersembunyi, `config/openapi.ts`
tidak mengatakan apa pun tentang apakah permukaan API-mu dipublikasikan —
padahal itu satu-satunya pertanyaan yang harus dijawab file tersebut.

## Konfigurasi

```ts
// config/openapi.ts
import { defineOpenApiConfig } from '@elyvel/core'

export default defineOpenApiConfig({
  enabled: true, // default: aktif — file inilah yang menentukan
  path: '/openapi', // spec dilayani di `${path}/json`
  provider: 'scalar', // atau 'swagger-ui'
  title: 'My API',
  version: '1.0.0',
  description: 'Public API for the mobile app.',
})
```

`title`/`version` default ke `config('app.name')`/`config('app.version')`
jika dikosongkan.

## Peer dependency opsional

UI docs berasal dari `@elysiajs/openapi`, dipasang terpisah:

```bash
bun add @elysiajs/openapi
```

Jika tidak terpasang, route docs diam-diam dilewati — sisa aplikasi tetap
boot normal apa pun kondisinya, jadi tidak ada dependency wajib yang perlu
dikhawatirkan di environment yang tidak membutuhkannya (misalnya proses
worker murni).
