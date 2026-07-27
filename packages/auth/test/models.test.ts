import { createConnection, Model, SchemaBuilder, setConnection } from '@elyvel/database'
import { beforeEach, describe, expect, test } from 'bun:test'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { defineAuth } from '../src/define-auth'
import { AuthAccount, AuthSession, AuthUser, AuthVerification } from '../src/models'

beforeEach(async () => {
  const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
  setConnection(conn)
  await migrateBetterAuth(new SchemaBuilder(conn), defineAuth({}).options)
})

describe('AuthUser / AuthAccount', () => {
  test('AuthUser.find() reads a row Better Auth itself would have written', async () => {
    const user = new AuthUser()
    user.forceFill({
      id: 'user_1',
      name: 'Ada',
      email: 'ada@x.test',
      email_verified: false,
    })
    await user.save()

    const found = await AuthUser.find('user_1')
    expect(found?.name).toBe('Ada')
    expect(found?.email_verified).toBe(false)
  })

  test('AuthAccount belongsTo AuthUser via user_id (not the default authuser_id)', async () => {
    const user = new AuthUser()
    user.forceFill({ id: 'user_1', name: 'Ada', email: 'ada@x.test', email_verified: true })
    await user.save()

    const account = new AuthAccount()
    account.forceFill({
      id: 'account_1',
      account_id: 'ada@x.test',
      provider_id: 'credential',
      user_id: 'user_1',
      password: 'hashed',
    })
    await account.save()

    const owner = await account.user().first()
    expect(owner?.id).toBe('user_1')
    expect(owner?.name).toBe('Ada')
  })

  test('AuthUser hasMany AuthAccount via user_id (not the default authuser_id)', async () => {
    const user = new AuthUser()
    user.forceFill({ id: 'user_1', name: 'Ada', email: 'ada@x.test', email_verified: true })
    await user.save()

    for (const providerId of ['credential', 'github']) {
      const account = new AuthAccount()
      account.forceFill({
        id: `account_${providerId}`,
        account_id: 'ada@x.test',
        provider_id: providerId,
        user_id: 'user_1',
      })
      await account.save()
    }

    const accounts = await user.accounts().get()
    const providerIds = accounts.all().map(a => a.provider_id).sort()
    expect(providerIds).toEqual(['credential', 'github'])
  })

  test('sensitive AuthAccount columns are hidden from serialization', async () => {
    const account = new AuthAccount()
    account.forceFill({
      id: 'account_1',
      account_id: 'ada@x.test',
      provider_id: 'credential',
      user_id: 'user_1',
      password: 'super-secret-hash',
      access_token: 'super-secret-token',
    })
    await account.save()

    const found = await AuthAccount.find('account_1')
    const serialized = found!.toObject()
    expect(serialized.password).toBeUndefined()
    expect(serialized.access_token).toBeUndefined()
    expect(serialized.provider_id).toBe('credential')
  })

  test('AuthSession belongsTo AuthUser, and hides its token', async () => {
    const user = new AuthUser()
    user.forceFill({ id: 'user_1', name: 'Ada', email: 'ada@x.test', email_verified: true })
    await user.save()

    const session = new AuthSession()
    session.forceFill({
      id: 'session_1',
      user_id: 'user_1',
      token: 'super-secret-session-token',
      expires_at: new Date().toISOString(),
    })
    await session.save()

    const owner = await session.user().first()
    expect(owner?.id).toBe('user_1')
    expect(session.toObject().token).toBeUndefined()
  })

  test('AuthVerification is queryable by identifier (no FK to users — keyed by e.g. email)', async () => {
    const verification = new AuthVerification()
    verification.forceFill({
      id: 'verification_1',
      identifier: 'ada@x.test',
      value: 'otp-123456',
      expires_at: new Date().toISOString(),
    })
    await verification.save()

    const found = await AuthVerification.where('identifier', 'ada@x.test').first()
    expect(found?.value).toBe('otp-123456')
  })

  test('an app can subclass AuthUser to add its own fields/relations — statics + hydration follow the subclass', async () => {
    class Post extends Model {
      static override table = 'posts'
      static override fillable = ['title', 'user_id']
      declare id: number
      declare title: string
      declare user_id: string
    }
    class User extends AuthUser {
      posts() {
        return this.hasMany(Post, 'user_id')
      }
    }

    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    await migrateBetterAuth(new SchemaBuilder(conn), defineAuth({}).options)
    await new SchemaBuilder(conn).create('posts', (t) => {
      t.id()
      t.string('title')
      t.string('user_id')
      t.timestamps()
    })

    const user = new User()
    user.forceFill({ id: 'user_1', name: 'Ada', email: 'ada@x.test', email_verified: true })
    await user.save()
    const post = new Post()
    post.forceFill({ title: 'Hello', user_id: 'user_1' })
    await post.save()

    // find() hydrates as the SUBCLASS, and the subclass's own relation works.
    const found = await User.find('user_1')
    expect(found).toBeInstanceOf(User)
    const posts = (await found!.posts().get()).all()
    expect(posts.map(p => p.title)).toEqual(['Hello'])

    // Known limitation: a relation defined on the BASE class (AuthAccount.user())
    // still hydrates as the base AuthUser, not the app's User subclass — override
    // that relation on your own AuthAccount subclass too if you need it upgraded.
    const account = new AuthAccount()
    account.forceFill({ id: 'account_1', account_id: 'ada@x.test', provider_id: 'credential', user_id: 'user_1' })
    await account.save()
    const owner = await account.user().first()
    expect(owner).toBeInstanceOf(AuthUser)
    expect(owner).not.toBeInstanceOf(User)
  })
})
