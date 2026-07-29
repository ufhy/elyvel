# Broadcasting

Push server-side events to connected clients in real time — a new comment
appearing live, a job's progress updating — over a WebSocket server built
directly on Bun's native pub/sub. No Pusher, Ably, or separate WS process
needed.

## Configuration

```ts
// config/broadcasting.ts
import { defineBroadcastConfig } from '@elyvel/broadcasting'

export default defineBroadcastConfig({
  driver: process.env.BROADCAST_DRIVER ?? 'log',
  authenticate: async (request) => {
    // resolve a session from the WS upgrade request's cookies; `false` rejects
    // the connection with 401, anything else becomes the connection's identity
    const session = await auth().api.getSession({ headers: request.headers })
    return session?.user ?? null
  },
})
```

Four drivers: `websocket` (real pub/sub, single process), `redis` (same
hub, but relays broadcasts across processes/instances via Redis pub/sub —
`url`/`channel` options configure the connection), `log` (writes to the
logger, the dev default), and `array` (collects in memory — see
[Testing](#testing)).

The `redis` driver is backed by an importable `RedisBroadcaster` class if
you need to construct one manually (a custom Redis client, or listening
for `RedisConnectionEvent`s like reconnects):

```ts
import { RedisBroadcaster } from '@elyvel/broadcasting'

const broadcaster = new RedisBroadcaster(
  publisherClient,   // a plain { send(command, args) } — the publish side
  subscriberClient,  // a SEPARATE connection — Redis can't publish and subscribe on one
  hub,
  'elyvel-broadcast', // wire channel, default shown
  event => console.log('redis:', event), // 'connected' | 'disconnected'
)
await broadcaster.listen() // start relaying — call once at boot
```

## Channels & authorization

Channel names follow Laravel's convention: a bare name (`posts.5`) is
public; `private-*`/`presence-*` prefixes require an authorization rule.
Register rules at boot (typically in a service provider's `boot()`):

```ts
import { channel } from '@elyvel/broadcasting'

channel('private-posts.{postId}', async (identity, { postId }) => {
  const post = await Post.find(postId)
  if (!post)
    return false
  return post.published || (identity as User | null)?.id === post.user_id
})
```

`identity` is whatever `authenticate()` resolved for that connection at
upgrade time. **A `private-`/`presence-` channel with no matching rule
denies every subscriber by default** — there's no accidentally-public
private channel. A denied subscribe attempt gets back a `subscription_error`
frame instead of data.

::: warning Presence channels
`presence-*` is currently just a naming convention subject to the same
authorization gate as `private-*` — there's no member list or
`joining`/`leaving` tracking yet. Don't rely on presence-specific behavior.
:::

## Broadcasting an event

Extend `Broadcastable` and say which channel(s) it goes on:

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

`broadcastAs()` defaults to the class name (the `event` field clients
receive); `broadcastWith()` defaults to every own property on the instance
if you don't override it.

## Client-side

There's no shipped client helper yet (no Echo equivalent) — subscribe with
a plain `WebSocket` matching the wire protocol directly:

```ts
const ws = new WebSocket(`wss://${location.host}/`)

ws.onopen = () => ws.send(JSON.stringify({ event: 'subscribe', channel: `private-posts.${postId}` }))

ws.onmessage = ({ data }) => {
  const frame = JSON.parse(data)
  if (frame.channel === `private-posts.${postId}` && frame.event === 'CommentBroadcast') {
    // frame.payload — the broadcastWith() data
  }
  if (frame.event === 'subscription_error') {
    // access denied
  }
}
```

## Notifications integration

`@elyvel/notifications`' `broadcast` channel pushes a notification's
`toBroadcast()` payload to `private-notifications.<id>` (or a routed channel)
the same way the `mail`/`database`/`telegram` channels deliver theirs — see
[Notifications](/digging-deeper/notifications).

The channel is **private**, and `BroadcastServiceProvider` registers its
authorizer for you: a socket may only subscribe to the channel matching its
own authenticated key. Subscribe with the prefix included:

```ts
ws.send(JSON.stringify({ event: 'subscribe', channel: `private-notifications.${user.id}` }))
```

::: warning A notification channel must never be public
Without the `private-` prefix the hub treats a channel as public and lets
anyone subscribe — any unauthenticated socket could read another user's
notification payloads by guessing their id. If you override the channel with
`routeNotificationFor('broadcast')`, keep the `private-` (or `presence-`)
prefix and register a matching `hub.channel(...)` rule.
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

For channel-authorization logic itself, boot a real app with `app.listen(port)`
and drive an actual `WebSocket` client through subscribe/deny scenarios —
there's no shortcut for testing the auth rule other than a real handshake.
