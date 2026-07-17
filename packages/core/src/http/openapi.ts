import type { AnyElysia } from 'elysia'

/**
 * OpenAPI docs configuration, resolved from `config('openapi')`. Mirrors Laravel's
 * zero-config docs: Elysia already derives the schema from typed routes, so this
 * just wires the renderer and document metadata.
 */
export interface OpenApiConfig {
  /** Serve the docs UI + spec. Defaults to on outside production. */
  enabled?: boolean
  /** UI path (default `/openapi`). The raw spec is served at `${path}/json`. */
  path?: string
  /** Docs UI renderer (default `scalar`). */
  provider?: 'scalar' | 'swagger-ui'
  /** Document title (defaults to `config('app.name')`). */
  title?: string
  /** Document version (defaults to `config('app.version')` or `1.0.0`). */
  version?: string
  /** Free-form description shown at the top of the docs. */
  description?: string
}

/** Identity helper for a typed `config/openapi.ts`. */
export function defineOpenApiConfig(config: OpenApiConfig): OpenApiConfig {
  return config
}

/**
 * Build the Elysia OpenAPI plugin from framework config. `@elysiajs/openapi` is an
 * optional peer — dynamically imported so apps that don't want docs don't pay for
 * it. Returns `null` when the package isn't installed (docs silently disabled).
 */
export async function openApiPlugin(config: OpenApiConfig = {}): Promise<AnyElysia | null> {
  let openapi: (typeof import('@elysiajs/openapi'))['openapi']
  try {
    ({ openapi } = await import('@elysiajs/openapi'))
  }
  catch {
    return null
  }
  return openapi({
    path: config.path ?? '/openapi',
    provider: config.provider ?? 'scalar',
    documentation: {
      info: {
        title: config.title ?? 'API',
        version: config.version ?? '1.0.0',
        ...(config.description ? { description: config.description } : {}),
      },
    },
  }) as unknown as AnyElysia
}
