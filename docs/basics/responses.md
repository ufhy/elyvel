# Responses

What a route handler returns **is** the response. The framework normalises the
common shapes, so most handlers return a value and never touch a `Response`
object.

## JSON

Return anything JSON-serialisable and it goes out as `application/json`:

```ts
route().get('/api/health', () => ({ status: 'ok' }))
```

Models serialise through their `toJSON` (hidden attributes stay hidden, casts
apply). For a real API, shape the output with an
[API resource](/database/api-resources) instead of returning models raw:

```ts
route().get('/users/:id', async ({ params }) => UserResource.make(await User.findOrFail(params.id)))
```

## Status codes and errors

`status(code, body)` from the handler context sets both. For error paths, throw
an `HttpException` — it renders as JSON on the API lane and as an error page on
the web lane, with the [error-handling rules](/basics/error-handling) applied:

```ts
route().get('/report', ({ status }) => status(202, { queued: true }))

import { HttpException } from '@elyvel/support'
throw new HttpException(403, 'This invoice belongs to someone else.')
```

## Redirects

`redirect()` and `back()` return a `RedirectResponse` — a 303 with a `Location`
header. `with*` methods flash to the session for the next request:

```ts
import { back, redirect } from '@elyvel/core'

return redirect('/dashboard')
return redirect('/login').with('status', 'Account created — sign in.')
return back().withErrors({ email: 'Already taken.' }).withInput(body)
```

`back()` resolves from the `Referer` but never leaves your origin — a cross-site
page can't turn it into an open redirect.

## Views

`view('welcome', { name })` renders an HTML template (see
[Views](/digging-deeper/views)); Inertia apps return
`Inertia.render('Dashboard', props)` instead.

## Files and downloads

`file()` serves a path or buffer; `download()` is the same with
`Content-Disposition: attachment`:

```ts
import { download, file } from '@elyvel/core'

return file('storage/app/report.pdf')
return download('storage/app/report.pdf', 'Laporan-Juli.pdf')
```

Streams (`ReadableStream`, async iterables) pass through untouched, so a large
export never buffers in memory.

## Headers and cookies

Elysia's context does this directly — there is no wrapper to learn:

```ts
route().get('/data', ({ set }) => {
  set.headers['cache-control'] = 'no-store'
  return { ok: true }
})
```

The session cookie, CSRF cookie, and flash data are managed by the session
plugin; you rarely set cookies by hand.
