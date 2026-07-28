# HTTP Client

A fluent wrapper over `fetch` for calling other services — headers,
timeouts, retries, and a fakeable transport for tests, Laravel's `Http`
facade.

## Making requests

```ts
import { Http } from '@elyvel/core'

const res = await Http.get('https://api.example.com/users/1')
const created = await Http.post('https://api.example.com/users', { name: 'Ada' })

if (res.ok)
  return res.json()
```

`get`/`post`/`put`/`patch`/`delete(url, data?)` are available directly on
`Http`, or chained after any of the fluent configuration methods below —
each returns a `HttpResponse`.

## Configuring a request

```ts
const res = await Http
  .withToken(apiToken)
  .withHeaders({ 'X-App-Version': '2.0' })
  .withBaseUrl('https://api.example.com')
  .timeout(5000)
  .retry(3, 200) // up to 3 retries, 200ms between each
  .get('/users/1') // resolved against the base URL
```

`withToken(token, scheme?)` sets an `Authorization` header (`Bearer` by
default). Every `with*`/`timeout`/`retry` call returns a new, independent
request builder — safe to build a base client once and branch off it per
call site without one call's config leaking into another's.

Retries apply on a thrown error (network failure, timeout) or a 5xx
response — a 4xx is returned as-is, not retried.

## Reading the response

```ts
res.ok            // 2xx
res.failed        // not 2xx
res.clientError   // 4xx
res.serverError   // 5xx
res.status
res.json<T>()
res.text()
res.throwIfFailed() // throws if not 2xx — chainable
```

## Testing

Swap the real network for canned responses, matched by URL glob:

```ts
import { Http } from '@elyvel/core'

Http.fake({
  'https://api.example.com/users/*': { status: 200, json: { id: 1, name: 'Ada' } },
  '*': { status: 500 }, // fallback for anything else
})

const res = await Http.get('https://api.example.com/users/1')

Http.assertSent(req => req.method === 'GET' && req.url.includes('/users/1'))
Http.stopFaking() // restore the real fetch transport
```

`Http.recorded()` returns every request made while faking, for custom
assertions beyond `assertSent`/`assertNothingSent`.
