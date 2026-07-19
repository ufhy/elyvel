import type { FileResponse } from '@elyvel/core'
import type { LocalDiskConfig, S3DiskConfig, Visibility } from './config-schema'
import { existsSync, statSync } from 'node:fs'
import { appendFile, chmod, copyFile, mkdir, readdir, rename, rm, unlink } from 'node:fs/promises'
// biome-ignore lint/correctness/noUnusedImports: false positive — all are used (verified by tsc)
import { dirname, extname, posix, resolve, sep } from 'node:path'
import { download } from '@elyvel/core'
import { S3Client } from 'bun'

/** Raw content accepted by write operations. */
export type Contents = string | Uint8Array | ArrayBuffer | Blob | ReadableStream

/** A file-ish upload accepted by `putFile`/`putFileAs`. */
export type Storable = Blob | { path: string } | Contents

export interface TemporaryUrlOptions {
  /** Extra query/response params (S3: ResponseContentDisposition, etc.). */
  [key: string]: unknown
}

/**
 * A single storage disk. Every path is relative to the disk's root. Mirrors the
 * Laravel `Storage` disk surface (Flysystem), backed by Bun-native drivers.
 */
export interface FilesystemDisk {
  get(path: string): Promise<string>
  getBytes(path: string): Promise<Uint8Array>
  json<T = unknown>(path: string): Promise<T>
  exists(path: string): Promise<boolean>
  missing(path: string): Promise<boolean>

  put(path: string, contents: Contents, visibility?: Visibility): Promise<boolean>
  putFile(directory: string, file: Storable, visibility?: Visibility): Promise<string>
  putFileAs(
    directory: string,
    file: Storable,
    name: string,
    visibility?: Visibility,
  ): Promise<string>
  prepend(path: string, data: string): Promise<boolean>
  append(path: string, data: string): Promise<boolean>
  copy(from: string, to: string): Promise<boolean>
  move(from: string, to: string): Promise<boolean>

  delete(paths: string | string[]): Promise<boolean>

  size(path: string): Promise<number>
  lastModified(path: string): Promise<number>
  mimeType(path: string): Promise<string | undefined>
  path(path: string): string
  url(path: string): string
  temporaryUrl(
    path: string,
    expiresIn: Date | number,
    options?: TemporaryUrlOptions,
  ): Promise<string>
  temporaryUploadUrl(
    path: string,
    expiresIn: Date | number,
    options?: TemporaryUrlOptions,
  ): Promise<{ url: string, headers: Record<string, string> }>

  getVisibility(path: string): Promise<Visibility>
  setVisibility(path: string, visibility: Visibility): Promise<boolean>

  download(path: string, name?: string): FileResponse

  files(directory?: string): Promise<string[]>
  allFiles(directory?: string): Promise<string[]>
  directories(directory?: string): Promise<string[]>
  allDirectories(directory?: string): Promise<string[]>
  makeDirectory(path: string): Promise<boolean>
  deleteDirectory(path: string): Promise<boolean>
}

/** Thrown when a path would escape its disk root / scope prefix — always fatal. */
export class PathEscapeError extends Error {}

// ── shared helpers ─────────────────────────────────────────────────────────
function secondsUntil(expiresIn: Date | number): number {
  return typeof expiresIn === 'number'
    ? expiresIn
    : Math.max(0, Math.round((expiresIn.getTime() - Date.now()) / 1000))
}

/** A random, extension-preserving filename (Laravel's `hashName`). */
function hashName(ext: string): string {
  return `${crypto.randomUUID().replace(/-/g, '')}${ext ? `.${ext}` : ''}`
}

/** Extension for a Storable, from a File name or Blob type. */
function extensionOf(file: Storable): string {
  if (
    typeof file === 'object'
    && file !== null
    && 'path' in file
    && typeof file.path === 'string'
  ) {
    return extname(file.path).replace(/^\./, '')
  }
  if (file instanceof Blob) {
    const name = (file as File).name
    if (name)
      return extname(name).replace(/^\./, '')
    const sub = file.type.split('/')[1]
    return sub ? (sub.split(';')[0] ?? '') : ''
  }
  return ''
}

/** Normalize a Storable into something Bun.write / S3 can consume. */
async function toBytes(file: Storable): Promise<Contents> {
  if (
    typeof file === 'object'
    && file !== null
    && 'path' in file
    && typeof (file as { path: string }).path === 'string'
  ) {
    return await Bun.file((file as { path: string }).path).arrayBuffer()
  }
  return file as Contents
}

// ── LocalDisk ───────────────────────────────────────────────────────────────
export class LocalDisk implements FilesystemDisk {
  private readonly root: string
  private readonly baseUrl: string
  private readonly defaultVisibility: Visibility
  private readonly shouldThrow: boolean
  private readonly perms: {
    file: { public: number, private: number }
    dir: { public: number, private: number }
  }

  constructor(config: LocalDiskConfig & { root: string }) {
    this.root = config.root
    this.baseUrl = (config.url ?? '/storage').replace(/\/$/, '')
    this.defaultVisibility = config.visibility ?? 'private'
    this.shouldThrow = config.throw ?? false
    this.perms = {
      file: {
        public: config.permissions?.file?.public ?? 0o644,
        private: config.permissions?.file?.private ?? 0o600,
      },
      dir: {
        public: config.permissions?.dir?.public ?? 0o755,
        private: config.permissions?.dir?.private ?? 0o700,
      },
    }
  }

  private full(path: string): string {
    // Resolve and confirm the result stays inside the disk root — a `../`
    // traversal (e.g. `../../etc/passwd`) must never escape the sandbox.
    const rootAbs = resolve(this.root)
    const full = resolve(rootAbs, path)
    if (full !== rootAbs && !full.startsWith(rootAbs + sep)) {
      throw new PathEscapeError(`[elyvel] Path "${path}" escapes the disk root.`)
    }
    return full
  }

  private fail(error: unknown): false {
    // A traversal attempt is always fatal, regardless of the `throw` config.
    if (this.shouldThrow || error instanceof PathEscapeError)
      throw error
    return false
  }

  async get(path: string): Promise<string> {
    return await Bun.file(this.full(path)).text()
  }

  async getBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await Bun.file(this.full(path)).arrayBuffer())
  }

  async json<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await this.get(path)) as T
  }

  async exists(path: string): Promise<boolean> {
    return await Bun.file(this.full(path)).exists()
  }

  async missing(path: string): Promise<boolean> {
    return !(await this.exists(path))
  }

  async put(path: string, contents: Contents, visibility?: Visibility): Promise<boolean> {
    try {
      const full = this.full(path)
      await mkdir(dirname(full), { recursive: true })
      await Bun.write(full, contents as Blob)
      await chmod(full, this.perms.file[visibility ?? this.defaultVisibility])
      return true
    }
    catch (error) {
      return this.fail(error)
    }
  }

  async putFile(directory: string, file: Storable, visibility?: Visibility): Promise<string> {
    return this.putFileAs(directory, file, hashName(extensionOf(file)), visibility)
  }

  async putFileAs(
    directory: string,
    file: Storable,
    name: string,
    visibility?: Visibility,
  ): Promise<string> {
    const target = posix.join(directory, name)
    await this.put(target, await toBytes(file), visibility)
    return target
  }

  /**
   * Read-then-write: two concurrent `prepend()` calls on the same path can
   * race and one write can clobber the other. Unlike `append()`, there's no
   * OS-level atomic "insert at start" primitive to fall back on — if
   * concurrent prepends to the same file are expected, serialize callers
   * yourself (e.g. a lock keyed on `path`).
   */
  async prepend(path: string, data: string): Promise<boolean> {
    const existing = (await this.exists(path)) ? await this.get(path) : ''
    return this.put(path, data + existing)
  }

  /** Safe under concurrent callers: `appendFile` issues a single O_APPEND write, atomic at the OS level. */
  async append(path: string, data: string): Promise<boolean> {
    try {
      const full = this.full(path)
      await mkdir(dirname(full), { recursive: true })
      await appendFile(full, data)
      return true
    }
    catch (error) {
      return this.fail(error)
    }
  }

  async copy(from: string, to: string): Promise<boolean> {
    try {
      await mkdir(dirname(this.full(to)), { recursive: true })
      await copyFile(this.full(from), this.full(to))
      return true
    }
    catch (error) {
      return this.fail(error)
    }
  }

  async move(from: string, to: string): Promise<boolean> {
    try {
      await mkdir(dirname(this.full(to)), { recursive: true })
      await rename(this.full(from), this.full(to))
      return true
    }
    catch (error) {
      return this.fail(error)
    }
  }

  async delete(paths: string | string[]): Promise<boolean> {
    let ok = true
    for (const p of Array.isArray(paths) ? paths : [paths]) {
      const full = this.full(p) // traversal guard — throws before any unlink
      try {
        await unlink(full)
      }
      catch {
        ok = false
      }
    }
    return ok
  }

  async size(path: string): Promise<number> {
    return statSync(this.full(path)).size
  }

  async lastModified(path: string): Promise<number> {
    return Math.floor(statSync(this.full(path)).mtimeMs / 1000)
  }

  async mimeType(path: string): Promise<string | undefined> {
    return Bun.file(this.full(path)).type || undefined
  }

  path(path: string): string {
    return this.full(path)
  }

  url(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\//, '')}`
  }

  async temporaryUrl(
    _path: string,
    _expiresIn: Date | number,
    _options?: TemporaryUrlOptions,
  ): Promise<string> {
    throw new Error(
      '[elyvel] temporaryUrl is not supported by the local driver. Use the s3 driver, or serve files through a signed route.',
    )
  }

  async temporaryUploadUrl(
    _path: string,
    _expiresIn: Date | number,
    _options?: TemporaryUrlOptions,
  ): Promise<{ url: string, headers: Record<string, string> }> {
    throw new Error(
      '[elyvel] temporaryUploadUrl is not supported by the local driver. Use the s3 driver.',
    )
  }

  async getVisibility(path: string): Promise<Visibility> {
    const mode = statSync(this.full(path)).mode & 0o777
    return mode === this.perms.file.public ? 'public' : 'private'
  }

  async setVisibility(path: string, visibility: Visibility): Promise<boolean> {
    try {
      await chmod(this.full(path), this.perms.file[visibility])
      return true
    }
    catch (error) {
      return this.fail(error)
    }
  }

  download(path: string, name?: string): FileResponse {
    return download(this.full(path), name)
  }

  private async list(
    directory: string,
    recursive: boolean,
    want: 'files' | 'dirs',
  ): Promise<string[]> {
    const base = this.full(directory)
    if (!existsSync(base))
      return []
    const entries = await readdir(base, { withFileTypes: true, recursive })
    const out: string[] = []
    for (const e of entries) {
      const isDir = e.isDirectory()
      if ((want === 'files' && isDir) || (want === 'dirs' && !isDir))
        continue
      // node returns `parentPath` on recursive reads; build a disk-relative posix path.
      const parent
        = (e as { parentPath?: string, path?: string }).parentPath
          ?? (e as { path?: string }).path
          ?? base
      const rel = posix.join(
        directory,
        parent
          .slice(base.length)
          .replace(/^[/\\]/, '')
          .split(/[/\\]/)
          .join('/'),
        e.name,
      )
      out.push(rel.replace(/^\//, ''))
    }
    return out
  }

  files(directory = ''): Promise<string[]> {
    return this.list(directory, false, 'files')
  }

  allFiles(directory = ''): Promise<string[]> {
    return this.list(directory, true, 'files')
  }

  directories(directory = ''): Promise<string[]> {
    return this.list(directory, false, 'dirs')
  }

  allDirectories(directory = ''): Promise<string[]> {
    return this.list(directory, true, 'dirs')
  }

  async makeDirectory(path: string): Promise<boolean> {
    try {
      await mkdir(this.full(path), {
        recursive: true,
        mode: this.perms.dir[this.defaultVisibility],
      })
      return true
    }
    catch (error) {
      return this.fail(error)
    }
  }

  async deleteDirectory(path: string): Promise<boolean> {
    try {
      await rm(this.full(path), { recursive: true, force: true })
      return true
    }
    catch (error) {
      return this.fail(error)
    }
  }
}

// ── S3Disk ────────────────────────────────────────────────────────────────
export class S3Disk implements FilesystemDisk {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly baseUrl: string
  private readonly defaultVisibility: Visibility

  constructor(config: S3DiskConfig) {
    this.client = new S3Client({
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
    })
    this.bucket = config.bucket
    this.defaultVisibility = config.visibility ?? 'private'
    this.baseUrl = (
      config.url
      ?? (config.endpoint
        ? config.usePathStyleEndpoint
          ? `${config.endpoint.replace(/\/$/, '')}/${config.bucket}`
          : config.endpoint.replace(/\/$/, '')
        : `https://${config.bucket}.s3.${config.region ?? 'us-east-1'}.amazonaws.com`)
    ).replace(/\/$/, '')
  }

  private acl(visibility?: Visibility): 'public-read' | 'private' {
    return (visibility ?? this.defaultVisibility) === 'public' ? 'public-read' : 'private'
  }

  async get(path: string): Promise<string> {
    return await this.client.file(path).text()
  }

  async getBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.client.file(path).arrayBuffer())
  }

  async json<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await this.get(path)) as T
  }

  async exists(path: string): Promise<boolean> {
    return await this.client.file(path).exists()
  }

  async missing(path: string): Promise<boolean> {
    return !(await this.exists(path))
  }

  async put(path: string, contents: Contents, visibility?: Visibility): Promise<boolean> {
    await this.client.write(path, contents as Blob, { acl: this.acl(visibility) })
    return true
  }

  async putFile(directory: string, file: Storable, visibility?: Visibility): Promise<string> {
    return this.putFileAs(directory, file, hashName(extensionOf(file)), visibility)
  }

  async putFileAs(
    directory: string,
    file: Storable,
    name: string,
    visibility?: Visibility,
  ): Promise<string> {
    const target = posix.join(directory, name)
    await this.put(target, await toBytes(file), visibility)
    return target
  }

  /**
   * Read-then-write, same as `append()` below: S3 objects are immutable, so
   * there's no server-side "insert at start/end" operation to build this on
   * — every S3-backed SDK (Flysystem included) has this same limitation.
   * Concurrent prepend/append calls on the same key can race and one write
   * can clobber the other; serialize callers yourself if that's expected.
   */
  async prepend(path: string, data: string): Promise<boolean> {
    const existing = (await this.exists(path)) ? await this.get(path) : ''
    return this.put(path, data + existing)
  }

  async append(path: string, data: string): Promise<boolean> {
    const existing = (await this.exists(path)) ? await this.get(path) : ''
    return this.put(path, existing + data)
  }

  async copy(from: string, to: string): Promise<boolean> {
    await this.client.write(to, this.client.file(from))
    return true
  }

  async move(from: string, to: string): Promise<boolean> {
    await this.copy(from, to)
    await this.client.file(from).delete()
    return true
  }

  async delete(paths: string | string[]): Promise<boolean> {
    for (const p of Array.isArray(paths) ? paths : [paths]) await this.client.file(p).delete()
    return true
  }

  async size(path: string): Promise<number> {
    return (await this.client.file(path).stat()).size
  }

  async lastModified(path: string): Promise<number> {
    const stat = await this.client.file(path).stat()
    return Math.floor(new Date(stat.lastModified).getTime() / 1000)
  }

  async mimeType(path: string): Promise<string | undefined> {
    return this.client.file(path).type || undefined
  }

  path(path: string): string {
    return path
  }

  url(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\//, '')}`
  }

  async temporaryUrl(
    path: string,
    expiresIn: Date | number,
    options: TemporaryUrlOptions = {},
  ): Promise<string> {
    return this.client.presign(path, {
      expiresIn: secondsUntil(expiresIn),
      method: 'GET',
      ...options,
    })
  }

  async temporaryUploadUrl(
    path: string,
    expiresIn: Date | number,
    options: TemporaryUrlOptions = {},
  ): Promise<{ url: string, headers: Record<string, string> }> {
    const url = this.client.presign(path, {
      expiresIn: secondsUntil(expiresIn),
      method: 'PUT',
      ...options,
    })
    return { url, headers: {} }
  }

  async getVisibility(): Promise<Visibility> {
    return this.defaultVisibility
  }

  async setVisibility(): Promise<boolean> {
    return true
  }

  download(path: string, name?: string): FileResponse {
    return download(this.url(path), name)
  }

  private async keys(
    directory: string,
    recursive: boolean,
    want: 'files' | 'dirs',
  ): Promise<string[]> {
    const prefix = directory ? `${directory.replace(/\/$/, '')}/` : ''
    const result = await this.client.list({ prefix, ...(recursive ? {} : { delimiter: '/' }) })
    if (want === 'dirs') {
      return (result.commonPrefixes ?? []).map((p: { prefix: string }) =>
        p.prefix.replace(/\/$/, ''),
      )
    }
    return (result.contents ?? [])
      .map((c: { key: string }) => c.key)
      .filter((k: string) => !k.endsWith('/'))
  }

  files(directory = ''): Promise<string[]> {
    return this.keys(directory, false, 'files')
  }

  allFiles(directory = ''): Promise<string[]> {
    return this.keys(directory, true, 'files')
  }

  directories(directory = ''): Promise<string[]> {
    return this.keys(directory, false, 'dirs')
  }

  allDirectories(directory = ''): Promise<string[]> {
    return this.keys(directory, true, 'dirs')
  }

  async makeDirectory(path: string): Promise<boolean> {
    // S3 has no real directories; create a zero-byte key marker.
    await this.put(`${path.replace(/\/$/, '')}/`, '')
    return true
  }

  async deleteDirectory(path: string): Promise<boolean> {
    const keys = await this.allFiles(path)
    if (keys.length)
      await this.delete(keys)
    return true
  }
}

// ── ScopedDisk ───────────────────────────────────────────────────────────────
/** A path-prefixed view over another disk (Laravel's `scoped` driver). */
export class ScopedDisk implements FilesystemDisk {
  constructor(
    private readonly inner: FilesystemDisk,
    private readonly prefix: string,
  ) {}

  private p(path: string): string {
    // Confirm the joined path stays under the scope prefix — a `../` must not
    // let a scoped (e.g. per-tenant) disk reach a sibling's files.
    const base = this.prefix.replace(/\/+$/, '')
    const joined = posix.normalize(posix.join(base, path))
    if (joined !== base && !joined.startsWith(`${base}/`)) {
      throw new PathEscapeError(
        `[elyvel] Path "${path}" escapes the scoped prefix "${this.prefix}".`,
      )
    }
    return joined
  }

  private strip(path: string): string {
    const base = `${this.prefix.replace(/\/$/, '')}/`
    return path.startsWith(base) ? path.slice(base.length) : path
  }

  get(path: string) {
    return this.inner.get(this.p(path))
  }

  getBytes(path: string) {
    return this.inner.getBytes(this.p(path))
  }

  json<T = unknown>(path: string) {
    return this.inner.json<T>(this.p(path))
  }

  exists(path: string) {
    return this.inner.exists(this.p(path))
  }

  missing(path: string) {
    return this.inner.missing(this.p(path))
  }

  put(path: string, contents: Contents, visibility?: Visibility) {
    return this.inner.put(this.p(path), contents, visibility)
  }

  async putFile(directory: string, file: Storable, visibility?: Visibility) {
    return this.strip(await this.inner.putFile(this.p(directory), file, visibility))
  }

  async putFileAs(directory: string, file: Storable, name: string, visibility?: Visibility) {
    return this.strip(await this.inner.putFileAs(this.p(directory), file, name, visibility))
  }

  prepend(path: string, data: string) {
    return this.inner.prepend(this.p(path), data)
  }

  append(path: string, data: string) {
    return this.inner.append(this.p(path), data)
  }

  copy(from: string, to: string) {
    return this.inner.copy(this.p(from), this.p(to))
  }

  move(from: string, to: string) {
    return this.inner.move(this.p(from), this.p(to))
  }

  delete(paths: string | string[]) {
    return this.inner.delete(Array.isArray(paths) ? paths.map(p => this.p(p)) : this.p(paths))
  }

  size(path: string) {
    return this.inner.size(this.p(path))
  }

  lastModified(path: string) {
    return this.inner.lastModified(this.p(path))
  }

  mimeType(path: string) {
    return this.inner.mimeType(this.p(path))
  }

  path(path: string) {
    return this.inner.path(this.p(path))
  }

  url(path: string) {
    return this.inner.url(this.p(path))
  }

  temporaryUrl(path: string, expiresIn: Date | number, options?: TemporaryUrlOptions) {
    return this.inner.temporaryUrl(this.p(path), expiresIn, options)
  }

  temporaryUploadUrl(path: string, expiresIn: Date | number, options?: TemporaryUrlOptions) {
    return this.inner.temporaryUploadUrl(this.p(path), expiresIn, options)
  }

  getVisibility(path: string) {
    return this.inner.getVisibility(this.p(path))
  }

  setVisibility(path: string, visibility: Visibility) {
    return this.inner.setVisibility(this.p(path), visibility)
  }

  download(path: string, name?: string) {
    return this.inner.download(this.p(path), name)
  }

  async files(directory = '') {
    return (await this.inner.files(this.p(directory))).map(p => this.strip(p))
  }

  async allFiles(directory = '') {
    return (await this.inner.allFiles(this.p(directory))).map(p => this.strip(p))
  }

  async directories(directory = '') {
    return (await this.inner.directories(this.p(directory))).map(p => this.strip(p))
  }

  async allDirectories(directory = '') {
    return (await this.inner.allDirectories(this.p(directory))).map(p => this.strip(p))
  }

  makeDirectory(path: string) {
    return this.inner.makeDirectory(this.p(path))
  }

  deleteDirectory(path: string) {
    return this.inner.deleteDirectory(this.p(path))
  }
}
