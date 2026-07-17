import { describe, expect, test } from 'bun:test'
import { app, application, createApp } from '../src/application'
import { config, ConfigToken } from '../src/config'
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
      register() {}
      boot() {
        booted = true
      }
    }
    await createApp({ basePath, autoloadRoutes: false, providers: [InlineProvider as any] })
    expect(booted).toBe(true)
  })
})

describe('global helpers', () => {
  test('config() reads the booted repository by dot-path', async () => {
    await createApp({ basePath, autoloadRoutes: false })
    expect(config<string>('app.name')).toBe('Test App')
    expect(config<number>('app.port')).toBe(4321)
    expect(config('app.missing', 'fallback')).toBe('fallback')
  })

  test('app() returns the running application; app(token) resolves a binding', async () => {
    const created = await createApp({ basePath, autoloadRoutes: false })
    expect(app()).toBe(created)
    expect(application()).toBe(created)
    expect(app(ConfigToken)).toBe(created.config)
  })
})
