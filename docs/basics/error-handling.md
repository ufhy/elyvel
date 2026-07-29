# Error Handling

An uncaught error becomes a response: a styled HTML page for a browser
navigation, JSON for an API or XHR client. The status code and the message the
client sees depend on **what kind of error** was thrown.

## Internal faults answer 500

Any error the framework doesn't recognise as client-facing is an internal fault.
It's logged in full, and the client gets a generic 500:

```ts
route().get('/posts/:id', async ({ params }) => {
  const post = await Post.find(params.id) // driver throws → 500, generic message
  return post
})
```

The error's own message is never sent, because an internal message routinely
contains things a client must not see — hostnames, connection strings, tokens in
a query string. In development, `app.debug` additionally renders a stack-trace
page for 5xx, but only on the web lane and never in production.

## Throwing a client-facing error

To choose the status *and* show a message, throw an `HttpException`:

```ts
import { HttpException } from '@elyvel/support'

route().get('/posts/:slug', async ({ params }) => {
  const post = await Post.query().where('slug', params.slug).first()
  if (!post)
    throw new HttpException(404, 'That post has been removed.')
  return post
})
```

```json
{ "message": "That post has been removed.", "status": 404 }
```

A third argument attaches field-level errors, rendered under `errors`:

```ts
throw new HttpException(422, 'The given data was invalid.', {
  email: ['That address is already registered.'],
})
```

Subclass it when the same failure recurs:

```ts
export class PostArchived extends HttpException {
  constructor() {
    super(410, 'This post has been archived.')
  }
}
```

A `5xx` `HttpException` is still scrubbed — marking an exception client-facing
lets you pick the status, not bypass the rule that server faults stay generic.

::: warning Attaching `status` to an ordinary error does nothing
```ts
// ✗ Answers 500. The status and message are both ignored.
throw Object.assign(new Error('Not found'), { status: 404 })
```

This used to work, and that was the bug: outbound HTTP clients and database
drivers routinely put a numeric `status` on their rejections, so an internal
fault was relayed to the client as a plausible-looking 4xx with its internal
message echoed verbatim — in production too. Only an exception that opts in via
`HttpException` is trusted now.

Migrating is one line: `throw new HttpException(404, 'Not found')`.
:::

## The framework's own exceptions

These already extend `HttpException`, so they render as themselves rather than as
a 500:

| Exception | Status | Thrown by |
| --- | --- | --- |
| `ValidationException` | 422 | a failed `validate()` / FormRequest |
| `AuthorizationException` | 403 | a FormRequest whose `authorize()` returned false |
| `AuthorizationError` | 403 (configurable) | `gate().authorize()`, the `can` guard, `@Authorize` |

Elysia's own conditions are mapped by code rather than by exception class:
`NOT_FOUND` → 404, `VALIDATION` → 422, `PARSE` and
`INVALID_COOKIE_SIGNATURE` → 400.

## Returning a status instead of throwing

A handler or guard can return an error status directly. Because you chose the
status and body explicitly, the message is shown as given:

```ts
route().get('/posts/:id', ({ status }) => status(403, { message: 'You do not own this post.' }))
```

On the web lane this is rewritten into an error page carrying that message; JSON
clients receive the body unchanged. 5xx is scrubbed here too.

## On the web lane

A 422 `HttpException` carrying an error bag behaves like Laravel's validation
redirect for a browser navigation: it redirects back with `errors` and
`_old_input` flashed to the session instead of returning JSON. API clients still
get the 422 body. See [Validation](/basics/validation).

## Customizing the error page

```ts
import { configureErrorPage } from '@elyvel/core'

configureErrorPage((status, { message, request, session }) =>
  view(ErrorPage, { status, message: message ?? 'Something went wrong.' }))
```

The resolver receives the status and a context (`request`, `message`, `error`,
`session`) and may return HTML, a `Response`, or a view. It's consulted only on
the web lane, so JSON responses are never affected by it. `message` is
`undefined` for 5xx — that's the scrubbing described above, so supply your own
copy for those.
