import type { MiddlewareContext } from '../src/middleware'
import { beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import {
  excludeMiddleware,
  globalMiddlewarePlugin,
  group,
  guardName,
  Middleware,

  registerMiddlewareRegistry,
  resetMiddlewareExclusions,
} from '../src/middleware'

class Blocker extends Middleware {
  handle(ctx: MiddlewareContext): unknown {
    return ctx.status(403, { message: 'blocked' })
  }
}
class Throttle extends Middleware {
  handle(ctx: MiddlewareContext, limit?: string): unknown {
    return ctx.status(429, { message: `limit ${limit}` })
  }
}

function get(app: Elysia, path: string): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`))
}

beforeEach(() => {
  resetMiddlewareExclusions()
  registerMiddlewareRegistry({
    aliases: { blocker: Blocker, throttle: Throttle },
    groups: { api: ['blocker'], throttled: ['throttle:60,1'], web: ['csrf'] },
  })
})

/**
 * Route-level middleware lists could always be filtered at registration, but
 * `global` and `group` middleware run from their own hooks and never saw that
 * list — so there was no way to exempt a single route from them (Laravel's
 * `->withoutMiddleware([...])`). Exemptions are keyed by the matched route
 * pattern, which is what the guard runner can see via `ctx.route`.
 */
describe('a route can be exempted from global middleware', () => {
  function app(): Elysia {
    return new Elysia()
      .use(globalMiddlewarePlugin([Blocker]))
      .get('/open', () => 'ok')
      .get('/health', () => 'ok') as unknown as Elysia
  }

  test('without an exemption, global middleware applies', async () => {
    expect((await get(app(), '/open')).status).toBe(403)
  })

  test('an exempted route runs without it', async () => {
    excludeMiddleware('GET', '/health', ['blocker'])
    expect((await get(app(), '/health')).status).toBe(200)
  })

  test('sibling routes are unaffected', async () => {
    excludeMiddleware('GET', '/health', ['blocker'])
    const built = app()
    expect((await get(built, '/health')).status).toBe(200)
    expect((await get(built, '/open')).status).toBe(403)
  })

  test('the exemption is per method, not per path', async () => {
    excludeMiddleware('POST', '/open', ['blocker'])
    expect((await get(app(), '/open')).status).toBe(403)
  })

  test('\'*\' drops every middleware for that route', async () => {
    excludeMiddleware('GET', '/open', '*')
    expect((await get(app(), '/open')).status).toBe(200)
  })

  test('an unrelated name in the exemption changes nothing', async () => {
    excludeMiddleware('GET', '/open', ['something-else'])
    expect((await get(app(), '/open')).status).toBe(403)
  })
})

describe('a route can be exempted from group middleware', () => {
  function app(groupName: string): Elysia {
    return new Elysia()
      .use(group(groupName))
      .get('/x', () => 'ok')
      .get('/y', () => 'ok') as unknown as Elysia
  }

  test('the group applies until exempted', async () => {
    expect((await get(app('api'), '/x')).status).toBe(403)
    excludeMiddleware('GET', '/y', ['blocker'])
    expect((await get(app('api'), '/y')).status).toBe(200)
  })

  /**
   * Regression: exclusion matched the whole spec string, so `'throttle'` failed
   * to drop `'throttle:60,1'` — the route asked to be exempt and silently wasn't.
   */
  test('the bare alias name matches a spec carrying arguments', async () => {
    expect((await get(app('throttled'), '/x')).status).toBe(429)
    excludeMiddleware('GET', '/x', ['throttle'])
    expect((await get(app('throttled'), '/x')).status).toBe(200)
  })
})

describe('guardName', () => {
  test('strips arguments from an alias spec', () => {
    expect(guardName('throttle:60,1')).toBe('throttle')
    expect(guardName('csrf')).toBe('csrf')
  })

  test('resolves a class to its registered alias, else its class name', () => {
    expect(guardName(Blocker)).toBe('blocker')
    class Unregistered extends Middleware {
      handle(): void {}
    }
    expect(guardName(Unregistered)).toBe('Unregistered')
  })
})
