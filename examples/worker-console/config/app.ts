import { defineAppConfig } from '@elyvel/core'
import { EloquentServiceProvider } from '@elyvel/database'
import { I18nServiceProvider } from '@elyvel/i18n'
import { MailServiceProvider } from '@elyvel/mail'
import { NotificationServiceProvider } from '@elyvel/notifications'
import { QueueServiceProvider } from '@elyvel/queue'
import { ScheduleServiceProvider } from '@elyvel/scheduler'
import { AppServiceProvider } from '../app/providers/AppServiceProvider'

/**
 * Application config. `defineAppConfig` pins the type, so your editor
 * autocompletes every option and typos fail the type-check.
 */
export default defineAppConfig({
  name: process.env.APP_NAME ?? 'Worker Console',
  env: process.env.APP_ENV ?? 'local',
  key: process.env.APP_KEY, // secret for `encrypted` model casts (AES-256-GCM)
  port: Number(process.env.PORT ?? 3000),

  providers: [
    EloquentServiceProvider,
    I18nServiceProvider,
    MailServiceProvider,
    NotificationServiceProvider,
    QueueServiceProvider,
    ScheduleServiceProvider,
    AppServiceProvider,
  ],
})
