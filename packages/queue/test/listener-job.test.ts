import { describe, expect, test } from 'bun:test'
import { serializeJob } from '../src/job'
import { ListenerJob, registerListener } from '../src/listener-job'
import { MemoryQueueStore } from '../src/store'
import { Worker } from '../src/worker'

// A queued listener (duck-typed; no dep on @elysia-ravel/events needed here).
const seen: { event: unknown, name: string }[] = []
class RewardListener {
  handle(event: unknown, name: string) {
    seen.push({ event, name })
  }
}
registerListener(RewardListener)

describe('ListenerJob', () => {
  test('handle() reconstructs the listener and runs it with the event', async () => {
    seen.length = 0
    const job = new ListenerJob()
    job.listenerName = 'RewardListener'
    job.eventName = 'OrderCreated'
    job.event = { id: 7 }
    await job.handle()
    expect(seen).toEqual([{ event: { id: 7 }, name: 'OrderCreated' }])
  })

  test('unknown listener throws a clear error', async () => {
    const job = new ListenerJob()
    job.listenerName = 'Nope'
    await expect(job.handle()).rejects.toThrow(/Unknown queued listener "Nope"/)
  })

  test('round-trips through the queue: serialize → worker → run', async () => {
    seen.length = 0
    const store = new MemoryQueueStore()
    const job = new ListenerJob()
    job.listenerName = 'RewardListener'
    job.eventName = 'OrderCreated'
    job.event = { total: 5000 }
    await store.push(JSON.stringify(serializeJob(job)))

    const processed = await new Worker(store).work({ stopWhenEmpty: true })
    expect(processed).toBe(1)
    expect(seen).toEqual([{ event: { total: 5000 }, name: 'OrderCreated' }])
  })
})
