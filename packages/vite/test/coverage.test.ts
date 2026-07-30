import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { viteTags } from '../src/tags'

/** Covers the production-manifest branch of viteTags (only the dev/no-manifest path was tested). */

const dir = mkdtempSync(join(tmpdir(), 'vite-cov-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function manifest(content: unknown): string {
  const path = join(dir, `manifest-${crypto.randomUUID()}.json`)
  writeFileSync(path, JSON.stringify(content))
  return path
}

describe('viteTags — production manifest', () => {
  // The manifest is only trusted when APP_ENV=production (see vite.test.ts
  // for the "stale build shouldn't shadow the dev server" behavior itself).
  const savedAppEnv = process.env.APP_ENV
  beforeEach(() => {
    process.env.APP_ENV = 'production'
  })
  afterEach(() => {
    if (savedAppEnv === undefined)
      delete process.env.APP_ENV
    else process.env.APP_ENV = savedAppEnv
  })

  test('emits hashed script + css tags from the manifest chunk', () => {
    const path = manifest({
      'frontend/app.ts': { file: 'assets/app.abc123.js', css: ['assets/app.def456.css'] },
    })
    const html = viteTags({ entry: 'frontend/app.ts', manifest: path, base: '/build/' })
    expect(html).toContain('<script type="module" src="/build/assets/app.abc123.js"></script>')
    expect(html).toContain('<link rel="stylesheet" href="/build/assets/app.def456.css">')
  })

  test('a chunk without css emits only the script tag', () => {
    const path = manifest({ 'main.ts': { file: 'assets/main.js' } })
    const html = viteTags({ entry: 'main.ts', manifest: path, base: '/build/' })
    expect(html).toContain('<script type="module" src="/build/assets/main.js"></script>')
    expect(html).not.toContain('stylesheet')
  })

  /**
   * Regression: a manifest problem in production fell through to the DEV tags, so
   * real users were served `http://localhost:5173/...` asset URLs — the page
   * rendered, every asset 404'd in their browser, and the server logged nothing.
   * A missing entry or an unreadable manifest must fail loudly instead.
   */
  test('a missing entry throws instead of emitting dev-server URLs', () => {
    const path = manifest({ 'other.ts': { file: 'x.js' } })
    expect(() => viteTags({ entry: 'missing.ts', manifest: path, devUrl: 'http://localhost:5173' }))
      .toThrow(/is not in the Vite manifest/)
  })

  test('the error names the entries that ARE present, so the typo is obvious', () => {
    const path = manifest({ 'frontend/app.ts': { file: 'x.js' } })
    expect(() => viteTags({ entry: 'frontend/main.ts', manifest: path }))
      .toThrow(/frontend\/app\.ts/)
  })

  test('an unparseable manifest throws rather than silently degrading', () => {
    const path = join(dir, `broken-${crypto.randomUUID()}.json`)
    writeFileSync(path, '{ not json')
    expect(() => viteTags({ entry: 'frontend/app.ts', manifest: path }))
      .toThrow(/Could not read the Vite manifest/)
  })

  test('outside production a missing manifest still falls back to the dev server', () => {
    process.env.APP_ENV = 'local'
    const path = manifest({ 'other.ts': { file: 'x.js' } })
    const html = viteTags({ entry: 'missing.ts', manifest: path, devUrl: 'http://localhost:5173' })
    expect(html).toContain('http://localhost:5173')
  })
})
