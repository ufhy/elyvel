import { fallback } from '@elysia-ravel/core'

/**
 * Catches any request that no route matched, à la Laravel's `Route::fallback`.
 * Auto-mounted like any `routes/` file.
 */
export default fallback((ctx) => ctx.status(404, { message: 'Route not found' }))
