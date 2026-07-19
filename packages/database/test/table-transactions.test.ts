import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection, transaction, useConnection } from '../src/connection'
import { table } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

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

      const names = (await table('items').get()).map(r => r.name)
      expect(names).toEqual(['outer']) // inner insert rolled back, outer committed
      expect(conn.transactionLevel()).toBe(0)
    })

    test('concurrent transactions on the same connection do not corrupt each other', async () => {
      // Regression test: the connection is a single physical socket shared by
      // every concurrent request, and beginTransaction/commit/rollBack used
      // to be tracked via plain shared state — two overlapping transaction()
      // calls could interleave their BEGIN/SAVEPOINT/COMMIT bookkeeping, so
      // one request's rollback could silently discard another's "committed"
      // work. transaction() now runs each call through the connection's
      // runExclusive(), serializing overlapping transactions instead.
      async function txA() {
        return transaction(async () => {
          await table('items').insert({ name: 'A' })
          await new Promise(resolve => setTimeout(resolve, 20)) // yield mid-transaction
          throw new Error('A fails deliberately')
        })
      }
      async function txB() {
        await new Promise(resolve => setTimeout(resolve, 5)) // starts after A begins
        return transaction(async () => {
          await table('items').insert({ name: 'B' })
          await new Promise(resolve => setTimeout(resolve, 5))
          return 'B committed'
        })
      }

      const results = await Promise.allSettled([txA(), txB()])
      expect(results[0].status).toBe('rejected')
      expect(results[1]).toEqual({ status: 'fulfilled', value: 'B committed' })

      const names = (await table('items').get()).map(r => r.name)
      expect(names).toEqual(['B']) // A's rollback must not have touched B's committed row
      expect(useConnection().transactionLevel()).toBe(0)
    })

    test('an ordinary query from another caller waits for an open transaction to close', async () => {
      // Same root cause as above: an ordinary (non-transactional) query must
      // never execute in the middle of someone else's open transaction just
      // because they share one physical connection.
      const order: string[] = []
      async function holder() {
        return transaction(async () => {
          order.push('holder:begin')
          await table('items').insert({ name: 'holder' })
          await new Promise(resolve => setTimeout(resolve, 15))
          order.push('holder:commit')
        })
      }
      async function bystander() {
        await new Promise(resolve => setTimeout(resolve, 5))
        order.push('bystander:query-start')
        await table('items').count()
        order.push('bystander:query-end')
      }

      await Promise.all([holder(), bystander()])
      expect(order.indexOf('bystander:query-end')).toBeGreaterThan(order.indexOf('holder:commit'))
    })

    test('retry: succeeds on a later attempt for concurrency errors', async () => {
      let tries = 0
      const result = await transaction(async () => {
        tries++
        if (tries < 3)
          throw new Error('deadlock detected')
        await table('items').insert({ name: 'retried' })
        return tries
      }, 3)
      expect(result).toBe(3)
      expect(await table('items').count()).toBe(1)
    })
  })
}
