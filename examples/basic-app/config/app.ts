import { CacheServiceProvider } from '@elysia-ravel/cache'
import { defineAppConfig } from '@elysia-ravel/core'
import { EloquentServiceProvider } from '@elysia-ravel/database'
import { MailServiceProvider } from '@elysia-ravel/mail'
import { QueueServiceProvider } from '@elysia-ravel/queue'
import { TelegramServiceProvider } from '@elysia-ravel/telegram'
import { AppServiceProvider } from '../app/providers/AppServiceProvider'
import { EventServiceProvider } from '../app/providers/EventServiceProvider'
import { ScheduleServiceProvider } from '../app/providers/ScheduleServiceProvider'

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

  providers: [
    EloquentServiceProvider,
    CacheServiceProvider,
    EventServiceProvider,
    QueueServiceProvider,
    ScheduleServiceProvider,
    MailServiceProvider,
    TelegramServiceProvider,
    AppServiceProvider,
  ],
})
