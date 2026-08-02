import type { FilesystemDisk } from '../src/disk'
import { describe, expect, test } from 'bun:test'
import { FilesystemManager } from '../src/manager'

describe('FilesystemManager.extend', () => {
  test('a disk driver the framework never shipped becomes configurable', async () => {
    const written: string[] = []
    const fake = { put: async (path: string) => void written.push(path) } as unknown as FilesystemDisk

    const manager = new FilesystemManager({ default: 'r2', disks: { r2: { driver: 'r2' } as never } })
    manager.extend('r2', () => fake)

    await manager.disk().put('a.txt', 'x')
    expect(written).toEqual(['a.txt'])
  })

  test('an unknown driver names the ones that exist', () => {
    const manager = new FilesystemManager({ disks: { x: { driver: 'gopher' } as never } })
    expect(() => manager.disk('x')).toThrow(/Available: local, s3, scoped/)
  })
})
