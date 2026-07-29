import { describe, expect, test } from 'bun:test'
import { configureMigrationEventDispatcher, freshMigrate, migrate, rollback } from '../src/index'
import { dialects } from './dialects'

const dir = new URL('./fixtures/migrations', import.meta.url).pathname

interface Recorded { name: string, payload: Record<string, unknown> }

for (const d of dialects) {
  describe(`migration events (${d.name})`, () => {
    test('migrate() fires migrations.started/ended and migration.started/ended', async () => {
      const conn = await d.connect()
      const recorded: Recorded[] = []
      configureMigrationEventDispatcher((name, payload) => {
        recorded.push({ name, payload })
      })

      await migrate(conn, dir)
      const ours = recorded.filter(r => JSON.stringify(r.payload).includes('0001_create_things'))

      expect(ours.map(r => r.name)).toEqual([
        'migrations.started',
        'migration.started',
        'migration.ended',
        'migrations.ended',
      ])
      expect(ours[0]?.payload).toEqual({ names: ['0001_create_things'], direction: 'up' })
      expect(ours[1]?.payload).toEqual({ name: '0001_create_things', direction: 'up' })
      expect(ours[3]?.payload).toEqual({ names: ['0001_create_things'], direction: 'up' })
    })

    test('nothing pending fires no events at all', async () => {
      const conn = await d.connect()
      await migrate(conn, dir) // apply once, untracked
      const recorded: Recorded[] = []
      configureMigrationEventDispatcher((name, payload) => {
        recorded.push({ name, payload })
      })

      await migrate(conn, dir) // nothing pending this time
      expect(recorded).toEqual([])
    })

    test('rollback() fires the same shape with direction: down', async () => {
      const conn = await d.connect()
      await migrate(conn, dir)
      const recorded: Recorded[] = []
      configureMigrationEventDispatcher((name, payload) => {
        recorded.push({ name, payload })
      })

      await rollback(conn, dir)
      const ours = recorded.filter(r => JSON.stringify(r.payload).includes('0001_create_things'))

      expect(ours.map(r => r.name)).toEqual([
        'migrations.started',
        'migration.started',
        'migration.ended',
        'migrations.ended',
      ])
      expect(ours[0]?.payload).toEqual({ names: ['0001_create_things'], direction: 'down' })
    })

    test('freshMigrate() still fires events (delegates to migrate())', async () => {
      const conn = await d.connect()
      const recorded: Recorded[] = []
      configureMigrationEventDispatcher((name, payload) => {
        recorded.push({ name, payload })
      })

      await freshMigrate(conn, dir)
      const ours = recorded.filter(r => JSON.stringify(r.payload).includes('0001_create_things'))
      expect(ours.map(r => r.name)).toContain('migrations.started')
      expect(ours.map(r => r.name)).toContain('migrations.ended')
    })
  })
}
