import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/application'
import { MarkerToken } from './fixtures/providers/MarkerProvider'

const basePath = new URL('./fixtures', import.meta.url).pathname

describe('createApp', () => {
  test('loads config from the config/ directory', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false })
    expect(app.config.get<string>('app.name')).toBe('Test App')
    expect(app.config.get<number>('app.port')).toBe(4321)
  })

  test('runs provider register() then boot()', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false })
    const marker = app.make(MarkerToken)
    expect(marker.registered).toBe(true)
    expect(marker.booted).toBe(true)
  })

  test('merges providers passed via options', async () => {
    let booted = false
    class InlineProvider {
      constructor(private readonly app: any) {}
      register() {}
      boot() {
        booted = true
      }
    }
    await createApp({ basePath, autoloadRoutes: false, providers: [InlineProvider as any] })
    expect(booted).toBe(true)
  })
})
