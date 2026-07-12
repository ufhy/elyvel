import { CacheServiceProvider } from '@elysia-ravel/cache'
import { defineAppConfig } from '@elysia-ravel/core'
import { EloquentServiceProvider } from '@elysia-ravel/database'
import { AppServiceProvider } from '../app/providers/AppServiceProvider'

/**
 * Application config. `defineAppConfig` pins the type, so your editor
 * autocompletes every available option and typos fail the type-check.
 */
export default defineAppConfig({
  name: process.env.APP_NAME ?? 'elysia-ravel',
  env: process.env.APP_ENV ?? 'local',
  timezone: process.env.APP_TIMEZONE ?? 'Asia/Makassar', // display tz; storage stays UTC
  key: process.env.APP_KEY, // secret for `encrypted` model casts (AES-256-GCM)

  port: Number(process.env.PORT ?? 3000),

  providers: [EloquentServiceProvider, CacheServiceProvider, AppServiceProvider],
})
