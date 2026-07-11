import { defineAppConfig } from '@elysia-ravel/core'
import { DatabaseServiceProvider } from '@elysia-ravel/orm'
import { AppServiceProvider } from '../app/providers/AppServiceProvider'

/**
 * Application config. `defineAppConfig` pins the type, so your editor
 * autocompletes every available option and typos fail the type-check.
 */
export default defineAppConfig({
  name: process.env.APP_NAME ?? 'elysia-ravel',
  env: process.env.APP_ENV ?? 'local',
  port: Number(process.env.PORT ?? 3000),

  providers: [DatabaseServiceProvider, AppServiceProvider],
})
