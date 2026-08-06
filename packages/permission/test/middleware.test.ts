import type { MiddlewareContext } from '@elyvel/core'
import { createGate, setDefaultGate } from '@elyvel/auth'
import { withContextScope } from '@elyvel/core'
import { beforeEach, describe, expect, test } from 'bun:test'
import { currentPermissions, loadPermissionsInto } from '../src/context'
import {
  PermissionContextMiddleware,
  PermissionMiddleware,
  RoleMiddleware,
  RoleOrPermissionMiddleware,
} from '../src/middleware'
import { Permission, Role } from '../src/models'
import { freshDatabase, User } from './helpers'

/** A minimal stand-in for the Elysia context the middleware receives. */
function ctx(user?: unknown): MiddlewareContext & { rejected?: { code: number, body: unknown } } {
  const context = {
    request: new Request('http://localhost/'),
    params: {},
    query: {},
    body: undefined,
    set: { headers: {} },
    user,
    status(code: number, body?: unknown) {
      context.rejected = { code, body }
      return context.rejected
    },
  } as unknown as MiddlewareContext & { rejected?: { code: number, body: unknown } }
  return context
}

beforeEach(async () => {
  await freshDatabase()
  await Permission.create({ name: 'edit posts', guard: 'web' })
  await Permission.create({ name: 'view reports', guard: 'web' })
  const editor = await Role.create({ name: 'editor', guard: 'web' })
  await editor.permissions().attach([1])
})

describe('RoleMiddleware', () => {
  test('allows a user holding one of the piped roles', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')

    const context = ctx(user)
    expect(await new RoleMiddleware().handle(context, 'admin|editor')).toBeUndefined()
    expect(context.rejected).toBeUndefined()
  })

  test('rejects with 403 and names the required roles', async () => {
    const user = await User.create({ name: 'Ada' })
    const context = ctx(user)
    await new RoleMiddleware().handle(context, 'admin|editor')

    expect(context.rejected?.code).toBe(403)
    expect((context.rejected?.body as { message: string }).message).toContain('admin, editor')
  })

  test('an unauthenticated request is 403, not a crash', async () => {
    const context = ctx(undefined)
    await new RoleMiddleware().handle(context, 'editor')
    expect(context.rejected?.code).toBe(403)
    expect((context.rejected?.body as { message: string }).message).toContain('not logged in')
  })
})

describe('PermissionMiddleware', () => {
  test('allows a permission granted through a role', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')

    const context = ctx(user)
    expect(await new PermissionMiddleware().handle(context, 'edit posts')).toBeUndefined()
  })

  test('rejects a permission the user does not hold', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')

    const context = ctx(user)
    await new PermissionMiddleware().handle(context, 'view reports')
    expect(context.rejected?.code).toBe(403)
  })
})

describe('RoleOrPermissionMiddleware', () => {
  test('either side is enough', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.givePermissionTo('view reports')

    const viaPermission = ctx(user)
    expect(await new RoleOrPermissionMiddleware().handle(viaPermission, 'admin|view reports')).toBeUndefined()

    const neither = ctx(user)
    await new RoleOrPermissionMiddleware().handle(neither, 'admin|edit posts')
    expect(neither.rejected?.code).toBe(403)
  })
})

describe('request context', () => {
  test('the loader fills Context once and the middleware reuses it', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')

    await withContextScope(async () => {
      expect(currentPermissions()).toBeUndefined()
      await new PermissionContextMiddleware().handle(ctx(user))

      const loaded = currentPermissions()
      expect(loaded?.roles).toEqual(['editor'])
      expect(loaded?.permissions).toEqual(['edit posts'])
    })
  })

  test('nothing leaks between two request scopes', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')

    await withContextScope(async () => {
      await loadPermissionsInto(user)
      expect(currentPermissions()?.roles).toEqual(['editor'])
    })
    await withContextScope(() => {
      expect(currentPermissions()).toBeUndefined()
    })
  })
})

describe('Gate integration', () => {
  /**
   * The whole reason `context.ts` exists: Gate is synchronous and throws on a
   * Promise, so the hook may only read what the middleware already loaded.
   */
  function gateWithPermissions() {
    const gate = createGate()
    gate.before((_user, ability) => {
      const loaded = currentPermissions()
      if (!loaded)
        return undefined
      return loaded.permissions.includes(ability) ? true : undefined
    })
    setDefaultGate(gate)
    return gate
  }

  test('an ability matching a held permission is allowed — synchronously', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')
    const gate = gateWithPermissions()

    await withContextScope(async () => {
      await loadPermissionsInto(user)
      expect(gate.allows('edit posts', user as never)).toBe(true)
      expect(gate.allows('view reports', user as never)).toBe(false)
    })
  })

  test('outside a loaded request the hook abstains instead of denying wrongly', async () => {
    const user = await User.create({ name: 'Ada' })
    await user.assignRole('editor')
    const gate = gateWithPermissions()
    gate.define('edit posts', () => true) // the app defined it itself

    withContextScope(() => {
      // Nothing loaded: the hook returns undefined, so the app's own ability
      // still decides. Denying here would break every job and CLI command.
      expect(gate.allows('edit posts', user as never)).toBe(true)
    })
  })
})
