import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { generateMigrationPluginCommand, make } from '../src/commands/make'

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

describe('make:controller flags', () => {
  test('default: the 5-action JSON stub (unchanged)', async () => {
    expect(await make('controller', 'Post')).toBe(0)
    const src = read('app/controllers/PostController.ts')
    expect(src).toContain('async index(')
    expect(src).toContain('async store(')
    expect(src).not.toContain('async create(')
  })

  test('--resource generates the full 7-action stub, with create/edit', async () => {
    expect(await make('controller', 'Post', { resource: true })).toBe(0)
    const src = read('app/controllers/PostController.ts')
    for (const action of ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'])
      expect(src).toContain(`async ${action}(`)
  })

  test('--invokable generates a single handle() method', async () => {
    expect(await make('controller', 'ProvisionServer', { invokable: true })).toBe(0)
    const src = read('app/controllers/ProvisionServerController.ts')
    expect(src).toContain('async handle(')
    expect(src).not.toContain('async index(')
  })

  test('--singleton generates show/edit/update, no create/store/destroy', async () => {
    expect(await make('controller', 'Profile', { singleton: true })).toBe(0)
    const src = read('app/controllers/ProfileController.ts')
    expect(src).toContain('async show(')
    expect(src).toContain('async edit(')
    expect(src).toContain('async update(')
    expect(src).not.toContain('async create(')
    expect(src).not.toContain('async destroy(')
  })

  test('--singleton --creatable adds create/store/destroy too', async () => {
    expect(await make('controller', 'Profile', { singleton: true, creatable: true })).toBe(0)
    const src = read('app/controllers/ProfileController.ts')
    for (const action of ['create', 'store', 'show', 'edit', 'update', 'destroy'])
      expect(src).toContain(`async ${action}(`)
  })

  test('--model adds a route-model-binding hint comment, not a live (unused) import', async () => {
    expect(await make('controller', 'Post', { model: 'Post' })).toBe(0)
    const src = read('app/controllers/PostController.ts')
    expect(src).toContain('bind: Post')
    expect(src).not.toContain('import type { Post }')
  })

  test('--parent adds a nested-resource hint comment', async () => {
    expect(await make('controller', 'Comment', { parent: 'Post' })).toBe(0)
    const src = read('app/controllers/CommentController.ts')
    expect(src).toContain('Nested under Post')
    expect(src).toContain('shallow: true')
  })

  test('--requests also generates Store/Update FormRequest classes', async () => {
    expect(await make('controller', 'Post', { requests: true })).toBe(0)
    expect(read('app/requests/StorePostRequest.ts')).toContain('export class StorePostRequest')
    expect(read('app/requests/UpdatePostRequest.ts')).toContain('export class UpdatePostRequest')
  })

  test('--force allows overwriting an existing generated file', async () => {
    expect(await make('controller', 'Post')).toBe(0)
    expect(await make('controller', 'Post')).toBe(1) // refused without --force
    expect(await make('controller', 'Post', { force: true })).toBe(0) // allowed with it
  })
})

describe('auth:generate-migration-plugin', () => {
  test('generates a migrateBetterAuth re-run migration — no name to invent', async () => {
    expect(await generateMigrationPluginCommand()).toBe(0)
    const [file] = readdirSync(join(dir, 'database/migrations'))
    expect(file).toMatch(/_sync_auth_schema\.ts$/)
    const src = read(`database/migrations/${file}`)
    expect(src).toContain('migrateBetterAuth(schema, app(AuthToken).options)')
    expect(src).not.toContain('schema.create(')
  })

  test('make:migration stays the plain create-table stub (unaffected)', async () => {
    expect(await make('migration', 'create_widgets_table')).toBe(0)
    const [file] = readdirSync(join(dir, 'database/migrations'))
    const src = read(`database/migrations/${file}`)
    expect(src).toContain('schema.create(')
    expect(src).not.toContain('migrateBetterAuth')
  })
})

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
