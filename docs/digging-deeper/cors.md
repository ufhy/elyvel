# CORS

Cross-Origin Resource Sharing headers as a `.use()`-able plugin — for an
API consumed by a frontend on a different origin (a separate SPA domain, a
mobile app, a third party).

## Usage

```ts
import { cors } from '@elyvel/core'

route().use(cors({ origin: 'https://app.example.com' })).get('/api/posts', listPosts)
```

Or apply it globally in `config/middleware.ts` so every route gets CORS
headers:

```ts
// config/middleware.ts
import { cors } from '@elyvel/core'

export default defineMiddlewareConfig({
  global: [cors({ origin: 'https://app.example.com' })],
})
```

It sets the relevant headers on every response and answers preflight
`OPTIONS` requests with `204` automatically — no separate `OPTIONS` route
needed.

## Options

```ts
cors({
  origin: 'https://app.example.com', // default '*'
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Access-Control-Allow-Credentials: true
  maxAge: 86400, // seconds a preflight response can be cached
})
```

::: warning `credentials: true` needs an explicit origin
`Access-Control-Allow-Origin: *` combined with
`Access-Control-Allow-Credentials: true` is invalid per the Fetch spec —
browsers reject the response client-side for any credentialed request
(cookies, `Authorization` headers). `cors()` throws at setup time if you
pass `credentials: true` without also setting an explicit `origin`, rather
than letting that combination fail silently and confusingly in the
browser.
:::
