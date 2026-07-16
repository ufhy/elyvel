import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'
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
  test('emits hashed script + css tags from the manifest chunk', () => {
    const path = manifest({
      'resources/js/app.ts': { file: 'assets/app.abc123.js', css: ['assets/app.def456.css'] },
    })
    const html = viteTags({ entry: 'resources/js/app.ts', manifest: path, base: '/build/' })
    expect(html).toContain('<script type="module" src="/build/assets/app.abc123.js"></script>')
    expect(html).toContain('<link rel="stylesheet" href="/build/assets/app.def456.css">')
  })

  test('a chunk without css emits only the script tag', () => {
    const path = manifest({ 'main.ts': { file: 'assets/main.js' } })
    const html = viteTags({ entry: 'main.ts', manifest: path, base: '/build/' })
    expect(html).toContain('<script type="module" src="/build/assets/main.js"></script>')
    expect(html).not.toContain('stylesheet')
  })

  test('falls through to dev tags when the entry is missing from the manifest', () => {
    const path = manifest({ 'other.ts': { file: 'x.js' } })
    const html = viteTags({ entry: 'missing.ts', manifest: path, devUrl: 'http://localhost:5173' })
    expect(html).toContain('http://localhost:5173')
  })
})
