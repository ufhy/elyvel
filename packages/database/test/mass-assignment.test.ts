import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Account extends Model {
  static override table = 'accounts'
  static override timestamps = false
  static override fillable = ['name', 'email'] // is_admin NOT fillable
  declare id: number
  declare name: string
  declare email: string
  declare is_admin: number
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`mass assignment (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('accounts', (t) => {
        t.id()
        t.string('name')
        t.string('email')
        t.integer('is_admin').default(0)
      })
    })

    test('create ignores non-fillable attributes (mass-assignment guard)', async () => {
      const acc = await Account.create({ name: 'Ada', email: 'a@b.com', is_admin: 1 })
      expect(acc.name).toBe('Ada')
      // injected is_admin=1 was NOT mass-assigned → DB default (0) wins
      expect(Number(acc.is_admin)).toBe(0)
      const fromDb = await Account.find(acc.id)
      expect(Number(fromDb?.is_admin)).toBe(0)
    })

    test('forceCreate bypasses the guard', async () => {
      const acc = await Account.forceCreate({ name: 'Ada', email: 'a@b.com', is_admin: 1 })
      expect(Number(acc.is_admin)).toBe(1)
    })
  })
}
