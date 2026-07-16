import { join } from 'node:path'
import { Elysia } from 'elysia'

/**
 * A route module is any file under `routes/` that default-exports an Elysia
 * instance (a plugin). Controllers follow the same convention, so a route
 * file can simply compose controllers with `.use()`.
 */
export interface RouteModule { default: Elysia }

function isElysia(value: unknown): value is Elysia {
  return value instanceof Elysia
}

/**
 * Discover every `*.ts` file under `dir`, import it, and return the Elysia
 * instances they export. Files are loaded in a stable (sorted) order so route
 * registration is deterministic. Files that do not default-export an Elysia
 * instance are skipped with a warning.
 */
export async function loadRoutes(dir: string): Promise<Elysia[]> {
  const glob = new Bun.Glob('**/*.{ts,js}')
  const files: string[] = []

  for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
    if (file.endsWith('.d.ts') || file.endsWith('.test.ts'))
      continue
    files.push(file)
  }

  files.sort()

  const routers: Elysia[] = []
  for (const file of files) {
    const absolute = join(dir, file)
    const module = (await import(absolute)) as Partial<RouteModule>

    if (isElysia(module.default)) {
      routers.push(module.default)
    }
    else {
      console.warn(
        `[elysia-ravel] "${file}" was skipped: expected a default-exported Elysia instance.`,
      )
    }
  }

  return routers
}
