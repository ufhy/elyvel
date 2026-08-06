import { beforeEach, describe, expect, test } from 'bun:test'
import { Permission, Role } from '../src/models'
import { freshDatabase, Team, User } from './helpers'

/**
 * The behaviours an authorization package has to get right. Several of these
 * exist because the failure mode is silent: assigning a misspelled role that
 * grants nothing reads, at the call site, exactly like assigning a real one.
 */
beforeEach(async () => {
  await freshDatabase()
})

async function seed(): Promise<void> {
  await Permission.create({ name: 'edit posts', guard: 'web' })
  await Permission.create({ name: 'delete posts', guard: 'web' })
  await Permission.create({ name: 'view reports', guard: 'web' })
  const writer = await Role.create({ name: 'writer', guard: 'web' })
  const editor = await Role.create({ name: 'editor', guard: 'web' })
  await writer.permissions().attach([1])
  await editor.permissions().attach([1, 2])
}

describe('roles', () => {
  test('a role can be assigned, checked, and removed', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })

    expect(await user.hasRole('writer')).toBe(false)
    await user.assignRole('writer')
    expect(await user.hasRole('writer')).toBe(true)
    expect(await user.getRoleNames()).toEqual(['writer'])

    await user.removeRole('writer')
    expect(await user.hasRole('writer')).toBe(false)
  })

  test('assigning the same role twice does not duplicate it', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('writer')
    await user.assignRole('writer')
    expect(await user.getRoleNames()).toEqual(['writer'])
  })

  test('a misspelled role throws instead of silently granting nothing', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    expect(user.assignRole('writr')).rejects.toThrow('No role named "writr"')
    expect(await user.getRoleNames()).toEqual([])
  })

  test('syncRoles replaces the set', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('writer')
    await user.syncRoles('editor')
    expect(await user.getRoleNames()).toEqual(['editor'])
  })

  test('hasRole accepts a pipe string or an array, hasAllRoles demands every one', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('writer')

    expect(await user.hasRole('writer|editor')).toBe(true)
    expect(await user.hasRole(['admin', 'writer'])).toBe(true)
    expect(await user.hasAnyRole('editor', 'writer')).toBe(true)
    expect(await user.hasAllRoles(['writer', 'editor'])).toBe(false)
    await user.assignRole('editor')
    expect(await user.hasAllRoles(['writer', 'editor'])).toBe(true)
  })

  test('roles() returns the Role models', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')
    const roles = await user.roles()
    expect(roles.map(r => r.name)).toEqual(['editor'])
  })
})

describe('permissions', () => {
  test('permissions arrive through a role', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')

    expect(await user.hasPermissionTo('edit posts')).toBe(true)
    expect(await user.hasPermissionTo('delete posts')).toBe(true)
    expect(await user.hasPermissionTo('view reports')).toBe(false)
    expect(await user.getAllPermissions()).toEqual(['delete posts', 'edit posts'])
  })

  test('a direct permission is granted without any role', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.givePermissionTo('view reports')

    expect(await user.hasPermissionTo('view reports')).toBe(true)
    expect(await user.hasDirectPermission('view reports')).toBe(true)
    expect(await user.getRoleNames()).toEqual([])
  })

  test('hasDirectPermission ignores what a role grants', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')

    expect(await user.hasPermissionTo('edit posts')).toBe(true)
    expect(await user.hasDirectPermission('edit posts')).toBe(false)
  })

  test('revoking a direct permission leaves role-granted ones alone', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')
    await user.givePermissionTo('view reports')

    await user.revokePermissionTo('view reports')
    expect(await user.hasPermissionTo('view reports')).toBe(false)
    expect(await user.hasPermissionTo('edit posts')).toBe(true)
  })

  test('an unknown permission name throws', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    expect(user.givePermissionTo('edit postz')).rejects.toThrow('No permission named "edit postz"')
  })

  test('hasPermissionTo accepts a pipe string; hasAllPermissions demands every one', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('writer') // edit posts only

    expect(await user.hasPermissionTo('edit posts|delete posts')).toBe(true)
    expect(await user.hasAllPermissions('edit posts|delete posts')).toBe(false)
    expect(await user.hasAllPermissions(['edit posts'])).toBe(true)
  })
})

describe('guards', () => {
  test('an unspecified guard matches any guard; naming one narrows it', async () => {
    await Permission.create({ name: 'edit posts', guard: 'api' })
    const apiRole = await Role.create({ name: 'writer', guard: 'api' })
    await apiRole.permissions().attach([1])

    const user = await User.create({ name: 'Ada' })
    await user.assignRole(apiRole)

    // No guard given → matches, exactly as spatie's hasRole($role, null) does.
    expect(await user.hasRole('writer')).toBe(true)
    expect(await user.hasRole('writer', 'api')).toBe(true)
    expect(await user.hasRole('writer', 'web')).toBe(false)
    expect(await user.hasPermissionTo('edit posts', 'web')).toBe(false)
    expect(await user.hasPermissionTo('edit posts', 'api')).toBe(true)
  })

  test('same role name under two guards stays separate', async () => {
    await Role.create({ name: 'admin', guard: 'web' })
    const apiAdmin = await Role.create({ name: 'admin', guard: 'api' })

    const user = await User.create({ name: 'Ada' })
    await user.assignRole(apiAdmin)

    expect(await user.hasRole('admin', 'api')).toBe(true)
    expect(await user.hasRole('admin', 'web')).toBe(false)
  })
})

describe('polymorphic subjects', () => {
  test('roles attach to any model, and two models with the same id do not share them', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    const team = await Team.create({ name: 'Platform' })
    expect(user.id).toBe(team.id) // both are row 1 — the collision this guards against

    await user.assignRole('writer')
    await team.assignRole('editor')

    expect(await user.getRoleNames()).toEqual(['writer'])
    expect(await team.getRoleNames()).toEqual(['editor'])
  })
})

describe('cache invalidation', () => {
  test('a permission granted to a role after the catalogue was read is seen', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('writer')
    expect(await user.hasPermissionTo('view reports')).toBe(false) // warms the cache

    const writer = await Role.query().where('name', 'writer').first()
    await writer!.permissions().attach([3])
    // The write went through the relation, not this package — so the app must
    // clear the catalogue itself. Documented, and asserted here so the
    // requirement can't quietly disappear.
    const { forgetPermissionCache } = await import('../src/registrar')
    await forgetPermissionCache()

    expect(await user.hasPermissionTo('view reports')).toBe(true)
  })

  test('assigning through this package clears the catalogue by itself', async () => {
    await seed()
    const user = await User.create({ name: 'Ada' })
    expect(await user.hasPermissionTo('edit posts')).toBe(false) // warms the cache

    await user.assignRole('writer')
    expect(await user.hasPermissionTo('edit posts')).toBe(true)
  })
})
