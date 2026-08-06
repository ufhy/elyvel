## Roles & permissions (@elyvel/permission)

- Roles and permissions live in the database — do NOT invent a `role` column
  on users, and do not hand-write role tables. The five tables come from
  `elyvel permission:migration`.
- Every check is `await`: `await user.hasRole('admin')`,
  `await user.hasPermissionTo('edit posts')`, `await user.assignRole('editor')`.
  There is no synchronous form on the model.
- A role or permission must exist before it can be assigned — assigning an
  unknown name throws. Create it first (`Role.create({ name, guard })`,
  `Permission.create({ name, guard })`) or with
  `elyvel permission:create-role` / `permission:create-permission`.
- Guard rules: a check with no guard matches every guard; passing one narrows
  it (`hasRole('admin', 'api')`). Writes default to the configured guard.
- Guarding routes: `{ middleware: 'role:admin|editor' }`,
  `'permission:edit posts'`, `'role_or_permission:admin|view panel'`. A pipe
  means "any of these". These need `permissionMiddlewareAliases` registered in
  `config/middleware.ts`.
- `gate().allows('edit posts', user)` works inside a request ONLY when the
  `permissions` middleware ran (it loads the user's names into Context, because
  Gate is synchronous). Outside a request — jobs, CLI, tinker — use the
  model's `await` methods instead.
- After writing to the tables directly (raw SQL, or `role.permissions()
  .attach(...)`), call `forgetPermissionCache()`; writes through the model's
  own methods already do.
