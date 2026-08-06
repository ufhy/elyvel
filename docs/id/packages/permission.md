# Permission

`@elyvel/permission` menyimpan **role dan permission di database**, seperti
[spatie/laravel-permission](https://github.com/spatie/laravel-permission):
kamu memberi user sebuah role, role membawa permission, dan kodemu bertanya
"boleh tidak?" tanpa menuliskan jabatan siapa pun secara keras.

Ia melengkapi [otorisasi](/id/security/authorization), bukan menggantikannya:
`Gate` dan policy tetap menjawab pertanyaan tentang *satu record tertentu*
("bolehkah Ada menyunting post **ini**?"). Paket ini menjawab pertanyaan
tentang *apa yang boleh dilakukan seseorang secara umum* — dan bisa
menyuapkan jawabannya ke Gate.

## Instalasi

```sh
bun add @elyvel/permission
bun elyvel permission:migration   # menulis migration-nya
bun elyvel migrate                # membuat lima tabelnya
```

Lalu pasang concern-nya ke model yang menerima role:

```ts
// app/models/User.ts
import { Model, withConcerns } from '@elyvel/database'
import { HasRoles, type HasRolesFields } from '@elyvel/permission'

// eslint-disable-next-line ts/no-unsafe-declaration-merging
export interface User extends HasRolesFields {}

// eslint-disable-next-line ts/no-unsafe-declaration-merging
export class User extends Model {
  static override table = 'users'
}
withConcerns(User, HasRoles)
```

Baris `interface User extends HasRolesFields` itulah yang membuat
`user.assignRole(...)` lolos type-check — resep yang sama dengan
[model concern](/id/database/eloquent#model-concern-padanan-trait) mana pun.

## Semuanya `await`

Ini satu-satunya perbedaan nyata dari Laravel. Di sana
`$user->hasRole('admin')` menyembunyikan query-nya di balik relasi lazy; di
sini setiap pengecekan adalah baca database, jadi setiap pengecekan asinkron:

```ts
await Role.create({ name: 'writer', guard: 'web' })
await Permission.create({ name: 'edit posts', guard: 'web' })

await user.assignRole('writer')
await user.givePermissionTo('edit posts')   // langsung ke user, tanpa role

await user.hasRole('writer')                // true
await user.hasPermissionTo('edit posts')    // true
await user.getAllPermissions()              // ['edit posts']
```

Di dalam request kamu jarang menulis ini — lihat [Integrasi Gate](#integrasi-gate).

### Seluruh permukaannya

| Role | Permission |
| --- | --- |
| `assignRole(...)` | `givePermissionTo(...)` |
| `removeRole(...)` | `revokePermissionTo(...)` |
| `syncRoles(...)` | `syncPermissions(...)` |
| `hasRole(nama, guard?)` | `hasPermissionTo(nama, guard?)` |
| `hasAnyRole(...)` | `hasAllPermissions(nama, guard?)` |
| `hasAllRoles(nama, guard?)` | `hasDirectPermission(nama, guard?)` |
| `getRoleNames()` | `getAllPermissions()` |
| `roles()` → `Role[]` | `permissions()` → `Permission[]` (yang langsung saja) |

Nama boleh dipisah pipa — `hasRole('admin|editor')` berarti salah satu, sama
dengan bentuk string yang dikirim middleware.

**Nama yang tidak ada akan melempar error.** `assignRole('wrtier')` itu error,
bukan no-op: memberi nol hak secara diam-diam adalah cara bug otorisasi lolos
ke produksi, karena di tempat pemanggilan tulisannya persis seperti berhasil.

## Role di model apa pun

Kedua tabel pivotnya polimorfik (`model_type` + `model_id`), jadi role bukan
fitur khusus user — pasang concern-nya ke `Team`, `ApiClient`, apa pun yang
membutuhkan. Dua model berbeda dengan id baris yang sama tetap terpisah
role-nya.

## Middleware

Daftarkan alias-nya sekali:

```ts
// config/middleware.ts
import { defineMiddlewareConfig } from '@elyvel/core'
import { permissionMiddlewareAliases } from '@elyvel/permission'

export default defineMiddlewareConfig({
  aliases: { ...permissionMiddlewareAliases },
  groups: {
    web: ['permissions'], // ← memuat nama-nama milik user aktif; lihat di bawah
  },
})
```

Lalu jaga route-nya:

```ts
route().get('/admin', handler, { middleware: 'role:admin|editor' })
route().post('/posts', handler, { middleware: 'permission:create posts' })
route().get('/panel', handler, { middleware: 'role_or_permission:admin|view panel' })
```

Pipa berarti "salah satu". Argumen kedua mempersempit guard: `role:admin,api`.
Pemanggil yang belum login mendapat **403**, bukan 401 — pilihan yang sama
dengan spatie: route-nya ada dan request-nya bisa dijawab, pemanggilnya saja
yang tidak berhak.

## Integrasi Gate

`Gate` sengaja sinkron, dan melempar error kalau sebuah ability mengembalikan
Promise — sebabnya adalah bug lama ketika policy async mengembalikan Promise
yang truthy lalu meloloskan semuanya. Pengecekan permission membaca database,
jadi tidak bisa ditempel langsung ke sana.

`PermissionContextMiddleware` (alias `permissions` di atas) yang
menyelesaikannya: ia memuat nama role dan permission user aktif **sekali per
request** ke [Context](/id/digging-deeper/context), dan hook Gate menjawab
dari himpunan di memori itu.

```ts
// dengan middleware-nya terpasang di grup, ini langsung jalan:
gate().allows('edit posts', user)   // sinkron, membaca nama yang sudah dimuat
```

Dua konsekuensi dari desain ini, keduanya disengaja:

- **Tanpa middleware-nya, hook Gate abstain** — ia mengembalikan "tidak
  berpendapat", jadi ability yang kamu definisikan sendiri tetap yang
  memutuskan. Ia tidak menolak.
- **Di luar request** (job antrean, CLI, tinker) tidak ada yang dimuat, jadi
  pakai `await user.hasPermissionTo(...)` di sana.

Taruh middleware-nya *setelah* apa pun yang mengautentikasi request; ia membaca
`ctx.user`.

### Memberi tahu model user-mu

Dengan Better Auth, `ctx.user` adalah **objek biasa**, bukan model Eloquent —
jadi nama class-nya tidak bisa dipakai sebagai `model_type`. Sebutkan
model-nya:

```ts
// config/permission.ts
import { AuthUser } from '@elyvel/auth'
import { definePermissionConfig } from '@elyvel/permission'

export default definePermissionConfig({ userModel: AuthUser })
```

Tanpa itu, request yang membawa user objek-biasa akan melempar error berisi
instruksi tersebut alih-alih menebak — menebak berarti role-nya tercatat di
`model_type` yang berbeda dari yang ditulis `AuthUser.assignRole()`, dan
diam-diam tidak akan pernah cocok. Aplikasi yang `ctx.user`-nya memang sudah
model bisa melewati langkah ini.

## Cache

Katalognya — semua role dan permission, dan permission apa yang diberikan tiap
role — di-cache lewat [`@elyvel/cache`](/id/digging-deeper/cache) selama 24
jam. Siapa memegang apa TIDAK di-cache; itu dibaca per model, dan sekali per
request kalau middleware-nya dipakai.

Setiap penulisan lewat paket ini otomatis membersihkan katalognya. Satu-satunya
kasus yang tidak terlihat olehnya adalah penulisan yang melewatinya — INSERT
SQL mentah, atau attach lewat relasi langsung
(`role.permissions().attach(...)`). Panggil `forgetPermissionCache()` sesudah
itu.

Kalau aplikasi sama sekali tidak punya cache terkonfigurasi, pengecekan tetap
jalan — hanya saja membaca tabelnya setiap kali.

## Guard

Sebuah role atau permission milik satu guard, persis seperti `guard_name` di
Laravel, jadi satu aplikasi bisa punya "admin" untuk sesi web dan "admin" lain
untuk token API tanpa keduanya bertabrakan.

Semantiknya mengikuti spatie persis, dan ketidaksimetrisannya disengaja:

- **Membaca tanpa guard cocok dengan guard mana pun.** `hasRole('admin')` true
  untuk admin di guard apa saja.
- **Menyebut satu guard mempersempitnya.** `hasRole('admin', 'api')`.
- **Menulis memakai default** `permission.defaultGuard` (`web`), karena sebuah
  role harus dibuat di bawah suatu guard.

## Konfigurasi

Semuanya sudah punya default; buat `config/permission.ts` hanya kalau mau
mengubah salah satunya:

```ts
import { definePermissionConfig } from '@elyvel/permission'

export default definePermissionConfig({
  defaultGuard: 'web',
  cacheSeconds: 24 * 60 * 60,
  tables: { roles: 'roles', permissions: 'permissions' },
  registerGate: true,
})
```

## Command

```sh
elyvel permission:migration                                   # buat migration-nya
elyvel permission:create-permission "edit posts"              # [--guard=web]
elyvel permission:create-role editor --permissions="edit posts,delete posts"
elyvel permission:show                                        # semua role dan isinya
```

## Cakupan

Yang belum termasuk, disebutkan supaya bukan kejutan: fitur **teams** milik
spatie (pelingkupan role multi-tenant — melipatgandakan skema, dan di sana pun
harus diaktifkan lewat config), **wildcard permission** (`posts.*`), dan
**event** role/permission.
