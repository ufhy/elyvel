# Rate Limiting

A named, reusable rate limiter — cache-backed, works both as request
middleware and as a plain function call for throttling arbitrary logic (an
SMS send, an expensive job) outside the request/response cycle.

This page goes deeper than the brief mention in
[Middleware](/basics/middleware#rate-limiting) — the store abstraction,
multi-limit ordering, response headers, and the `.after()` caveat.

## Defining named limiters

```ts
import { Limit, RateLimiter } from '@elyvel/core'

RateLimiter.for('api', () => Limit.perMinute(60))

RateLimiter.for('login', ctx => [
  Limit.perMinute(5), // global cap for this route
  Limit.perMinute(2).by(`email:${(ctx.body as any)?.email ?? ''}`), // per-email cap
])
```

`Limit` builders: `perSecond(max, seconds?)`, `perMinute(max)`,
`perMinutes(minutes, max)`, `perHour(max, hours?)`, `perDay(max, days?)`,
`none()` (unlimited — skips the store entirely). Chainable modifiers:
`.by(key)` (segment the bucket — per-user, per-email, per-IP override),
`.response(fn)` (custom rejection response), `.after(fn)` (see
[below](#deferred-counting-after)).

A limiter can return **multiple limits at once** — every request is checked
against all of them, and the **first one exceeded wins** (a stricter
per-segment cap can reject before a looser global one is even close). Each
limit in the array gets its own independent bucket, so a 5/min global +
2/min per-email pair tracks two separate counters, not one.

## Applying it as middleware

```ts
route().post('/login', handler, { middleware: 'throttle:login' }) // named
route().get('/api/ping', handler, { middleware: 'throttle:60,1' }) // inline: max,decayMinutes
```

The inline form has no way to set a custom response or multiple limits —
reach for a named limiter (`RateLimiter.for`) whenever you need either.

## Programmatic rate limiting

Throttle logic that isn't behind an HTTP route — an OTP send, a retry loop
— using the same facade and store:

```ts
import { RateLimiter } from '@elyvel/core'

const key = `otp:${phone}`

const sent = await RateLimiter.attempt(key, 3, async () => {
  await sendOtp(phone)
  return true
}, 60 * 15) // 3 sends per 15 minutes

if (!sent) {
  // already at the limit — attempt() didn't run the callback
}
```

Full facade: `attempt(key, max, callback, decaySeconds?)`, `hit(key,
decaySeconds?)`, `increment(key, decaySeconds?, amount?)`,
`tooManyAttempts(key, max)`, `remaining`/`retriesLeft(key, max)`,
`attempts(key)`, `resetAttempts`/`clear(key)`, `availableIn(key)`.

## The backing store

```ts
import { configureRateLimiterStore, RedisRateLimiterStore } from '@elyvel/core'

configureRateLimiterStore(new RedisRateLimiterStore(redisClient))
```

Default is an in-memory `MemoryRateLimiterStore` — fine for a single
process, but a multi-instance deployment behind a load balancer effectively
multiplies every limit by the instance count, since each process counts
independently. `RedisRateLimiterStore` shares counts across every instance
instead. Both implement the same small `RateLimiterStore` interface
(`increment`/`attempts`/`reset`/`availableIn`), so a custom store is just as
easy to plug in.

## Trusting proxy headers

By default, the client IP used for per-IP throttling comes from the real
socket connection — trusting `X-Forwarded-For` by default would let an
attacker rotate that header per request and defeat IP-based throttling
entirely. Behind a real reverse proxy, opt in explicitly:

```ts
import { trustProxies } from '@elyvel/core'

trustProxies() // now reads X-Forwarded-For (falling back to X-Real-IP)
```

## Response headers & customization

Every throttled request gets `x-ratelimit-limit` and `x-ratelimit-remaining`
(clamped at 0); a rejected one also gets `retry-after` (seconds until the
window resets) and a `429` with `{ message: 'Too Many Requests' }`
(translatable). Override the rejection response per-limit:

```ts
RateLimiter.for('api', () =>
  Limit.perMinute(60).response((ctx, headers) => ctx.status(429, { retryAfter: headers['retry-after'] })))
```

## Deferred counting: `.after()`

Normally a request counts against its limit the moment it arrives. `.after(status => boolean)`
defers that decision until the response status is known — count only 404s,
only 5xx, only failed logins, whatever the callback decides:

```ts
RateLimiter.for('search', () => Limit.perMinute(10).after(status => status === 404))
```

This runs the actual increment in an `onAfterResponse` hook — genuinely
after the response has already been sent, not synchronously inside the
handler. That means checking rate-limit state (`RateLimiter.attempts(key)`)
immediately after a request completes in-process may not yet reflect an
`.after()`-based count; it's guaranteed correct by the time a *subsequent*
request arrives over the wire, just not at the exact instant the current
response object returns. Plain (non-`.after()`) limits don't have this
caveat — they count synchronously during `handle()`.
