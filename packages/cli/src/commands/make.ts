import type { Names } from '../naming'
import { relative } from 'node:path'
import { makeNames } from '../naming'
import { join, renderStub, writeGenerated } from '../stub'

interface Blueprint {
  stub: string
  suffix: string
  dir: string
  /** File name (without dir) for the generated artifact. */
  filename(names: Names): string
  /** Extra template variables beyond the standard name casings. */
  vars?(names: Names): Record<string, string>
}

/** Naive singular→table pluralization (user → users, category → categories). */
function tableName(snake: string): string {
  if (/[^aeiou]y$/.test(snake))
    return `${snake.slice(0, -1)}ies`
  if (/(?:[sxz]|ch|sh)$/.test(snake))
    return `${snake}es`
  return `${snake}s`
}

/** Strip `create_`/`_table` to guess the table a migration targets. */
function migrationTable(snake: string): string {
  return snake.replace(/^create_/, '').replace(/_table$/, '') || 'table_name'
}

const timestamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

const blueprints: Record<string, Blueprint> = {
  controller: {
    stub: 'controller',
    suffix: 'Controller',
    dir: 'app/controllers',
    filename: n => `${n.class}.ts`,
  },
  middleware: {
    stub: 'middleware',
    suffix: 'Middleware',
    dir: 'app/middleware',
    filename: n => `${n.class}.ts`,
    vars: n => ({ alias: n.snake.replace(/_middleware$/, '') }),
  },
  model: {
    stub: 'model',
    suffix: '',
    dir: 'app/models',
    filename: n => `${n.class}.ts`,
    vars: n => ({ table: tableName(n.snake) }),
  },
  seeder: {
    stub: 'seeder',
    suffix: 'Seeder',
    dir: 'database/seeders',
    filename: n => `${n.class}.ts`,
  },
  policy: {
    stub: 'policy',
    suffix: 'Policy',
    dir: 'app/policies',
    filename: n => `${n.class}.ts`,
    vars: n => ({ resource: n.snake.replace(/_policy$/, '') }),
  },
  migration: {
    stub: 'migration',
    suffix: '',
    dir: 'database/migrations',
    filename: n => `${timestamp()}_${n.snake}.ts`,
    vars: n => ({ table: migrationTable(n.snake) }),
  },
  request: {
    stub: 'request',
    suffix: 'Request',
    dir: 'app/requests',
    filename: n => `${n.class}.ts`,
  },
  resource: {
    stub: 'resource',
    suffix: 'Resource',
    dir: 'app/resources',
    filename: n => `${n.class}.ts`,
  },
  event: {
    stub: 'event',
    suffix: '',
    dir: 'app/events',
    filename: n => `${n.class}.ts`,
  },
  listener: {
    stub: 'listener',
    suffix: '',
    dir: 'app/listeners',
    filename: n => `${n.class}.ts`,
  },
  notification: {
    stub: 'notification',
    suffix: 'Notification',
    dir: 'app/notifications',
    filename: n => `${n.class}.ts`,
  },
  provider: {
    stub: 'provider',
    suffix: 'ServiceProvider',
    dir: 'app/providers',
    filename: n => `${n.class}.ts`,
  },
  factory: {
    stub: 'factory',
    suffix: 'Factory',
    dir: 'database/factories',
    filename: n => `${n.class}.ts`,
    vars: (n) => {
      const model = makeNames(n.snake.replace(/_factory$/, ''))
      return { Model: model.class }
    },
  },
  concern: {
    stub: 'concern',
    suffix: '',
    dir: 'app/concerns',
    filename: n => `${n.class}.ts`,
  },
}

/** Generate a single blueprint file, returning an exit code. */
async function generate(
  type: string,
  rawName: string,
  flags: Record<string, string | boolean>,
): Promise<number> {
  const blueprint = blueprints[type]
  if (!blueprint) {
    console.error(
      `Unknown generator "make:${type}". Available: ${Object.keys(blueprints).join(', ')}`,
    )
    return 1
  }

  const names = makeNames(rawName, blueprint.suffix)
  const target = join(process.cwd(), blueprint.dir, blueprint.filename(names))
  let stub = blueprint.stub
  let vars: Record<string, string | undefined> = { ...names, ...blueprint.vars?.(names) }

  // `make:policy <Name> --model[=Model]` scaffolds the full resource method set.
  // A bare `--model` infers the model from the policy name (PostPolicy → Post).
  if (type === 'policy' && flags.model) {
    const modelRaw
      = typeof flags.model === 'string' ? flags.model : names.snake.replace(/_policy$/, '')
    stub = 'policy-model'
    vars = { ...vars, Model: makeNames(modelRaw).class }
  }

  // `make:controller <Name> [--resource] [--invokable] [--singleton [--creatable]] [--model=X] [--parent=X]`
  if (type === 'controller') {
    if (flags.invokable) {
      stub = 'controller-invokable'
    }
    else if (flags.singleton) {
      stub = flags.creatable ? 'controller-singleton-creatable' : 'controller-singleton'
    }
    else if (flags.resource) {
      stub = 'controller-resource'
    }

    // Comments, not live imports/wiring: route-model-binding (`bind`) and
    // nesting are configured where the resource is REGISTERED (a routes/
    // file), not inside the controller class itself — a live import here
    // would just be unused code, not working code.
    const hints: string[] = []
    if (flags.model) {
      const modelRaw = typeof flags.model === 'string' ? flags.model : names.snake.replace(/_controller$/, '')
      const Model = makeNames(modelRaw).class
      hints.push(`// Route-model-bound: resource('/${names.kebab.replace(/-controller$/, '')}', ${names.class}, { bind: ${Model} }) — see app/models/${Model}.ts`)
    }
    if (flags.parent) {
      const parentRaw = typeof flags.parent === 'string' ? flags.parent : 'Parent'
      const Parent = makeNames(parentRaw).class
      const parentKebab = makeNames(parentRaw).kebab
      hints.push(
        `// Nested under ${Parent}: resource('/${parentKebab}/:${parentKebab}/${names.kebab.replace(/-controller$/, '')}', ${names.class}, { shallow: true })`,
      )
    }
    vars = { ...vars, modelImport: hints.length ? `${hints.join('\n')}\n` : '' }
  }

  try {
    const contents = await renderStub(stub, vars)
    await writeGenerated(target, contents, Boolean(flags.force))
    console.log(`✓ Created ${relative(process.cwd(), target)}`)
    return 0
  }
  catch (error) {
    console.error(`✗ ${(error as Error).message}`)
    return 1
  }
}

/**
 * `make:model <Name>` companions (Laravel's `-m`/`-f`/`-s`/`-c`/`-a` flags) — each
 * generates its own file alongside the model, named/tabled to match it.
 */
async function generateModelCompanions(
  rawName: string,
  flags: Record<string, string | boolean>,
): Promise<number[]> {
  const wants = (flag: string) => Boolean(flags.all || flags[flag])
  const table = tableName(makeNames(rawName).snake)
  const results: number[] = []

  if (wants('migration'))
    results.push(await generate('migration', `create_${table}_table`, {}))
  if (wants('factory'))
    results.push(await generate('factory', rawName, {}))
  if (wants('seed'))
    results.push(await generate('seeder', rawName, {}))
  if (wants('controller'))
    results.push(await generate('controller', rawName, {}))

  return results
}

/**
 * `make:controller <Name> --requests` (Laravel's `--requests` on `make:controller
 * --resource`) — Store/Update FormRequest classes for the resource, named after
 * the controller with the `Controller` suffix stripped (`PostController` → `StorePostRequest`/`UpdatePostRequest`).
 */
async function generateControllerCompanions(
  rawName: string,
  flags: Record<string, string | boolean>,
): Promise<number[]> {
  if (!flags.requests)
    return []
  const base = makeNames(rawName, 'Controller').snake.replace(/_controller$/, '')
  return [
    await generate('request', `store_${base}`, {}),
    await generate('request', `update_${base}`, {}),
  ]
}

/**
 * `elyvel auth:generate-migration-plugin` — no name to invent, no flag to
 * remember: it generates a migration that re-runs `migrateBetterAuth`
 * (idempotent/incremental — see `better-auth-schema.ts`), for after you've
 * enabled a new Better Auth plugin in `config/auth.ts` (added by hand) on an
 * app that's already migrated. Mirrors Laravel's `queue:table`/`session:table`
 * — a fixed-purpose migration generator that takes no argument because
 * there's only one thing to name it.
 */
export async function generateMigrationPluginCommand(): Promise<number> {
  const target = join(process.cwd(), 'database/migrations', `${timestamp()}_sync_auth_schema.ts`)
  try {
    const contents = await renderStub('migration-auth', {})
    await writeGenerated(target, contents, false)
    console.log(`✓ Created ${relative(process.cwd(), target)}`)
    console.log(
      '  Add the plugin to config/auth.ts (import it from \'better-auth/plugins\', add it to `plugins: [...]`), then `elyvel migrate`.',
    )
    return 0
  }
  catch (error) {
    console.error(`✗ ${(error as Error).message}`)
    return 1
  }
}

/** Handle `make:<type> <Name>`, returning an exit code. */
export async function make(
  type: string,
  rawName?: string,
  flags: Record<string, string | boolean> = {},
): Promise<number> {
  if (!blueprints[type]) {
    console.error(
      `Unknown generator "make:${type}". Available: ${Object.keys(blueprints).join(', ')}`,
    )
    return 1
  }
  if (!rawName) {
    console.error(`Missing name. Usage: elyvel make:${type} <Name>`)
    return 1
  }

  const results = [await generate(type, rawName, flags)]
  if (type === 'model')
    results.push(...await generateModelCompanions(rawName, flags))
  if (type === 'controller')
    results.push(...await generateControllerCompanions(rawName, flags))

  return results.some(code => code !== 0) ? 1 : 0
}
