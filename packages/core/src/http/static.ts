import { resolve } from 'node:path'
import { trans, trimTrailing } from '@elyvel/support'
import { Elysia } from 'elysia'

export interface StaticFilesOptions {
  /** Directory to serve from (relative to cwd or absolute). */
  dir: string
  /** URL prefix, e.g. `/build`. Default `` (root). */
  prefix?: string
}

/**
 * Serve static files from a directory (Laravel's `public/`). Mount in a route
 * file: `.use(staticFiles({ prefix: '/build', dir: 'public/build' }))`. Guards
 * against path traversal and 404s missing files.
 */
export function staticFiles(options: StaticFilesOptions) {
  const prefix = trimTrailing(options.prefix ?? '', '/')
  const root = resolve(process.cwd(), options.dir)

  return new Elysia({ name: `elyvel-static-${prefix || 'root'}` }).get(
    `${prefix}/*`,
    async ({ params, set }: any) => {
      const rel = (params['*'] ?? '') as string
      const target = resolve(root, rel)
      // Stay inside the served directory (block ../ traversal).
      if (target !== root && !target.startsWith(`${root}/`)) {
        set.status = 403
        return trans('core::errors.forbidden', {}, 'Forbidden')
      }
      const bunFile = Bun.file(target)
      if (!(await bunFile.exists())) {
        set.status = 404
        return trans('core::errors.file_not_found', {}, 'Not Found')
      }
      return bunFile
    },
  )
}
