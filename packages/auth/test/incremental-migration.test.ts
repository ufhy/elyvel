import { createConnection, hasColumn, QueryBuilder, SchemaBuilder, setConnection } from '@elyvel/database'
import { twoFactor, username } from 'better-auth/plugins'
import { describe, expect, test } from 'bun:test'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { defineAuth } from '../src/define-auth'

// The real-world sequence: migrate once, THEN enable a plugin, THEN migrate
// again from a NEW migration file — exactly what `elyvel make:migration` +
// re-calling `migrateBetterAuth` looks like once an app is already live.
describe('migrateBetterAuth is idempotent and incremental', () => {
  test('re-running it after enabling a plugin only adds what is missing — it used to crash with "table already exists"', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)

    // Migration #1 — plain app, no plugins yet.
    const firstRun = await migrateBetterAuth(new SchemaBuilder(conn), defineAuth({}).options)
    expect(firstRun.sort()).toEqual(['accounts', 'sessions', 'users', 'verifications'].sort())

    // A real row already exists before the plugin is ever added — an
    // incremental migration must not disturb it.
    await new QueryBuilder(conn, 'users').insert({
      id: 'user_1',
      name: 'Ada',
      email: 'ada@x.test',
      email_verified: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    // The developer enables two plugins later and writes a NEW migration
    // that calls migrateBetterAuth again with the updated options.
    const auth = defineAuth({ plugins: [twoFactor(), username()] })
    const secondRun = await migrateBetterAuth(new SchemaBuilder(conn), auth.options)

    // twoFactor's own table is brand new; users/accounts/sessions/verifications
    // only gained columns (twoFactorEnabled, username, displayUsername) so they
    // report as "touched" too, but were NOT recreated.
    expect(secondRun).toContain('twoFactor')
    expect(secondRun).toContain('users')

    expect(await hasColumn(conn, 'users', 'twoFactorEnabled')).toBe(true)
    expect(await hasColumn(conn, 'users', 'username')).toBe(true)
    expect(await hasColumn(conn, 'users', 'displayUsername')).toBe(true)

    // The pre-existing row survived the incremental ALTER untouched.
    const survivor = await new QueryBuilder(conn, 'users').where('id', 'user_1').first()
    expect(survivor?.name).toBe('Ada')

    // Running it a THIRD time (nothing new enabled) touches nothing at all.
    const thirdRun = await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
    expect(thirdRun).toEqual([])
  })

  test('a newly-added unique plugin field (username) actually enforces uniqueness', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    await migrateBetterAuth(new SchemaBuilder(conn), defineAuth({}).options)
    await migrateBetterAuth(new SchemaBuilder(conn), defineAuth({ plugins: [username()] }).options)

    await new QueryBuilder(conn, 'users').insert({
      id: 'user_1',
      name: 'Ada',
      email: 'ada@x.test',
      email_verified: 0,
      username: 'ada',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await expect(
      new QueryBuilder(conn, 'users').insert({
        id: 'user_2',
        name: 'Grace',
        email: 'grace@x.test',
        email_verified: 0,
        username: 'ada',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ).rejects.toThrow()
  })
})
