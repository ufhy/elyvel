# Dokumentasi OpenAPI

Dokumentasi API interaktif yang dihasilkan dari route bertipe milikmu —
tanpa anotasi, tanpa file spec terpisah yang perlu dijaga manual. Elysia
sudah menurunkan skema dari definisi route-mu; ini cuma menyambungkan
renderer-nya.

## Aktif secara default

Di luar production, aplikasi otomatis mount UI docs di `/openapi` (spec di
`/openapi/json`) tanpa konfigurasi apa pun — tidak ada yang perlu di-opt-in
untuk development lokal.

## Konfigurasi

```ts
// config/openapi.ts
import { defineOpenApiConfig } from '@elyvel/core'

export default defineOpenApiConfig({
  enabled: true, // default: aktif di luar production, mati di production
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
