# Response

Apa yang dikembalikan route handler **itulah** response-nya. Framework
menormalkan bentuk-bentuk umum, jadi kebanyakan handler cukup mengembalikan nilai
dan tidak pernah menyentuh objek `Response`.

## JSON

Kembalikan apa pun yang bisa di-JSON dan ia keluar sebagai `application/json`:

```ts
route().get('/api/health', () => ({ status: 'ok' }))
```

Model diserialisasi lewat `toJSON`-nya (atribut hidden tetap tersembunyi, cast
berlaku). Untuk API sungguhan, bentuk keluarannya dengan
[API resource](/id/database/api-resources) alih-alih mengembalikan model mentah:

```ts
route().get('/users/:id', async ({ params }) => UserResource.make(await User.findOrFail(params.id)))
```

## Status code dan error

`status(code, body)` dari context handler mengatur keduanya. Untuk jalur error,
lempar `HttpException` — dirender sebagai JSON di jalur API dan halaman error di
jalur web, dengan [aturan error handling](/id/basics/error-handling) berlaku:

```ts
route().get('/report', ({ status }) => status(202, { queued: true }))

import { HttpException } from '@elyvel/support'
throw new HttpException(403, 'Invoice ini milik orang lain.')
```

## Redirect

`redirect()` dan `back()` mengembalikan `RedirectResponse` — 303 dengan header
`Location`. Method `with*` mem-flash ke session untuk request berikutnya:

```ts
import { back, redirect } from '@elyvel/core'

return redirect('/dashboard')
return redirect('/login').with('status', 'Akun dibuat — silakan masuk.')
return back().withErrors({ email: 'Sudah terpakai.' }).withInput(body)
```

`back()` membaca `Referer` tapi tidak pernah keluar dari origin-mu — halaman
lintas situs tidak bisa mengubahnya jadi open redirect.

## View

`view('welcome', { name })` merender template HTML (lihat
[View](/id/digging-deeper/views)); aplikasi Inertia mengembalikan
`Inertia.render('Dashboard', props)`.

## File dan unduhan

`file()` menyajikan path atau buffer; `download()` sama plus
`Content-Disposition: attachment`:

```ts
import { download, file } from '@elyvel/core'

return file('storage/app/report.pdf')
return download('storage/app/report.pdf', 'Laporan-Juli.pdf')
```

Stream (`ReadableStream`, async iterable) lewat begitu saja, jadi ekspor besar
tidak pernah menumpuk di memori.

## Header dan cookie

Context Elysia melakukannya langsung — tidak ada wrapper yang harus dipelajari:

```ts
route().get('/data', ({ set }) => {
  set.headers['cache-control'] = 'no-store'
  return { ok: true }
})
```

Cookie session, cookie CSRF, dan data flash dikelola plugin session; kamu jarang
menyetel cookie sendiri.
