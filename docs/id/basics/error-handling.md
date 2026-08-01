# Penanganan Error

Error yang tidak tertangkap menjadi sebuah response: halaman HTML ber-style untuk
navigasi browser, JSON untuk client API atau XHR. Status code dan pesan yang
dilihat client bergantung pada **jenis error** yang dilempar.

## Kesalahan internal dijawab 500

Error apa pun yang tidak dikenali framework sebagai client-facing dianggap
kesalahan internal. Ia di-log utuh, dan client mendapat 500 generik:

```ts
route().get('/posts/:id', async ({ params }) => {
  const post = await Post.find(params.id) // driver throw → 500, pesan generik
  return post
})
```

Pesan milik error itu tidak pernah dikirim, karena pesan internal rutin memuat
hal yang tidak boleh dilihat client — hostname, connection string, token di query
string. `app.debug` juga merender halaman stack-trace untuk 5xx, hanya di jalur
web.

`app.debug` **mati kecuali kamu menyalakannya**, dan dituruti di mana pun kamu
menyalakannya — framework tidak mematikannya untukmu berdasarkan `APP_ENV`,
sama seperti `(bool) env('APP_DEBUG', false)` milik Laravel. Config hasil
scaffold membaca variabel itu dan `.env` menyalakannya untuk development lokal:

```ts
// config/app.ts
debug: process.env.APP_DEBUG === 'true',
```

Itulah seluruh proteksinya: deploy yang tidak mengatur apa pun tidak menyajikan
stack trace. Menyetel `APP_DEBUG=true` di host publik berarti menyajikannya ke
siapa pun yang memicu error.

## Melempar error yang client-facing

Untuk memilih status **sekaligus** menampilkan pesan, lempar `HttpException`:

```ts
import { HttpException } from '@elyvel/support'

route().get('/posts/:slug', async ({ params }) => {
  const post = await Post.query().where('slug', params.slug).first()
  if (!post)
    throw new HttpException(404, 'Post itu sudah dihapus.')
  return post
})
```

```json
{ "message": "Post itu sudah dihapus.", "status": 404 }
```

Argumen ketiga melampirkan error per-field, dirender di bawah `errors`:

```ts
throw new HttpException(422, 'Data yang diberikan tidak valid.', {
  email: ['Alamat itu sudah terdaftar.'],
})
```

Buat subclass kalau kegagalan yang sama berulang:

```ts
export class PostArchived extends HttpException {
  constructor() {
    super(410, 'Post ini sudah diarsipkan.')
  }
}
```

`HttpException` dengan status `5xx` tetap di-scrub — menandai sebuah exception
sebagai client-facing membuatmu bisa memilih status, bukan melewati aturan bahwa
kesalahan server tetap generik.

::: warning Menempelkan `status` ke error biasa tidak berpengaruh
```ts
// ✗ Dijawab 500. Status dan pesannya sama-sama diabaikan.
throw Object.assign(new Error('Not found'), { status: 404 })
```

Ini dulu berhasil, dan justru itulah bug-nya: HTTP client dan driver database
rutin menempelkan `status` numerik pada rejection mereka, jadi kesalahan internal
diteruskan ke client sebagai 4xx yang tampak masuk akal dengan pesan internalnya
disalin apa adanya — di production juga. Sekarang hanya exception yang opt-in
lewat `HttpException` yang dipercaya.

Migrasinya satu baris: `throw new HttpException(404, 'Not found')`.
:::

## Exception milik framework sendiri

Ketiganya sudah extend `HttpException`, jadi dirender sebagai dirinya sendiri,
bukan sebagai 500:

| Exception | Status | Dilempar oleh |
| --- | --- | --- |
| `ValidationException` | 422 | `validate()` / FormRequest yang gagal |
| `AuthorizationException` | 403 | FormRequest yang `authorize()`-nya mengembalikan false |
| `AuthorizationError` | 403 (bisa diatur) | `gate().authorize()`, guard `can`, `@Authorize` |

Kondisi milik Elysia sendiri dipetakan lewat kode, bukan lewat class exception:
`NOT_FOUND` → 404, `VALIDATION` → 422, `PARSE` dan
`INVALID_COOKIE_SIGNATURE` → 400.

## Mengembalikan status alih-alih melempar

Handler atau guard bisa langsung mengembalikan status error. Karena kamu memilih
status dan body-nya secara eksplisit, pesannya ditampilkan apa adanya:

```ts
route().get('/posts/:id', ({ status }) => status(403, { message: 'Post ini bukan milikmu.' }))
```

Di jalur web ini ditulis ulang menjadi halaman error yang membawa pesan itu;
client JSON menerima body-nya tanpa perubahan. 5xx juga di-scrub di sini.

## Di jalur web

`HttpException` 422 yang membawa error bag berperilaku seperti redirect validasi
Laravel untuk navigasi browser: ia redirect balik dengan `errors` dan
`_old_input` di-flash ke session alih-alih mengembalikan JSON. Client API tetap
mendapat body 422-nya. Lihat [Validasi](/id/basics/validation).

## Menyesuaikan halaman error

```ts
import { configureErrorPage } from '@elyvel/core'

configureErrorPage((status, { message, request, session }) =>
  view(ErrorPage, { status, message: message ?? 'Terjadi kesalahan.' }))
```

Resolver-nya menerima status dan sebuah context (`request`, `message`, `error`,
`session`), dan boleh mengembalikan HTML, sebuah `Response`, atau sebuah view. Ia
hanya dipanggil di jalur web, jadi response JSON tidak pernah terpengaruh.
`message` bernilai `undefined` untuk 5xx — itu scrubbing yang dijelaskan di atas,
jadi sediakan teksmu sendiri untuk kasus itu.
