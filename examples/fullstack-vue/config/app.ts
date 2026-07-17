import { AuthServiceProvider } from '@elysia-ravel/auth'
import { defineAppConfig } from '@elysia-ravel/core'
import { EloquentServiceProvider } from '@elysia-ravel/database'
import { MailServiceProvider } from '@elysia-ravel/mail'
import { AppServiceProvider } from '../app/providers/AppServiceProvider'

/**
 * Application config. `defineAppConfig` pins the type, so your editor
 * autocompletes every option and typos fail the type-check.
 */
export default defineAppConfig({
  name: process.env.APP_NAME ?? 'Fullstack Vue',
  env: process.env.APP_ENV ?? 'local',
  key: process.env.APP_KEY, // secret for `encrypted` model casts (AES-256-GCM)
  port: Number(process.env.PORT ?? 3000),

  providers: [EloquentServiceProvider, MailServiceProvider, AuthServiceProvider, AppServiceProvider],
})
