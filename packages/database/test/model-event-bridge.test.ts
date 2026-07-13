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

describe('Eloquent model events → dispatcher bridge', () => {
  const bridged: string[] = []

  beforeEach(async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    await new SchemaBuilder(conn).create('things', (t) => {
      t.id()
      t.string('name')
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
})
