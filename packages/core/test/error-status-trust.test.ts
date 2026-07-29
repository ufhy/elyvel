import { HttpException } from '@elyvel/support'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { errorPages } from '../src/http/error-pages'

const asJson = { accept: 'application/json' }
const asBrowser = { accept: 'text/html' }

function appThatThrows(thrower: () => never): Elysia {
  return new Elysia().use(errorPages()).get('/x', thrower) as unknown as Elysia
}

async function jsonError(thrower: () => never): Promise<{ status: number, body: any }> {
  const res = await appThatThrows(thrower).handle(
    new Request('http://localhost/x', { headers: asJson }),
  )
  return { status: res.status, body: await res.json() }
}

/**
 * Regression: `resolveStatus` trusted ANY object with a numeric `status`, and
 * `safeMessage` echoed ANY error's message verbatim below 500 — in production
 * too. Outbound HTTP clients and database drivers routinely carry a numeric
 * `status`, so an internal fault was relayed to the client as a plausible-looking
 * 4xx, complete with internal hostnames, connection strings and credentials
 * sitting in a query string. The `errors` bag was read off any error as well.
 *
 * Only an exception marked as client-facing (`HttpException`) may now choose its
 * status, message, or error bag.
 */
describe('an unmarked error cannot choose its status or leak its message', () => {
  test('a foreign error carrying status and errors is rendered as a generic 500', async () => {
    class UpstreamError extends Error {
      status = 404
      errors = { internal: ['secret detail'] }
    }

    const { status, body } = await jsonError(() => {
      throw new UpstreamError('ECONNREFUSED 10.0.0.5:5432 while fetching https://internal.api/v1?key=AKIA123')
    })

    expect(status).toBe(500)
    expect(body.message).not.toContain('10.0.0.5')
    expect(body.message).not.toContain('AKIA123')
    expect(body.message).not.toContain('internal.api')
    expect(body.errors).toBeUndefined()
  })

  test('a plain Error is a generic 500', async () => {
    const { status, body } = await jsonError(() => {
      throw new Error('connection string postgres://user:pw@db/app')
    })

    expect(status).toBe(500)
    expect(body.message).not.toContain('postgres://')
  })

  test('a foreign error with a 4xx status does not get to pick it', async () => {
    const { status } = await jsonError(() => {
      throw Object.assign(new Error('nope'), { status: 401 })
    })
    expect(status).toBe(500)
  })
})

describe('a client-facing HttpException is honoured in full', () => {
  test('its status and message reach the client', async () => {
    const { status, body } = await jsonError(() => {
      throw new HttpException(404, 'That post has been removed.')
    })

    expect(status).toBe(404)
    expect(body.message).toBe('That post has been removed.')
  })

  test('its error bag reaches the client', async () => {
    const { status, body } = await jsonError(() => {
      throw new HttpException(422, 'The given data was invalid.', { email: ['required'] })
    })

    expect(status).toBe(422)
    expect(body.errors).toEqual({ email: ['required'] })
  })

  test('a 5xx is still scrubbed even when marked — marking is not a licence to leak', async () => {
    const { status, body } = await jsonError(() => {
      throw new HttpException(500, 'internal detail that must not ship')
    })

    expect(status).toBe(500)
    expect(body.message).not.toContain('must not ship')
  })

  test('a subclass inherits the marker', async () => {
    class PostGone extends HttpException {
      constructor() {
        super(410, 'Post archived.')
      }
    }

    const { status, body } = await jsonError(() => {
      throw new PostGone()
    })

    expect(status).toBe(410)
    expect(body.message).toBe('Post archived.')
  })
})

/**
 * The sibling path: an error-status response a handler or guard RETURNED (`can`,
 * the throttler). The app chose that status and body explicitly, so its message
 * is client-facing by construction — sharing one helper with the thrown-error
 * path would have silently swallowed every custom guard message.
 */
describe('a returned status() response keeps its message', () => {
  test('a browser navigation renders the guard message, not the status default', async () => {
    const app = new Elysia()
      .use(errorPages())
      .get('/denied', (ctx: any) => ctx.status(403, { message: 'You do not own this post.' }))

    const res = await app.handle(new Request('http://localhost/denied', { headers: asBrowser }))
    const html = await res.text()

    expect(res.status).toBe(403)
    expect(html).toContain('You do not own this post.')
  })

  test('a 5xx returned response is still scrubbed', async () => {
    const app = new Elysia()
      .use(errorPages())
      .get('/boom', (ctx: any) => ctx.status(500, { message: 'internal detail' }))

    const res = await app.handle(new Request('http://localhost/boom', { headers: asBrowser }))
    expect(await res.text()).not.toContain('internal detail')
  })
})
