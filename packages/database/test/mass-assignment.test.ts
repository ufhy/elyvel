import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Account extends Model {
  static override table = 'accounts'
  static override timestamps = false
  static override fillable = ['name', 'email'] // is_admin NOT fillable
  declare id: number
  declare name: string
  declare email: string
  declare is_admin: number
}

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

// Guarded-by-default (like Laravel): a model with no `fillable`/`guarded` is
// "totally guarded" and rejects mass assignment until you declare intent.
class Bare extends Model {
  static override table = 'bare'
  declare name: string
}
class Open extends Model {
  static override table = 'open'
  static override guarded = [] // opt back into unguarded
  declare name: string
}

describe('mass assignment defaults', () => {
  test('a fresh model is guarded by default and throws on mass assignment', () => {
    expect(() => new Bare({ name: 'x' })).toThrow(/Add \[name\] to the `fillable`/)
  })

  test('the guard error names the offending key and the escape hatch', () => {
    expect(() => new Bare({ name: 'x' })).toThrow(/set `static guarded = \[\]`/)
  })

  test('`guarded = []` opts back into fully unguarded', () => {
    expect(() => new Open({ name: 'x' })).not.toThrow()
    expect(new Open({ name: 'x' }).name).toBe('x')
  })

  test('forceFill bypasses the guard even when totally guarded', () => {
    const m = new Bare()
    m.forceFill({ name: 'x' })
    expect(m.name).toBe('x')
  })
})
