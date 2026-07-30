import type { Connection } from '../src/connection'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection } from '../src/connection'
import { hasTable } from '../src/inspect'
import { migrate } from '../src/migrator'
import { dumpSchema, pruneMigrations } from '../src/schema-dump'

const MIGRATION = `export default {
  async up(s) { await s.create('users', t => { t.id(); t.string('email') }) },
  async down(s) { await s.drop('users') },
}
`
const NAME = '2026_01_01_000000_create_users'

let dir: string
let migrations: string
let dumpPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-dump-'))
  migrations = join(dir, 'migrations')
  mkdirSync(migrations)
  writeFileSync(join(migrations, `${NAME}.ts`), MIGRATION)
  dumpPath = join(dir, 'schema', 'default-schema.sql')
})

function open(file: string): Promise<Connection> {
  return createConnection({ driver: 'sqlite', database: join(dir, file) })
}

/**
 * `schema:dump` collapses a project's whole migration history into one SQL file,
 * so a fresh checkout or CI run builds the structure in one step instead of
 * replaying hundreds of migrations.
 */
describe('schema:dump', () => {
  test('the dump contains the structure and the applied-migration history', async () => {
    const source = await open('a.sqlite')
    await migrate(source, migrations)
    await dumpSchema(source, dumpPath)

    const sql = await Bun.file(dumpPath).text()
    expect(sql).toContain('CREATE TABLE')
    expect(sql).toContain('users')
    // Without the ledger rows a restore would re-run every migration against an
    // already-built schema.
    expect(sql).toContain(NAME)
  })

  test('the migration LOCK table is excluded — it is a mutex, not schema', async () => {
    const source = await open('a.sqlite')
    await migrate(source, migrations)
    await dumpSchema(source, dumpPath)

    // Dumping it made the file unloadable: the migrator recreates the lock table
    // and hit "table already exists".
    expect(await Bun.file(dumpPath).text()).not.toContain('_elyvel_migrations_lock')
  })

  test('a fresh database loads the dump and re-runs nothing', async () => {
    const source = await open('a.sqlite')
    await migrate(source, migrations)
    await dumpSchema(source, dumpPath)

    const fresh = await open('b.sqlite')
    const applied = await migrate(fresh, migrations, { schemaDumpPath: dumpPath })

    expect(applied).toEqual([])
    expect(await hasTable(fresh, 'users')).toBe(true)
  })

  test('a migration added after the dump still runs', async () => {
    const source = await open('a.sqlite')
    await migrate(source, migrations)
    await dumpSchema(source, dumpPath)

    writeFileSync(
      join(migrations, '2026_02_02_000000_create_posts.ts'),
      `export default {
        async up(s) { await s.create('posts', t => { t.id() }) },
        async down(s) { await s.drop('posts') },
      }\n`,
    )

    const fresh = await open('b.sqlite')
    const applied = await migrate(fresh, migrations, { schemaDumpPath: dumpPath })

    expect(applied).toEqual(['2026_02_02_000000_create_posts'])
    expect(await hasTable(fresh, 'users')).toBe(true)
    expect(await hasTable(fresh, 'posts')).toBe(true)
  })

  test('with no dump present, migrate behaves exactly as before', async () => {
    const fresh = await open('b.sqlite')
    const applied = await migrate(fresh, migrations, { schemaDumpPath: dumpPath })
    expect(applied).toEqual([NAME])
  })

  test('dumping a database that was never migrated omits the history block', async () => {
    const bare = await open('c.sqlite')
    await bare.unprepared('CREATE TABLE things (id INTEGER PRIMARY KEY)')
    await dumpSchema(bare, dumpPath)

    const sql = await Bun.file(dumpPath).text()
    expect(sql).toContain('things')
    expect(sql).not.toContain('INSERT INTO _elyvel_migrations')
  })
})

describe('--prune', () => {
  test('applied migration files are removed', async () => {
    const source = await open('a.sqlite')
    await migrate(source, migrations)

    expect(await pruneMigrations(source, migrations)).toEqual([`${NAME}.ts`])
    expect(readdirSync(migrations)).toEqual([])
  })

  test('a PENDING migration is kept — the dump does not contain it', async () => {
    const source = await open('a.sqlite')
    await migrate(source, migrations)
    writeFileSync(join(migrations, '2026_03_03_000000_later.ts'), MIGRATION)

    const removed = await pruneMigrations(source, migrations)
    expect(removed).toEqual([`${NAME}.ts`])
    expect(readdirSync(migrations)).toEqual(['2026_03_03_000000_later.ts'])
  })

  test('nothing is removed when no migration has been applied', async () => {
    const bare = await open('c.sqlite')
    expect(await pruneMigrations(bare, migrations)).toEqual([])
    expect(readdirSync(migrations)).toHaveLength(1)
  })
})
