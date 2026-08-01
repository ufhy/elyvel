import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_HOT_FILE, elyvel } from '../plugin.mjs'
import { DEFAULT_HOT_FILE as TAGS_HOT_FILE, viteTags } from '../src/tags'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-vite-plugin-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Stands in for the bits of Vite's dev server the plugin touches. */
function fakeServer(
  address: { address: string, port: number, family?: string } | string | null,
  base = '/build/',
  serverConfig: Record<string, unknown> = {},
) {
  const listeners: (() => void)[] = []
  return {
    server: {
      httpServer: {
        once: (event: string, listener: () => void) => {
          if (event === 'listening')
            listeners.push(listener)
        },
        address: () => address,
      },
      config: { base, server: serverConfig },
    },
    listen: () => listeners.forEach(l => l()),
  }
}

describe('elyvel() vite plugin', () => {
  test('defaults to the same path Laravel uses, so the two are interchangeable', () => {
    expect(DEFAULT_HOT_FILE).toBe('public/hot')
  })

  /**
   * The plugin is plain JS (Vite loads configs under Node) while the reader is
   * TypeScript, so the default path exists twice. If they ever drift, the dev
   * server writes a file the backend never reads and dev silently serves the
   * last build — no error, just stale UI.
   */
  test('the writer and the reader agree on the default path', () => {
    expect(DEFAULT_HOT_FILE).toBe(TAGS_HOT_FILE)
  })

  test('writes the dev server URL WITH vite\'s base once the server is listening', () => {
    const hotFile = join(dir, 'hot')
    const { server, listen } = fakeServer({ address: '127.0.0.1', port: 5173 })

    elyvel({ hotFile }).configureServer(server)
    expect(existsSync(hotFile)).toBe(false) // nothing written before it listens

    listen()
    expect(readFileSync(hotFile, 'utf8')).toBe('http://127.0.0.1:5173/build')
  })

  /**
   * The base has to be in the file, not appended by the reader: `viteTags` takes
   * the contents verbatim. Writing the bare origin here would produce URLs that
   * 404 in the browser with no server-side error — the failure mode this whole
   * mechanism exists to remove.
   */
  test('what it writes is exactly what viteTags reads back', () => {
    const hotFile = join(dir, 'hot')
    const { server, listen } = fakeServer({ address: '127.0.0.1', port: 5173 }, '/assets/')
    elyvel({ hotFile }).configureServer(server)
    listen()

    const tags = viteTags({ entry: 'app.ts', hotFile, base: '/assets/' })
    expect(tags).toContain('http://127.0.0.1:5173/assets/@vite/client')
    expect(tags).toContain('http://127.0.0.1:5173/assets/app.ts')
    expect(tags).not.toContain('/assets/assets/')
  })

  /**
   * Regression, found by actually running `vite`: Vite binds `::1` here, and an
   * unbracketed IPv6 host produced `http://::1:5199/build` — an invalid URL. The
   * page still rendered, so the only symptom was every asset failing to load.
   */
  test('an IPv6 address is bracketed', () => {
    const hotFile = join(dir, 'hot')
    const { server, listen } = fakeServer({ address: '::1', port: 5199, family: 'IPv6' })
    elyvel({ hotFile }).configureServer(server)
    listen()
    expect(readFileSync(hotFile, 'utf8')).toBe('http://[::1]:5199/build')
    expect(() => new URL(readFileSync(hotFile, 'utf8'))).not.toThrow()
  })

  test('server.origin wins over the bound address', () => {
    const hotFile = join(dir, 'hot')
    const { server, listen } = fakeServer({ address: '127.0.0.1', port: 5173 }, '/build/', { origin: 'https://assets.test' })
    elyvel({ hotFile }).configureServer(server)
    listen()
    expect(readFileSync(hotFile, 'utf8')).toBe('https://assets.test/build')
  })

  test('an hmr host/clientPort override is honoured, as in Laravel', () => {
    const hotFile = join(dir, 'hot')
    const { server, listen } = fakeServer(
      { address: '127.0.0.1', port: 5173 },
      '/build/',
      { hmr: { host: 'tunnel.test', clientPort: 443, protocol: 'wss' } },
    )
    elyvel({ hotFile }).configureServer(server)
    listen()
    expect(readFileSync(hotFile, 'utf8')).toBe('https://tunnel.test:443/build')
  })

  test('https is reflected in the written URL', () => {
    const hotFile = join(dir, 'hot')
    const { server, listen } = fakeServer({ address: '127.0.0.1', port: 5173 }, '/build/', { https: {} })
    elyvel({ hotFile }).configureServer(server)
    listen()
    expect(readFileSync(hotFile, 'utf8')).toStartWith('https://')
  })

  test('creates the directory when it does not exist yet', () => {
    const hotFile = join(dir, 'public', 'hot')
    const { server, listen } = fakeServer({ address: '127.0.0.1', port: 5173 })
    elyvel({ hotFile }).configureServer(server)
    listen()
    expect(existsSync(hotFile)).toBe(true)
  })

  test('a socket address (no port) writes nothing rather than a broken URL', () => {
    const hotFile = join(dir, 'hot')
    const { server, listen } = fakeServer('/tmp/vite.sock')
    elyvel({ hotFile }).configureServer(server)
    listen()
    expect(existsSync(hotFile)).toBe(false)
  })
})
