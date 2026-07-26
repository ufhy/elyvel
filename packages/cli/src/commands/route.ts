import { createApp, routeMetaEntries } from '@elyvel/core'

interface ElysiaRoute {
  method: string
  path: string
}

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL']

/** `elyvel route:list` — list every registered HTTP route (method + path + middleware/authorize). */
export async function routeListCommand(): Promise<number> {
  // Boot with routes so `routes/` files are mounted.
  const app = await createApp({ basePath: process.cwd() })
  const routes = ((app.elysia as unknown as { routes?: ElysiaRoute[] }).routes ?? [])
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path) || methodRank(a.method) - methodRank(b.method))

  if (routes.length === 0) {
    console.log('No routes registered.')
    return 0
  }

  // Middleware/authorize metadata is only recorded for resource()/apiResource()
  // routes (route.ts, group()-based ad-hoc routes aren't tracked this way) —
  // matched by method + path, so a plain route just shows blank extra columns.
  const meta = new Map(routeMetaEntries().map(m => [`${m.method} ${m.path}`, m]))

  const width = Math.max(...routes.map(r => r.method.length), 'Method'.length)
  const pathWidth = Math.max(...routes.map(r => r.path.length), 'Path'.length)
  const hasMeta = meta.size > 0
  console.log(`${'Method'.padEnd(width)}  ${'Path'.padEnd(pathWidth)}${hasMeta ? '  Middleware              Authorize' : ''}`)
  for (const r of routes) {
    const m = meta.get(`${r.method} ${r.path}`)
    const mwCol = hasMeta ? `  ${(m?.middleware.join(', ') ?? '').padEnd(23)}` : ''
    const authCol = hasMeta ? `  ${m?.authorize ?? ''}` : ''
    console.log(`${r.method.padEnd(width)}  ${r.path.padEnd(pathWidth)}${mwCol}${authCol}`)
  }
  console.log(`\n${routes.length} routes.`)
  return 0
}

function methodRank(method: string): number {
  const i = METHOD_ORDER.indexOf(method.toUpperCase())
  return i === -1 ? METHOD_ORDER.length : i
}
