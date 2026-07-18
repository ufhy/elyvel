import { Model, SchemaBuilder } from '@elyvel/database'
import { describe, expect, test } from 'bun:test'
import { refreshDatabase } from '../src/index'

class Widget extends Model {
  static override guarded = []
  static override table = 'widgets'
  static override timestamps = false
  declare id: number
  declare name: string
}

describe('refreshDatabase', () => {
  test('opens a fresh in-memory connection and runs the seed', async () => {
    await refreshDatabase({
      seed: conn => new SchemaBuilder(conn).create('widgets', (t) => {
        t.id()
        t.string('name')
      }),
    })
    const w = await Widget.create({ name: 'gear' })
    expect(w.id).toBe(1)
    expect((await Widget.all()).count()).toBe(1)
  })

  test('each call starts empty (isolation)', async () => {
    await refreshDatabase({
      seed: conn => new SchemaBuilder(conn).create('widgets', (t) => {
        t.id()
        t.string('name')
      }),
    })
    // Fresh DB — the row from the previous test is gone.
    expect((await Widget.all()).count()).toBe(0)
  })
})
