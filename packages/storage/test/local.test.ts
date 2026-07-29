import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { fakeStorage, FilesystemManager, LocalDisk, ScopedDisk, storage } from '../src/index'

const roots: string[] = []
function freshRoot(): string {
  const root = join(tmpdir(), `elyvel-storage-test-${crypto.randomUUID()}`)
  roots.push(root)
  return root
}
function makeDisk() {
  return new LocalDisk({ driver: 'local', root: freshRoot(), url: '/storage', visibility: 'public' })
}

afterAll(() => {
  for (const r of roots) {
    if (existsSync(r))
      rmSync(r, { recursive: true, force: true })
  }
})

describe('LocalDisk — read/write', () => {
  test('put then get round-trips string content', async () => {
    const disk = makeDisk()
    expect(await disk.put('notes/hello.txt', 'Hello')).toBe(true)
    expect(await disk.get('notes/hello.txt')).toBe('Hello')
    expect(await disk.exists('notes/hello.txt')).toBe(true)
    expect(await disk.missing('notes/hello.txt')).toBe(false)
    expect(await disk.missing('nope.txt')).toBe(true)
  })

  test('put stores bytes and getBytes reads them back', async () => {
    const disk = makeDisk()
    const bytes = new Uint8Array([1, 2, 3, 255])
    await disk.put('bin.dat', bytes)
    expect(Array.from(await disk.getBytes('bin.dat'))).toEqual([1, 2, 3, 255])
  })

  test('json decodes stored JSON', async () => {
    const disk = makeDisk()
    await disk.put('data.json', JSON.stringify({ a: 1, b: [2, 3] }))
    expect(await disk.json<{ a: number, b: number[] }>('data.json')).toEqual({ a: 1, b: [2, 3] })
  })

  test('prepend and append', async () => {
    const disk = makeDisk()
    await disk.put('log.txt', 'B')
    await disk.prepend('log.txt', 'A')
    await disk.append('log.txt', 'C')
    expect(await disk.get('log.txt')).toBe('ABC')
    // append creates the file when missing
    await disk.append('fresh.txt', 'X')
    expect(await disk.get('fresh.txt')).toBe('X')
  })
})

describe('LocalDisk — copy/move/delete', () => {
  test('copy leaves the original, move removes it', async () => {
    const disk = makeDisk()
    await disk.put('a.txt', 'data')
    await disk.copy('a.txt', 'sub/b.txt')
    expect(await disk.get('sub/b.txt')).toBe('data')
    expect(await disk.exists('a.txt')).toBe(true)

    await disk.move('a.txt', 'sub/c.txt')
    expect(await disk.get('sub/c.txt')).toBe('data')
    expect(await disk.exists('a.txt')).toBe(false)
  })

  test('delete accepts a single path or an array', async () => {
    const disk = makeDisk()
    await disk.put('x.txt', '1')
    await disk.put('y.txt', '2')
    await disk.delete('x.txt')
    expect(await disk.missing('x.txt')).toBe(true)
    await disk.delete(['y.txt', 'ghost.txt'])
    expect(await disk.missing('y.txt')).toBe(true)
  })
})

describe('LocalDisk — metadata + url', () => {
  test('size, lastModified, mimeType, path', async () => {
    const disk = makeDisk()
    await disk.put('photo.png', 'abcde')
    expect(await disk.size('photo.png')).toBe(5)
    expect(await disk.lastModified('photo.png')).toBeGreaterThan(0)
    expect(await disk.mimeType('photo.png')).toContain('image/png')
    expect(disk.path('photo.png')).toContain('photo.png')
  })

  test('url prepends the configured base', async () => {
    const disk = makeDisk()
    expect(disk.url('avatars/1.png')).toBe('/storage/avatars/1.png')
  })

  test('temporaryUrl is unsupported on local (clear error)', async () => {
    const disk = makeDisk()
    await expect(disk.temporaryUrl('x.txt', 60)).rejects.toThrow(
      /not supported by the local driver/,
    )
  })
})

describe('LocalDisk — visibility', () => {
  // Regression: `appendFile` creates a missing file at the process umask
  // (0644), and `append` was the one write path that never chmod'd — so
  // appending to a new path on a `private` disk produced a world-readable file.
  test('append applies the disk visibility when it creates the file', async () => {
    const root = freshRoot()
    const disk = new LocalDisk({ driver: 'local', root, visibility: 'private' })
    await disk.append('fresh.log', 'line\n')
    expect(await disk.getVisibility('fresh.log')).toBe('private')

    // Appending to an EXISTING file must not reset permissions a caller set.
    await disk.setVisibility('fresh.log', 'public')
    await disk.append('fresh.log', 'more\n')
    expect(await disk.getVisibility('fresh.log')).toBe('public')
  })

  test('put honors visibility and get/setVisibility round-trip', async () => {
    const disk = makeDisk()
    await disk.put('secret.txt', 'shh', 'private')
    expect(await disk.getVisibility('secret.txt')).toBe('private')
    await disk.setVisibility('secret.txt', 'public')
    expect(await disk.getVisibility('secret.txt')).toBe('public')
  })
})

describe('LocalDisk — uploads (putFile/putFileAs)', () => {
  test('putFileAs stores a Blob under the given name', async () => {
    const disk = makeDisk()
    const blob = new File([new Uint8Array([9, 8, 7])], 'upload.bin', {
      type: 'application/octet-stream',
    })
    const path = await disk.putFileAs('uploads', blob, 'named.bin')
    expect(path).toBe('uploads/named.bin')
    expect(Array.from(await disk.getBytes(path))).toEqual([9, 8, 7])
  })

  // Regression: `putFileAs` discarded `put()`'s boolean and returned the path
  // regardless, so a failed write handed back a path callers persist to the
  // database — a reference to a file that was never written.
  test('a failed write returns false, not a path', async () => {
    const disk = makeDisk()
    // Writing under a path whose parent is a FILE cannot succeed (ENOTDIR).
    await disk.put('blocker', 'x')
    expect(await disk.putFileAs('blocker', new Blob(['y']), 'child.bin')).toBe(false)
    expect(await disk.exists('blocker/child.bin')).toBe(false)
    expect(await disk.putFile('blocker', new Blob(['y']))).toBe(false)

    // A write that CAN succeed still returns its path.
    expect(await disk.putFileAs('ok', new Blob(['y']), 'child.bin')).toBe('ok/child.bin')
  })

  test('ScopedDisk propagates a failed write instead of stripping false', async () => {
    const base = makeDisk()
    const scoped = new ScopedDisk(base, 'tenant')
    await base.put('tenant/blocker', 'x')
    expect(await scoped.putFileAs('blocker', new Blob(['y']), 'child.bin')).toBe(false)
    expect(await scoped.putFileAs('ok', new Blob(['y']), 'child.bin')).toBe('ok/child.bin')
  })

  test('putFile generates a unique name, preserving the extension', async () => {
    const disk = makeDisk()
    const blob = new File(['content'], 'photo.jpg', { type: 'image/jpeg' })
    const path = await disk.putFile('photos', blob)
    expect(path).toMatch(/^photos\/[a-f0-9]{32}\.jpg$/)
    expect(await disk.exists(path)).toBe(true)
  })
})

describe('LocalDisk — directories', () => {
  test('files/allFiles and directories/allDirectories', async () => {
    const disk = makeDisk()
    await disk.put('top.txt', '1')
    await disk.put('a/one.txt', '1')
    await disk.put('a/b/two.txt', '1')

    expect((await disk.files()).sort()).toEqual(['top.txt'])
    expect((await disk.allFiles()).sort()).toEqual(['a/b/two.txt', 'a/one.txt', 'top.txt'])
    expect((await disk.directories()).sort()).toEqual(['a'])
    expect((await disk.allDirectories()).sort()).toEqual(['a', 'a/b'])
  })

  // Regression: `deleteDirectory('')` resolved to the root and `rm -r`'d the
  // disk itself. An empty path is almost always an empty variable at the call
  // site, not an intent to destroy the disk, so clear the contents instead.
  test('deleteDirectory("") empties the disk without deleting it', async () => {
    const disk = makeDisk()
    await disk.put('a/one.txt', '1')
    await disk.put('top.txt', '2')

    expect(await disk.deleteDirectory('')).toBe(true)
    expect(await disk.allFiles()).toEqual([])
    // still a working disk afterwards
    await disk.put('after.txt', 'x')
    expect(await disk.get('after.txt')).toBe('x')
  })

  test('makeDirectory and deleteDirectory', async () => {
    const disk = makeDisk()
    await disk.makeDirectory('created')
    expect((await disk.directories()).includes('created')).toBe(true)
    await disk.put('created/f.txt', '1')
    await disk.deleteDirectory('created')
    expect(await disk.missing('created/f.txt')).toBe(true)
  })
})

describe('throw option', () => {
  test('failed write throws when throw:true, returns false otherwise', async () => {
    const strict = new LocalDisk({ driver: 'local', root: freshRoot(), throw: true })
    // writing over a path whose parent is a file forces a failure
    await strict.put('file', 'x')
    await expect(strict.put('file/child.txt', 'y')).rejects.toThrow()

    const lenient = new LocalDisk({ driver: 'local', root: freshRoot() })
    await lenient.put('file', 'x')
    expect(await lenient.put('file/child.txt', 'y')).toBe(false)
  })
})

describe('path traversal is blocked', () => {
  test('LocalDisk rejects `../` escapes on read and write', async () => {
    const disk = makeDisk()
    await expect(disk.get('../../etc/passwd')).rejects.toThrow(/escapes the disk root/)
    await expect(disk.put('../outside.txt', 'x')).rejects.toThrow(/escapes the disk root/)
    await expect(disk.delete('../../secret')).rejects.toThrow(/escapes the disk root/)
  })

  test('LocalDisk allows normalized in-root paths', async () => {
    const disk = makeDisk()
    // a `..` that resolves back inside the root is fine
    await disk.put('a/b/c.txt', 'ok')
    expect(await disk.get('a/b/../b/c.txt')).toBe('ok')
  })

  // Regression: the root check used `resolve()`, which is purely lexical and
  // therefore blind to symlinks — a link INSIDE the root pointing out of it
  // (extracted archive, rsync, user-writable dir) read/wrote wherever it
  // pointed while still looking contained. Verified reading /etc/hosts.
  test('LocalDisk rejects a symlink that points outside the root', async () => {
    const root = freshRoot()
    const disk = new LocalDisk({ driver: 'local', root })
    mkdirSync(join(root, 'links'), { recursive: true })
    symlinkSync('/etc', join(root, 'links', 'etc'))

    await expect(disk.get('links/etc/hosts')).rejects.toThrow(/escapes the disk root/)
    await expect(disk.put('links/etc/evil.txt', 'x')).rejects.toThrow(/escapes the disk root/)
  })

  test('LocalDisk still writes into directories that do not exist yet', async () => {
    // The symlink check resolves the deepest EXISTING ancestor, so a brand-new
    // nested path must not be mistaken for an escape.
    const disk = makeDisk()
    await disk.put('brand/new/deep/file.txt', 'v')
    expect(await disk.get('brand/new/deep/file.txt')).toBe('v')
  })

  // Regression: `name` is the attacker-controlled part of an upload
  // (`putFileAs(dir, file, upload.name)`) and was joined unguarded, so `..`
  // in it walked out of the target directory — and out of a ScopedDisk's
  // tenant prefix, since that prefix sits below the root the disk validates.
  test('putFileAs rejects a name containing a path separator', async () => {
    const disk = makeDisk()
    await expect(disk.putFileAs('uploads', new Blob(['x']), '../../escaped.txt'))
      .rejects
      .toThrow(/not a valid file name/)
    await expect(disk.putFileAs('uploads', new Blob(['x']), 'nested/name.txt'))
      .rejects
      .toThrow(/not a valid file name/)
    // a plain name still works
    expect(await disk.putFileAs('uploads', new Blob(['ok']), 'photo.png')).toBe('uploads/photo.png')
  })

  test('ScopedDisk cannot be escaped through the putFileAs name', async () => {
    const base = makeDisk()
    const scoped = new ScopedDisk(base, 'tenants/acme')
    await expect(scoped.putFileAs('uploads', new Blob(['PWNED']), '../../beta/secret.txt'))
      .rejects
      .toThrow(/not a valid file name/)
    expect(await base.exists('tenants/beta/secret.txt')).toBe(false)
  })
})

describe('ScopedDisk', () => {
  test('prefixes every path and strips it from listings', async () => {
    const base = makeDisk()
    await base.put('tenants/acme/a.txt', 'A')
    const manager = new FilesystemManager({
      default: 'base',
      disks: { base: { driver: 'local', root: base.path('').replace(/\/$/, '') } },
    })
    // build a scoped disk over the same root via the manager
    const scoped = manager.build({ driver: 'scoped', disk: 'base', prefix: 'tenants/acme' })
    expect(await scoped.get('a.txt')).toBe('A')
    await scoped.put('b.txt', 'B')
    expect(await base.get('tenants/acme/b.txt')).toBe('B')
    expect((await scoped.files()).sort()).toEqual(['a.txt', 'b.txt'])
  })

  test('rejects `../` that would escape the scope prefix (tenant isolation)', async () => {
    const manager = new FilesystemManager({
      disks: { base: { driver: 'local', root: freshRoot() } },
    })
    const scoped = manager.build({ driver: 'scoped', disk: 'base', prefix: 'tenants/acme' })
    // async IIFE turns the guard's (synchronous) throw into a rejection for the matcher
    await expect((async () => scoped.get('../beta/secret.txt'))()).rejects.toThrow(
      /escapes the scoped prefix/,
    )
    await expect((async () => scoped.put('../../root.txt', 'x'))()).rejects.toThrow(
      /escapes the scoped prefix/,
    )
  })
})

describe('fakeStorage + storage() helper', () => {
  beforeEach(() => {
    fakeStorage()
  })

  test('storage() returns the fake default disk and round-trips', async () => {
    await storage().put('f.txt', 'faked')
    expect(await storage().get('f.txt')).toBe('faked')
  })
})

describe('FilesystemManager', () => {
  test('disk() caches and default resolves', async () => {
    const manager = new FilesystemManager({
      default: 'main',
      disks: { main: { driver: 'local', root: freshRoot() } },
    })
    expect(manager.disk()).toBe(manager.disk('main'))
    await manager.disk().put('z.txt', 'z')
    expect(await manager.disk('main').get('z.txt')).toBe('z')
  })

  test('unknown disk throws a clear error', () => {
    const manager = new FilesystemManager({ disks: {} })
    expect(() => manager.disk('ghost')).toThrow(/Disk "ghost" is not defined/)
  })
})
