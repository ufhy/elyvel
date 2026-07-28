# Authentication

Authentication di elyvel ditenagai oleh [Better Auth](https://www.better-auth.com)
yang berjalan di atas adapter Eloquent framework, dibungkus agar terasa seperti
bagian lain dari framework: **setiap alur auth divalidasi melalui FormRequest**,
error dikembalikan dalam envelope `{ message, errors }` terjemahan yang sama
seperti request lainnya, dan aturan tiap alur bisa ditukar tanpa menyentuh satu
route pun.

## Konfigurasi

Authentication dikonfigurasi di `config/auth.ts` dengan **opsi Better Auth
native** — framework hanya mengisi lem penghubung (adapter Eloquent, secret yang
diturunkan dari `APP_KEY`, base URL, prefix cookie, dan nama tabel bentuk jamak).

```ts
// config/auth.ts
import { defineAuthConfig } from '@elyvel/auth'
import { twoFactor } from 'better-auth/plugins'

export default defineAuthConfig({
  // Which endpoints are exposed (see “Features” below).
  features: {
    registration: true,
    passwordReset: true,
    emailVerification: true,
  },

  // Native Better Auth options — the Better Auth docs apply directly here.
  plugins: [twoFactor()],
  emailAndPassword: { enabled: true, requireEmailVerification: false },
})
```

### Menambah plugin setelah aplikasi sudah dimigrasikan

Mengaktifkan plugin baru (mis. `username()`) pada aplikasi yang migrasi
pertamanya sudah pernah dijalankan itu aman: `migrateBetterAuth` (dipakai oleh
migration yang membuat tabel-tabel Better Auth) bersifat **idempotent dan
inkremental** — tabel yang sudah ada dibiarkan apa adanya kecuali kolom yang
ditambahkan plugin baru, dan tabel plugin yang sepenuhnya baru (mis. tabel
`twoFactor` milik `twoFactor()` sendiri) dibuat.

1. Tambahkan plugin ke `config/auth.ts` secara manual (import dari
   `better-auth/plugins`, tambahkan ke `plugins: [...]`).
2. Jalankan `elyvel auth:generate-migration-plugin` — tidak perlu memikirkan
   nama, ini menggenerate migration yang menjalankan ulang `migrateBetterAuth`.
3. `elyvel migrate`.

```ts
// config/auth.ts
import { twoFactor, username } from 'better-auth/plugins'

export default defineAuthConfig({
  plugins: [twoFactor(), username()], // username() ditambahkan belakangan
})
```

## Pemasangan

Better Auth dipasang sekali, sebagai global middleware, di `config/middleware.ts`:

```ts
// config/middleware.ts
import { betterAuthPlugin } from '@elyvel/auth'

export default defineMiddlewareConfig({
  global: [
    betterAuthPlugin(), // mounts /api/auth/*, derives `user`, adds guard macros
    // …
  ],
})
```

`betterAuthPlugin()` hanya menerima opsi HTTP-wiring — `{ instance?, basePath? }`.
Instance Better Auth di-resolve secara lazy dari container, jadi file route tidak
pernah meng-import-nya. Di file route Anda, `webRoute()` memberikan router dengan
`user` yang terautentikasi sudah bertipe di dalam context.

## Melindungi route

Gunakan middleware `auth` dan `verified` — padanan dari `auth` dan `verified`
milik Laravel:

```ts
// routes/web.ts
webRoute()
  .get('/dashboard', ({ user }) => Inertia.render('Dashboard', { user }), {
    middleware: ['auth'],
  })
  .get('/billing', ({ user }) => /* … */, { middleware: ['verified'] })
```

- **`auth`** — mensyaratkan user yang sudah masuk. Navigasi browser dialihkan ke
  halaman login; request API/JSON mendapat `401`.
- **`verified`** — juga mensyaratkan email yang terverifikasi; browser yang belum
  terverifikasi dikirim ke notice verify-email, request API mendapat `403`.

Target redirect berasal dari `config/auth.ts` — satu sumber tunggal yang dipakai
bersama oleh para guard:

```ts
export default defineAuthConfig({
  loginPath: '/login', // where guests are sent (default)
  verifyPath: '/verify-email', // where unverified users are sent (default)
})
```

### User yang terautentikasi

Di dalam handler route mana pun, `ctx.user` adalah user yang sudah masuk (atau
`null`), dan helper gate terikat padanya:

```ts
webRoute().get('/posts/:id/edit', (ctx) => {
  ctx.authorize('update', post) // throws 403 if the policy denies
  return Inertia.render('Posts/Edit', { post, user: ctx.user })
}, { middleware: ['auth'] })
```

`ctx.can(ability, …)`, `ctx.cannot(…)`, dan `ctx.authorize(…)` juga tersedia.

### Model Eloquent untuk tabel-tabel auth

Tabel milik Better Auth sendiri diekspos sebagai model Eloquent asli — jadi
Anda bisa query dan berelasi dengannya seperti tabel lain di framework, bukan
sekadar menyentuh kolom `user_id` polos:

```ts
import { AuthUser } from '@elyvel/auth'

const user = await AuthUser.find(id)
const accounts = await user.accounts().get() // hasMany(AuthAccount, 'user_id')
const sessions = await user.sessions().get() // hasMany(AuthSession, 'user_id')
```

| Model | Tabel | Catatan |
| --- | --- | --- |
| `AuthUser` | `users` | Relasi `accounts()`, `sessions()`. |
| `AuthAccount` | `accounts` | Satu baris per metode login yang tertaut (password, tiap provider OAuth). `user()` belongsTo `AuthUser`. Menyembunyikan `access_token`/`refresh_token`/`id_token`/`password`. |
| `AuthSession` | `sessions` | Satu baris per sesi login aktif. `user()` belongsTo `AuthUser`. Menyembunyikan `token`. |
| `AuthVerification` | `verifications` | Token verifikasi email / reset password, di-key berdasarkan `identifier` (mis. email) — tidak ada FK ke `users`. |

Hanya field yang selalu dimiliki Better Auth yang dideklarasikan/bertipe.
Field tambahan milik plugin di `users` (mis. `twoFactorEnabled` dari
`twoFactor()`) tetap merupakan attribute asli pada baris tersebut — `declare`
sendiri di subclass kalau ingin diberi tipe:

```ts
// app/models/User.ts
import { AuthUser } from '@elyvel/auth'
import { Post } from './Post'

export class User extends AuthUser {
  declare twoFactorEnabled: boolean

  posts() {
    return this.hasMany(Post, 'user_id')
  }
}
```

::: tip Batasan subclass
Relasi yang didefinisikan di class dasar — `AuthAccount.user()` →
`belongsTo(AuthUser, ...)` — tetap menghasilkan instance `AuthUser` dasar,
bukan subclass `User` Anda, walau barisnya sama persis. Kalau butuh itu ikut
ter-upgrade, subclass juga `AuthAccount`/`AuthSession` dan override `user()`
supaya menunjuk ke class `User` Anda sendiri.
:::

Field Better Auth sendiri itu camelCase (`emailVerified`, `userId`, …); elyvel
me-remap setiap field inti ke nama kolom snake_case-nya (`email_verified`,
`user_id`, …) supaya cocok dengan tabel lain di framework. Ini hanya mengubah
nama kolom yang disimpan — API level-JS milik Better Auth sendiri
(`ctx.user.emailVerified`, `session.userId`) sama sekali tidak terpengaruh.
Field tambahan milik plugin di tabel inti (mis. `twoFactorEnabled` dari
`twoFactor()`) **tidak** ikut di-remap dan tetap camelCase.

## Memvalidasi & mengustomisasi tiap alur

Setiap alur auth divalidasi oleh sebuah **FormRequest**, persis seperti bagian
lain dari framework. Request default disertakan bersama framework; Anda menukar
salah satunya melalui registry `AuthActions` (analog dari `createUsersUsing` milik
Laravel Fortify) di dalam `boot()` sebuah service provider:

| Alur | Endpoint | Ditukar dengan |
| --- | --- | --- |
| Registration | `POST /api/auth/sign-up/email` | `AuthActions.registerUsing()` |
| Login | `POST /api/auth/sign-in/email` | `AuthActions.loginUsing()` |
| Password reset | `POST /api/auth/reset-password` | `AuthActions.resetPasswordUsing()` |
| Change password | `POST /api/auth/change-password` | `AuthActions.updatePasswordUsing()` |
| Update profile | `POST /api/auth/update-user` | `AuthActions.updateProfileUsing()` |

Validasi berjalan baik saat endpoint diakses melalui HTTP **maupun** dipanggil
secara programatik via `auth.api.*` — jadi route kustom yang memanggil server API
juga tervalidasi.

### Contoh: mewajibkan konfirmasi password saat registrasi

```ts
// app/requests/RegisterRequest.ts
import type { Rules } from '@elyvel/validation'
import { FormRequest, Password } from '@elyvel/validation'

export class RegisterRequest extends FormRequest {
  rules(): Rules {
    return {
      name: 'required|string|max:255',
      email: 'required|email',
      // `confirmed` requires a matching `password_confirmation` field.
      password: ['required', 'string', 'confirmed', Password.default()],
    }
  }
}
```

```ts
// app/providers/AppServiceProvider.ts
import { AuthActions } from '@elyvel/auth'
import { RegisterRequest } from '../requests/RegisterRequest'

export class AppServiceProvider extends ServiceProvider {
  boot(): void {
    AuthActions.registerUsing(RegisterRequest)
  }
}
```

Aturan yang gagal mengembalikan `422` standar framework:

```json
{
  "message": "The name field is required. (and 1 more error)",
  "errors": {
    "name": ["The name field is required."],
    "password": ["The password confirmation does not match."]
  }
}
```

::: tip
Aturan `confirmed` melaporkan ketidakcocokan pada field **`password`** (mengikuti
Laravel), jadi tampilkan error tersebut di bawah input password Anda, bukan di
input konfirmasi.
:::

## Kebijakan password

Definisikan aturan password Anda **sekali** dengan `Password.defaults()` — padanan
`Password::defaults()` milik Laravel. Ini mengatur registrasi, password reset, dan
change-password secara seragam, dan `minPasswordLength` milik Better Auth sendiri
otomatis dijaga sinkron dengannya.

```ts
// app/providers/AppServiceProvider.ts
import { Password } from '@elyvel/validation'

boot(): void {
  Password.defaults(() =>
    this.app.config.get('app.env') === 'production'
      ? Password.min(10).mixedCase().numbers().uncompromised()
      : Password.min(8),
  )
}
```

`uncompromised()` memeriksa password terhadap korpus kebocoran Have I Been Pwned
(k-anonymity — hanya prefix SHA-1 yang pernah dikirim, dan gagal secara terbuka
jika layanan tidak dapat dijangkau).

## Features — menutup endpoint

Map `features` mengontrol endpoint auth mana yang diekspos. Feature yang
dinonaktifkan menjadi **`404` sungguhan** (bukan route yang ada-tapi-dilarang),
sehingga tidak dapat dibedakan dari route yang memang tidak pernah didaftarkan.

```ts
export default defineAuthConfig({
  features: {
    registration: false, // no public sign-up endpoint
    passwordReset: true,
    emailVerification: true,
    // signIn, socialSignIn, signOut, sessions, changeEmail,
    // updatePassword, updateProfile, accounts, deleteUser …
  },
})
```

Gating bersifat HTTP-only: **`auth.api.*` tetap berfungsi** bahkan ketika route
publik sebuah feature ditutup. Ini memberi Anda dua pola yang bersih:

- **Invite-only** — set `registration: false`, lalu buat user di sisi server
  (dari layar admin, alur undangan, seeder) dengan `auth.api.signUpEmail`.
- **Bring-your-own registration URL** — set `registration: false`, lalu
  definisikan route `POST /register` Anda sendiri yang memanggil
  `auth.api.signUpEmail` — tidak ada endpoint default menggantung yang tersisa
  terekspos.

```ts
// routes/auth.ts — a fully custom registration endpoint
webRoute().post('/register', async ({ body }) => {
  return app(AuthToken).api.signUpEmail({ body, asResponse: true })
})
```

::: tip Nonaktifkan vs tutup
`features.registration: false` menutup **route publik** tetapi mempertahankan API
programatik. Untuk menonaktifkan registrasi *sepenuhnya* (bahkan di sisi server),
gunakan `emailAndPassword.disableSignUp: true` milik Better Auth sendiri.
:::

## Field registrasi tambahan

Deklarasikan field user tambahan dengan `additionalFields` native milik Better
Auth; field tersebut dipersistensi dan divalidasi oleh Better Auth, dan Anda dapat
memvalidasinya di FormRequest Anda untuk mendapatkan error yang diterjemahkan dan
berbentuk-framework:

```ts
export default defineAuthConfig({
  user: {
    additionalFields: {
      company: { type: 'string', required: false },
    },
  },
})
```

Setiap key body yang bukan field yang dideklarasikan (misalnya
`password_confirmation`) cukup diabaikan oleh sign-up API — tidak pernah
menyebabkan error "field not allowed".

## Verifikasi email

Sediakan callback mailer di `config/auth.ts`; Better Auth mengirim tautan
verifikasi (saat sign-up secara default):

```ts
export default defineAuthConfig({
  emailAndPassword: { requireEmailVerification: true },
  emailVerification: {
    sendVerificationEmail: ({ user, url }) =>
      Mail.to(user.email).subject('Verify your email').html(`<a href="${url}">Verify</a>`).send(),
  },
})
```

Dengan `requireEmailVerification: true`, user yang belum terverifikasi tidak dapat
masuk dan guard `verified` mengirim mereka ke `verifyPath`. Kirim ulang tautan
dari sisi client:

```ts
authApi.sendVerification(email, callbackURL) // POST /api/auth/send-verification-email
```

## Reset password

Sediakan mailer reset, lalu jalankan alur dua langkah dari sisi client:

```ts
export default defineAuthConfig({
  emailAndPassword: {
    sendResetPassword: ({ user, url }) =>
      Mail.to(user.email).subject('Reset your password').html(`<a href="${url}">Reset</a>`).send(),
  },
})
```

```ts
authApi.requestPasswordReset(email, redirectTo) // emails a reset link
authApi.resetPassword(newPassword, token)        // sets the new password
```

`resetPassword` berjalan melalui `ResetPasswordRequest`, jadi kebijakan
`Password.defaults()` yang berlaku di seluruh aplikasi juga berlaku di sini.

## Autentikasi dua faktor

Aktifkan plugin `twoFactor()` di `config/auth.ts`:

```ts
import { twoFactor } from 'better-auth/plugins'

export default defineAuthConfig({ plugins: [twoFactor()] })
```

`authHasPlugin('two-factor')` memungkinkan Anda meng-feature-gate UI. Pendaftaran
dan challenge berjalan melalui client:

```ts
authApi.enableTwoFactor(password)   // → { totpURI, backupCodes } — show the QR
authApi.verifyTotp(code)            // confirm enrollment / clear a sign-in challenge
authApi.verifyBackupCode(code)      // use a backup code instead
authApi.disableTwoFactor(password)
authApi.generateBackupCodes(password)
```

Ketika 2FA diaktifkan, sebuah sign-in mengembalikan two-factor challenge;
selesaikan dengan `verifyTotp` (atau `verifyBackupCode`) sebelum session
terbentuk.

## Login sosial

Provider bersifat opt-in — sebuah tombol muncul hanya ketika credential-nya
tersedia (biasanya di-wire dari env):

```ts
export default defineAuthConfig({
  socialProviders: {
    github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! },
  },
})
```

`enabledSocialProviders(auth)` mengembalikan provider yang aktif sehingga Anda
dapat merender tombol yang tepat. Memulai alur mengembalikan URL OAuth untuk
dialihkan:

```ts
const { data } = await authApi.signInSocial('github', '/dashboard') // → { url }
```

## Sesi & keluar

User yang sudah masuk berasal dari cookie session; `ctx.user` diturunkan darinya
pada setiap request. Keluar dan kelola session dari sisi client:

```ts
authApi.signOut() // POST /api/auth/sign-out
```

Endpoint pengelolaan session (`list-sessions`, `revoke-session`,
`revoke-sessions`, `revoke-other-sessions`) di-gate oleh `features.sessions`.

## Rate limiting

Better Auth me-rate-limit route auth (sign-up/sign-in secara default ~3 request
per 10 detik), diaktifkan di production. Untuk menerapkannya di setiap environment
atau menyetelnya per path, set `rateLimit` di `config/auth.ts`:

```ts
export default defineAuthConfig({
  rateLimit: { enabled: true },
})
```

## Response error

Error mentah bertkode milik Better Auth dinormalisasi menjadi satu envelope
terjemahan tunggal milik framework sebelum sampai ke client:

```json
{ "message": "These credentials do not match our records." }
```

Kegagalan tingkat-field (email duplikat, password lemah) dikembalikan sebagai
`422` dengan bag `errors` yang di-key berdasarkan field — bentuk yang sama yang
dihasilkan setiap request tervalidasi di elyvel, dan diterjemahkan melalui
language namespace `auth::` dan `validation::`.

## Testing

Login sebagai user tertentu tanpa lewat alur Better Auth sungguhan —
lihat [HTTP Test](/id/digging-deeper/testing#bertindak-sebagai-user)
untuk seam testing lengkap
`actingAs()`/`stopActingAs()`/`actingAsGuest()`.

## Password hashing

`Hash` membungkus `Bun.password` native milik Bun (argon2id secara
default, verifikasi constant-time) — primitif yang sama yang dipakai
Better Auth sendiri di baliknya, tersedia langsung jika kamu pernah butuh
hash/verify password di luar alur auth:

```ts
import { Hash } from '@elyvel/auth'

const hashed = await Hash.make('a-plaintext-password')
await Hash.verify('a-plaintext-password', hashed) // boolean
```

## Auth token standalone (lanjutan)

Untuk gate API-token minimal yang tidak butuh session/2FA/login sosial —
API machine-to-machine atau mobile-client — `AuthManager` adalah
alternatif yang lebih ringan dan independen dari `betterAuthPlugin()`.
Keduanya tidak bisa digabung; pilih satu per aplikasi:

```ts
import { createAuth } from '@elyvel/auth'

const auth = createAuth({
  provider: myUserProvider,   // retrieveById / retrieveByCredentials / validateCredentials
  tokens: myTokenStore,        // store / findUserId / revoke (hanya token yang di-hash)
  maxAttempts: 5,               // lockout login gagal, di-key berdasarkan email
  decayMinutes: 1,
})

const { user, token } = await auth.attempt({ email, password }) ?? {}
// throw TooManyAttemptsError saat lockout; return null saat kredensial salah

app.use(auth.guard()) // menurunkan `user`/`authToken`, menambah macro `auth`
```

Kamu mengimplementasikan `UserProvider`/`TokenStore` sendiri di atas
model-mu sendiri — ini sengaja dibuat DB-agnostic.
