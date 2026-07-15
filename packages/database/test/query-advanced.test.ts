import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Person extends Model {
  static override table = 'people'
  static override timestamps = false
  declare id: number
  declare name: string
  declare age: number
  declare role: string
  declare score: number
  declare bonus: number
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`advanced query (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('people', (t) => {
        t.id()
        t.string('name')
        t.integer('age')
        t.string('role')
        t.integer('score')
        t.integer('bonus')
      })
      await Person.create({ name: 'Ada', age: 28, role: 'dev', score: 95, bonus: 10 })
      await Person.create({ name: 'Bob', age: 40, role: 'dev', score: 60, bonus: 70 })
      await Person.create({ name: 'Cara', age: 25, role: 'qa', score: 80, bonus: 80 })
      await Person.create({ name: 'Dan', age: 35, role: 'dev', score: 50, bonus: 40 })
    })

    test('grouped where: role=dev AND (age<30 OR score>90)', async () => {
      const rows = await Person.query()
        .where('role', 'dev')
        .where((q) => q.where('age', '<', 30).orWhere('score', '>', 90))
        .get()
      expect(rows.pluck('name').all()).toEqual(['Ada'])
    })

    test('whereColumn', async () => {
      expect(await Person.query().whereColumn('score', '>', 'bonus').count()).toBe(2)
    })

    test('whereNotIn / orWhereIn', async () => {
      expect(await Person.query().whereNotIn('role', ['qa']).count()).toBe(3)
      const rows = await Person.query().where('role', 'qa').orWhereIn('name', ['Ada']).get()
      expect(rows.pluck('name').all().sort()).toEqual(['Ada', 'Cara'])
    })

    test('whereNotBetween', async () => {
      const rows = await Person.query().whereNotBetween('age', [30, 40]).get()
      expect(rows.pluck('name').all().sort()).toEqual(['Ada', 'Cara'])
    })

    test('when applies conditionally', async () => {
      const dev = async (flag: boolean) =>
        (
          await Person.query()
            .when(flag, (q) => q.where('role', 'dev'))
            .get()
        ).count()
      expect(await dev(true)).toBe(3)
      expect(await dev(false)).toBe(4)
    })

    test('latest / oldest', async () => {
      expect((await Person.query().latest('score').first())?.name).toBe('Ada')
      expect((await Person.query().oldest('score').first())?.name).toBe('Dan')
    })
  })
}
