import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { S3Disk } from '../src/index'

// ── boot a real MinIO server (S3-compatible) if the binary is available ──────
const PORT = 9911
const BUCKET = 'ravel-test'
const KEY = 'minioadmin'
const SECRET = 'minioadmin'
const endpoint = `http://localhost:${PORT}`
const dataDir = join(tmpdir(), `ravel-minio-${crypto.randomUUID()}`)

let proc: import('bun').Subprocess | null = null
let live = false

function disk() {
  return new S3Disk({
    driver: 's3',
    bucket: BUCKET,
    region: 'us-east-1',
    endpoint,
    accessKeyId: KEY,
    secretAccessKey: SECRET,
    usePathStyleEndpoint: true,
  })
}

beforeAll(async () => {
  if (!(await Bun.file('/usr/local/bin/minio').exists()))
    return
  mkdirSync(join(dataDir, BUCKET), { recursive: true }) // top-level dir == bucket
  proc = Bun.spawn(['/usr/local/bin/minio', 'server', dataDir, '--address', `:${PORT}`], {
    env: { ...process.env, MINIO_ROOT_USER: KEY, MINIO_ROOT_PASSWORD: SECRET },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  // poll until the server answers
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${endpoint}/minio/health/live`)
      if (res.ok) {
        live = true
        break
      }
    }
    catch {
      // not up yet
    }
    await Bun.sleep(100)
  }
}, 30_000) // explicit hook timeout: MinIO's cold boot can exceed bun's 5s default

afterAll(() => {
  proc?.kill()
  rmSync(dataDir, { recursive: true, force: true })
})

// presign/url are pure (no network) — always exercised.
describe('S3Disk — url + presign (offline)', () => {
  test('url derives a path-style base from the endpoint', () => {
    expect(disk().url('a/b.txt')).toBe(`${endpoint}/${BUCKET}/a/b.txt`)
  })

  test('temporaryUrl returns a signed GET url', async () => {
    const url = await disk().temporaryUrl('a/b.txt', 60)
    expect(url).toContain('X-Amz-Signature')
    expect(url).toContain('X-Amz-Expires=60')
  })

  test('temporaryUploadUrl returns a signed PUT url + headers', async () => {
    const { url, headers } = await disk().temporaryUploadUrl('up.txt', 120)
    expect(url).toContain('X-Amz-Signature')
    expect(headers).toEqual({})
  })
})

describe('S3Disk — live round-trips (MinIO)', () => {
  test('put/get/exists/size/delete', async () => {
    if (!live)
      return
    const d = disk()
    expect(await d.put('docs/hello.txt', 'Hello S3')).toBe(true)
    expect(await d.exists('docs/hello.txt')).toBe(true)
    expect(await d.get('docs/hello.txt')).toBe('Hello S3')
    expect(await d.size('docs/hello.txt')).toBe(8)
    await d.delete('docs/hello.txt')
    expect(await d.missing('docs/hello.txt')).toBe(true)
  })

  test('putFile generates a key; copy/move', async () => {
    if (!live)
      return
    const d = disk()
    const blob = new File(['pixels'], 'p.jpg', { type: 'image/jpeg' })
    const key = await d.putFile('photos', blob)
    expect(key).toMatch(/^photos\/[a-f0-9]{32}\.jpg$/)

    await d.copy(key, 'photos/copy.jpg')
    expect(await d.exists('photos/copy.jpg')).toBe(true)
    await d.move('photos/copy.jpg', 'photos/moved.jpg')
    expect(await d.missing('photos/copy.jpg')).toBe(true)
    expect(await d.exists('photos/moved.jpg')).toBe(true)
  })

  test('files/allFiles + directories via delimiter', async () => {
    if (!live)
      return
    const d = disk()
    await d.put('tree/root.txt', '1')
    await d.put('tree/sub/leaf.txt', '1')
    const all = await d.allFiles('tree')
    expect(all).toContain('tree/root.txt')
    expect(all).toContain('tree/sub/leaf.txt')
    const dirs = await d.directories('tree')
    expect(dirs).toContain('tree/sub')
  })

  test('append reads-modifies-writes', async () => {
    if (!live)
      return
    const d = disk()
    await d.put('log.txt', 'A')
    await d.append('log.txt', 'B')
    expect(await d.get('log.txt')).toBe('AB')
  })
})
