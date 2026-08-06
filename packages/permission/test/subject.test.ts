import { beforeEach, describe, expect, test } from 'bun:test'
import { loadPermissionsInto } from '../src/context'
import { Permission, Role } from '../src/models'
import { configurePermissions } from '../src/registrar'
import { subjectFromUser, subjectOf } from '../src/subject'
import { freshDatabase, User } from './helpers'

/**
 * The case a unit test with a hand-made model would have missed entirely:
 * `ctx.user` in a real app is what the auth layer derived, and with Better
 * Auth that is a PLAIN OBJECT. Recording its `constructor.name` would file
 * every user's roles under `model_type: 'Object'` — roles assigned through
 * `AuthUser` would then never be found again.
 */
beforeEach(async () => {
  await freshDatabase()
  await Permission.create({ name: 'edit posts', guard: 'web' })
  const editor = await Role.create({ name: 'editor', guard: 'web' })
  await editor.permissions().attach([1])
})

describe('subjectFromUser', () => {
  test('a model instance resolves to its own class name and key', async () => {
    const user = await User.create({ name: 'Ada' })
    expect(subjectFromUser(user)).toEqual({ type: 'User', id: String(user.id) })
  })

  test('a plain auth object uses the configured userModel', () => {
    configurePermissions({ userModel: User })
    expect(subjectFromUser({ id: 'usr_abc', email: 'a@b.c' })).toEqual({ type: 'User', id: 'usr_abc' })
  })

  test('a plain auth object without userModel throws rather than guessing', () => {
    configurePermissions(undefined)
    expect(() => subjectFromUser({ id: 'usr_abc' })).toThrow('userModel')
  })

  test('no user at all is simply nobody', () => {
    expect(subjectFromUser(null)).toBeUndefined()
    expect(subjectFromUser(undefined)).toBeUndefined()
    expect(subjectFromUser({})).toBeUndefined()
  })
})

describe('the two paths agree', () => {
  test('a role assigned through the model is found via the plain auth object', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')

    // What the middleware would receive from Better Auth: same person, plain object.
    configurePermissions({ userModel: User })
    const asAuthObject = subjectFromUser({ id: user.id, email: 'ada@example.com' })!

    const loaded = await loadPermissionsInto(asAuthObject)
    expect(loaded.roles).toEqual(['editor'])
    expect(loaded.permissions).toEqual(['edit posts'])
    expect(asAuthObject).toEqual(subjectOf(user))
  })
})
