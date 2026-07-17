import type { EloquentBuilder } from '../src'
import { beforeEach, describe, expect, test } from 'bun:test'
import { Model } from '../src'
import { setConnection } from '../src/connection'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Log extends Model {
  static override table = 'logs'
  static override timestamps = false
  declare id: number
  declare level: string

  static override prunable(): EloquentBuilder<Model> | null {
    return this.query<Log>().where('level', 'debug')
  }
}

class Kept extends Model {
  static override table = 'kept'
  static override timestamps = false
  declare id: number
}

for (const d of dialects) {
  describe(`pruning (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('logs', (t) => {
        t.id()
        t.string('level')
      })
      await new SchemaBuilder(conn).create('kept', (t) => {
        t.id()
      })
    })

    test('prunes matching rows in batches, leaves the rest', async () => {
      for (let i = 0; i < 5; i++) await Log.create({ level: 'debug' })
      for (let i = 0; i < 3; i++) await Log.create({ level: 'info' })

      const pruned = await Log.prune(2)
      expect(pruned).toBe(5)
      expect(await Log.query().count()).toBe(3)
    })

    test('fires the pruning event per record', async () => {
      const seen: number[] = []
      Log.on('pruning', (m) => {
        seen.push((m as Log).id)
      })
      await Log.create({ level: 'debug' })
      await Log.create({ level: 'debug' })
      await Log.prune()
      expect(seen).toHaveLength(2)
    })

    test('non-prunable model throws', async () => {
      await expect(Kept.prune()).rejects.toThrow(/not prunable/)
    })
  })
}
