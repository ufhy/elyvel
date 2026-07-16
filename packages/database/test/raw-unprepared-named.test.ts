import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, raw, setConnection, unprepared } from '../src/connection'

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`unprepared + named bindings (${d.name})`, () => {
    beforeEach(async () => {
      setConnection(await d.connect())
    })

    test('unprepared runs multi-statement DDL', async () => {
      await unprepared(
        'CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (id INTEGER PRIMARY KEY);',
      )
      await raw('INSERT INTO a (id) VALUES (1)')
      await raw('INSERT INTO b (id) VALUES (2)')
      expect((await raw('SELECT id FROM a'))[0]?.id).toBe(1)
      expect((await raw('SELECT id FROM b'))[0]?.id).toBe(2)
    })

    test('named bindings (:name) resolve positionally', async () => {
      await unprepared('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      await raw('INSERT INTO users (id, name, age) VALUES (:id, :name, :age)', {
        id: 1,
        name: 'Ada',
        age: 36,
      })

      const rows = await raw<{ name: string, age: number }>(
        'SELECT name, age FROM users WHERE age > :min AND name = :who',
        { min: 30, who: 'Ada' },
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('Ada')
      expect(rows[0]?.age).toBe(36)
    })

    test('a named param reused twice binds at each occurrence', async () => {
      await unprepared('CREATE TABLE nums (a INTEGER, b INTEGER)')
      await raw('INSERT INTO nums (a, b) VALUES (:v, :v)', { v: 7 })
      const row = await raw<{ a: number, b: number }>('SELECT a, b FROM nums')
      expect(row[0]?.a).toBe(7)
      expect(row[0]?.b).toBe(7)
    })
  })
}
