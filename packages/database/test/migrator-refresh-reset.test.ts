import type { Connection } from '../src/connection'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { hasTable } from '../src/inspect'
import { migrate, refresh, reset, rollback, status } from '../src/migrator'
import { dialects } from './dialects'

/** Write N standalone migration files, each creating/dropping its own table. */
function writeMigrations(dir: string, names: string[]): void {
  for (const name of names) {
    const table = name.replace(/^\d+_create_/, '')
    writeFileSync(
      join(dir, `${name}.ts`),
      `export default {
  async up(schema) { await schema.create('${table}', (t) => { t.id() }) },
  async down(schema) { await schema.dropIfExists('${table}') },
}
`,
    )
  }
}

for (const d of dialects) {
  describe(`migrator refresh/reset/step/batch/pretend (${d.name})`, () => {
    let conn: Connection
    let dir: string
    beforeEach(async () => {
      conn = await d.connect()
      dir = mkdtempSync(join(tmpdir(), 'elyvel-migrator-'))
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    test('migrate --step runs each migration as its own batch, so rollback --step undoes them one at a time', async () => {
      writeMigrations(dir, ['0001_create_a', '0002_create_b', '0003_create_c'])
      const applied = await migrate(conn, dir, { step: true })
      expect(applied).toEqual(['0001_create_a', '0002_create_b', '0003_create_c'])
      expect(await hasTable(conn, 'a')).toBe(true)
      expect(await hasTable(conn, 'b')).toBe(true)
      expect(await hasTable(conn, 'c')).toBe(true)

      // Without --step, a plain rollback() would undo ALL three (same batch).
      // With --step at migrate time, each is its own batch — rollback() (no
      // options) only undoes the single most recent one.
      const rolledBack = await rollback(conn, dir)
      expect(rolledBack).toEqual(['0003_create_c'])
      expect(await hasTable(conn, 'c')).toBe(false)
      expect(await hasTable(conn, 'b')).toBe(true)
    })

    test('rollback --step=N undoes the last N migrations across batches', async () => {
      writeMigrations(dir, ['0001_create_a', '0002_create_b'])
      await migrate(conn, dir, { step: true }) // 2 batches
      writeMigrations(dir, ['0003_create_c'])
      await migrate(conn, dir) // batch 3, joins nothing (only one pending)

      const rolledBack = await rollback(conn, dir, { step: 2 })
      expect(rolledBack.sort()).toEqual(['0002_create_b', '0003_create_c'])
      expect(await hasTable(conn, 'a')).toBe(true)
      expect(await hasTable(conn, 'b')).toBe(false)
      expect(await hasTable(conn, 'c')).toBe(false)
    })

    test('rollback --batch=N undoes exactly that batch', async () => {
      writeMigrations(dir, ['0001_create_a'])
      await migrate(conn, dir) // batch 1
      writeMigrations(dir, ['0002_create_b'])
      await migrate(conn, dir) // batch 2

      const rolledBack = await rollback(conn, dir, { batch: 1 })
      expect(rolledBack).toEqual(['0001_create_a'])
      expect(await hasTable(conn, 'a')).toBe(false)
      expect(await hasTable(conn, 'b')).toBe(true) // batch 2 untouched
    })

    test('migrate:reset rolls back every applied migration, not just the last batch', async () => {
      writeMigrations(dir, ['0001_create_a'])
      await migrate(conn, dir)
      writeMigrations(dir, ['0002_create_b'])
      await migrate(conn, dir)

      const rolledBack = await reset(conn, dir)
      expect(rolledBack.sort()).toEqual(['0001_create_a', '0002_create_b'])
      expect(await hasTable(conn, 'a')).toBe(false)
      expect(await hasTable(conn, 'b')).toBe(false)
      expect((await status(conn, dir)).every(s => !s.ran)).toBe(true)
    })

    test('migrate:refresh rolls back everything then re-migrates', async () => {
      writeMigrations(dir, ['0001_create_a', '0002_create_b'])
      await migrate(conn, dir)

      let seeded = false
      const { rolledBack, applied } = await refresh(conn, dir, {
        seed: async () => {
          seeded = true
        },
      })
      expect(rolledBack.sort()).toEqual(['0001_create_a', '0002_create_b'])
      expect(applied).toEqual(['0001_create_a', '0002_create_b'])
      expect(await hasTable(conn, 'a')).toBe(true)
      expect(await hasTable(conn, 'b')).toBe(true)
      expect(seeded).toBe(true)
    })

    test('migrate:refresh --step=N only refreshes the last N migrations', async () => {
      writeMigrations(dir, ['0001_create_a', '0002_create_b'])
      await migrate(conn, dir, { step: true }) // 2 batches, so step targets exactly one each

      const { rolledBack, applied } = await refresh(conn, dir, { step: 1 })
      expect(rolledBack).toEqual(['0002_create_b'])
      expect(applied).toEqual(['0002_create_b'])
      expect(await hasTable(conn, 'a')).toBe(true) // untouched
      expect(await hasTable(conn, 'b')).toBe(true) // dropped + recreated
    })

    test('migrate --pretend collects SQL without touching the database or the ledger', async () => {
      writeMigrations(dir, ['0001_create_a'])
      const sql: string[] = []
      const applied = await migrate(conn, dir, { pretend: sql })
      expect(applied).toEqual(['0001_create_a'])
      expect(sql.some(s => /create table/i.test(s))).toBe(true)
      expect(await hasTable(conn, 'a')).toBe(false)
      expect((await status(conn, dir)).every(s => !s.ran)).toBe(true)
    })

    test('rollback --pretend collects SQL without touching the database or the ledger', async () => {
      writeMigrations(dir, ['0001_create_a'])
      await migrate(conn, dir)
      const sql: string[] = []
      const rolledBack = await rollback(conn, dir, { pretend: sql })
      expect(rolledBack).toEqual(['0001_create_a'])
      expect(sql.some(s => /drop table/i.test(s))).toBe(true)
      // Real table + ledger row are both untouched — pretend never executes.
      expect(await hasTable(conn, 'a')).toBe(true)
      expect((await status(conn, dir)).every(s => s.ran)).toBe(true)
    })
  })
}
