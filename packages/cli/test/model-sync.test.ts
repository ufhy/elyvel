import type { ColumnInfo } from '@elyvel/database'
import type { ModelMeta } from '../src/commands/model-sync'
import { describe, expect, test } from 'bun:test'
import { applyModelSync, planModelSync, resolveType } from '../src/commands/model-sync'

const META: ModelMeta = {
  primaryKey: 'id',
  createdAtColumn: 'created_at',
  updatedAtColumn: 'updated_at',
  deletedAtColumn: 'deleted_at',
  casts: { published: 'boolean', meta: 'json' },
}

function col(partial: Partial<ColumnInfo> & { name: string }): ColumnInfo {
  return { type: 'text', nullable: false, default: null, ...partial }
}

describe('resolveType', () => {
  test('created_at/updated_at are non-null Dayjs despite being DB-nullable', () => {
    expect(resolveType(col({ name: 'created_at', type: 'timestamp', nullable: true }), META, 'sqlite')).toBe('Dayjs')
    expect(resolveType(col({ name: 'updated_at', type: 'timestamp', nullable: true }), META, 'sqlite')).toBe('Dayjs')
  })

  test('deleted_at stays nullable Dayjs', () => {
    expect(resolveType(col({ name: 'deleted_at', type: 'timestamp', nullable: true }), META, 'sqlite')).toBe('Dayjs | null')
  })

  test('a cast column uses the cast\'s output type, not the raw DB type', () => {
    expect(resolveType(col({ name: 'published', type: 'integer' }), META, 'sqlite')).toBe('boolean')
    expect(resolveType(col({ name: 'meta', type: 'text', nullable: true }), META, 'sqlite')).toBe('Record<string, unknown> | null')
  })

  test('the primary key is never nullable, even if the DB catalog says so (SQLite rowid quirk)', () => {
    expect(resolveType(col({ name: 'id', type: 'integer', nullable: true }), META, 'sqlite')).toBe('number')
  })

  test('falls back to raw-type inference for uncast columns', () => {
    expect(resolveType(col({ name: 'title', type: 'TEXT' }), META, 'sqlite')).toBe('string')
    expect(resolveType(col({ name: 'views', type: 'INTEGER' }), META, 'sqlite')).toBe('number')
    expect(resolveType(col({ name: 'active', type: 'tinyint(1)' }), META, 'mysql')).toBe('boolean')
    expect(resolveType(col({ name: 'active', type: 'boolean' }), META, 'pg')).toBe('boolean')
  })

  test('nullable uncast columns get a `| null` suffix', () => {
    expect(resolveType(col({ name: 'subtitle', type: 'TEXT', nullable: true }), META, 'sqlite')).toBe('string | null')
  })
})

describe('planModelSync', () => {
  const columns = [
    col({ name: 'id', type: 'integer' }),
    col({ name: 'title', type: 'TEXT' }),
    col({ name: 'created_at', type: 'timestamp', nullable: true }),
  ]

  test('reports missing columns not yet declared', () => {
    const plan = planModelSync('class Post extends Model {\n  declare id: number\n}', columns, META, 'sqlite')
    expect(plan.missing.map(c => c.name)).toEqual(['title', 'created_at'])
    expect(plan.lines).toEqual(['  declare title: string', '  declare created_at: Dayjs'])
    expect(plan.stale).toEqual([])
  })

  test('a commented-out example declare counts as neither declared nor stale', () => {
    const source = 'class Post extends Model {\n  //   declare title: string\n  declare id: number\n}'
    const plan = planModelSync(source, columns, META, 'sqlite')
    expect(plan.missing.map(c => c.name)).toContain('title')
  })

  test('reports a declared field with no matching column as stale, without touching it', () => {
    const source = 'class Post extends Model {\n  declare id: number\n  declare ghost_field: string\n  declare title: string\n  declare created_at: Dayjs\n}'
    const plan = planModelSync(source, columns, META, 'sqlite')
    expect(plan.stale).toEqual(['ghost_field'])
    expect(plan.missing).toEqual([])
  })

  test('fully in sync → nothing missing, nothing stale', () => {
    const source = 'class Post extends Model {\n  declare id: number\n  declare title: string\n  declare created_at: Dayjs\n}'
    const plan = planModelSync(source, columns, META, 'sqlite')
    expect(plan.missing).toEqual([])
    expect(plan.stale).toEqual([])
  })
})

describe('applyModelSync', () => {
  test('inserts after the last existing declare line', () => {
    const source = [
      'import { Model } from \'@elyvel/database\'',
      'export class Post extends Model {',
      '  declare id: number',
      '}',
    ].join('\n')
    const result = applyModelSync(source, ['  declare title: string'])
    expect(result).toBe([
      'import { Model } from \'@elyvel/database\'',
      'export class Post extends Model {',
      '  declare id: number',
      '  declare title: string',
      '}',
    ].join('\n'))
  })

  test('falls back to after the last static line when there are no declares yet', () => {
    const source = [
      'import { Model } from \'@elyvel/database\'',
      'export class Post extends Model {',
      '  static override table = \'posts\'',
      '}',
    ].join('\n')
    const result = applyModelSync(source, ['  declare id: number'])
    expect(result).toBe([
      'import { Model } from \'@elyvel/database\'',
      'export class Post extends Model {',
      '  static override table = \'posts\'',
      '  declare id: number',
      '}',
    ].join('\n'))
  })

  test('activates a commented-out Dayjs import when a generated line needs it', () => {
    const source = [
      'import { Model } from \'@elyvel/database\'',
      '// import type { Dayjs } from \'@elyvel/database\'',
      'export class Post extends Model {',
      '  declare id: number',
      '}',
    ].join('\n')
    const result = applyModelSync(source, ['  declare created_at: Dayjs'])
    expect(result).toContain('import type { Dayjs } from \'@elyvel/database\'')
    expect(result).not.toContain('// import type { Dayjs }')
  })

  test('adds a fresh Dayjs import when none exists at all', () => {
    const source = [
      'import { Model } from \'@elyvel/database\'',
      'export class Post extends Model {',
      '  declare id: number',
      '}',
    ].join('\n')
    const result = applyModelSync(source, ['  declare created_at: Dayjs'])
    expect(result).toContain('import type { Dayjs } from \'@elyvel/database\'')
  })

  test('returns null when the class body can\'t be located', () => {
    expect(applyModelSync('not a model file', ['  declare id: number'])).toBeNull()
  })
})
