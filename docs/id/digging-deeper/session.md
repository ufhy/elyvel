# HTTP Session

Session menyimpan data lintas request untuk satu pengunjung — login, flash
message, dan token CSRF semuanya numpang di sini. Tersedia sebagai
`ctx.session` di route atau middleware mana pun begitu `config/session.ts`
ada.

## Konfigurasi

```ts
// config/session.ts
import { defineSessionConfig } from '@elyvel/core'

export default defineSessionConfig({
  driver: 'cookie',
  cookie: 'elyvel_session',
  lifetime: 60 * 120, // 2 jam
})
```

| Driver | Tempat data disimpan |
| --- | --- |
| `cookie` (default) | Terenkripsi di dalam cookie itu sendiri (AES-256-GCM) — stateless, tanpa server-side store, tanpa perlu cleanup. |
| `memory` | Di dalam proses — reset saat restart. Cocok untuk dev/test. |
| `file` | `storage/framework/sessions` (atau opsi `files`). |
| `database` | Butuh `configureDatabaseSession(adapter)` saat boot (otomatis disambungkan `EloquentServiceProvider` jika tabel `sessions` ada). |
| `redis` | `RedisClient` bawaan Bun. TTL native `EX` — tidak butuh GC. |

Setiap driver kecuali `cookie`/`redis` membersihkan entri yang sudah expired
lewat "lottery" GC — pada persentase kecil request (`lottery: [chance,
outOf]`, default 2%), bukan setiap request, karena sweep penuh menyentuh
seluruh session yang tersimpan.

::: warning Driver `cookie` tidak bisa dicabut dari sisi server
Stateless adalah inti dari driver `cookie` — dan konsekuensinya tidak ada
record di server yang bisa dihapus. `lifetime` **memang** ditegakkan saat
dibaca (di-stamp ke dalam payload yang di-sign, bukan cuma dikirim sebagai
`Max-Age` cookie yang akan diabaikan attacker saat replay), jadi cookie yang
dicuri berhenti bekerja begitu lifetime-nya lewat. Tapi di dalam window itu,
`session.invalidate()` hanya bisa menghentikan *browser* mengirim cookie-nya
lagi — ia tidak bisa membatalkan salinan yang sudah dipegang attacker.

Kalau kamu butuh pencabutan sungguhan — "logout semua device", paksa
re-auth setelah ganti password, lockout seketika — pakai driver berbasis
store (`file`/`database`/`redis`), di mana `invalidate()` menghapus
record-nya dan id lama tidak lagi resolve ke apa pun. Kalau tidak, pendekkan
`lifetime`.
:::

Opsi lain: `secret` (default ke `app.key`), `path`/`domain`/`secure`/
`httpOnly`/`sameSite` (atribut cookie), `expireOnClose` (hilangkan `maxAge`
supaya cookie mati bersama tab browser).

::: warning `secure` mati sampai kamu menyalakannya
Nilainya datang dari config saja — framework tidak menyimpulkannya dari
`APP_ENV`, persis seperti Laravel yang mengambilnya dari
`env('SESSION_SECURE_COOKIE')` di `config/session.php`. Config hasil scaffold
membaca variabel itu:

```ts
// config/session.ts
secure: process.env.SESSION_SECURE_COOKIE === 'true',
```

Nyalakan di mana pun kamu menyajikan HTTPS. Menyimpulkannya dari environment
adalah yang digantikan ini, dan gagalnya diam-diam di dua arah: aplikasi
berlabel production tapi disajikan lewat http polos akan menulis cookie Secure
yang lalu ditolak dikirim balik oleh browser, sehingga setiap session terbaca
kosong tanpa error di mana pun.
:::

::: details Class di baliknya, untuk komposisi custom
Setiap driver didukung implementasi `SessionStore` yang di-export —
`MemorySessionStore`, `FileSessionStore`, `RedisSessionStore` (plus yang
berbasis database secara internal di balik `configureDatabaseSession`).
Kebanyakan aplikasi tidak pernah menyentuh ini langsung — cukup pilih
string `driver` di config — tapi tersedia jika kamu perlu membuat satu
sendiri (misalnya menyambungkan client Redis custom) atau
mengimplementasikan `SessionStore` milikmu sendiri. `sessionPlugin(config)`
adalah plugin Elysia yang dipasang framework secara internal untuk
menyambungkan store ke `ctx.session`.
:::

## Membaca & menulis

```ts
route().get('/cart', ({ session }) => {
  const items = session.get('cart', [])
  return { items }
})

route().post('/cart', ({ session, body }) => {
  session.put('cart', body.items)
})
```

API lengkap: `get(key, fallback?)`, `put(key, value)`, `has(key)` (ada dan
bukan null), `exists(key)` (ada, meski null), `missing(key)`, `forget(key)`,
`pull(key, fallback?)` (get + forget sekaligus), `push(key, value)` (tambah
ke value array), `increment`/`decrement`, `remember(key, factory)`, `all()`.

## Flash data

Flash sebuah value yang bertahan tepat satu request lagi — pola klasik
"redirect back dengan pesan sukses":

```ts
route().post('/posts', ({ session, body }) => {
  const post = Post.create(body)
  session.flash('success', 'Post created.')
  return back()
})
```

`reflash()` mempertahankan setiap key yang sedang di-flash untuk satu
request lagi; `keep(['success'])` mempertahankan key tertentu saja, bukan
semuanya.

## Meregenerasi session

Rotasi id session (dan token CSRF) tepat setelah perubahan privilege —
panduan anti session-fixation Laravel berlaku sama di sini:

```ts
route().post('/login', async ({ session, request }) => {
  // ... verifikasi kredensial ...
  session.regenerate() // id baru + token CSRF baru, data tetap
})
```

`invalidate()` melakukan rotasi yang sama tapi juga menghapus semua data
session (biasanya untuk `logout`). Keduanya hanya berpengaruh pada driver
yang didukung store (`memory`/`file`/`database`/`redis`) — driver `cookie`
tidak punya id server-side terpisah yang bisa fixated.

Memanggil `regenerate()` saat login tetap kebiasaan yang benar, tapi id
session yang tidak pernah diterbitkan server sekarang tidak bisa dipakai
begitu saja: id yang masuk hanya diadopsi kalau bentuknya memang seperti yang
kita hasilkan **dan** resolve ke session yang benar-benar dipegang store.
Selain itu (nilai yang ditanam, yang dipalsukan, atau id yang session-nya
sudah expired/di-invalidate) akan mendapat id baru — jadi attacker tidak bisa
memilih id tempat session korban akan hidup, dan session yang sudah dihapus
tidak bisa dihidupkan lagi dengan me-replay id lamanya.

## Proteksi CSRF

Setiap session membawa token CSRF (`session.token()`), bisa dibaca dari sisi
client lewat cookie `XSRF-TOKEN` (untuk double-submit SPA, mirip Axios).
Terapkan alias bawaan `csrf` ke route yang mengubah state — atau pakai grup
`web`, yang sudah membundelnya:

```ts
route().use(group('web')).post('/profile', updateProfile) // terproteksi csrf
```

Token dari request diambil dari field body `_token` atau header
`X-CSRF-Token`/`X-XSRF-Token`; ketidakcocokan merespons `419`. Perbandingan
dilakukan constant-time (`timingSafeEqual`) untuk menghindari timing
side-channel. Lihat [Middleware](/id/basics/middleware) untuk referensi
lengkap alias/grup.
