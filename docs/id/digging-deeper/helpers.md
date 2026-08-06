# Helper & Collection

`@elyvel/support` adalah fondasi tanpa dependency milik elyvel — `Str`,
`Arr`, `Collection`, `LazyCollection`, dan segelintir helper mandiri,
dipakai di seluruh framework itu sendiri. Ini adalah subset yang sengaja
dikurasi dari `Illuminate\Support` milik Laravel, bukan clone 180-method
penuh — method array native sudah mencakup sebagian besar yang biasa
kamu butuhkan.

## String (`Str`)

```ts
import { Str } from '@elyvel/support'
```

**Konversi case**

| Method | Contoh |
| --- | --- |
| `Str.studly(value)` | `Str.studly('foo_bar baz')` → `'FooBarBaz'` |
| `Str.camel(value)` | `Str.camel('foo_bar')` → `'fooBar'` |
| `Str.snake(value, delimiter?)` | `Str.snake('fooBar')` → `'foo_bar'` |
| `Str.kebab(value)` | `Str.kebab('fooBar')` → `'foo-bar'` |
| `Str.title(value)` | `Str.title('hello world')` → `'Hello World'` |
| `Str.headline(value)` | alias `title` saat ini |
| `Str.upper(value)` / `Str.lower(value)` | `.toUpperCase()`/`.toLowerCase()` |
| `Str.ucfirst(value)` / `Str.lcfirst(value)` | kapitalkan/kecilkan huruf pertama saja |
| `Str.slug(value, separator?)` | `Str.slug('Héllo Wörld!')` → `'hello-world'` — menghapus diakritik, lowercase |

::: tip Tanpa inflection kata
Tidak ada `Str.plural()`/`Str.singular()` — memluralkan kata Inggris
dengan benar butuh ruleset kata tidak beraturan yang besar dan di luar
scope di sini. Pakai library inflector khusus jika kamu membutuhkannya.
:::

**Truncation**

| Method | Contoh |
| --- | --- |
| `Str.limit(value, limit?, end?)` | `Str.limit('hello world', 5)` → `'hello...'` |
| `Str.words(value, words?, end?)` | `Str.words('a b c d', 2)` → `'a b...'` |

**Trimming & pencarian**

| Method | Contoh |
| --- | --- |
| `Str.before(value, search)` | `Str.before('a@b.com', '@')` → `'a'` |
| `Str.beforeLast(value, search)` | `Str.beforeLast('a.b.c', '.')` → `'a.b'` |
| `Str.after(value, search)` | `Str.after('a@b.com', '@')` → `'b.com'` |
| `Str.afterLast(value, search)` | `Str.afterLast('a.b.c', '.')` → `'c'` |
| `Str.between(value, from, to)` | `Str.between('[hi]', '[', ']')` → `'hi'` |
| `Str.contains(haystack, needles)` | needle mana pun cocok |
| `Str.containsAll(haystack, needles)` | semua needle cocok |
| `Str.startsWith(haystack, needles)` / `Str.endsWith(haystack, needles)` | needle sebagai string atau array |
| `Str.is(pattern, value)` | wildcard match — `Str.is('foo.*', 'foo.bar')` → `true` |
| `Str.start(value, prefix)` | prepend kecuali sudah ada — `Str.start('path', '/')` → `'/path'` |
| `Str.finish(value, cap)` | append kecuali sudah ada |
| `Str.replaceFirst(search, replace, subject)` / `Str.replaceLast(search, replace, subject)` | ganti hanya satu kemunculan |
| `Str.mask(value, char, index, length?)` | `Str.mask('taylor@example.com', '*', 3)` → `'tay***************'` |

**Padding, repeat, lain-lain**

| Method | Contoh |
| --- | --- |
| `Str.padLeft(value, length, pad?)` / `Str.padRight(value, length, pad?)` | `Str.padLeft('7', 3, '0')` → `'007'` |
| `Str.repeat(value, times)` | `Str.repeat('ab', 3)` → `'ababab'` |
| `Str.reverse(value)` | pembalikan yang aman untuk Unicode |
| `Str.length(value)` / `Str.wordCount(value)` | |
| `Str.random(length?)` | string alfanumerik CSPRNG, default 16 karakter |
| `Str.uuid()` | UUID v4 RFC-4122 |

Pemakaian nyata: model observer umumnya membangun slug unik dengan
`Str.slug(title)`, fallback ke `` `${slug}-${Str.random(6).toLowerCase()}` ``
saat terjadi collision.

## Array (`Arr`)

```ts
import { Arr } from '@elyvel/support'
```

Baca tidak pernah mutasi; `set`/`forget` mutasi target di tempat (sesuai
Laravel).

| Method | Tujuan | Contoh |
| --- | --- | --- |
| `Arr.get(target, path, fallback?)` | baca dot-path | `Arr.get(data, 'user.roles.0')` |
| `Arr.has(target, path)` | keberadaan dot-path (menghitung `null` sebagai ada) | `Arr.has({ a: { b: null } }, 'a.b')` → `true` |
| `Arr.set(target, path, value)` | tulis dot-path, membuat intermediate — **mutasi** | `Arr.set({}, 'a.b.c', 1)` → `{ a: { b: { c: 1 } } }` |
| `Arr.forget(target, path)` | hapus dot-path — **mutasi** | |

::: warning Penulisan dot-path menolak segmen yang bisa mencemari prototype
`Arr.set`/`Arr.forget` akan **throw** kalau ada segmen bernama `__proto__`,
`constructor`, atau `prototype`. Menugaskan nilai ke `__proto__` mengubah
prototype sebuah object, bukan membuat property — jadi menelusuri path melewatinya
akan mendarat di `Object.prototype`, dan penulisan berikutnya merembes ke
**setiap** object di proses itu. Array PHP tidak punya prototype chain, jadi
`Arr::set` milik Laravel tidak punya bahaya serupa — penjaga ini khusus untuk port
JS-nya.

Kalau path-nya bisa berasal dari request, validasi dulu terhadap daftar yang kamu
kenal sebelum memanggilnya: throw itu menghentikan pencemarannya, tapi 500 yang
bisa dipicu pengguna tetap denial-of-service.
:::
| `Arr.only(target, keys)` / `Arr.except(target, keys)` | ambil/buang key | `Arr.only({a:1,b:2}, ['a'])` → `{a:1}` |
| `Arr.pluck(array, value, key?)` | ekstraksi kolom, opsional dengan key | `Arr.pluck(rows, 'name', 'id')` → `{1:'a',2:'b'}` |
| `Arr.wrap(value)` | bungkus non-array jadi satu; `null`/`undefined` → `[]` | |
| `Arr.first(array, predicate?, fallback?)` / `Arr.last(...)` | | |
| `Arr.flatten(array, depth?)` | flatten rekursif | `Arr.flatten([1,[2,[3]]])` → `[1,2,3]` |
| `Arr.collapse(array)` | flatten tepat satu level | `Arr.collapse([[1,2],[3]])` → `[1,2,3]` |
| `Arr.isAssoc(value)` | apakah dict plain-object, bukan array | |
| `Arr.random(array)` | elemen acak berbasis CSPRNG | |

`dataGet(target, path, fallback?)` (helper mandiri, bukan di `Arr`)
adalah wrapper tipis atas `Arr.get` — penamaan `data_get()` Laravel.

## Collection

Wrapper eager dan chainable atas sebuah array — setiap transform
mengembalikan `Collection` **baru**, dimaterialisasi langsung (berbeda
dari `LazyCollection` di bawah):

```ts
import { Collection } from '@elyvel/support'

const people = new Collection([
  { name: 'Ada', role: 'admin', age: 36 },
  { name: 'Alan', role: 'user', age: 41 },
  { name: 'Grace', role: 'admin', age: 45 },
])

people.filter(p => p.role === 'admin').count()   // 2
people.sortBy('age').first()?.name               // 'Ada'
people.groupBy('role').admin?.count()             // 2
people.pipe(c => c.sum('age'))
```

Daftar method lengkap: `all`, `count`, `isEmpty`/`isNotEmpty`, `get`,
`first`/`last` (masing-masing dengan predicate opsional), `map`, `filter`,
`reject`, `flatMap`, `flatten`, `unique(by?)`, `reverse`,
`sortBy`/`sortByDesc`, `take`, `skip`, `slice`, `concat`/`merge`, `diff`,
`intersect`, `implode(glue, key?)`, `countBy(by?)`, `pipe`, `tap`,
`whenEmpty`/`whenNotEmpty`, `sole` (throw kecuali tepat satu yang cocok),
`mapWithKeys`, `reduce`, `each`, `contains`, `pluck(key)`, `where(key,
value)`/`firstWhere(key, value)`, `keyBy(key)`, `groupBy(key)`,
`sum`/`avg`/`min`/`max` (masing-masing dengan key/selector opsional),
`chunk(size)`, `partition(predicate)` (mengembalikan tuple `[matching,
rest]`), `toArray`/`toJSON`. Juga langsung bisa di-spread/iterasi
(`[...collection]`, `for...of`).

`toArray()`/`toJSON()` membuka bungkus item yang punya method
`toObject()`-nya sendiri — inilah hook yang membuat model Eloquent bisa
menyerialisasi dirinya sendiri dengan benar saat sekumpulan model
di-JSON-stringify.

**Subclass bertahan sepanjang chain.** Transform yang mempertahankan tipe
elemen — `filter`, `reject`, `take`, `skip`, `slice`, `reverse`, `sortBy`,
`sortByDesc`, `unique`, `where`, `concat`/`merge`, `diff`, `intersect`,
`partition`, `groupBy`, dan setiap batch `chunk` — mengembalikan subclass
yang *sama* seperti yang dipanggil, jadi `EloquentCollection` tetap
model-aware sepanjang `posts.filter(...).sortBy('title').take(5)`.
Transform yang **mengubah** tipe elemen — `map`, `flatMap`, `pluck`,
`flatten` — mengembalikan `Collection` biasa, karena hasilnya tidak lagi
memuat tipe elemen aslinya (`posts.map(p => p.title)` adalah collection
berisi string, bukan model). Ini pembedaan yang sama seperti di Laravel.

::: tip Hasil query Eloquent
`Model.query().get()` mengembalikan `EloquentCollection`, yang
**meng-extend** `Collection` yang sama ini — setiap method di atas sudah
bekerja di hasil query, ditambah method model-aware: `modelKeys()`,
`find(id)`, `load(...paths)` (eager-load relasi ke setiap model yang sudah
ada di tangan), `loadCount(...names)`. Ia juga **meng-override**
`diff`/`intersect`/`unique` supaya membandingkan model berdasarkan primary
key (`getKey()`), bukan object reference — jadi
`posts.diff(await Post.whereIn('id', ids).get())` tetap benar meski kedua
collection berisi instance object yang berbeda untuk row yang sama. Lihat
[Eloquent](/id/database/eloquent).
:::

## Lazy Collection

Berbasis generator alih-alih array — tidak ada apa pun yang diambil atau
ditransformasi sampai sesuatu benar-benar mengiterasi, jadi tetap
terbatas memori bahkan untuk result set yang sangat besar. Inilah persis
yang menggerakkan `Model.query().cursor()`:

```ts
for await (const user of User.query().where('active', true).cursor(500)) {
  await sendEmail(user) // melewati DB 500 row sekaligus, tidak pernah menahan semuanya di memori
}
```

Method: `map`, `filter`, `take(n)` (menghentikan source lebih awal —
tidak menguras sisanya), `each(fn)`, `first()`, `toArray()` (menguras
semuanya jadi array biasa — pakai seperlunya, karena ini mengalahkan
tujuan memory-bound-nya). Harus dikonsumsi dengan `for await...of`, bukan
`for...of` — ia `AsyncIterable`, bukan `Iterable`.

## Helper mandiri

```ts
import { blank, dataGet, filled, retry, tap, value } from '@elyvel/support'

tap(new User(), u => u.save())        // efek samping, lalu return value tidak berubah — untuk chain fluent
value(5)                              // 5
value(() => computeDefault())         // resolve value yang mungkin berupa thunk

blank('   ')                          // true — null/undefined, string whitespace-saja, array/Map/Set/object kosong
blank(0)                              // false — 0 bukan blank
filled('0')                           // true — kebalikan blank; catat 0/false/'0' semuanya dihitung "filled"

dataGet({ a: { b: 2 } }, 'a.b')       // 2 — sama seperti Arr.get

await retry(3, async (attempt) => {   // retry sampai 3 kali, dengan delay opsional antar percobaan
  return await flakyApiCall()
}, 200)

await retry(5, fetchThing, 0, error => error.message !== 'fatal') // `when` menentukan error mana yang layak di-retry sama sekali
```

## Proses (`Process`)

Menjalankan perintah eksternal tanpa tarian stream/exit-code yang dituntut
`Bun.spawn` — facade `Process` milik Laravel:

```ts
import { Process } from '@elyvel/support'

const result = await Process.run(['git', 'status', '--porcelain'])
result.successful() // exit code 0
result.output()     // stdout; errorOutput() untuk stderr

await Process.path('/repo').timeout(60).env({ CI: 'true' })
  .run('bun run build')
  .then(r => r.throw()) // ProcessFailedError dengan output di pesannya
```

Perintah berupa string dipecah di spasi dan **tidak** melewati shell — argumen
tidak bisa di-inject ke sana. Untuk pipe atau glob, panggil shell eksplisit:
`['sh', '-c', '…']`. `timeout(s)` mengirim SIGKILL ke child (child yang
mengabaikan SIGTERM akan membuat await menggantung selamanya) dan reject dengan
`ProcessTimedOutError`. `input(text)` mengisi stdin.

## Concurrency

Menjalankan task async independen bersamaan — `Concurrency::run` milik Laravel,
tanpa driver proses yang Laravel butuhkan karena PHP sinkron:

```ts
import { Concurrency } from '@elyvel/support'

const [users, orders] = await Concurrency.run([
  () => db.table('users').count(),
  () => db.table('orders').count(),
])

// Bentuk bernama:
const { fast, slow } = await Concurrency.run({
  fast: () => fetchSummary(),
  slow: () => fetchHistory(),
})

// Lima puluh task, enam sekaligus, masing-masing dibunuh setelah 30 detik:
await Concurrency.run(tasks, { limit: 6, timeoutSeconds: 30 })
```

Satu kegagalan me-reject seluruh run — tapi baru setelah semua task yang sudah
mulai selesai, jadi tidak ada yang tertinggal jalan di belakang pemanggil. Timer
timeout dibersihkan (kebocoran klasik `Promise.race`).

## Pipeline

Melewatkan nilai melalui rantai tahapan, masing-masing memutuskan lanjut atau
tidak — bawang yang menyusun HTTP middleware, dalam bentuk mandiri:

```ts
import { Pipeline } from '@elyvel/support'

const order = await Pipeline.send(draft)
  .through([validate, reserveStock, charge])
  .then(finalize)
```

Tahapan berupa `(value, next) => …` atau objek dengan `handle` — instance kelas
bisa. Tahapan pertama paling luar: melihat nilai pertama saat masuk dan terakhir
saat keluar, boleh memutus rantai dengan tidak memanggil `next`, atau
try/finally di sekeliling sisa rantainya. `thenReturn()` mengakhiri rantai dengan
nilainya sendiri.
