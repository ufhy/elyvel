import { Elysia } from 'elysia'

/** The parts of a Better Auth instance this plugin needs (kept loose to avoid deep generics). */
export interface BetterAuthLike {
  handler: (request: Request) => Response | Promise<Response>
  // biome-ignore lint/suspicious/noExplicitAny: Better Auth session shape varies by config/plugins
  api: { getSession: (args: { headers: Headers }) => Promise<any> }
}

export interface BetterAuthPluginOptions {
  /** Where Better Auth's routes are mounted. Default `/api/auth`. */
  basePath?: string
}

/**
 * Mount Better Auth into elysia-ravel: routes at `/api/auth/*`, a derived
 * `user`/`session` in context, and an `{ auth: true }` macro that 401s guests.
 * Use it in a route file like `auth.guard()`:
 *
 *   route().use(betterAuthPlugin(auth)).get('/me', ({ user }) => user, { auth: true })
 */
export function betterAuthPlugin(auth: BetterAuthLike, options: BetterAuthPluginOptions = {}) {
  const base = (options.basePath ?? '/api/auth').replace(/\/$/, '')
  return (
    new Elysia({ name: 'ravel-better-auth' })
      // Rebuild the request from Elysia's parsed body — other global plugins may
      // have already consumed the stream, and Better Auth reads request.json().
      // biome-ignore lint/suspicious/noExplicitAny: Elysia context varies
      .all(`${base}/*`, ({ request, body }: any) => {
        const hasBody = body != null && request.method !== 'GET' && request.method !== 'HEAD'
        const req = hasBody
          ? new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: typeof body === 'string' ? body : JSON.stringify(body),
            })
          : request
        return auth.handler(req)
      })
      // Derive the authenticated `user` + `authSession`. NB: not named `session`
      // — that would clobber the framework's cookie-session (a Session instance).
      // biome-ignore lint/suspicious/noExplicitAny: Elysia derive context varies
      .derive({ as: 'scoped' }, async ({ request }: any) => {
        const result = await auth.api.getSession({ headers: request.headers })
        return { user: result?.user ?? null, authSession: result?.session ?? null }
      })
      .macro({
        auth(enabled: boolean) {
          if (!enabled) return {}
          return {
            // biome-ignore lint/suspicious/noExplicitAny: derived user + status
            beforeHandle({ user, status }: any) {
              if (!user) return status(401, { message: 'Unauthenticated' })
            },
          }
        },
      })
  )
}
