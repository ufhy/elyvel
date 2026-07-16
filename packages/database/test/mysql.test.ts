import type { Bindings, Connection, MysqlConnectionConfig } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import {

  createConnection,

  setConnection,
  transaction,
} from '../src/connection'
import { grammarFor } from '../src/grammar'
import { listTables, tableColumns } from '../src/inspect'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'

// ── MysqlGrammar (no server needed) ──────────────────────────────────────────
describe('MysqlGrammar', () => {
  const g = grammarFor('mysql')

  test('quotes identifiers with backticks; passes `*` through', () => {
    expect(g.wrap('users.name')).toBe('`users`.`name`')
    expect(g.wrap('*')).toBe('*')
    expect(g.wrap('a`b')).toBe('`a``b`') // escapes embedded backticks
  })

  test('uses positional `?` placeholders and has no RETURNING', () => {
    expect(g.placeholder(0)).toBe('?')
    expect(g.placeholder(3)).toBe('?')
    expect(g.supportsReturning).toBe(false)
  })

  test('renders MySQL column types in CREATE TABLE', () => {
    const sql = g.compileCreateTable('users', [
      { name: 'id', type: 'id' },
      { name: 'name', type: 'string' },
      { name: 'active', type: 'boolean', default: true },
      { name: 'meta', type: 'json', nullable: true },
      { name: 'score', type: 'decimal', precision: 8, scale: 2, nullable: true },
    ])
    expect(sql).toContain('CREATE TABLE `users`')
    expect(sql).toContain('`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY')
    expect(sql).toContain('`name` VARCHAR(255) NOT NULL')
    expect(sql).toContain('`active` TINYINT(1) NOT NULL DEFAULT 1')
    expect(sql).toContain('`meta` TEXT NULL')
    expect(sql).toContain('`score` DECIMAL(8, 2) NULL')
  })

  test('change() uses MODIFY COLUMN; dropForeign uses DROP FOREIGN KEY', () => {
    expect(g.compileChangeColumn('users', { name: 'name', type: 'string', length: 100 })).toEqual([
      'ALTER TABLE `users` MODIFY COLUMN `name` VARCHAR(100) NOT NULL',
    ])
    expect(g.compileDropForeign('posts', 'posts_user_id_foreign')).toBe(
      'ALTER TABLE `posts` DROP FOREIGN KEY `posts_user_id_foreign`',
    )
  })
})

// ── query builder SQL for the mysql dialect (via a capturing fake connection) ─
function fakeMysql(rows: Record<string, unknown>[] = []) {
  const statements: { sql: string, bindings: unknown[] }[] = []
  const selects: { sql: string, bindings: unknown[] }[] = []
  const conn = {
    dialect: 'mysql' as const,
    grammar: grammarFor('mysql'),
    select: async (sql: string, bindings: Bindings = []) => {
      selects.push({ sql, bindings: bindings as unknown[] })
      return rows as never[]
    },
    statement: async (sql: string, bindings: Bindings = []) => {
      statements.push({ sql, bindings: bindings as unknown[] })
    },
    insertGetId: async (sql: string, bindings: Bindings = []) => {
      statements.push({ sql, bindings: bindings as unknown[] })
      return 42
    },
  }
  return { conn: conn as unknown as Connection, statements, selects }
}

describe('query builder (mysql dialect SQL)', () => {
  test('insert emulates RETURNING: INSERT (no RETURNING) then re-select by id', async () => {
    const { conn, statements, selects } = fakeMysql([{ id: 42, name: 'Ada' }])
    const row = await new QueryBuilder(conn, 'users').insert({ name: 'Ada' }, 'id')

    expect(statements[0]?.sql).toBe('INSERT INTO `users` (`name`) VALUES (?)')
    expect(statements[0]?.sql).not.toContain('RETURNING')
    // re-selected the freshly generated id
    expect(selects[0]?.sql).toContain('WHERE `id` = ?')
    expect(selects[0]?.bindings).toEqual([42])
    expect(row).toEqual({ id: 42, name: 'Ada' })
  })

  test('upsert uses ON DUPLICATE KEY UPDATE … = VALUES(…)', async () => {
    const { conn, statements } = fakeMysql()
    await new QueryBuilder(conn, 'users').upsert(
      [{ email: 'a@b.c', name: 'A' }],
      ['email'],
      ['name'],
    )
    expect(statements[0]?.sql).toBe(
      'INSERT INTO `users` (`email`, `name`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)',
    )
  })

  test('insertOrIgnore uses INSERT IGNORE', async () => {
    const { conn, statements } = fakeMysql()
    await new QueryBuilder(conn, 'users').insertOrIgnore([{ id: 1, name: 'A' }])
    expect(statements[0]?.sql).toContain('INSERT IGNORE INTO `users`')
    expect(statements[0]?.sql).not.toContain('ON CONFLICT')
  })

  test('truncate uses TRUNCATE TABLE', async () => {
    const { conn, statements } = fakeMysql()
    await new QueryBuilder(conn, 'users').truncate()
    expect(statements[0]?.sql).toBe('TRUNCATE TABLE `users`')
  })

  test('whereLike stays LIKE (MySQL is case-insensitive by collation)', () => {
    const { conn } = fakeMysql()
    const { sql } = new QueryBuilder(conn, 'users').whereLike('name', 'A%').toSql()
    expect(sql).toContain('`name` LIKE ?')
    expect(sql).not.toContain('ILIKE')
  })

  test('lockForUpdate appends FOR UPDATE', () => {
    const { conn } = fakeMysql()
    const { sql } = new QueryBuilder(conn, 'users').where('id', 1).lockForUpdate().toSql()
    expect(sql).toContain('FOR UPDATE')
  })

  test('whereYear uses MySQL year(); whereJsonContains uses json_contains()', () => {
    const { conn } = fakeMysql()
    expect(new QueryBuilder(conn, 'users').whereYear('created_at', 2024).toSql().sql).toContain(
      'year(`created_at`)',
    )
    expect(
      new QueryBuilder(conn, 'users').whereJsonContains('roles', 'admin').toSql().sql,
    ).toContain('json_contains(`roles`, ?)')
  })
})

// ── live round-trip (only when a MySQL server is reachable) ───────────────────
const MYSQL_URL = process.env.MYSQL_URL
const liveConfig: MysqlConnectionConfig | null = MYSQL_URL
  ? { driver: 'mysql', url: MYSQL_URL }
  : null

describe.skipIf(!liveConfig)('mysql live round-trip', () => {
  let conn: Connection
  beforeEach(async () => {
    conn = await createConnection(liveConfig as MysqlConnectionConfig)
    await new SchemaBuilder(conn).dropIfExists('mysql_samples')
    await new SchemaBuilder(conn).create('mysql_samples', (t) => {
      t.id()
      t.string('name')
      t.boolean('active').default(true)
      t.integer('n').nullable()
    })
  })

  test('insert returns generated id + defaults, then update/upsert/truncate', async () => {
    const qb = () => new QueryBuilder(conn, 'mysql_samples')
    const row = await qb().insert({ name: 'Ada' }, 'id')
    expect(Number(row.id)).toBeGreaterThan(0)
    expect(row.active).toBe(true) // TINYINT(1) → boolean via typeCast
    expect(row.name).toBe('Ada')

    await qb().upsert([{ id: row.id, name: 'Ada L.' }], ['id'], ['name'])
    expect((await qb().where('id', row.id).first())?.name).toBe('Ada L.')

    await qb().truncate()
    expect(await qb().count()).toBe(0)
  })

  test('transactions: commit persists, thrown callback rolls back', async () => {
    setConnection(conn)
    const qb = () => new QueryBuilder(conn, 'mysql_samples')
    await transaction(async () => {
      await qb().insert({ name: 'kept' }, 'id')
    })
    await expect(
      transaction(async () => {
        await qb().insert({ name: 'discarded' }, 'id')
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await qb().count()).toBe(1)
  })

  test('introspection reports the table + lowercased column metadata', async () => {
    expect(await listTables(conn)).toContain('mysql_samples')
    const cols = await tableColumns(conn, 'mysql_samples')
    expect(cols.map(c => c.name).sort()).toEqual(['active', 'id', 'n', 'name'])
  })
})
