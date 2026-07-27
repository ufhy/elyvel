# Struktur Direktori

Aplikasi elyvel yang di-scaffold mengikuti layout ala Laravel, jadi semuanya berada di tempat yang kamu
harapkan. Di bawah ini adalah aplikasi backend-only (`--kit none`); kit `vue` dan `spa`
menambahkan `database/` dan `frontend/` di atasnya.

```
my-app/
├── app/
│   └── providers/
│       └── AppServiceProvider.ts
├── config/
│   ├── app.ts
│   ├── database.ts
│   ├── i18n.ts
│   ├── logging.ts
│   ├── openapi.ts
│   └── session.ts
├── routes/
│   └── web.ts
├── server.ts
├── .env
├── .gitignore
├── eslint.config.mjs
├── package.json
├── README.md
└── tsconfig.json
```

## Direktori `app`

Kode aplikasimu. Ia dimulai hanya dengan `providers/`, dan bertambah dengan folder
Laravel yang familiar seiring kamu men-generate-nya (`elyvel make …`):

- **`providers/`** — service provider. `AppServiceProvider` adalah tempat untuk
  mendaftarkan binding container (`register()`) dan menjalankan logika startup (`boot()`) —
  policy, observer, password policy, event listener, dan sebagainya.
- **`models/`** — model ala Eloquent.
- **`controllers/`** — controller route.
- **`requests/`** — kelas validasi FormRequest.
- **`policies/`** — policy otorisasi (didaftarkan dengan gate).

Hanya folder yang kamu gunakan yang perlu ada; framework tidak mengharuskan direktori
kosong untuk setiap konsep.

## Direktori `config`

Satu file per concern, masing-masing mengembalikan objek config bertipe (lihat
[Konfigurasi](/id/guide/configuration)). `config/app.ts` adalah entry point — ia
mendeklarasikan nama aplikasi, environment, dan **service provider** yang akan di-boot.

## Direktori `routes`

Setiap file di dalam `routes/` **di-mount otomatis saat boot** — tanpa registrasi manual.
`routes/web.ts` adalah default-nya. Kembalikan sebuah nilai dan ia diserialisasi ke JSON;
kembalikan `view(...)` / `Inertia.render(...)` untuk HTML. Route berbasis cookie (browser)
sebaiknya berjalan melalui group `web` bawaan untuk proteksi CSRF; route API/token
tetap di luarnya.

## `server.ts`

Entry point. Ia melakukan bootstrap framework — memuat `config/`, mendaftarkan
provider, dan me-mount otomatis `routes/`:

```ts
import { createApp } from '@elyvel/core'

const app = await createApp({ basePath: import.meta.dir })
app.catchExceptions()
await app.listen()
```

## `.env`

Variabel environment — `APP_NAME`, `APP_ENV`, `APP_KEY`, `PORT`,
`DB_CONNECTION`, dan kredensial apa pun. Lihat [Konfigurasi](/id/guide/configuration).

## Direktori `database` <Badge type="tip" text="vue / spa kits" />

Migration berada di `database/migrations/`. Jalankan dengan `bun run migrate`
(`elyvel migrate`) atau reset dengan `bun run migrate:fresh`.

## Direktori `frontend` <Badge type="tip" text="vue / spa kits" />

Source frontend — komponen/halaman Vue di `frontend/` dan style di
`frontend/css` — dikompilasi oleh Vite.

## File config tambahan <Badge type="tip" text="vue / spa kits" />

Selain file `config/` dasar di atas, kit `vue`/`spa` juga menambahkan
`config/auth.ts` (Better Auth — lihat [Autentikasi](/id/security/authentication)),
`config/middleware.ts` (lihat [Middleware](/id/basics/middleware)), dan
`config/mail.ts` (transport mailer untuk email auth).
