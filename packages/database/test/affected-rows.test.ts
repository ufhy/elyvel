import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection } from '../src/connection'
import { QueryBuilder } from '../src/query-builder'

let connection: Connection

beforeEach(async () => {
  connection = await createConnection({ driver: 'sqlite', database: ':memory:' })
  await connection.unprepared('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER, tag TEXT)')
  for (const [n, tag] of [[1, 'a'], [2, 'a'], [3, 'b']] as const)
    await connection.statement('INSERT INTO t (n, tag) VALUES (?, ?)', [n, tag])
})

// `test/setup.ts` is preloaded and closes connections after each test.

const table = (): QueryBuilder => new QueryBuilder(connection, 't')

/**
 * `update()`/`delete()` used to resolve to `void`, so there was no way to tell
 * "updated three rows" from "matched nothing" — the distinction most callers
 * branch on ("nothing matched, so 404"). Laravel returns the count.
 */
describe('update and delete report how many rows they changed', () => {
  test('update returns the number of matched rows', async () => {
    expect(await table().where('tag', 'a').update({ n: 9 })).toBe(2)
    expect(await table().update({ n: 0 })).toBe(3)
  })

  test('update returns 0 when nothing matched', async () => {
    expect(await table().where('tag', 'nope').update({ n: 9 })).toBe(0)
  })

  test('delete returns the number of removed rows', async () => {
    expect(await table().where('tag', 'a').delete()).toBe(2)
    expect(await table().count()).toBe(1)
  })

  test('delete returns 0 when nothing matched', async () => {
    expect(await table().where('tag', 'nope').delete()).toBe(0)
    expect(await table().count()).toBe(3)
  })

  test('the statement still runs, and the count reflects reality', async () => {
    const changed = await table().where('n', '>', 1).update({ tag: 'x' })
    expect(changed).toBe(2)
    expect(await table().where('tag', 'x').count()).toBe(2)
  })

  /**
   * A connection predating `affectingStatement` can't report a count. Returning
   * `0` would be a lie the caller can't detect, so the write happens and only
   * READING the count fails, with a message naming the fix.
   */
  test('a connection without affectingStatement fails loudly, after running the write', async () => {
    const legacy = { ...connection, affectingStatement: undefined } as Connection
    const builder = new QueryBuilder(legacy, 't')

    await expect(builder.where('tag', 'a').update({ n: 42 })).rejects.toThrow(
      /cannot report affected rows/,
    )
    // The write was not skipped — it ran before the count was found unavailable.
    expect(await table().where('n', 42).count()).toBe(2)
  })
})
