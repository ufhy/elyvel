import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { make } from '../src/commands/make'

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'elyvel-make-'))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')

describe('make:request', () => {
  test('generates a FormRequest', async () => {
    expect(await make('request', 'StorePost')).toBe(0)
    const src = read('app/requests/StorePostRequest.ts')
    expect(src).toContain('export class StorePostRequest extends FormRequest')
    expect(src).toContain('rules()')
  })
})

describe('make:resource', () => {
  test('generates an API Resource transform function', async () => {
    expect(await make('resource', 'Post')).toBe(0)
    const src = read('app/resources/PostResource.ts')
    expect(src).toContain('export function postResource(')
    expect(src).toContain('import { Resource }')
  })
})

describe('make:event', () => {
  test('generates a plain event class (no forced suffix)', async () => {
    expect(await make('event', 'CommentPosted')).toBe(0)
    const src = read('app/events/CommentPosted.ts')
    expect(src).toContain('export class CommentPosted')
  })
})

describe('make:listener', () => {
  test('generates a listener with a handle() method', async () => {
    expect(await make('listener', 'SendCommentNotification')).toBe(0)
    const src = read('app/listeners/SendCommentNotification.ts')
    expect(src).toContain('export class SendCommentNotification')
    expect(src).toContain('async handle(')
  })
})

describe('make:notification', () => {
  test('generates a Notification subclass', async () => {
    expect(await make('notification', 'NewComment')).toBe(0)
    const src = read('app/notifications/NewCommentNotification.ts')
    expect(src).toContain('export class NewCommentNotification extends Notification')
    expect(src).toContain('override via(')
  })
})

describe('make:provider', () => {
  test('generates a ServiceProvider subclass', async () => {
    expect(await make('provider', 'Blog')).toBe(0)
    const src = read('app/providers/BlogServiceProvider.ts')
    expect(src).toContain('export class BlogServiceProvider extends ServiceProvider')
    expect(src).toContain('override register(')
    expect(src).toContain('override boot(')
  })
})

describe('make:factory', () => {
  test('generates a factory + infers the model from the name', async () => {
    expect(await make('factory', 'Post')).toBe(0)
    const src = read('database/factories/PostFactory.ts')
    expect(src).toContain('export const postFactory = defineFactory(Post,')
    expect(src).toContain('import { Post } from \'../../app/models/Post\'')
  })
})

describe('make:concern', () => {
  test('generates a Concern object + matching Fields interface', async () => {
    expect(await make('concern', 'HasStatus')).toBe(0)
    const src = read('app/concerns/HasStatus.ts')
    expect(src).toContain('export interface HasStatusFields')
    expect(src).toContain('export const HasStatus: Concern')
    expect(src).toContain('import type { Concern } from \'@elyvel/database\'')
  })
})

describe('make:model companions', () => {
  test('plain make:model generates only the model', async () => {
    expect(await make('model', 'Category')).toBe(0)
    expect(read('app/models/Category.ts')).toContain('static override table = \'categories\'')
  })

  test('--migration generates a create_<table>_table migration', async () => {
    expect(await make('model', 'Category', { migration: true })).toBe(0)
    const [file] = readdirSync(join(dir, 'database/migrations'))
    const src = read(`database/migrations/${file}`)
    expect(file).toMatch(/_create_categories_table\.ts$/)
    expect(src).toContain('schema.create(\'categories\'')
  })

  test('--factory generates a matching factory', async () => {
    expect(await make('model', 'Category', { factory: true })).toBe(0)
    const src = read('database/factories/CategoryFactory.ts')
    expect(src).toContain('export const categoryFactory = defineFactory(Category,')
  })

  test('--seed generates a matching seeder', async () => {
    expect(await make('model', 'Category', { seed: true })).toBe(0)
    expect(read('database/seeders/CategorySeeder.ts')).toContain('export class CategorySeeder')
  })

  test('--controller generates a matching controller', async () => {
    expect(await make('model', 'Category', { controller: true })).toBe(0)
    expect(read('app/controllers/CategoryController.ts')).toContain('export class CategoryController')
  })

  test('--all generates every companion', async () => {
    expect(await make('model', 'Category', { all: true })).toBe(0)
    expect(read('app/models/Category.ts')).toContain('class Category')
    expect(read('database/factories/CategoryFactory.ts')).toContain('categoryFactory')
    expect(read('database/seeders/CategorySeeder.ts')).toContain('class CategorySeeder')
    expect(read('app/controllers/CategoryController.ts')).toContain('class CategoryController')
    expect(readdirSync(join(dir, 'database/migrations')).some(f => f.endsWith('_create_categories_table.ts'))).toBe(true)
  })
})
