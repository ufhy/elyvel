import { describe, expect, test } from 'bun:test'
import { app, application, createApp } from '../src/application'
import { config, ConfigToken } from '../src/config'
import { DedupProvider } from './fixtures-discovery/providers/DedupProvider'
import { DiscoveredToken } from './fixtures-discovery/providers/DiscoveredProvider'
import { MarkerToken } from './fixtures/providers/MarkerProvider'

const basePath = new URL('./fixtures', import.meta.url).pathname
const discoveryBasePath = new URL('./fixtures-discovery', import.meta.url).pathname

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

describe('package discovery (bootstrap/providers.generated.ts)', () => {
  test('registers a provider found ONLY in the generated manifest, not config/app.ts', async () => {
    const discoveryApp = await createApp({ basePath: discoveryBasePath, autoloadRoutes: false })
    const marker = discoveryApp.make(DiscoveredToken)
    expect(marker.registered).toBe(true)
    expect(marker.booted).toBe(true)
  })

  test('a provider listed in BOTH the manifest and config/app.ts registers/boots only once', async () => {
    DedupProvider.registerCount = 0
    DedupProvider.bootCount = 0
    await createApp({ basePath: discoveryBasePath, autoloadRoutes: false })
    expect(DedupProvider.registerCount).toBe(1)
    expect(DedupProvider.bootCount).toBe(1)
  })

  test('missing bootstrap/providers.generated.ts is not an error (discovery never run)', async () => {
    // The default `fixtures` basePath has no bootstrap/ dir at all.
    await expect(createApp({ basePath, autoloadRoutes: false })).resolves.toBeDefined()
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
