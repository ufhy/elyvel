import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'
import { LocalDisk, ScopedDisk } from '../src/index'

/**
 * Fills the gaps left by local.test.ts / s3.test.ts: LocalDisk `download` +
 * error paths, and the ScopedDisk delegation surface (only prefixing/traversal
 * were exercised before). S3Disk data ops still need live MinIO (see s3.test.ts).
 */

const roots: string[] = []
function makeDisk(): LocalDisk {
  const root = join(tmpdir(), `elyvel-storage-cov-${crypto.randomUUID()}`)
  roots.push(root)
  return new LocalDisk({ driver: 'local', root, url: '/storage', visibility: 'public' })
}

afterAll(() => {
  for (const r of roots) {
    if (existsSync(r))
      rmSync(r, { recursive: true, force: true })
  }
})

describe('LocalDisk — download + error paths', () => {
  test('download returns a FileResponse (attachment + name + full path source)', async () => {
    const disk = makeDisk()
    await disk.put('docs/report.txt', 'hi')
    const res = disk.download('docs/report.txt', 'out.txt')
    expect((res as { __elyvelFile?: boolean }).__elyvelFile).toBe(true)
    expect(res.options.disposition).toBe('attachment')
    expect(res.options.name).toBe('out.txt')
    expect(String(res.source)).toContain('docs/report.txt')
  })

  test('get / json on a missing or invalid file reject', async () => {
    const disk = makeDisk()
    await expect(disk.get('nope.txt')).rejects.toThrow()
    await disk.put('bad.json', '{not json')
    await expect(disk.json('bad.json')).rejects.toThrow()
  })

  test('temporaryUrl + temporaryUploadUrl are unsupported on local', async () => {
    const disk = makeDisk()
    await expect(disk.temporaryUrl('f.txt', 60)).rejects.toThrow(/not supported/)
    await expect(disk.temporaryUploadUrl('f.txt', 60)).rejects.toThrow(/not supported/)
  })

  test('private visibility round-trips through getVisibility', async () => {
    const disk = makeDisk()
    await disk.put('secret.txt', 's', 'private')
    expect(await disk.getVisibility('secret.txt')).toBe('private')
    expect(await disk.setVisibility('secret.txt', 'public')).toBe(true)
    expect(await disk.getVisibility('secret.txt')).toBe('public')
  })
})

describe('ScopedDisk — delegation surface', () => {
  function scoped(): { disk: ScopedDisk, inner: LocalDisk } {
    const inner = makeDisk()
    return { disk: new ScopedDisk(inner, 'tenant-1'), inner }
  }

  test('read/write/content ops delegate under the prefix', async () => {
    const { disk, inner } = scoped()
    expect(await disk.put('a/f.txt', 'Hello')).toBe(true)
    // physically stored under the prefix
    expect(await inner.exists('tenant-1/a/f.txt')).toBe(true)
    expect(await disk.get('a/f.txt')).toBe('Hello')
    expect(Array.from(await disk.getBytes('a/f.txt')).length).toBe(5)
    expect(await disk.exists('a/f.txt')).toBe(true)
    expect(await disk.missing('a/f.txt')).toBe(false)
    await disk.put('data.json', '{"n":1}')
    expect(await disk.json<{ n: number }>('data.json')).toEqual({ n: 1 })
    await disk.prepend('a/f.txt', 'X')
    await disk.append('a/f.txt', 'Y')
    expect(await disk.get('a/f.txt')).toBe('XHelloY')
  })

  test('metadata / copy / move / delete delegate', async () => {
    const { disk } = scoped()
    await disk.put('m/a.txt', 'abcd')
    expect(await disk.size('m/a.txt')).toBe(4)
    expect(typeof await disk.lastModified('m/a.txt')).toBe('number')
    expect(await disk.mimeType('m/a.txt')).toContain('text')
    expect(disk.path('m/a.txt')).toContain('tenant-1/m/a.txt')
    expect(disk.url('m/a.txt')).toContain('tenant-1/m/a.txt')
    await disk.copy('m/a.txt', 'm/b.txt')
    expect(await disk.exists('m/b.txt')).toBe(true)
    await disk.move('m/b.txt', 'm/c.txt')
    expect(await disk.missing('m/b.txt')).toBe(true)
    expect(await disk.exists('m/c.txt')).toBe(true)
    expect(await disk.delete('m/c.txt')).toBe(true)
    expect(await disk.missing('m/c.txt')).toBe(true)
  })

  test('visibility / download / uploads delegate', async () => {
    const { disk } = scoped()
    await disk.put('v.txt', 'x', 'private')
    expect(await disk.getVisibility('v.txt')).toBe('private')
    expect(await disk.setVisibility('v.txt', 'public')).toBe(true)
    const dl = disk.download('v.txt')
    expect(dl.options.disposition).toBe('attachment')
    const blob = new File([new Uint8Array([1, 2, 3])], 'up.bin', { type: 'application/octet-stream' })
    const stored = await disk.putFileAs('uploads', blob, 'named.bin')
    expect(stored).toBe('uploads/named.bin') // prefix stripped from the returned path
    const generated = await disk.putFile('uploads', blob)
    expect(generated.startsWith('uploads/')).toBe(true)
  })

  test('directory listing delegates and strips the prefix', async () => {
    const { disk } = scoped()
    await disk.put('list/one.txt', '1')
    await disk.put('list/sub/two.txt', '2')
    expect(await disk.files('list')).toEqual(['list/one.txt'])
    expect((await disk.allFiles('list')).sort()).toEqual(['list/one.txt', 'list/sub/two.txt'])
    expect(await disk.directories('list')).toEqual(['list/sub'])
    expect((await disk.allDirectories('list')).length).toBeGreaterThanOrEqual(1)
    expect(await disk.makeDirectory('fresh')).toBe(true)
    expect(await disk.deleteDirectory('fresh')).toBe(true)
  })

  test('temporaryUrl delegates the unsupported-on-local error', async () => {
    const { disk } = scoped()
    await expect(disk.temporaryUrl('v.txt', 60)).rejects.toThrow(/not supported/)
  })
})
