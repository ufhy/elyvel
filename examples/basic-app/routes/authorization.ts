import { betterAuthPlugin } from '@elysia-ravel/auth'
import { route } from '@elysia-ravel/core'
import { notes } from '../app/authorization'
import { auth } from '../app/better-auth'

/**
 * Authorization demo. `{ can: 'admin' }` guards a route by a model-less ability;
 * in-handler `authorize('update', note)` runs the Note policy and throws a 403
 * (converted by the error handler) when the current user isn't the author.
 */
export default route()
  .use(betterAuthPlugin(auth))
  // model-less gate via the `can` macro
  .get('/admin', ({ user }: any) => ({ ok: true, user: user.email }), { auth: true, can: 'admin' })
  // create a note owned by the current user (spread to a plain object for JSON)
  .post(
    '/notes',
    ({ user, body }: any) => ({ ...notes.create(user.id, body?.title ?? 'Untitled') }),
    {
      auth: true,
    },
  )
  // policy check in the handler: only the author may update
  .put(
    '/notes/:id',
    ({ params, body, authorize, status }: any) => {
      const note = notes.find(params.id)
      if (!note)
        return status(404, { message: 'Not found' })
      authorize('update', note) // throws AuthorizationError (→ 403) when not the author
      note.title = body?.title ?? note.title
      return { ...note }
    },
    { auth: true },
  )
