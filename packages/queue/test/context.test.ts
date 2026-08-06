import { Context, withContextScope } from '@elyvel/core'
import { describe, expect, test } from 'bun:test'
import { Job, registerJob } from '../src/job'
import { QueueManager } from '../src/manager'
import { MemoryQueueStore } from '../src/store'
import { Worker } from '../src/worker'

const seenTraceIds: (string | undefined)[] = []

class RecordTrace extends Job {
  async handle(): Promise<void> {
    seenTraceIds.push(Context.get<string>('trace_id'))
  }
}
registerJob(RecordTrace)

/**
 * The half of Laravel's Context that justifies the feature: it follows a job
 * across the queue. The trace_id a middleware set on the request appears in the
 * log lines the worker writes — in another process, minutes later.
 */
describe('Context rides queued jobs', () => {
  test('a job sees the context of the request that dispatched it', async () => {
    const store = new MemoryQueueStore()
    const manager = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    manager.extend('memory', () => store)

    await withContextScope(async () => {
      Context.add('trace_id', 'req-123')
      await manager.push(new RecordTrace())
    })

    // The worker runs OUTSIDE the request scope, as it would in another process.
    const worker = new Worker(store)
    await worker.processNext()

    expect(seenTraceIds).toEqual(['req-123'])
  })

  test('a job dispatched with no context sees an empty one, not a stale one', async () => {
    seenTraceIds.length = 0
    const store = new MemoryQueueStore()
    const manager = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    manager.extend('memory', () => store)

    await manager.push(new RecordTrace())
    await new Worker(store).processNext()

    expect(seenTraceIds).toEqual([undefined])
  })
})
