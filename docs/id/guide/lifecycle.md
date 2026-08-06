# Siklus Hidup Request

Tahu urutan kejadian mengubah "kenapa session kosong di hook ini?" dari misteri
menjadi sekadar melihat daftar. Halaman ini daftarnya.

## Boot

`Application.create()` (dipanggil `server.ts`) berjalan sekali, dalam urutan ini:

1. **Config** — semua file `config/` dimuat; `.env` sudah berlaku.
2. **Logger** — channel dibangun dari `config/logging.ts`; kunci enkripsi dan
   kunci penandatangan URL di-set dari `app.key`.
3. **Maintenance mode** — penjaga paling awal: outage memutus semua request
   sebelum apa pun berjalan.
4. **Request context** — correlation id, logger per-request, scope
   [Context](/id/digging-deeper/context), scope actor.
5. **Registry middleware** — alias dan group dari `config/middleware.ts`.
6. **Normalisasi response** — redirect, file, view (lihat
   [Response](/id/basics/responses)). Dipasang sebelum session supaya flash
   mendarat sebelum session dipersist.
7. **Session** — cookie atau store server-side, CSRF.
8. **Halaman error** — setelah session, supaya redirect-back 422 menang sebelum
   halaman error dirender.
9. **Timezone**, lalu **OpenAPI** (sebelum route, supaya plugin melihat semuanya).
10. **Service provider** — provider paket hasil discovery dulu (dari
    `bootstrap/providers.generated.ts`), lalu daftar `config/app.ts`. Semua
    `register()` jalan, route dimuat dari `routes/`, lalu semua `boot()`.

Kemudian `listen()` menyalakan server.

## Satu request

```
request
  → cek maintenance
  → request context (id, log, scope Context/actor dibuka)
  → middleware global (config/middleware.ts `global`)
  → middleware group (`web` → session + CSRF, `api`, …)
  → middleware route
  → route handler                ← kodemu
  → normalisasi response (redirect/file/view/JSON)
  → terminator (middleware `terminate()`, setelah response)
```

Dua konsekuensi yang layak diketahui:

- **Session hanya ada di dalam group `web`** (atau di mana pun kamu memasangnya).
  Handler di luar itu tidak punya `ctx.session`.
- **`@WithoutMiddleware`** mencopot middleware dari mana pun asalnya — route,
  group, atau global — mengikuti `->withoutMiddleware()` Laravel.

## Error

Error yang tidak tertangkap melewati satu pipeline: dicatat (dengan correlation
id request-nya) → session diberi kesempatan redirect-back (validasi 422) →
dirender, menghormati `Accept` (JSON untuk klien API, halaman error untuk
browser) dan `app.debug` untuk trace. Detail:
[Error handling](/id/basics/error-handling).
