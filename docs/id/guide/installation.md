# Instalasi

elyvel adalah framework web yang terinspirasi Laravel dan mengutamakan Elysia untuk [Bun](https://bun.sh).
Ia memberikan ergonomi yang diharapkan developer Laravel — routing yang ekspresif,
middleware, validasi FormRequest, ORM ala Eloquent, queue, event, dan
lapisan otorisasi gate/policy — di atas core [Elysia](https://elysiajs.com) yang
berperforma tinggi dan sepenuhnya type-safe.

## Prasyarat

- [Bun](https://bun.sh) `>= 1.1`

Cukup itu — tidak ada runtime, package manager, atau build toolchain terpisah yang perlu diinstal.

## Membuat aplikasi

Scaffold aplikasi baru dengan `bun create`. Default-nya adalah kit Vue
full-stack:

```bash
bun create @elyvel my-app
```

Pilih starter yang berbeda dengan `--kit` (gunakan bentuk `=` — `--kit=none`, bukan
`--kit none`):

| Kit | Yang kamu dapatkan |
| --- | --- |
| `vue` | **Default.** Full-stack: Better Auth, frontend Vue + Inertia, halaman auth, dan migration auth. |
| `spa` | Better Auth plus SPA Vue (Vite + Vue Router, tanpa Inertia). |
| `none` | Backend saja — template dasar, tanpa frontend atau auth. |

```bash
bun create @elyvel my-app --kit=none
```

`bun create @elyvel` juga menulis file `.env` dengan **`APP_KEY`** yang baru dibuat,
sehingga aplikasi siap dijalankan seketika.

## Menjalankan aplikasi

```bash
cd my-app
bun install
bun run migrate   # vue / spa kits — creates the Better Auth tables
bun run dev       # elyvel serve
```

Aplikasimu berjalan di `http://localhost:3000`. Kit `vue`/`spa` juga menjalankan Vite
untuk HMR frontend. Untuk menjalankan server secara langsung (mis. di production), gunakan
`bun run start`, yang mengeksekusi `server.ts`.

::: tip APP_KEY
`APP_KEY` menandatangani cookie session dan menggerakkan model cast `encrypted` — aplikasi
tidak akan boot tanpanya. `bun create @elyvel` mengaturnya untukmu; rotasi kapan saja
dengan `bun run key:generate`.
:::

## CLI `elyvel`

Di dalam sebuah project, CLI `elyvel` tersedia (dikirim sebagai dev dependency).
Jalankan task melalui script `package.json` atau panggil langsung:

```bash
bunx elyvel make:model Post   # generate a model
bunx elyvel route:list        # inspect registered routes
bunx elyvel migrate           # run migrations
```

## Langkah berikutnya

- [Struktur Direktori](/id/guide/directory-structure) — tempat semuanya berada.
- [Konfigurasi](/id/guide/configuration) — file config, `.env`, dan helper
  `config()`.
- [Autentikasi](/id/security/authentication) — termasuk dalam kit `vue` default.
