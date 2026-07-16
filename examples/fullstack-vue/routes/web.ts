import { route } from '@elysia-ravel/core'

/**
 * Web routes. Files under routes/ are auto-mounted at boot. Return a value and
 * the framework serializes it to JSON; return `view(...)` / `Inertia.render(...)`
 * for HTML. See the docs to add controllers, middleware, and validation.
 */
export default route().get('/api/health', () => ({ status: 'ok' }))
