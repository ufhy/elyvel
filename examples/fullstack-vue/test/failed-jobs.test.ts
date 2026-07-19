import { join } from 'node:path'
import { createApp } from '@elyvel/core'
import { migrate } from '@elyvel/database'
import { failedJobs } from '@elyvel/queue'
import { refreshDatabase } from '@elyvel/testing'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

const basePath = join(import.meta.dir, '..')

const savedAppKey = process.env.APP_KEY
process.env.APP_KEY = 'base64:test-key'
afterAll(() => {
  if (savedAppKey === undefined)
    delete process.env.APP_KEY
  else process.env.APP_KEY = savedAppKey
})

describe('DatabaseFailedJobStore (real SQLite, wired via AppServiceProvider)', () => {
  beforeEach(async () => {
    // Booting the app runs AppServiceProvider.boot(), which calls
    // configureFailedJobs(new DatabaseFailedJobStore()) — no manual wiring
    // needed here, exactly what a real app gets by default.
    await createApp({ basePath })
    await refreshDatabase({
      seed: async (connection) => { await migrate(connection, join(basePath, 'database/migrations')) },
    })
  })

  test('log() persists to the real failed_jobs table; find()/all() read it back', async () => {
    const repo = failedJobs()
    expect(repo).not.toBeNull()

    const id = await repo!.log('redis', 'default', JSON.stringify({ job: 'SendEmail' }), new Error('SMTP timeout'))
    const found = await repo!.find(id)
    expect(found?.connection).toBe('redis')
    expect(found?.queue).toBe('default')
    expect(found?.exception).toContain('SMTP timeout')

    const all = await repo!.all()
    expect(all.map(r => r.id)).toContain(id)
  })

  test('forget() removes a row; returns false for an unknown id', async () => {
    const repo = failedJobs()!
    const id = await repo.log('sync', 'default', '{}', new Error('boom'))
    expect(await repo.forget(id)).toBe(true)
    expect(await repo.find(id)).toBeNull()
    expect(await repo.forget(id)).toBe(false) // already gone
  })

  test('prune() deletes only records older than the cutoff', async () => {
    const repo = failedJobs()!
    const oldId = await repo.log('sync', 'default', '{}', new Error('old failure'))
    // Backdate it directly via the same table the adapter uses.
    const { table } = await import('@elyvel/database')
    await table('failed_jobs').where('uuid', oldId).update({ failed_at: Date.now() - 48 * 3600 * 1000 })

    const recentId = await repo.log('sync', 'default', '{}', new Error('recent failure'))

    const pruned = await repo.prune(24) // older than 24h
    expect(pruned).toBe(1)
    expect(await repo.find(oldId)).toBeNull()
    expect(await repo.find(recentId)).not.toBeNull()
  })

  test('flush() clears every record', async () => {
    const repo = failedJobs()!
    await repo.log('sync', 'default', '{}', new Error('a'))
    await repo.log('sync', 'default', '{}', new Error('b'))
    await repo.flush()
    expect(await repo.all()).toHaveLength(0)
  })
})
