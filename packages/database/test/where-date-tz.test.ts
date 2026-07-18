import type { Connection } from '../src/connection'
import { runWithTimezone } from '@elysia-ravel/core'
import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

// created_at is UTC. 16:30Z is still 2021-06-20 in UTC, but 2021-06-21 00:30 in
// Asia/Makassar (+08). whereDate must bucket by the LOCAL day of the active tz.
for (const d of dialects) {
  describe(`whereDate timezone-awareness (${d.name})`, () => {
    let conn: Connection
    beforeEach(async () => {
      conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('events', (t) => {
        t.id()
        t.string('name')
        t.timestamp('created_at')
      })
      await new QueryBuilder(conn, 'events').insertMany([
        { name: 'late', created_at: '2021-06-20T16:30:00.000Z' }, // 2021-06-21 in +08
        { name: 'early', created_at: '2021-06-20T02:00:00.000Z' }, // 2021-06-20 in +08
      ])
    })

    const onDay = (date: string, tz: string) =>
      runWithTimezone(tz, () => new QueryBuilder(conn, 'events').whereDate('created_at', date).get())
        .then(rows => rows.map(r => r.name).sort())

    test('UTC: both rows fall on 2021-06-20', async () => {
      expect(await onDay('2021-06-20', 'UTC')).toEqual(['early', 'late'])
    })

    test('Asia/Makassar (+08): the 16:30Z row moves to 2021-06-21', async () => {
      expect(await onDay('2021-06-20', 'Asia/Makassar')).toEqual(['early'])
      expect(await onDay('2021-06-21', 'Asia/Makassar')).toEqual(['late'])
    })

    test('operators respect the local day boundary (>= start of day)', async () => {
      // In +08, only the 2021-06-21 row is on/after that local day.
      const rows = await runWithTimezone('Asia/Makassar', () =>
        new QueryBuilder(conn, 'events').whereDate('created_at', '>=', '2021-06-21').get())
      expect(rows.map(r => r.name)).toEqual(['late'])
    })
  })
}
