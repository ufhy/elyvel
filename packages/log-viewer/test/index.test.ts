import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { configureLogViewer, logViewer, resetLogViewerConfig } from '../src/index'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-logviewer-'))
  writeFileSync(join(dir, 'app.log'), `${JSON.stringify({ level: 'error', message: 'boom', stack: 'Error: boom' })}\n`)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  resetLogViewerConfig()
})

function app() {
  return logViewer({ logDir: dir })
}

describe('logViewer — authorization', () => {
  test('with no authorize configured, every route is denied', async () => {
    const instance = app()
    const page = await instance.handle(new Request('http://localhost/log-viewer'))
    expect(page.status).toBe(403)
    const files = await instance.handle(new Request('http://localhost/log-viewer/api/files'))
    expect(files.status).toBe(403)
  })

  test('authorize returning false denies', async () => {
    configureLogViewer({ authorize: () => false })
    const res = await app().handle(new Request('http://localhost/log-viewer/api/files'))
    expect(res.status).toBe(403)
  })

  test('authorize returning true allows', async () => {
    configureLogViewer({ authorize: () => true })
    const res = await app().handle(new Request('http://localhost/log-viewer/api/files'))
    expect(res.status).toBe(200)
    expect((await res.json() as { files: unknown[] }).files).toHaveLength(1)
  })

  test('authorize can be async and inspect the request', async () => {
    configureLogViewer({ authorize: async ctx => ctx.request.headers.get('x-admin') === 'yes' })
    const denied = await app().handle(new Request('http://localhost/log-viewer/api/files'))
    expect(denied.status).toBe(403)
    const allowed = await app().handle(
      new Request('http://localhost/log-viewer/api/files', { headers: { 'x-admin': 'yes' } }),
    )
    expect(allowed.status).toBe(200)
  })
})

describe('logViewer — routes', () => {
  beforeEach(() => configureLogViewer({ authorize: () => true }))

  test('GET / serves the HTML shell', async () => {
    const res = await app().handle(new Request('http://localhost/log-viewer'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Log Viewer')
  })

  test('GET /api/files/:name/entries returns parsed entries', async () => {
    const res = await app().handle(new Request('http://localhost/log-viewer/api/files/app.log/entries'))
    const body = await res.json() as { total: number, entries: { message: string }[] }
    expect(body.total).toBe(1)
    expect(body.entries[0]?.message).toBe('boom')
  })

  test('an unknown file name 404s instead of leaking a path error', async () => {
    const res = await app().handle(new Request('http://localhost/log-viewer/api/files/nope.log/entries'))
    expect(res.status).toBe(404)
  })

  test('path traversal in the file name is rejected, not resolved outside logDir', async () => {
    const res = await app().handle(
      new Request(`http://localhost/log-viewer/api/files/${encodeURIComponent('../../etc/passwd')}/entries`),
    )
    expect(res.status).toBe(404)
  })

  test('download streams the raw file with an attachment header', async () => {
    const res = await app().handle(new Request('http://localhost/log-viewer/api/files/app.log/download'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(await res.text()).toContain('boom')
  })

  test('DELETE removes the file', async () => {
    const instance = app()
    const del = await instance.handle(new Request('http://localhost/log-viewer/api/files/app.log', { method: 'DELETE' }))
    expect(del.status).toBe(200)
    const files = await instance.handle(new Request('http://localhost/log-viewer/api/files'))
    expect((await files.json() as { files: unknown[] }).files).toHaveLength(0)
  })
})
