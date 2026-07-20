import type { MiddlewareContext } from '@elyvel/core'

/**
 * `ctx.authorize` is derived at runtime by `betterAuthPlugin` (typed `unknown`
 * on `MiddlewareContext`) — cast once here instead of in every controller.
 * Throws (via the Gate) when the ability is denied.
 */
export function authorize(ctx: MiddlewareContext, ability: string, ...args: unknown[]): void {
  (ctx.authorize as (a: string, ...x: unknown[]) => void)(ability, ...args)
}
