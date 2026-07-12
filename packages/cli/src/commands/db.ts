import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from '@elysia-ravel/core'
import {
  DatabaseToken,
  freshMigrate,
  migrate,
  type Model,
  rollback,
  runSeeders,
  type SeederClass,
  status,
} from '@elysia-ravel/eloquent'

/** A model constructor with the static pruning API. */
type PrunableClass = typeof Model & { prune(chunkSize?: number): Promise<number> }

/** Boot the framework without HTTP routes — just enough to reach the DB. */
async function boot() {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  return { app, conn: app.make(DatabaseToken) }
}

/** `ravel migrate` / `ravel migrate:fresh`. */
export async function migrateCommand(fresh: boolean): Promise<number> {
  const { app, conn } = await boot()
  const dir = app.path('database/migrations')

  const applied = fresh ? await freshMigrate(conn, dir) : await migrate(conn, dir)
  if (applied.length === 0) {
    console.log('Nothing to migrate.')
  } else {
    if (fresh) console.log('Dropped all tables, re-running migrations:')
    for (const name of applied) console.log(`✓ ${name}`)
  }
  return 0
}

/** `ravel migrate:rollback` — roll back the most recent batch. */
export async function rollbackCommand(): Promise<number> {
  const { app, conn } = await boot()
  const rolledBack = await rollback(conn, app.path('database/migrations'))
  if (rolledBack.length === 0) console.log('Nothing to roll back.')
  else for (const name of rolledBack) console.log(`✓ rolled back ${name}`)
  return 0
}

/** `ravel migrate:status` — show applied/pending migrations. */
export async function statusCommand(): Promise<number> {
  const { app, conn } = await boot()
  const rows = await status(conn, app.path('database/migrations'))
  if (rows.length === 0) console.log('No migrations found.')
  else for (const r of rows) console.log(`${r.ran ? '✓ ran    ' : '· pending'}  ${r.name}`)
  return 0
}

/** `ravel db:seed` — runs `database/seeders/DatabaseSeeder.ts`. */
export async function seedCommand(): Promise<number> {
  const { app } = await boot()
  const seederPath = app.path('database/seeders/DatabaseSeeder.ts')

  if (!existsSync(seederPath)) {
    console.error('No database/seeders/DatabaseSeeder.ts found. Create one with: ravel make:seeder Database')
    return 1
  }

  const module = (await import(seederPath)) as { default?: SeederClass }
  if (!module.default) {
    console.error('DatabaseSeeder.ts must default-export a Seeder class.')
    return 1
  }

  await runSeeders([module.default])
  console.log('✓ Database seeded.')
  return 0
}

/**
 * `ravel model:prune [Name]` — permanently delete records matched by each model's
 * `prunable()`. With a name, prunes just `app/models/<Name>.ts`; otherwise scans
 * `app/models/` and prunes every model that overrides `prunable()`.
 */
export async function pruneCommand(name?: string): Promise<number> {
  const { app } = await boot()
  const dir = app.path('app/models')

  let files: string[]
  if (name) {
    const file = join(dir, `${name}.ts`)
    if (!existsSync(file)) {
      console.error(`No model found at app/models/${name}.ts`)
      return 1
    }
    files = [file]
  } else {
    if (!existsSync(dir)) {
      console.error('No app/models directory found.')
      return 1
    }
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(dir, f))
  }

  let anyPruned = false
  for (const file of files) {
    const module = (await import(file)) as { default?: unknown }
    const cls = module.default as PrunableClass | undefined
    if (typeof cls?.prune !== 'function' || cls.prunable() === null) {
      if (name) console.log(`${name} is not prunable (override static prunable()).`)
      continue
    }
    const count = await cls.prune()
    console.log(`✓ pruned ${count} ${cls.name} record${count === 1 ? '' : 's'}`)
    anyPruned = true
  }

  if (!anyPruned && !name) console.log('Nothing to prune.')
  return 0
}
