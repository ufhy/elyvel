import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry, route } from '../src/middleware'
import { Limit, RateLimiter, rateLimiter, ThrottleMiddleware, trustProxies } from '../src/throttle'

beforeEach(() => rateLimiter.clear())

// ── programmatic facade ──────────────────────────────────────────────────
describe('RateLimiter facade', () => {
  test('attempt runs until the limit, then returns false', async () => {
    const key = 'send:1'
    const run = () => RateLimiter.attempt(key, 3, () => 'sent')
    expect(await run()).toBe('sent')
    expect(await run()).toBe('sent')
    expect(await run()).toBe('sent')
    expect(await run()).toBe(false) // 4th blocked
  })

  test('hit / attempts / remaining / tooManyAttempts', async () => {
    const key = 'msg:1'
    expect(await RateLimiter.attempts(key)).toBe(0)
    await RateLimiter.hit(key)
    await RateLimiter.hit(key)
    expect(await RateLimiter.attempts(key)).toBe(2)
    expect(await RateLimiter.remaining(key, 5)).toBe(3)
    expect(await RateLimiter.tooManyAttempts(key, 2)).toBe(true)
    expect(await RateLimiter.tooManyAttempts(key, 3)).toBe(false)
  })

  test('increment by amount, availableIn, and clear', async () => {
    const key = 'bulk:1'
    expect(await RateLimiter.increment(key, 60, 5)).toBe(5)
    expect(await RateLimiter.availableIn(key)).toBeGreaterThan(0)
    expect(await RateLimiter.availableIn(key)).toBeLessThanOrEqual(60)
    await RateLimiter.clear(key)
    expect(await RateLimiter.attempts(key)).toBe(0)
    expect(await RateLimiter.availableIn(key)).toBe(0)
  })

  test('attempt returns true when the callback returns undefined', async () => {
    expect(await RateLimiter.attempt('void:1', 1, () => undefined)).toBe(true)
  })
})

// ── Limit builder ────────────────────────────────────────────────────────
describe('Limit builder', () => {
  test('windows map to the right decay seconds', () => {
    expect(Limit.perSecond(5).decaySeconds).toBe(1)
    expect(Limit.perMinute(60).decaySeconds).toBe(60)
    expect(Limit.perMinutes(2, 5).decaySeconds).toBe(120)
    expect(Limit.perHour(100).decaySeconds).toBe(3600)
    expect(Limit.perDay(1000).decaySeconds).toBe(86400)
    expect(Limit.none().unlimited).toBe(true)
  })
  test('by/response/after are chainable', () => {
    const limit = Limit.perMinute(10)
      .by('user:1')
      .response(() => 'nope')
      .after(() => true)
    expect(limit.key).toBe('user:1')
    expect(limit.responseCallback).toBeDefined()
    expect(limit.afterCallback).toBeDefined()
  })
})

// ── trusted-proxy handling for the client IP ───────────────────────────────
describe('X-Forwarded-For trust (throttle client IP)', () => {
  afterEach(() => trustProxies(false)) // reset module-level state

  const build = () => {
    registerMiddlewareRegistry({ aliases: { throttle: ThrottleMiddleware } })
    return new Elysia().use(route().get('/login', () => 'ok', { middleware: 'throttle:2,1' }))
  }
  const hit = (app: ReturnType<typeof build>, xff: string) =>
    app.handle(new Request('http://localhost/login', { headers: { 'x-forwarded-for': xff } }))

  test('by default X-Forwarded-For is IGNORED — a rotating header cannot bypass the per-IP limit', async () => {
    const app = build()
    // Attacker sends a fresh spoofed IP each request; all should share one
    // bucket (no server peer in app.handle → the constant fallback), so the
    // 3rd request is still blocked.
    expect((await hit(app, '1.1.1.1')).status).toBe(200)
    expect((await hit(app, '2.2.2.2')).status).toBe(200)
    expect((await hit(app, '3.3.3.3')).status).toBe(429)
  })

  test('with trustProxies() enabled, distinct X-Forwarded-For values get distinct buckets', async () => {
    trustProxies(true)
    const app = build()
    // A genuine proxy deployment: each real client IP is its own bucket.
    expect((await hit(app, '1.1.1.1')).status).toBe(200)
    expect((await hit(app, '1.1.1.1')).status).toBe(200)
    expect((await hit(app, '1.1.1.1')).status).toBe(429) // this client exhausted
    expect((await hit(app, '9.9.9.9')).status).toBe(200) // a different client is independent
  })
})

// ── named limiters via throttle:name ───────────────────────────────────────
describe('throttle:name middleware', () => {
  const build = () => {
    registerMiddlewareRegistry({ aliases: { throttle: ThrottleMiddleware } })
    return new Elysia().use(
      route()
        .get('/api', () => 'ok', { middleware: 'throttle:api' })
        .get('/vip', () => 'ok', { middleware: 'throttle:vip' })
        .get('/none', () => 'ok', { middleware: 'throttle:unlimited' }),
    )
  }

  test('enforces a named per-minute limit with headers + 429', async () => {
    RateLimiter.for('api', () => Limit.perMinute(2))
    const app = build()
    const hit = () => app.handle(new Request('http://localhost/api'))
    const r1 = await hit()
    expect(r1.status).toBe(200)
    expect(r1.headers.get('x-ratelimit-limit')).toBe('2')
    expect(r1.headers.get('x-ratelimit-remaining')).toBe('1')
    expect((await hit()).status).toBe(200)
    const r3 = await hit()
    expect(r3.status).toBe(429)
    expect(r3.headers.get('retry-after')).toBeDefined()
  })

  test('Limit.none() disables limiting', async () => {
    RateLimiter.for('unlimited', () => Limit.none())
    const app = build()
    for (let i = 0; i < 20; i++)
      expect((await app.handle(new Request('http://localhost/none'))).status).toBe(200)
  })

  test('segments by the .by() key — separate buckets', async () => {
    RateLimiter.for('vip', ctx =>
      Limit.perMinute(1).by((ctx.query as Record<string, string>).u ?? 'anon'))
    const app = build()
    const hit = (u: string) => app.handle(new Request(`http://localhost/vip?u=${u}`))
    expect((await hit('alice')).status).toBe(200)
    expect((await hit('alice')).status).toBe(429) // alice exhausted
    expect((await hit('bob')).status).toBe(200) // bob independent
  })

  test('custom response callback overrides the 429 body', async () => {
    RateLimiter.for('api', () =>
      Limit.perMinute(1).response(ctx =>
        (ctx.status as (c: number, b: unknown) => unknown)(429, { custom: true }),
      ))
    const app = build()
    await app.handle(new Request('http://localhost/api'))
    const blocked = await app.handle(new Request('http://localhost/api'))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ custom: true })
  })
})

// ── response-based counting (.after) ──────────────────────────────────────
describe('.after() response-based counting', () => {
  test('only counts responses the callback opts into (e.g. 404s)', async () => {
    registerMiddlewareRegistry({ aliases: { throttle: ThrottleMiddleware } })
    RateLimiter.for('enum', () => Limit.perMinute(2).after(status => status === 404))
    const app = new Elysia().use(
      route()
        .get('/found', () => 'ok', { middleware: 'throttle:enum' })
        .get(
          '/missing',
          ({ status }: { status(c: number, b: unknown): unknown }) => status(404, {}),
          {
            middleware: 'throttle:enum',
          },
        ),
    )
    // terminate() runs in onAfterResponse (not awaited by handle) — let it flush.
    const tick = () => new Promise(r => setTimeout(r, 5))
    const missing = async () => {
      const res = await app.handle(new Request('http://localhost/missing'))
      await tick()
      return res
    }
    // 200s never count → never blocked
    for (let i = 0; i < 5; i++) {
      expect((await app.handle(new Request('http://localhost/found'))).status).toBe(200)
      await tick()
    }
    // 404s count → third is blocked (two 404s recorded, then limit reached)
    expect((await missing()).status).toBe(404)
    expect((await missing()).status).toBe(404)
    expect((await missing()).status).toBe(429)
  })

  test('concurrent requests for the same key never exceed the limit (no check/increment race)', async () => {
    registerMiddlewareRegistry({ aliases: { throttle: ThrottleMiddleware } })
    RateLimiter.for('enum-concurrent', () => Limit.perMinute(2).after(status => status === 404))
    const app = new Elysia().use(
      route().get(
        '/missing-concurrent',
        ({ status }: { status(c: number, b: unknown): unknown }) => status(404, {}),
        { middleware: 'throttle:enum-concurrent' },
      ),
    )

    // Fired together — without serializing handle()'s peek against terminate()'s
    // increment, every one of these would see count=0 and pass, all landing as
    // 404 (5 counted, blowing past the limit of 2 with zero 429s).
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.handle(new Request('http://localhost/missing-concurrent'))),
    )
    const statuses = responses.map(r => r.status)
    const counted = statuses.filter(s => s === 404).length

    expect(counted).toBeLessThanOrEqual(2)
    expect(statuses.filter(s => s === 429).length).toBe(5 - counted)
  })
})

// ── multiple / segmented limits ────────────────────────────────────────────
describe('multiple rate limits', () => {
  test('first exceeded limit wins', async () => {
    registerMiddlewareRegistry({ aliases: { throttle: ThrottleMiddleware } })
    // 5/min overall, but 2/min per email
    RateLimiter.for('login', ctx => [
      Limit.perMinute(5),
      Limit.perMinute(2).by(`email:${(ctx.query as Record<string, string>).email ?? ''}`),
    ])
    const app = new Elysia().use(
      route().get('/login', () => 'ok', { middleware: 'throttle:login' }),
    )
    const hit = () => app.handle(new Request('http://localhost/login?email=a@x.test'))
    expect((await hit()).status).toBe(200)
    expect((await hit()).status).toBe(200)
    expect((await hit()).status).toBe(429) // per-email cap (2) hit before overall (5)
  })
})
