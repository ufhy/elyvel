import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { SchemaBuilder } from '../src/schema'
import { table } from '../src/query-builder'

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`query builder full (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('users', (t) => {
        t.id()
        t.string('name')
        t.integer('team_id')
        t.integer('score')
        t.timestamp('joined_at').nullable()
      })
      await new SchemaBuilder(conn).create('teams', (t) => {
        t.id()
        t.string('title')
      })
      await table('teams').insertMany([{ title: 'A' }, { title: 'B' }])
      await table('users').insertMany([
        { name: 'Ada', team_id: 1, score: 90, joined_at: '2020-03-15T10:00:00.000Z' },
        { name: 'Alan', team_id: 1, score: 70, joined_at: '2021-06-20T12:00:00.000Z' },
        { name: 'Grace', team_id: 2, score: 85, joined_at: '2020-11-01T09:00:00.000Z' },
        { name: 'Linus', team_id: 2, score: 50, joined_at: '2022-01-05T08:00:00.000Z' },
      ])
    })

    test('whereNot / orWhereNull / whereLike', async () => {
      const notTeam1 = await table('users').whereNot('team_id', 1).get()
      expect(notTeam1.map((r) => r.name).sort()).toEqual(['Grace', 'Linus'])

      const like = await table('users').whereLike('name', 'A%').get()
      expect(like.map((r) => r.name).sort()).toEqual(['Ada', 'Alan'])
    })

    test('whereBetween / whereBetweenColumns', async () => {
      const mid = await table('users').whereBetween('score', [60, 88]).orderBy('score').get()
      expect(mid.map((r) => r.name)).toEqual(['Alan', 'Grace'])
    })

    test('whereDate / whereYear / whereMonth', async () => {
      const y2020 = await table('users').whereYear('joined_at', 2020).get()
      expect(y2020.map((r) => r.name).sort()).toEqual(['Ada', 'Grace'])

      const march = await table('users').whereMonth('joined_at', 3).get()
      expect(march.map((r) => r.name)).toEqual(['Ada'])

      const onDay = await table('users').whereDate('joined_at', '2021-06-20').get()
      expect(onDay.map((r) => r.name)).toEqual(['Alan'])
    })

    test('joins: inner, cross, join-closure, subquery scalar select', async () => {
      const joined = await table('users')
        .join('teams', 'teams.id', '=', 'users.team_id')
        .select('users.name', 'teams.title')
        .orderBy('users.name')
        .get()
      expect(joined[0]).toMatchObject({ name: 'Ada', title: 'A' })

      const closure = await table('users')
        .join('teams', (j) => j.on('teams.id', '=', 'users.team_id').where('teams.title', '=', 'B'))
        .select('users.name')
        .orderBy('users.name')
        .get()
      expect(closure.map((r) => r.name).sort()).toEqual(['Grace', 'Linus'])

      const cross = await table('users').crossJoin('teams').count()
      expect(cross).toBe(8) // 4 users × 2 teams
    })

    test('subqueries: whereIn(sub), selectSub, fromSub', async () => {
      const sub = table('teams').select('id').where('title', 'B')
      const inTeamB = await table('users').whereIn('team_id', sub).orderBy('name').get()
      expect(inTeamB.map((r) => r.name)).toEqual(['Grace', 'Linus'])

      // selectSub: team title as a correlated-ish scalar (non-correlated here)
      const withCount = await table('users')
        .selectSub(table('users').selectRaw('count(*)'), 'total')
        .limit(1)
        .get()
      expect(Number(withCount[0]?.total)).toBe(4)

      // fromSub
      const highScorers = table('users').select('name', 'score').where('score', '>', 60)
      const fromSub = await table('sq')
        .fromSub(highScorers, 'sq')
        .where('score', '<', 90)
        .orderBy('name')
        .get()
      expect(fromSub.map((r) => r.name)).toEqual(['Alan', 'Grace'])
    })

    test('groupByRaw + having + havingBetween + aggregates', async () => {
      // sum(score): team1=160, team2=135 — filter groups with havingRaw on the aggregate.
      const totals = await table('users')
        .select('team_id')
        .selectRaw('sum(score) AS total')
        .groupByRaw('team_id')
        .havingRaw('sum(score) > ?', [150])
        .get()
      expect(totals).toHaveLength(1) // only team 1

      // havingBetween on the grouped column (portable across dialects).
      const groups = await table('users')
        .select('team_id')
        .groupBy('team_id')
        .havingBetween('team_id', [1, 1])
        .get()
      expect(groups).toHaveLength(1)
    })

    test('pagination: paginate / simplePaginate / cursorPaginate', async () => {
      const page = await table('users').orderBy('id').paginate(2, 1)
      expect(page.total).toBe(4)
      expect(page.lastPage).toBe(2)
      expect(page.data).toHaveLength(2)

      const simple = await table('users').orderBy('id').simplePaginate(2, 1)
      expect(simple.hasMore).toBe(true)
      expect(simple.data).toHaveLength(2)

      const c1 = await table('users').cursorPaginate(2)
      expect(c1.data).toHaveLength(2)
      const c2 = await table('users').cursorPaginate(2, c1.nextCursor)
      expect(c2.data).toHaveLength(2)
      expect(c2.data[0]?.id).toBe(3)
    })

    test('cursor / chunkById iterate all rows', async () => {
      const names: unknown[] = []
      for await (const row of table('users').cursor(2)) names.push(row.name)
      expect(names).toHaveLength(4)

      let seen = 0
      await table('users').chunkById(2, (rows) => {
        seen += rows.length
      })
      expect(seen).toBe(4)
    })

    test('unionAll / addSelect / skip / take / find / doesntExist', async () => {
      const u = await table('users')
        .select('name')
        .where('team_id', 1)
        .unionAll(table('users').select('name').where('team_id', 2))
        .get()
      expect(u).toHaveLength(4)

      const paged = await table('users').orderBy('id').skip(1).take(2).get()
      expect(paged.map((r) => r.id)).toEqual([2, 3])

      const found = await table('users').find(1)
      expect(found?.name).toBe('Ada')

      expect(await table('users').where('name', 'Nobody').doesntExist()).toBe(true)
    })

    test('incrementEach / truncate', async () => {
      await table('users').where('id', 1).incrementEach({ score: 5 }, { team_id: 2 })
      const ada = await table('users').find(1)
      expect(ada?.score).toBe(95)
      expect(ada?.team_id).toBe(2)

      await table('users').truncate()
      expect(await table('users').count()).toBe(0)
    })
  })
}
