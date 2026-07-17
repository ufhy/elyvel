import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class User extends Model {
  static override guarded = []
  static override table = 'users'
  static override timestamps = false
  static override hidden = ['password']
  static override appends = ['full_name']
  static override accessors = {
    full_name: (m: Model) => `${m.getAttribute('first')} ${m.getAttribute('last')}`,
  }

  declare id: number
  declare first: string
  declare last: string
  declare password: string
  declare full_name: string
}

class Account extends Model {
  static override guarded = []
  static override table = 'accounts'
  static override timestamps = false
  static override visible = ['id', 'label'] // whitelist
  declare id: number
  declare label: string
  declare secret: string
}

for (const d of dialects) {
  describe(`serialization (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('users', (t) => {
        t.id()
        t.string('first')
        t.string('last')
        t.string('password')
      })
      await schema.create('accounts', (t) => {
        t.id()
        t.string('label')
        t.string('secret')
      })
    })

    test('appends + accessors + hidden', async () => {
      const u = await User.create({ first: 'Ada', last: 'Lovelace', password: 'x' })
      expect(u.full_name).toBe('Ada Lovelace') // accessor via property
      const json = u.toJSON() as Record<string, unknown>
      expect(json.full_name).toBe('Ada Lovelace') // appended
      expect(json.password).toBeUndefined() // hidden
    })

    test('makeVisible / makeHidden per instance', async () => {
      const u = await User.create({ first: 'Ada', last: 'Lovelace', password: 'x' })
      expect((u.makeVisible('password').toJSON() as Record<string, unknown>).password).toBe('x')
      expect((u.makeHidden('last').toJSON() as Record<string, unknown>).last).toBeUndefined()
    })

    test('visible whitelist', async () => {
      const a = await Account.create({ label: 'main', secret: 'shh' })
      const json = a.toJSON() as Record<string, unknown>
      expect(Object.keys(json).sort()).toEqual(['id', 'label'])
    })
  })
}
