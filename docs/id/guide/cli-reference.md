# Referensi CLI

Setiap `elyvel <command>` di satu tempat. Flag mengikuti konvensi
sederhana: `--foo=bar` mengatur value, `--foo` polos mengaturnya `true`,
dan `--no-foo` mengaturnya `false` (dipakai untuk opt-out seperti
`serve --no-vite`).

## Dari mana command berasal

`@elyvel/cli` sendiri hanya mengirimkan command scaffolding (`make:*`,
`new`, `serve`, `key:generate`, `down`/`up`, `config:publish`,
`lang:publish`, `package:discover`) — ia sama sekali tidak bergantung pada
`@elyvel/database`, `@elyvel/queue`, atau `@elyvel/scheduler`. Command
runtime seperti `queue:work`, `migrate`, dan `schedule:run` disumbangkan
oleh package-package itu sendiri: package mana pun bisa meng-export
`elyvelCommands` dari **subpath terpisah `<pkg>/cli`** (misalnya
`@elyvel/queue/cli`, bukan entry utama package), dan `elyvel
package:discover` menemukannya lalu menulis
`bootstrap/commands.generated.ts` — mekanisme yang sama yang sudah dipakai
untuk service provider (`elyvelProviders` → `bootstrap/providers.generated.ts`).
Command sengaja berada di subpath terpisah itu supaya aplikasi yang
sedang jalan dan meng-import `@elyvel/queue` untuk `dispatch()`/`Job`
tidak pernah ikut memuat `queueWorkCommand` dan yang lainnya ke dalam
prosesnya sendiri — hanya `elyvel` itu sendiri (atau langkah discovery)
yang pernah meng-import `<pkg>/cli`. Ini berjalan otomatis di setiap `bun
install` (disambungkan ke script `postinstall` template dasar), jadi
command sebuah package langsung muncul begitu terpasang — termasuk
command milik package pihak ketiga, tanpa pernah menyentuh source
`@elyvel/cli`.

Jika command yang kamu harapkan (misalnya `queue:work`) tidak ditemukan,
jalankan `elyvel package:discover` — `elyvel help` juga mendaftar apa pun
yang ditemukan di bawah "Discovered package commands".

## Aplikasi & scaffolding

| Command | Deskripsi | Flag |
| --- | --- | --- |
| `elyvel new <name>` | Scaffold aplikasi baru | `--kit=vue\|spa\|none` (default `vue`) — menulis `.env` dengan `APP_KEY` baru |
| `elyvel serve` | Jalankan dev server | `--entry=<path>` (auto-deteksi `server.ts`), `--no-watch`, `--no-vite` (Vite otomatis jalan jika ada `vite.config.*`) |
| `elyvel key:generate` | Set `APP_KEY` di `.env` | `--show` (cetak saja, tidak menulis), `--force` (izinkan overwrite di production) |
| `elyvel down` | Aktifkan maintenance mode (503) | `--secret[=value]` (bentuk polos generate dan cetak satu, dipakai untuk bypass lewat `?secret=`), `--retry=<seconds>`, `--message=<text>`, `--status=<code>` |
| `elyvel up` | Matikan maintenance mode | tidak ada |
| `elyvel config:publish [name...]` | Salin file config default ke `config/` | nol atau lebih dari `app database i18n openapi session logging cache mail queue filesystems broadcasting telegram` (default: semua); `--force` |
| `elyvel lang:publish [locale]` | Publish file terjemahan default | `[locale]` (default `en`); `--force`; `--package=<name>` menyalin `lang/` milik package terpasang ke `lang/vendor/<name>` sebagai gantinya |
| `elyvel package:discover` | Otomatis mendaftarkan provider dan command package `@elyvel/*` terpasang | tidak ada — memindai `node_modules/@elyvel/*` untuk `elyvelProviders`/`elyvelCommands`, menulis `bootstrap/providers.generated.ts` + `bootstrap/commands.generated.ts`; menghormati `dontDiscover` di `config/app.ts` |
| `elyvel broadcast:serve` | Jalankan layer WebSocket/broadcast sebagai proses tersendiri | `--port=<n>` |

::: tip `down`/`up` tidak ada di `elyvel help`
Command maintenance mode `down`/`up` bekerja tapi tidak muncul di banner
help yang dicetak — mudah terlewat kalau kamu cuma sekilas lihat
`elyvel help`.
:::

## Make generator

Setiap generator `make:*` menerima `--force` untuk menimpa file yang
sudah ada.

| Command | Deskripsi | Flag tambahan |
| --- | --- | --- |
| `make:controller <Name>` | Controller | `--resource` (7-action), `--invokable`, `--singleton` (+ `--creatable`), `--model=[Name]` (hint route-binding, infer dari nama), `--parent=[Name]` (hint nesting), `--requests` (juga membuat FormRequest Store/Update) |
| `make:model <Name>` | Model | `--migration`, `--factory`, `--seed`, `--controller`, `--all` (keempatnya) |
| `make:migration <name>` | File migration | nama tabel ditebak dari nama bergaya `create_<table>_table` |
| `make:middleware <Name>` | Class middleware | — |
| `make:request <Name>` | Form Request | — |
| `make:policy <Name>` | Policy otorisasi | `--model=[Model]` (flag polos infer dari nama, menambah full resource-method set) |
| `make:resource <Name>` | Transform API Resource | — |
| `make:event <Name>` | Class event | — |
| `make:listener <Name>` | Event listener | — |
| `make:notification <Name>` | Class notifikasi | — |
| `make:job <Name>` | Job queue | — |
| `make:provider <Name>` | Service provider | — |
| `make:seeder <Name>` | Seeder | — |
| `make:factory <Name>` | Model factory | — |
| `make:concern <Name>` | Model concern (padanan trait) | — |
| `auth:generate-migration-plugin` | Migrasi yang menjalankan ulang sync skema Better Auth (setelah mengaktifkan plugin manual di `config/auth.ts`) | tidak ada — tanpa nama/flag, selalu menulis `<timestamp>_sync_auth_schema.ts` |

## Database (dari `@elyvel/database`)

| Command | Deskripsi | Flag |
| --- | --- | --- |
| `elyvel db` | Buka shell DB native (sqlite3/psql) | — |
| `elyvel db:show` | Daftar tabel beserta jumlah row | — |
| `elyvel db:table <name>` | Deskripsikan kolom sebuah tabel | — |
| `elyvel db:monitor` | Laporkan koneksi terbuka (Postgres) | `--max=<n>` |
| `elyvel db:seed` | Jalankan `database/seeders/DatabaseSeeder` | — |
| `elyvel migrate` | Jalankan migrasi yang pending | `--step`, `--pretend` |
| `elyvel migrate:fresh` | Drop semua, migrasi ulang | `--seed` |
| `elyvel migrate:rollback` | Rollback batch terakhir | `--step=N`, `--batch=N`, `--pretend` |
| `elyvel migrate:reset` | Rollback semua migrasi | — |
| `elyvel migrate:refresh` | Rollback lalu migrasi ulang | `--step=N`, `--seed` |
| `elyvel migrate:status` | Tampilkan migrasi yang sudah/belum jalan | — |
| `elyvel migrate:unlock` | Paksa bersihkan lock migrasi yang macet | — |
| `elyvel model:prune [Name]` | Prune record prunable yang usang | `[Name]` — semua model prunable jika dikosongkan |
| `elyvel model:sync <Name>` | Laporkan (atau tambahkan) field `declare` yang hilang vs tabel DB sesungguhnya | `--write` (kalau tidak, laporan dry-run saja) — tidak pernah menyentuh `fillable`/`guarded`/`casts` |

Lihat [Migrasi](/id/database/migrations) untuk sisi schema-builder dari
command-command ini.

## Queue (dari `@elyvel/queue`)

Lihat [Queue](/id/digging-deeper/queues) untuk perilaku lengkap
masing-masing.

| Command | Flag |
| --- | --- |
| `elyvel queue:work` | `--connection=<name>`, `--queue=high,default`, `--once` \| `--stop-when-empty` \| `--max=N`, `--sleep=N`, `--retry-after=N` |
| `elyvel queue:failed` | — |
| `elyvel queue:retry <id>` \| `--all` | — |
| `elyvel queue:forget <id>` | — |
| `elyvel queue:flush` | — |
| `elyvel queue:prune-failed` | `--hours=24` |
| `elyvel queue:restart` | — |

## Scheduler (dari `@elyvel/scheduler`)

Lihat [Task Scheduling](/id/digging-deeper/scheduler) untuk detailnya.

| Command | Deskripsi |
| --- | --- |
| `elyvel schedule:run` | Jalankan semua yang due sekarang — satu entri yang dipanggil system cron-mu setiap menit |
| `elyvel schedule:work` | Loop long-running, tick setiap detik — tidak butuh system cron untuk lokal |
| `elyvel schedule:test [name]` | Jalankan sebuah task sekarang juga, mengabaikan ekspresi cron-nya |
| `elyvel schedule:list` | Cetak ekspresi cron, nama, dan timezone setiap task |

## Route

| Command | Deskripsi |
| --- | --- |
| `elyvel route:list` | Daftar semua route terdaftar, dengan kolom Middleware/Authorize untuk route yang didaftarkan lewat `resource()` |

Lihat [Routing](/id/basics/routing#memeriksa-route).
