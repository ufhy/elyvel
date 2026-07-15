import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type QueryErrored,
  type QueryExecuted,
  createConnection,
  setConnection,
} from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Widget extends Model {
  static override table = 'widgets'
  static override timestamps = false
  declare id: number
  declare name: string
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`query listeners (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('widgets', (t) => {
        t.id()
        t.string('name')
      })
    })

    test('onQuery fires per executed query and unsubscribes', async () => {
      const conn = (await import('../src/connection')).useConnection()
      const seen: QueryExecuted[] = []
      const off = conn.onQuery((e) => seen.push(e))

      await Widget.create({ name: 'a' })
      await Widget.query().get()
      expect(seen.length).toBeGreaterThanOrEqual(2)
      expect(seen[0]?.sql).toContain('widgets')
      expect(typeof seen[0]?.ms).toBe('number')

      off()
      const before = seen.length
      await Widget.query().get()
      expect(seen.length).toBe(before) // no more events after unsubscribe
    })

    test('whenQueryingForLongerThan fires once cumulative time crosses threshold', async () => {
      const conn = (await import('../src/connection')).useConnection()
      let fired = 0
      // Threshold 0 → the very first query crosses it.
      conn.whenQueryingForLongerThan(0, () => {
        fired++
      })

      await Widget.query().get()
      await Widget.query().get()
      expect(fired).toBe(1) // fires once, not per query
      expect(conn.getTotalQueryDuration()).toBeGreaterThanOrEqual(0)

      conn.resetTotalQueryDuration()
      expect(conn.getTotalQueryDuration()).toBe(0)
      await Widget.query().get()
      expect(fired).toBe(2) // re-armed after reset
    })

    test('onQueryError fires with sql + error, then re-throws', async () => {
      const conn = (await import('../src/connection')).useConnection()
      const errors: QueryErrored[] = []
      conn.onQueryError((e) => errors.push(e))

      // Querying a non-existent table fails at the driver level.
      await expect(conn.select('SELECT * FROM does_not_exist')).rejects.toThrow()

      expect(errors).toHaveLength(1)
      expect(errors[0]?.sql).toContain('does_not_exist')
      expect(errors[0]?.error).toBeDefined()
      expect(typeof errors[0]?.ms).toBe('number')
    })
  })
}
