# Broadcasting

Dorong event dari sisi server ke client yang terhubung secara real-time —
komentar baru muncul langsung, progress sebuah job ter-update — lewat
server WebSocket yang dibangun langsung di atas pub/sub native Bun. Tidak
butuh Pusher, Ably, atau proses WS terpisah.

## Konfigurasi

```ts
// config/broadcasting.ts
import { defineBroadcastConfig } from '@elyvel/broadcasting'

export default defineBroadcastConfig({
  driver: process.env.BROADCAST_DRIVER ?? 'log',
  authenticate: async (request) => {
    // resolve session dari cookie di request upgrade WS; `false` menolak
    // koneksi dengan 401, apa pun selain itu menjadi identity koneksinya
    const session = await auth().api.getSession({ headers: request.headers })
    return session?.user ?? null
  },
})
```

Empat driver: `websocket` (pub/sub sungguhan, satu proses), `redis` (hub
yang sama, tapi merelay broadcast antar proses/instance lewat Redis
pub/sub — opsi `url`/`channel` mengatur koneksinya), `log` (menulis ke
logger, default untuk dev), dan `array` (dikumpulkan di memory — lihat
[Testing](#testing)).

Driver `redis` didukung class `RedisBroadcaster` yang bisa di-import
jika kamu perlu membuatnya secara manual (client Redis custom, atau
mendengarkan `RedisConnectionEvent` seperti reconnect):

```ts
import { RedisBroadcaster } from '@elyvel/broadcasting'

const broadcaster = new RedisBroadcaster(
  publisherClient,   // { send(command, args) } biasa — sisi publish
  subscriberClient,  // koneksi TERPISAH — Redis tidak bisa publish dan subscribe di satu koneksi
  hub,
  'elyvel-broadcast', // wire channel, default ditampilkan
  event => console.log('redis:', event), // 'connected' | 'disconnected'
)
await broadcaster.listen() // mulai merelay — panggil sekali saat boot
```

## Channel & otorisasi

Nama channel mengikuti konvensi Laravel: nama polos (`posts.5`) bersifat
publik; prefix `private-*`/`presence-*` butuh aturan otorisasi. Daftarkan
aturan saat boot (biasanya di `boot()` sebuah service provider):

```ts
import { channel } from '@elyvel/broadcasting'

channel('private-posts.{postId}', async (identity, { postId }) => {
  const post = await Post.find(postId)
  if (!post)
    return false
  return post.published || (identity as User | null)?.id === post.user_id
})
```

`identity` adalah apa pun yang di-resolve `authenticate()` untuk koneksi
tersebut saat upgrade. **Channel `private-`/`presence-` tanpa aturan yang
cocok menolak setiap subscriber secara default** — tidak ada private
channel yang tanpa sengaja jadi publik. Percobaan subscribe yang ditolak
mendapat frame `subscription_error`, bukan data.

::: warning Presence channel
`presence-*` saat ini hanya konvensi penamaan yang tunduk pada gate
otorisasi yang sama dengan `private-*` — belum ada member list atau
tracking `joining`/`leaving`. Jangan mengandalkan perilaku khusus presence.
:::

## Broadcast sebuah event

Extend `Broadcastable` dan sebutkan channel mana yang dituju:

```ts
// app/broadcasts/CommentBroadcast.ts
import { Broadcastable } from '@elyvel/broadcasting'

export class CommentBroadcast extends Broadcastable {
  constructor(private comment: Comment, private post: Post) {
    super()
  }

  override broadcastOn(): string[] {
    return [`private-posts.${this.post.id}`]
  }

  override broadcastWith(): Record<string, unknown> {
    return { comment: this.comment.toObject() }
  }
}
```

```ts
import { broadcast } from '@elyvel/broadcasting'

await broadcast(new CommentBroadcast(comment, post))
```

`broadcastAs()` defaultnya nama class (field `event` yang diterima
client); `broadcastWith()` defaultnya semua property milik instance
tersebut jika tidak di-override.

## Sisi client

Belum ada client helper bawaan (belum ada padanan Echo) — subscribe dengan
`WebSocket` biasa yang mengikuti wire protocol-nya langsung:

```ts
const ws = new WebSocket(`wss://${location.host}/`)

ws.onopen = () => ws.send(JSON.stringify({ event: 'subscribe', channel: `private-posts.${postId}` }))

ws.onmessage = ({ data }) => {
  const frame = JSON.parse(data)
  if (frame.channel === `private-posts.${postId}` && frame.event === 'CommentBroadcast') {
    // frame.payload — data dari broadcastWith()
  }
  if (frame.event === 'subscription_error') {
    // akses ditolak
  }
}
```

## Integrasi notifikasi

Channel `broadcast` milik `@elyvel/notifications` mengirim payload
`toBroadcast()` sebuah notifikasi ke `private-notifications.<id>` (atau
channel yang di-route) dengan cara yang sama seperti channel `mail`/
`database`/`telegram` mengirimkan miliknya — lihat
[Notifikasi](/id/digging-deeper/notifications).

Channel-nya **private**, dan `BroadcastServiceProvider` mendaftarkan
authorizer-nya untukmu: sebuah socket hanya boleh subscribe ke channel yang
cocok dengan key terautentikasinya sendiri. Subscribe dengan prefix-nya:

```ts
ws.send(JSON.stringify({ event: 'subscribe', channel: `private-notifications.${user.id}` }))
```

::: warning Channel notifikasi tidak boleh publik
Tanpa prefix `private-`, hub-nya menganggap channel itu publik dan
mengizinkan siapa pun subscribe — socket yang tidak terautentikasi pun bisa
membaca payload notifikasi user lain hanya dengan menebak id-nya. Kalau kamu
meng-override channel-nya lewat `routeNotificationFor('broadcast')`,
pertahankan prefix `private-` (atau `presence-`) dan daftarkan rule
`hub.channel(...)` yang cocok.
:::

## Testing

```ts
import { ArrayBroadcaster, setDefaultBroadcaster } from '@elyvel/broadcasting'

const array = new ArrayBroadcaster()
setDefaultBroadcaster(array)

await broadcast(new CommentBroadcast(comment, post))

expect(array.sent).toHaveLength(1)
expect(array.sent[0]?.channels).toEqual([`private-posts.${post.id}`])
```

Untuk logika otorisasi channel itu sendiri, boot aplikasi sungguhan dengan
`app.listen(port)` dan jalankan client `WebSocket` asli lewat skenario
subscribe/tolak — tidak ada jalan pintas untuk menguji aturan otorisasi
selain handshake sungguhan.
