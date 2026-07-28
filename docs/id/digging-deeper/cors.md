# CORS

Header Cross-Origin Resource Sharing sebagai plugin yang bisa di-`.use()`
— untuk API yang dikonsumsi frontend di origin berbeda (domain SPA
terpisah, aplikasi mobile, pihak ketiga).

## Pemakaian

```ts
import { cors } from '@elyvel/core'

route().use(cors({ origin: 'https://app.example.com' })).get('/api/posts', listPosts)
```

Atau terapkan secara global di `config/middleware.ts` supaya setiap route
mendapat header CORS:

```ts
// config/middleware.ts
import { cors } from '@elyvel/core'

export default defineMiddlewareConfig({
  global: [cors({ origin: 'https://app.example.com' })],
})
```

Ia mengatur header yang relevan di setiap response dan menjawab preflight
`OPTIONS` dengan `204` secara otomatis — tidak perlu route `OPTIONS`
terpisah.

## Opsi

```ts
cors({
  origin: 'https://app.example.com', // default '*'
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Access-Control-Allow-Credentials: true
  maxAge: 86400, // detik preflight response boleh di-cache
})
```

::: warning `credentials: true` butuh origin eksplisit
`Access-Control-Allow-Origin: *` dikombinasikan dengan
`Access-Control-Allow-Credentials: true` tidak valid menurut spek Fetch —
browser menolak response di sisi client untuk request apa pun yang
credentialed (cookie, header `Authorization`). `cors()` throw saat setup
jika kamu memberikan `credentials: true` tanpa juga mengatur `origin`
eksplisit, alih-alih membiarkan kombinasi itu gagal diam-diam dan
membingungkan di browser.
:::
