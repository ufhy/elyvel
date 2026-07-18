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
}

/** Handle `make:<type> <Name>`, returning an exit code. */
export async function make(
  type: string,
  rawName?: string,
  flags: Record<string, string | boolean> = {},
): Promise<number> {
  const blueprint = blueprints[type]
  if (!blueprint) {
    console.error(
      `Unknown generator "make:${type}". Available: ${Object.keys(blueprints).join(', ')}`,
    )
    return 1
  }
  if (!rawName) {
    console.error(`Missing name. Usage: elyvel make:${type} <Name>`)
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

  try {
    const contents = await renderStub(stub, vars)
    await writeGenerated(target, contents)
    console.log(`✓ Created ${relative(process.cwd(), target)}`)
    return 0
  }
  catch (error) {
    console.error(`✗ ${(error as Error).message}`)
    return 1
  }
}
