import type { Application } from '@elyvel/core'
import { Dispatcher, QueuedListener } from '@elyvel/events'
import { describe, expect, test } from 'bun:test'
import { registerListener } from '../src/listener-job'
import { QueueServiceProvider } from '../src/provider'

function stubApp(config: Record<string, unknown> = {}) {
  const app = {
    config: { get: (key: string, fallback?: unknown) => (key in config ? config[key] : fallback) },
    container: { instance: () => {} },
  }
  return app as unknown as Application
}

describe('QueueServiceProvider', () => {
  test('wires @elyvel/events\' QueuedListener so a dispatched event actually runs via this queue', async () => {
    const seen: unknown[] = []
    class RewardListener extends QueuedListener<{ id: number }> {
      handle(event: { id: number }) {
        seen.push(event)
      }
    }
    registerListener(RewardListener)

    new QueueServiceProvider(stubApp({ queue: { default: 'sync' } })).register()

    const dispatcher = new Dispatcher()
    dispatcher.listen('Reward', new RewardListener())
    await dispatcher.dispatch('Reward', { id: 42 })

    expect(seen).toEqual([{ id: 42 }]) // the sync connection runs it inline, but through the queue job
  })
})
