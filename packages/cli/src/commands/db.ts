import { existsSync } from 'node:fs'
import { createApp } from '@elysia-ravel/core'
import { DatabaseToken, freshMigrate, migrate, runSeeders, type SeederClass } from '@elysia-ravel/orm'

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
