import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { make } from '../src/commands/make'

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'ravel-make-'))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')

describe('make:policy', () => {
  test('generates a class-based policy (new API, not createGate)', async () => {
    expect(await make('policy', 'Post')).toBe(0)
    const src = read('app/policies/PostPolicy.ts')
    expect(src).toContain('export class PostPolicy')
    expect(src).toContain("import { Response } from '@elysia-ravel/auth'")
    expect(src).toContain('update(user:')
    expect(src).not.toContain('createGate') // old stub is gone
  })

  test('--model scaffolds the full resource method set + model import', async () => {
    expect(await make('policy', 'Post', { model: 'Post' })).toBe(0)
    const src = read('app/policies/PostPolicy.ts')
    expect(src).toContain("import type { Post } from '../models/Post'")
    for (const method of [
      'viewAny',
      'view',
      'create',
      'update',
      'delete',
      'restore',
      'forceDelete',
    ]) {
      expect(src).toContain(`${method}(`)
    }
    expect(src).toContain('_model: Post') // model param typed, collision-proof name
  })

  test('bare --model infers the model name from the policy name', async () => {
    expect(await make('policy', 'Comment', { model: true })).toBe(0)
    const src = read('app/policies/CommentPolicy.ts')
    expect(src).toContain("import type { Comment } from '../models/Comment'")
    expect(src).toContain('_model: Comment')
  })

  test('a policy named after the User model still typechecks (no param clash)', async () => {
    expect(await make('policy', 'User', { model: 'User' })).toBe(0)
    const src = read('app/policies/UserPolicy.ts')
    // both params present, distinct names → no duplicate identifier
    expect(src).toContain('view(_user: { id: unknown } | null, _model: User)')
  })

  test('refuses to overwrite an existing policy', async () => {
    expect(await make('policy', 'Post')).toBe(0)
    expect(await make('policy', 'Post')).toBe(1) // second run fails, file preserved
  })
})
