import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { configureModelEventDispatcher, Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Thing extends Model {
  static override table = 'things'
  static override timestamps = false
  declare id: number
  declare name: string
}

class SoftThing extends Model {
  static override table = 'soft_things'
  static override timestamps = false
  static override softDeletes = true
  declare id: number
  declare name: string
}

describe('Eloquent model events → dispatcher bridge', () => {
  const bridged: string[] = []

  beforeEach(async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    const schema = new SchemaBuilder(conn)
    await schema.create('things', (t) => {
      t.id()
      t.string('name')
    })
    await schema.create('soft_things', (t) => {
      t.id()
      t.string('name')
      t.timestamp('deleted_at').nullable()
    })
    bridged.length = 0
    configureModelEventDispatcher((name) => {
      bridged.push(name)
    })
  })

  test('lifecycle events bridge as `eloquent.<event>: <Model>`', async () => {
    await Thing.create({ name: 'a' })
    expect(bridged).toContain('eloquent.saving: Thing')
    expect(bridged).toContain('eloquent.creating: Thing')
    expect(bridged).toContain('eloquent.created: Thing')
    expect(bridged).toContain('eloquent.saved: Thing')
  })

  test('retrieved fires on read (local listener + bridge)', async () => {
    await Thing.create({ name: 'x' })
    bridged.length = 0
    const seen: string[] = []
    Thing.on('retrieved', (m) => void seen.push((m as Thing).name))

    const all = await Thing.all()
    expect(all.toArray()).toHaveLength(1)
    expect(seen).toEqual(['x']) // local `retrieved` listener ran
    expect(bridged).toContain('eloquent.retrieved: Thing') // and bridged to the dispatcher
  })

  test('soft delete fires deleting → trashed → deleted', async () => {
    const row = await SoftThing.create({ name: 's' })
    bridged.length = 0
    const order: string[] = []
    for (const e of ['deleting', 'trashed', 'deleted'] as const)
      SoftThing.on(e, () => void order.push(e))

    await row.delete()
    expect(order).toEqual(['deleting', 'trashed', 'deleted'])
    expect(bridged).toContain('eloquent.trashed: SoftThing')
    expect(row.trashed()).toBe(true) // soft-deleted, still present
  })

  test('forceDelete fires forceDeleting → forceDeleted', async () => {
    const row = await SoftThing.create({ name: 'f' })
    bridged.length = 0
    const order: string[] = []
    for (const e of ['forceDeleting', 'forceDeleted'] as const)
      SoftThing.on(e, () => void order.push(e))

    await row.forceDelete()
    expect(order).toEqual(['forceDeleting', 'forceDeleted'])
    expect(bridged).toEqual(
      expect.arrayContaining([
        'eloquent.forceDeleting: SoftThing',
        'eloquent.forceDeleted: SoftThing',
      ]),
    )
  })

  test('replicate fires replicating on the clone', async () => {
    const row = await SoftThing.create({ name: 'orig' })
    bridged.length = 0
    let replicated = false
    SoftThing.on('replicating', () => {
      replicated = true
    })
    const clone = row.replicate()
    await new Promise((r) => setTimeout(r, 0)) // fire-and-forget settles
    expect(clone.name).toBe('orig')
    expect(clone.id).toBeUndefined() // key stripped
    expect(replicated).toBe(true)
    expect(bridged).toContain('eloquent.replicating: SoftThing')
  })
})
