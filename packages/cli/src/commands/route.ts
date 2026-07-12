import { createApp } from '@elysia-ravel/core'

interface ElysiaRoute {
  method: string
  path: string
}

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL']

/** `ravel route:list` — list every registered HTTP route (method + path). */
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

  const width = Math.max(...routes.map((r) => r.method.length), 'Method'.length)
  console.log(`${'Method'.padEnd(width)}  Path`)
  for (const r of routes) console.log(`${r.method.padEnd(width)}  ${r.path}`)
  console.log(`\n${routes.length} routes.`)
  return 0
}

function methodRank(method: string): number {
  const i = METHOD_ORDER.indexOf(method.toUpperCase())
  return i === -1 ? METHOD_ORDER.length : i
}
