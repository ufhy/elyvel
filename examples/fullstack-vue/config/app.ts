import { AuthServiceProvider } from '@elyvel/auth'
import { BroadcastServiceProvider } from '@elyvel/broadcasting'
import { CacheServiceProvider } from '@elyvel/cache'
import { defineAppConfig } from '@elyvel/core'
import { EloquentServiceProvider } from '@elyvel/database'
import { I18nServiceProvider } from '@elyvel/i18n'
import { MailServiceProvider } from '@elyvel/mail'
import { NotificationServiceProvider } from '@elyvel/notifications'
import { QueueServiceProvider } from '@elyvel/queue'
import { StorageServiceProvider } from '@elyvel/storage'
import { AppServiceProvider } from '../app/providers/AppServiceProvider'
import { EventServiceProvider } from '../app/providers/EventServiceProvider'
import { ScheduleServiceProvider } from '../app/providers/ScheduleServiceProvider'

/**
 * Application config. `defineAppConfig` pins the type, so your editor
 * autocompletes every option and typos fail the type-check.
 */
export default defineAppConfig({
  name: process.env.APP_NAME ?? 'Fullstack Vue',
  env: process.env.APP_ENV ?? 'local',
  key: process.env.APP_KEY, // secret for `encrypted` model casts (AES-256-GCM)
  port: Number(process.env.PORT ?? 3000),

  providers: [
    EloquentServiceProvider,
    I18nServiceProvider,
    MailServiceProvider,
    CacheServiceProvider,
    StorageServiceProvider,
    QueueServiceProvider,
    BroadcastServiceProvider,
    NotificationServiceProvider,
    EventServiceProvider,
    ScheduleServiceProvider,
    AuthServiceProvider,
    AppServiceProvider,
  ],
})
