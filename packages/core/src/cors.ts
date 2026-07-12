import { Elysia } from 'elysia'

export interface CorsOptions {
  /** Allowed origin. Default `*`. */
  origin?: string
  /** Allowed methods. */
  methods?: string[]
  /** Allowed request headers. */
  allowedHeaders?: string[]
  /** Send `Access-Control-Allow-Credentials: true`. */
  credentials?: boolean
  /** `Access-Control-Max-Age` (seconds) for preflight caching. */
  maxAge?: number
}

/**
 * CORS as a `.use()`-able plugin. Add it to `global` middleware in
 * `config/middleware.ts`, or `.use(cors())` on a router. Sets the CORS headers
 * on every response and answers preflight `OPTIONS` with 204.
 */
export function cors(options: CorsOptions = {}): Elysia {
  const origin = options.origin ?? '*'
  const methods = (options.methods ?? ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']).join(', ')
  const allowHeaders = (options.allowedHeaders ?? ['Content-Type', 'Authorization']).join(', ')

  // biome-ignore lint/suspicious/noExplicitAny: Elysia infers the set shape
  const apply = (set: any) => {
    set.headers['access-control-allow-origin'] = origin
    set.headers['access-control-allow-methods'] = methods
    set.headers['access-control-allow-headers'] = allowHeaders
    if (options.credentials) set.headers['access-control-allow-credentials'] = 'true'
    if (options.maxAge !== undefined) set.headers['access-control-max-age'] = String(options.maxAge)
  }

  // biome-ignore lint/suspicious/noExplicitAny: Elysia's response generic varies with the hook
  const plugin: any = new Elysia({ name: 'ravel-cors' }).onRequest(({ request, set }) => {
    apply(set)
    if (request.method === 'OPTIONS') {
      set.status = 204
      return ''
    }
  })
  return plugin as Elysia
}
