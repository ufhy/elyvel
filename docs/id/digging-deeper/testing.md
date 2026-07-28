# HTTP Test

Jalankan aplikasimu lewat `app.handle()` — tanpa socket atau port
sungguhan — dengan test client yang sadar cookie/CSRF, assertion response
yang fluent, dan database yang terisolasi per test. Ketiganya independen
dan bisa dipakai sendiri-sendiri.

## Membuat request

```ts
import { createApp } from '@elyvel/core'
import { createTestClient } from '@elyvel/testing'

const app = createApp({ basePath: import.meta.dir })
const client = createTestClient(app)

const res = await client.post('/users', { json: { name: 'Grace' } })
res.assertCreated().assertJson({ data: { name: 'Grace' } })
```

`get`/`post`/`put`/`patch`/`delete`/`head(path, options?)` semuanya
menerima `{ json, headers, query, body }` — `json` otomatis diserialisasi
dengan `content-type: application/json`; `body` adalah alternatif mentah
untuk payload non-JSON. `withHeaders(...)`/`withToken(token)`/
`withCookie(name, value)` mengatur default yang ikut terbawa di setiap
request berikutnya dari client yang sama.

## Meng-assert response

`TestResponse` adalah object assertion kecil yang chainable — bukan
ekstensi dari `expect()` milik `bun:test` — yang throw dengan status dan
body disertakan di pesan error saat gagal:

```ts
const res = await client.get('/posts/1')

res.assertOk()
res.assertJson({ title: 'Hello' })          // deep partial match
res.assertJsonPath('author.name', 'Ada')    // pencarian dot-path
res.assertHeader('content-type', 'application/json; charset=utf-8')
res.assertSee('Hello')                       // cek substring pada raw body
```

Tersedia juga: `assertStatus(code)`, `assertCreated()`, `assertNoContent()`,
`assertNotFound()`, `assertUnauthorized()`, `assertForbidden()`,
`assertSuccessful()` (2xx apa pun), `assertRedirect(location?)`. Turun ke
`.json<T>()`/`.text()`/`.status`/`.headers` langsung saat assertion bawaan
tidak cukup spesifik — semuanya bisa dipakai bersama `expect()` biasa.

## Cookie & CSRF — ditangani otomatis

Client membawa cookie jar-nya sendiri: setiap `Set-Cookie` yang
dikembalikan aplikasi ditangkap dan diulang di request berikutnya dari
client yang sama, jadi session yang terbentuk di satu route masih ada di
request selanjutnya. Untuk request non-GET/HEAD/OPTIONS, client juga
otomatis mencerminkan cookie `XSRF-TOKEN` ke header `X-XSRF-Token` — pola
double-submit yang sama seperti browser/axios sungguhan — jadi `POST`
yang terproteksi CSRF langsung bekerja selama request sebelumnya di test
yang sama sudah membentuk session-nya:

```ts
await client.get('/posts/1') // membentuk session + cookie XSRF
await client.post('/posts/1/comments', { json: { body: 'Nice post' } }) // header CSRF otomatis terpasang
```

Melewati request pertama itu dan langsung POST tanpa session akan gagal
dengan CSRF mismatch — client tidak menutupi session yang hilang.

## Bertindak sebagai user

Tidak ada helper `/login`-lalu-tangkap-cookie — session berbasis Better
Auth, jadi test melewati alur login sepenuhnya lewat seam test khusus:

```ts
import { stopActingAs } from '@elyvel/auth'

await client.actingAs(author)
const res = await client.post('/posts', { json: { title: 'New post' } })
res.assertStatus(303)

stopActingAs() // wajib — override ini berlaku untuk seluruh proses, bukan per-client
```

`client.actingAs(user)` adalah wrapper kemudahan di sekitar `actingAs()`
milik `@elyvel/auth`. Karena override-nya berlaku untuk seluruh proses,
bukan di-scope ke satu client, selalu pasangkan dengan `stopActingAs()`
(biasanya di `afterEach`) supaya test berikutnya — atau client kedua di
test yang sama — tidak tertinggal terautentikasi sebagai user yang salah.
`actingAsGuest()` memaksa tidak terautentikasi sebagai gantinya.

## Isolasi database

```ts
import { migrate } from '@elyvel/database'
import { refreshDatabase } from '@elyvel/testing'
import { join } from 'node:path'

beforeEach(async () => {
  await refreshDatabase({
    seed: async (connection) => {
      await migrate(connection, join(import.meta.dir, '../database/migrations'))
    },
  })
})
```

`refreshDatabase(options?)` membuka koneksi baru (SQLite in-memory secara
default) dan menjadikannya yang aktif, jadi setiap test mulai dari
database yang benar-benar kosong — tidak ada row sisa dari test
sebelumnya yang perlu dibersihkan. Berikan config `connection` yang
berbeda untuk test terhadap Postgres/MySQL sebagai gantinya; `seed`
adalah tempat kamu menjalankan migrasi (dan data fixture apa pun)
terhadap koneksi barunya.

## Fake mail, event, notifikasi, broadcast

Tidak ada facade "fakes" terpadu di sini — fake milik setiap subsistem
independen dan didokumentasikan di halamannya masing-masing:
`ArrayTransport` milik Mail (lihat [Mail](/id/digging-deeper/mail#testing)),
`fakeEvents()` milik Event (lihat [Event](/id/digging-deeper/events#testing)),
`ArrayChannel` milik Notifikasi (lihat
[Notifikasi](/id/digging-deeper/notifications#testing)),
`ArrayBroadcaster` milik Broadcasting (lihat
[Broadcasting](/id/digging-deeper/broadcasting#testing)). Campur dan
padukan mana pun yang dibutuhkan sebuah test bersama `createTestClient`.

## Contoh lengkap

Menyatukan semua bagian — aplikasi sungguhan, database terisolasi, request
terautentikasi, dan assertion business-logic langsung terhadap model,
bukan hanya response HTTP:

```ts
import { createApp } from '@elyvel/core'
import { migrate } from '@elyvel/database'
import { actingAs, stopActingAs } from '@elyvel/auth'
import { createTestClient, refreshDatabase } from '@elyvel/testing'

describe('creating a post', () => {
  let client: ReturnType<typeof createTestClient>

  beforeEach(async () => {
    await refreshDatabase({ seed: conn => migrate(conn, migrationsDir) })
    const app = createApp({ basePath: appDir })
    client = createTestClient(app)
  })

  afterEach(() => stopActingAs())

  it('slugifies the title and persists it', async () => {
    await client.actingAs(author)
    const res = await client.post('/posts', { json: { title: 'Hello World' } })

    res.assertStatus(303)
    const post = await Post.query().where('title', 'Hello World').first()
    expect(post?.slug).toBe('hello-world')
  })
})
```
