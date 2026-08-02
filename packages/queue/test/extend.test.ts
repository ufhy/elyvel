import type { QueueConnectionConfig } from '../src/config-schema'
import type { QueuedRecord, QueueStore } from '../src/store'
import { describe, expect, test } from 'bun:test'
import { QueueManager } from '../src/manager'

/** Stands in for SQS, Beanstalk, or any hosted queue. */
class RecordingStore implements QueueStore {
  readonly pushed: string[] = []
  async push(body: string): Promise<void> {
    this.pushed.push(body)
  }

  async pop(): Promise<QueuedRecord | null> {
    return null
  }

  async release(): Promise<void> {}

  async size(): Promise<number> {
    return this.pushed.length
  }
}

describe('QueueManager.extend', () => {
  test('a registered driver is resolvable from config', async () => {
    const store = new RecordingStore()
    const manager = new QueueManager({ default: 'sqs', connections: { sqs: { driver: 'sqs' } as QueueConnectionConfig } })
    manager.extend('sqs', () => store)

    expect(manager.store()).toBe(store)
  })

  test('the factory sees the connection config', () => {
    let seen: unknown
    const manager = new QueueManager({ connections: { sqs: { driver: 'sqs', region: 'ap-southeast-3' } as never } })
    manager.extend('sqs', (cfg, name) => {
      seen = { cfg, name }
      return new RecordingStore()
    })
    manager.store('sqs')
    expect(seen).toEqual({ cfg: { driver: 'sqs', region: 'ap-southeast-3' }, name: 'sqs' })
  })

  test('an unknown driver names the ones that exist', () => {
    const manager = new QueueManager({ connections: { x: { driver: 'nope' } as never } })
    expect(() => manager.store('x')).toThrow(/Available: database, memory, redis, sync/)
  })
})
