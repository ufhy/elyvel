import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection, transaction, useConnection } from '../src/connection'
import { table } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`table() + transactions (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('items', (t) => {
        t.id()
        t.string('name')
      })
    })

    test('table() queries without a model and returns raw rows', async () => {
      await table('items').insert({ name: 'a' })
      await table('items').insert({ name: 'b' })

      const rows = await table('items').where('name', 'a').get()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.constructor).toBe(Object) // plain row, not a model instance
      expect(rows[0]?.name).toBe('a')
      expect(await table('items').count()).toBe(2)
    })

    test('transaction commits on success', async () => {
      await transaction(async () => {
        await table('items').insert({ name: 'x' })
      })
      expect(await table('items').count()).toBe(1)
    })

    test('transaction rolls back on error', async () => {
      await expect(
        transaction(async () => {
          await table('items').insert({ name: 'y' })
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      expect(await table('items').count()).toBe(0)
    })

    test('nested transaction: inner rollback keeps outer work (savepoint)', async () => {
      const conn = useConnection()
      await transaction(async () => {
        await table('items').insert({ name: 'outer' })
        expect(conn.transactionLevel()).toBe(1)

        // Inner transaction fails and rolls back to its savepoint.
        await expect(
          transaction(async () => {
            expect(conn.transactionLevel()).toBe(2)
            await table('items').insert({ name: 'inner' })
            throw new Error('inner fail')
          }),
        ).rejects.toThrow('inner fail')

        expect(conn.transactionLevel()).toBe(1) // back to outer level
      })

      const names = (await table('items').get()).map((r) => r.name)
      expect(names).toEqual(['outer']) // inner insert rolled back, outer committed
      expect(conn.transactionLevel()).toBe(0)
    })

    test('retry: succeeds on a later attempt for concurrency errors', async () => {
      let tries = 0
      const result = await transaction(async () => {
        tries++
        if (tries < 3) throw new Error('deadlock detected')
        await table('items').insert({ name: 'retried' })
        return tries
      }, 3)
      expect(result).toBe(3)
      expect(await table('items').count()).toBe(1)
    })
  })
}
