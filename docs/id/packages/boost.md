# Boost

`@elyvel/boost` adalah pengembangan berbantuan AI untuk aplikasi elyvel — ide
yang sama dengan [Laravel Boost](https://github.com/laravel/boost): memberi
coding agent (Claude Code, Cursor, apa pun yang bicara MCP) konteks yang
dibutuhkan untuk menulis kode yang benar bagi aplikasi **ini**, bukan menebak.
Isinya dua bagian:

- **MCP server** yang tools-nya membaca aplikasi hidup — skema asli, route
  asli, log asli, versi paket asli;
- **guidelines terkomposisi** yang ditulis ke `AGENTS.md` — konvensi elyvel,
  disesuaikan dengan paket yang benar-benar terpasang di aplikasi.

## Instalasi

Boost adalah dev tooling, persis seperti `@elyvel/cli`: pasang sebagai
dependensi **dev**, dan tidak ada bagiannya yang ikut ke produksi — ia tidak
meng-export service provider, dan command-nya hidup di balik subpath `/cli`
yang hanya dibaca CLI.

```sh
bun add -d @elyvel/boost
bun elyvel boost:install
```

`boost:install` melakukan dua hal yang idempoten:

1. **`AGENTS.md`** — menulis guidelines terkomposisi di antara penanda
   `<!-- elyvel-boost:guidelines:start/end -->`. Konten milikmu di file itu
   tidak pernah disentuh; menjalankan ulang hanya menyegarkan blok yang
   dikelola. Bagian-bagiannya dipilih berdasarkan paket terpasang — aplikasi
   tanpa `@elyvel/queue` tidak mendapat panduan queue — dan dicap dengan versi
   terpasang yang persis.
2. **`.mcp.json`** — mendaftarkan server `elyvel-boost` (file standar yang
   dibaca Claude Code, Cursor, dan kawan-kawan), digabung dengan server lain
   yang sudah terdaftar.

Jalankan ulang setelah menambah atau menghapus paket `@elyvel/*` agar
guidelines mengikuti. Kalau Boost terpasang di `dependencies` alih-alih
`devDependencies`, installer akan menegur.

## Tools MCP-nya

Server mem-boot aplikasimu sekali dan menjawab darinya — agent yang memakai
tools ini membaca aplikasimu, bukan asumsinya.

| Tool | Menjawab apa |
| --- | --- |
| `application-info` | Nama/env, versi Bun, setiap paket `@elyvel` terpasang dengan versi persisnya, koneksi database, daftar model. |
| `database-schema` | Tabel dan kolom asli dari koneksi hidup — sebelum menulis migration, model, atau query. |
| `database-query` | Satu statement SQL **read-only** (`SELECT`/`WITH`/`EXPLAIN`/`SHOW`/`DESCRIBE`/`PRAGMA`), baris kembali sebagai JSON. Penulisan ditolak. |
| `database-connections` | Koneksi di `config/database.ts` dan mana yang default. |
| `list-routes` | Setiap route HTTP terdaftar, dengan metadata middleware/authorize jika terekam. |
| `read-log-entries` | Entri log aplikasi terbaru, bisa difilter per level atau string pencarian. |
| `last-error` | Entri error paling baru lengkap dengan konteksnya (stack trace, request id) — hal pertama yang dicek saat ada yang rusak. |
| `tinker` | Menjalankan TypeScript di aplikasi yang sudah boot, memakai evaluator [`elyvel tinker`](/id/guide/cli-reference#tinker) yang sama: model dan `config()` dalam scope, `await` jalan, variabel bertahan antar-panggilan. |
| `get-absolute-url` | Path yang diresolusi terhadap base URL aplikasi (`app.url`, atau `http://localhost:<port>`). |

`boost:mcp` menjalankan server lewat stdio; kamu tidak pernah menjalankannya
manual — klien MCP yang men-spawn-nya dari `.mcp.json`. Lewat stdio, stdout
milik protokol, jadi Boost mengalihkan semua logging aplikasi ke stderr
sebelum boot.

## `app.url`

URL absolut yang dibangun di luar request (di sini, dan di mana pun yang
membutuhkannya) berasal dari kunci `url` di `config/app.ts` — config hasil
scaffold membacanya dari `APP_URL`. Kalau tidak diset, Boost jatuh ke
`http://localhost:<port>`.

## Cakupan

Boost sengaja belum menyertakan pencarian dokumentasi hosted milik Laravel
Boost, penangkapan log browser, maupun sistem skills/rules. Blok guidelines
plus tools aplikasi-hidup adalah bagian yang paling menanggung beban.
