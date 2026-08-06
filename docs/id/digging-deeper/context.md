# Context

Nilai ber-scope request yang mengikuti seluruh kelanjutan async, menempel di
setiap entri log yang ditulis selama itu, dan ikut bersama job yang di-queue —
`Context` milik Laravel.

Masalah yang diselesaikannya adalah korelasi. Satu request menulis log di enam
tempat di empat modul; tanpa context bersama, setiap tempat harus diberi trace id
secara eksplisit — dan yang tidak kebagian selalu yang justru kamu butuhkan.

```ts
// Di middleware:
Context.add('trace_id', crypto.randomUUID())
Context.add('url', request.url)

// Di mana pun setelahnya — modul lain, handle() milik job:
log.info('payment charged')
// ⇒ {"message":"payment charged","trace_id":"…","url":"…"}
```

## Menangkap

```ts
Context.add('key', 'value')
Context.add({ beberapa: 1, sekaligus: 'ya' })
Context.addIf('key', 'hanya saat belum ada')
Context.push('breadcrumbs', 'auth', 'billing') // menambah ke array
Context.increment('records_imported', 5)
```

Membaca: `get`, `has`, `only(['a', 'b'])`, `all`, `forget`.

Scope dibuka otomatis per request (mekanisme `AsyncLocalStorage` yang sama dengan
scope actor/userstamps). Dua request bersamaan tidak pernah melihat context satu
sama lain. Di luar scope — skrip biasa — pembacaan mengembalikan `undefined` dan
penulisan jadi no-op, bukan crash; buka sendiri dengan `withContextScope(fn)`.

## Log

Setiap entri yang ditulis di dalam scope membawa context yang visible. Prioritas
saat key bertabrakan: tempat pemanggilan menang atas binding logger, yang menang
atas context — yang lebih spesifik selalu menang.

## Job yang di-queue

Context ditangkap saat job di-dispatch dan dipulihkan di sekeliling `handle()`-nya
— jadi `trace_id` yang di-set middleware ada di baris log yang ditulis worker,
beberapa menit kemudian, di proses lain:

```ts
// request:                              // worker, di tempat lain:
Context.add('trace_id', id)
await dispatch(new SyncInventory(sku))   // log handle() membawa trace_id=id
```

## Context tersembunyi

Ikut bersama context (termasuk ke dalam job) tapi tidak pernah sampai ke entri
log — untuk hal yang dibutuhkan trace tapi tidak boleh disimpan file log:

```ts
Context.addHidden('api_token', token)
Context.getHidden('api_token')
```
