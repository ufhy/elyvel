# HTTP Client

Wrapper fluent di atas `fetch` untuk memanggil layanan lain — header,
timeout, retry, dan transport yang bisa di-fake untuk test, padanan
facade `Http` di Laravel.

## Membuat request

```ts
import { Http } from '@elyvel/core'

const res = await Http.get('https://api.example.com/users/1')
const created = await Http.post('https://api.example.com/users', { name: 'Ada' })

if (res.ok)
  return res.json()
```

`get`/`post`/`put`/`patch`/`delete(url, data?)` tersedia langsung di
`Http`, atau dirangkai setelah method konfigurasi fluent di bawah — masing-
masing mengembalikan `HttpResponse`.

## Mengonfigurasi request

```ts
const res = await Http
  .withToken(apiToken)
  .withHeaders({ 'X-App-Version': '2.0' })
  .withBaseUrl('https://api.example.com')
  .timeout(5000)
  .retry(3, 200) // sampai 3 kali retry, jeda 200ms antar tiap kali
  .get('/users/1') // di-resolve terhadap base URL
```

`withToken(token, scheme?)` mengatur header `Authorization` (default
`Bearer`). Setiap pemanggilan `with*`/`timeout`/`retry` mengembalikan
builder request baru yang independen — aman untuk membuat satu base
client lalu bercabang per call site tanpa config satu pemanggilan bocor
ke yang lain.

Retry berlaku saat error di-throw (kegagalan jaringan, timeout) atau
response 5xx — 4xx dikembalikan apa adanya, tidak di-retry.

## Membaca response

```ts
res.ok            // 2xx
res.failed        // bukan 2xx
res.clientError   // 4xx
res.serverError   // 5xx
res.status
res.json<T>()
res.text()
res.throwIfFailed() // throw jika bukan 2xx — chainable
```

## Testing

Ganti jaringan sungguhan dengan response kalengan, dicocokkan lewat glob
URL:

```ts
import { Http } from '@elyvel/core'

Http.fake({
  'https://api.example.com/users/*': { status: 200, json: { id: 1, name: 'Ada' } },
  '*': { status: 500 }, // fallback untuk yang lain
})

const res = await Http.get('https://api.example.com/users/1')

Http.assertSent(req => req.method === 'GET' && req.url.includes('/users/1'))
Http.stopFaking() // kembalikan transport fetch sungguhan
```

`Http.recorded()` mengembalikan setiap request yang dibuat selagi faking,
untuk assertion custom di luar `assertSent`/`assertNothingSent`.
